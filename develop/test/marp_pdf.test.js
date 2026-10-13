const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const zlib = require("node:zlib")

const { buildPdf } = require("../../plugin/marp/pdf.js")

/** Encodes raw RGB pixels as a PNG (colour type 2), which is what the rasterizer emits. */
const encodePng = (width, height, pixel) => {
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 3)
    raw[rowStart] = 0  // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y)
      const at = rowStart + 1 + x * 3
      raw[at] = r
      raw[at + 1] = g
      raw[at + 2] = b
    }
  }

  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, "ascii"), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([length, body, crc])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 2   // colour type: truecolour
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

const solidPng = (width, height, [r, g, b]) => encodePng(width, height, () => [r, g, b])

/**
 * A minimal but structurally real JPEG: SOI, an APP0 segment, a baseline SOF0 carrying the
 * dimensions, an SOS, then EOI. The dimensions have to be readable or the page geometry
 * cannot be derived.
 */
const makeJpeg = (width, height) => {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])
  const sof0 = Buffer.alloc(19)
  sof0.writeUInt16BE(0xffc0, 0)
  sof0.writeUInt16BE(17, 2)      // segment length
  sof0[4] = 8                     // precision
  sof0.writeUInt16BE(height, 5)
  sof0.writeUInt16BE(width, 7)
  sof0[9] = 3                     // components
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    sof0,
    sos,
    Buffer.alloc(32, 0x5a),
    Buffer.from([0xff, 0xd9]),
  ])
}

const JPEG = makeJpeg(64, 48)

const countPages = pdf => (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length

describe("pdf - page count", () => {
  it("writes exactly one page per image", () => {
    const pdf = buildPdf({ pages: [{ data: solidPng(8, 8, [1, 2, 3]) }, { data: solidPng(8, 8, [4, 5, 6]) }] })
    assert.equal(countPages(pdf), 2)
  })

  it("writes a single page for a single image", () => {
    assert.equal(countPages(buildPdf({ pages: [{ data: solidPng(4, 4, [9, 9, 9]) }] })), 1)
  })

  it("writes many pages", () => {
    const pages = Array.from({ length: 12 }, () => ({ data: solidPng(4, 4, [0, 0, 0]) }))
    assert.equal(countPages(buildPdf({ pages })), 12)
  })
})

describe("pdf - page geometry", () => {
  it("sizes each page to the slide geometry, not to the pixel dimensions", () => {
    // 1280x720 px at 96 dpi is 13.333x7.5 in, i.e. 960x540 pt.
    const pdf = buildPdf({
      pages: [{ data: solidPng(2560, 1440, [0, 0, 0]) }],
      slideSize: { width: 1280, height: 720 },
    })
    const box = pdf.toString("latin1").match(/\/MediaBox\s*\[([^\]]+)\]/)
    const [, , width, height] = box[1].trim().split(/\s+/).map(Number)
    assert.ok(Math.abs(width - 960) < 1, `expected 960pt wide, got ${width}`)
    assert.ok(Math.abs(height - 540) < 1, `expected 540pt tall, got ${height}`)
  })

  it("keeps a 4:3 geometry 4:3", () => {
    const pdf = buildPdf({
      pages: [{ data: solidPng(16, 16, [0, 0, 0]) }],
      slideSize: { width: 960, height: 720 },
    })
    const box = pdf.toString("latin1").match(/\/MediaBox\s*\[([^\]]+)\]/)[1].trim().split(/\s+/).map(Number)
    assert.ok(Math.abs(box[2] / box[3] - 4 / 3) < 0.001)
  })

  it("defaults the geometry when none is given", () => {
    const pdf = buildPdf({ pages: [{ data: solidPng(8, 8, [0, 0, 0]) }] })
    assert.match(pdf.toString("latin1"), /\/MediaBox/)
  })
})

