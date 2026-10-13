/**
 * Shared shape for the rasterized pages the exporters consume.
 *
 * Both the PPTX and PDF writers need the same two things from their input - a list of page
 * images with a known type, and a slide geometry - and both need the same validation. They
 * are kept here rather than duplicated so the two writers cannot drift apart on what they
 * accept or on which formats are recognised.
 */

const MIME_BY_EXTENSION = {
  png: "image/png",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
}

const DEFAULT_SLIDE_SIZE = { width: 1280, height: 720 }

/** Detect an image type from its magic bytes, so callers need not supply a mime type. */
const detectImageType = data => {
  if (data.length >= 8 && data.readUInt32BE(0) === 0x89504e47) return { ext: "png", mime: "image/png" }
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return { ext: "jpeg", mime: "image/jpeg" }
  if (data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") {
    return { ext: "webp", mime: "image/webp" }
  }
  if (data.length >= 6 && data.toString("ascii", 0, 3) === "GIF") return { ext: "gif", mime: "image/gif" }
  return null
}

const mimeForExtension = extension => MIME_BY_EXTENSION[String(extension || "").toLowerCase().replace(/^\./, "")] || null

const normalizeSlideSize = (slideSize, { fallback = false } = {}) => {
  const width = slideSize?.width ?? (fallback ? DEFAULT_SLIDE_SIZE.width : undefined)
  const height = slideSize?.height ?? (fallback ? DEFAULT_SLIDE_SIZE.height : undefined)
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("slideSize needs positive width and height")
  }
  return { width, height }
}

/**
 * @param {Array<{data: Buffer, mime?: string}>} pages
 * @param {string} what used in the error message, e.g. "presentation" or "pdf"
 */
const normalizePages = (pages, what) => {
  if (!Array.isArray(pages) || pages.length === 0) {
    throw new Error(`a ${what} needs at least one page`)
  }
  return pages.map((page, index) => {
    const data = page?.data
    if (!Buffer.isBuffer(data) || data.length === 0) {
      throw new Error(`page ${index + 1} has no image data`)
    }
    const type = detectImageType(data) || { ext: "png", mime: page.mime || "image/png" }
    return { data, ext: type.ext, mime: type.mime }
  })
}

module.exports = {
  DEFAULT_SLIDE_SIZE,
  MIME_BY_EXTENSION,
  detectImageType,
  mimeForExtension,
  normalizePages,
  normalizeSlideSize,
}
