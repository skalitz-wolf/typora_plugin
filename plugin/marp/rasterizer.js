/**
 * Turns a slide's SVG into a bitmap, inside the Typora renderer.
 *
 * ADR-0003 records why this runs in-process rather than by driving an external browser
 * the way Marp CLI does, and the three hazards that make it non-obvious. Two of them are
 * handled upstream in `deck.js` (the stylesheet is de-scoped, local images are inlined);
 * this module owns the rest: the SVG must declare its namespace and intrinsic size, the
 * image must actually decode before drawing, and a decode failure must surface as an
 * error rather than a silently blank page.
 *
 * This module is intentionally DOM-dependent and has no dependencies, so it can also be
 * loaded inside a page for verification.
 */

const PNG_SIGNATURE = "image/png"

const toDataUrl = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`

const decodeImage = (dataUrl) => new Promise((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error("the slide could not be decoded as an image"))
  image.src = dataUrl
})

const encodeCanvas = (canvas, mime, quality) => {
  const dataUrl = quality === undefined ? canvas.toDataURL(mime) : canvas.toDataURL(mime, quality)
  const marker = `data:${mime};base64,`
  if (!dataUrl.startsWith(marker)) {
    throw new Error(`the browser could not encode the slide as ${mime}`)
  }
  const binary = atob(dataUrl.slice(marker.length))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * @param {string} svg a slide from the deck renderer
 * @param {{width: number, height: number, scale?: number, background?: string, mime?: string, quality?: number}} options
 * @returns {Promise<Uint8Array>} encoded image bytes
 */
const rasterizeSlide = async (svg, { width, height, scale = 1, background, mime = PNG_SIGNATURE, quality } = {}) => {
  if (typeof svg !== "string" || svg === "") throw new Error("rasterizeSlide needs a slide svg")
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error("rasterizeSlide needs a positive width and height")
  }
  if (!Number.isFinite(scale) || scale <= 0) throw new Error("rasterizeSlide needs a positive scale")

  const image = await decodeImage(toDataUrl(svg))
  const pixelWidth = Math.max(1, Math.round(width * scale))
  const pixelHeight = Math.max(1, Math.round(height * scale))

  const canvas = document.createElement("canvas")
  canvas.width = pixelWidth
  canvas.height = pixelHeight
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("this environment has no 2d canvas context")

  // Only paint a background when asked: PNG keeps its transparency otherwise, which is
  // what a deck with a transparent theme wants. JPEG has no alpha, so it needs one.
  if (background) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, pixelWidth, pixelHeight)
  } else if (mime === "image/jpeg") {
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, pixelWidth, pixelHeight)
  }

  ctx.drawImage(image, 0, 0, pixelWidth, pixelHeight)
  return encodeCanvas(canvas, mime, quality)
}

/**
 * Rasterizes every slide in order, reporting progress between pages.
 *
 * `isCancelled` is consulted before each page rather than during one, so cancellation
 * never leaves a half-drawn image behind.
 *
 * @param {Array<{svg: string}>} slides
 * @param {{width: number, height: number, scale?: number, background?: string, mime?: string}} options
 * @param {{onProgress?: (done: number, total: number) => void, isCancelled?: () => boolean}} hooks
 * @returns {Promise<Uint8Array[]>}
 */
const rasterizeDeck = async (slides, options, { onProgress, isCancelled } = {}) => {
  if (!Array.isArray(slides) || slides.length === 0) throw new Error("there are no slides to rasterize")
  const images = []
  for (let i = 0; i < slides.length; i++) {
    if (typeof isCancelled === "function" && isCancelled()) {
      throw new Error("export cancelled")
    }
    images.push(await rasterizeSlide(slides[i].svg, options))
    if (typeof onProgress === "function") onProgress(i + 1, slides.length)
  }
  return images
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { rasterizeSlide, rasterizeDeck }
}