describe("pdf - structure", () => {
  it("starts with a pdf header and ends with the trailer", () => {
    const pdf = buildPdf({ pages: [{ data: solidPng(8, 8, [0, 0, 0]) }] })
    assert.match(pdf.subarray(0, 8).toString("latin1"), /^%PDF-1\.\d/)
    assert.match(pdf.toString("latin1").trimEnd().slice(-5), /%%EOF/)
  })

  it("declares an xref table whose offsets point at object headers", () => {
    const pdf = buildPdf({ pages: [{ data: solidPng(8, 8, [0, 0, 0]) }] })
    const text = pdf.toString("latin1")
    // The table keyword, not the "startxref" pointer that follows it.
    const xrefAt = text.lastIndexOf("\nxref\n") + 1
    assert.ok(xrefAt > 0)
    const startxref = Number(text.match(/startxref\s+(\d+)/)[1])
    assert.equal(text.slice(startxref, startxref + 4), "xref")

    const entries = text.slice(xrefAt).split("\n").filter(line => /^\d{10} \d{5} n/.test(line))
    assert.ok(entries.length >= 4, "expected an xref entry per object")
    for (const entry of entries) {
      const offset = Number(entry.slice(0, 10))
      assert.match(text.slice(offset, offset + 12), /^\d+ 0 obj/, `offset ${offset} does not point at an object`)
    }
  })

  it("carries a catalog and a page tree", () => {
    const text = buildPdf({ pages: [{ data: solidPng(8, 8, [0, 0, 0]) }] }).toString("latin1")
    assert.match(text, /\/Type\s*\/Catalog/)
    assert.match(text, /\/Type\s*\/Pages/)
  })
})

describe("pdf - image embedding", () => {
  it("flate-encodes a png page as raw rgb", () => {
    const pdf = buildPdf({ pages: [{ data: solidPng(4, 2, [10, 20, 30]) }] })
    const text = pdf.toString("latin1")
    assert.match(text, /\/FlateDecode/)
    assert.match(text, /\/ColorSpace\s*\/DeviceRGB/)
    assert.match(text, /\/Width\s+4/)
    assert.match(text, /\/Height\s+2/)
  })

  it("round-trips the actual pixel values", () => {
    const pdf = buildPdf({ pages: [{ data: solidPng(3, 3, [200, 100, 50]) }] })
    // Find the flate stream, inflate it, and check the first pixel.
    const latin = pdf.toString("latin1")
    const streamAt = latin.indexOf("stream\n", latin.indexOf("/FlateDecode")) + "stream\n".length
    const endAt = latin.indexOf("\nendstream", streamAt)
    const raw = zlib.inflateSync(pdf.subarray(streamAt, endAt))
    assert.equal(raw.length, 3 * 3 * 3)
    assert.deepEqual([raw[0], raw[1], raw[2]], [200, 100, 50])
  })

  it("passes a jpeg through as DCTDecode rather than re-encoding it", () => {
    const pdf = buildPdf({ pages: [{ data: JPEG }] })
    const text = pdf.toString("latin1")
    assert.match(text, /\/DCTDecode/)
    assert.ok(pdf.includes(JPEG), "jpeg bytes should be embedded verbatim")
  })

  it("handles a png with an alpha channel by compositing onto white", () => {
    const rgba = encodeRgbaPng(2, 1, [[255, 0, 0, 255], [0, 0, 255, 0]])
    const pdf = buildPdf({ pages: [{ data: rgba }] })
    const latin = pdf.toString("latin1")
    const streamAt = latin.indexOf("stream\n", latin.indexOf("/FlateDecode")) + "stream\n".length
    const endAt = latin.indexOf("\nendstream", streamAt)
    const raw = zlib.inflateSync(pdf.subarray(streamAt, endAt))
    // Opaque red stays red; fully transparent blue becomes the white background.
    assert.deepEqual([raw[0], raw[1], raw[2]], [255, 0, 0])
    assert.deepEqual([raw[3], raw[4], raw[5]], [255, 255, 255])
  })
})

describe("pdf - input validation", () => {
  it("rejects an empty page list", () => {
    assert.throws(() => buildPdf({ pages: [] }), /at least one page/i)
  })

  it("rejects a page with no data", () => {
    assert.throws(() => buildPdf({ pages: [{ data: Buffer.alloc(0) }] }), /image/i)
  })

  it("rejects an unsupported image format with a clear message", () => {
    assert.throws(
      () => buildPdf({ pages: [{ data: Buffer.from("not an image at all") }] }),
      /unsupported image/i,
    )
  })
})

describe("pdf - determinism", () => {
  it("produces byte-identical output for identical input", () => {
    const build = () => buildPdf({ pages: [{ data: solidPng(8, 8, [1, 2, 3]) }] })
    assert.deepEqual(build(), build())
  })
})

/** Minimal RGBA (colour type 6) encoder, for the alpha-compositing case. */
function encodeRgbaPng(width, height, pixels) {
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let i = 0; i < width * height; i++) {
    const at = i * 4 + 1
    raw[at] = pixels[i][0]
    raw[at + 1] = pixels[i][1]
    raw[at + 2] = pixels[i][2]
    raw[at + 3] = pixels[i][3]
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, "ascii"), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(zlib.crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}
