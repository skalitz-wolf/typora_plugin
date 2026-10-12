const zlib = require("zlib")

/**
 * Builds a PDF with one page per rasterized slide.
 *
 * Typora's own PDF export cannot be reused: the preview hides the editor, so printing
 * would capture the editor rather than the deck, and it paginates as a document rather
 * than as slides. The repo does vendor a PDF library, but it lives inside Typora's
 * `lib.asar` and is only reachable through `unstableRequire`, which would make this
 * module untestable and would tie it to Typora's private layout. Raster pages need no
 * fonts, no text and no layout engine, so a small direct writer is both sufficient and
 * far easier to test - the same reasoning as the zip writer (ADR-0004).
 *
 * Everything here is pure: bytes in, bytes out, deterministic output.
 */

const DEFAULT_SLIDE_SIZE = { width: 1280, height: 720 }

// PDF user-space units are points: 72 per inch, and the rasterizer works at 96 dpi.
const POINTS_PER_PIXEL = 72 / 96

const escapeName = value => String(value).replace(/[^A-Za-z0-9]/g, "")

/** Parses the chunks of a PNG just far enough to read IHDR and the concatenated IDAT. */
const parsePng = data => {
  if (data.length < 8 || data.readUInt32BE(0) !== 0x89504e47) return null

  let offset = 8
  let header = null
  const idat = []
  while (offset + 8 <= data.length) {
    const length = data.readUInt32BE(offset)
    const type = data.toString("ascii", offset + 4, offset + 8)
    const body = data.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      header = {
        width: body.readUInt32BE(0),
        height: body.readUInt32BE(4),
        bitDepth: body[8],
        colorType: body[9],
        interlace: body[12],
      }
    } else if (type === "IDAT") {
      idat.push(Buffer.from(body))
    } else if (type === "IEND") {
      break
    }
    offset += 12 + length
  }
  if (!header) return null
  return { ...header, data: Buffer.concat(idat) }
}

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

/** Reverses PNG's per-scanline filters, so the pixels can be re-encoded as raw RGB. */
const unfilter = (raw, width, height, bytesPerPixel, bytesPerRow) => {
  const out = Buffer.alloc(height * bytesPerRow)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (bytesPerRow + 1)]
    const lineStart = y * (bytesPerRow + 1) + 1
    const outStart = y * bytesPerRow
    const prevStart = outStart - bytesPerRow
    for (let x = 0; x < bytesPerRow; x++) {
      const value = raw[lineStart + x]
      const left = x >= bytesPerPixel ? out[outStart + x - bytesPerPixel] : 0
      const up = y > 0 ? out[prevStart + x] : 0
      const upLeft = y > 0 && x >= bytesPerPixel ? out[prevStart + x - bytesPerPixel] : 0
      let restored
      switch (filter) {
        case 0: restored = value; break
        case 1: restored = value + left; break
        case 2: restored = value + up; break
        case 3: restored = value + ((left + up) >> 1); break
        case 4: restored = value + paeth(left, up, upLeft); break
        default: throw new Error(`unsupported png filter ${filter}`)
      }
      out[outStart + x] = restored & 0xff
    }
  }
  return out
}

/**
 * Decodes a PNG to raw RGB bytes, compositing any alpha onto white.
 *
 * The rasterizer's own canvas output is opaque, so this mainly guards against a caller
 * passing a transparent PNG: PDF image XObjects have no alpha, and dropping the alpha
 * channel instead of compositing would turn transparent areas black.
 */
const decodePngToRgb = data => {
  const png = parsePng(data)
  if (!png) return null
  if (png.bitDepth !== 8) throw new Error(`unsupported png bit depth ${png.bitDepth}`)
  if (png.interlace !== 0) throw new Error("interlaced png images are not supported")

  const channelsByColorType = { 0: 1, 2: 3, 4: 2, 6: 4 }
  const channels = channelsByColorType[png.colorType]
  if (!channels) throw new Error(`unsupported png colour type ${png.colorType}`)

  const bytesPerRow = png.width * channels
  const raw = zlib.inflateSync(png.data)
  const pixels = unfilter(raw, png.width, png.height, channels, bytesPerRow)

  if (channels === 3) return pixels

  const rgb = Buffer.alloc(png.width * png.height * 3)
  for (let i = 0; i < png.width * png.height; i++) {
    const at = i * channels
    let r
    let g
    let b
    let alpha
    if (channels === 4) {
      r = pixels[at]; g = pixels[at + 1]; b = pixels[at + 2]; alpha = pixels[at + 3]
    } else if (channels === 2) {
      r = g = b = pixels[at]; alpha = pixels[at + 1]
    } else {
      r = g = b = pixels[at]; alpha = 255
    }
    const out = i * 3
    if (alpha === 255) {
      rgb[out] = r; rgb[out + 1] = g; rgb[out + 2] = b
    } else {
      rgb[out] = Math.round((r * alpha + 255 * (255 - alpha)) / 255)
      rgb[out + 1] = Math.round((g * alpha + 255 * (255 - alpha)) / 255)
      rgb[out + 2] = Math.round((b * alpha + 255 * (255 - alpha)) / 255)
    }
  }
  return rgb
}

const isJpeg = data => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff

const jpegSize = data => {
  let offset = 2
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) { offset++; continue }
    const marker = data[offset + 1]
    // Start-of-frame markers carry the dimensions; skip the others.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) }
    }
    offset += 2 + data.readUInt16BE(offset + 2)
  }
  return null
}

const normalizePages = pages => {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error("a pdf needs at least one page")
  }
  return pages.map((page, index) => {
    const data = page?.data
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new Error(`page ${index + 1} has no image data`)
    }
    if (isJpeg(data)) {
      const size = jpegSize(data)
      if (!size) throw new Error(`page ${index + 1}: could not read the jpeg dimensions`)
      return { kind: "jpeg", data, width: size.width, height: size.height }
    }
    const rgb = decodePngToRgb(data)
    if (!rgb) throw new Error(`page ${index + 1}: unsupported image format`)
    const png = parsePng(data)
    return { kind: "png", data, rgb, width: png.width, height: png.height }
  })
}

const normalizeSlideSize = slideSize => {
  const width = slideSize?.width ?? DEFAULT_SLIDE_SIZE.width
  const height = slideSize?.height ?? DEFAULT_SLIDE_SIZE.height
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("slideSize needs positive width and height")
  }
  return { width, height }
}

/**
 * @param {{pages: Array<{data: Buffer}>, slideSize?: {width: number, height: number}}} options
 * @returns {Buffer} PDF bytes
 */
const buildPdf = ({ pages, slideSize } = {}) => {
  const normalized = normalizePages(pages)
  const size = normalizeSlideSize(slideSize)
  const pageWidth = size.width * POINTS_PER_PIXEL
  const pageHeight = size.height * POINTS_PER_PIXEL

  // Objects: 1 catalog, 2 page tree, then per page an image XObject, a content stream,
  // and a page object. The content stream scales the unit image onto the whole page.
  const objects = []
  const pageObjectNumbers = []
  let nextNumber = 3

  for (const page of normalized) {
    const imageNumber = nextNumber++
    const contentNumber = nextNumber++
    const pageNumber = nextNumber++

    const imageDict = page.kind === "jpeg"
      ? `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height}` +
        ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>`
      : `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height}` +
        ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode` +
        ` /Length ${zlib.deflateSync(page.rgb).length} >>`

    const imageStream = page.kind === "jpeg" ? page.data : zlib.deflateSync(page.rgb)
    const content = `q\n${pageWidth} 0 0 ${pageHeight} 0 0 cm\n/Im0 Do\nQ\n`

    objects.push({
      number: imageNumber,
      body: Buffer.concat([
        Buffer.from(`${imageDict}\nstream\n`, "latin1"),
        imageStream,
        Buffer.from("\nendstream", "latin1"),
      ]),
    })
    objects.push({
      number: contentNumber,
      body: Buffer.from(
        `<< /Length ${content.length} >>\nstream\n${content}endstream`,
        "latin1",
      ),
    })
    objects.push({
      number: pageNumber,
      body: Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}]` +
        ` /Resources << /XObject << /Im0 ${imageNumber} 0 R >> >> /Contents ${contentNumber} 0 R >>`,
        "latin1",
      ),
    })
    pageObjectNumbers.push(pageNumber)
  }

  const catalog = {
    number: 1,
    body: Buffer.from("<< /Type /Catalog /Pages 2 0 R >>", "latin1"),
  }
  const pageTree = {
    number: 2,
    body: Buffer.from(
      `<< /Type /Pages /Kids [${pageObjectNumbers.map(n => `${n} 0 R`).join(" ")}]` +
      ` /Count ${pageObjectNumbers.length} >>`,
      "latin1",
    ),
  }
  const all = [catalog, pageTree, ...objects].sort((a, b) => a.number - b.number)

  const header = Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")
  const chunks = [header]
  const offsets = new Map()
  let cursor = header.length

  for (const object of all) {
    offsets.set(object.number, cursor)
    const prefix = Buffer.from(`${object.number} 0 obj\n`, "latin1")
    const suffix = Buffer.from("\nendobj\n", "latin1")
    chunks.push(prefix, object.body, suffix)
    cursor += prefix.length + object.body.length + suffix.length
  }

  const maxNumber = all[all.length - 1].number
  const xrefOffset = cursor
  const xrefLines = [`xref\n0 ${maxNumber + 1}\n`, "0000000000 65535 f \n"]
  for (let n = 1; n <= maxNumber; n++) {
    const offset = offsets.get(n)
    if (offset === undefined) throw new Error(`internal error: object ${n} was never written`)
    xrefLines.push(`${String(offset).padStart(10, "0")} 00000 n \n`)
  }
  chunks.push(Buffer.from(xrefLines.join(""), "latin1"))
  chunks.push(Buffer.from(
    `trailer\n<< /Size ${maxNumber + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    "latin1",
  ))

  return Buffer.concat(chunks)
}

module.exports = { buildPdf, POINTS_PER_PIXEL, escapeName }
