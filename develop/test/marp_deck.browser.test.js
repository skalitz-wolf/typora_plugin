const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const test = require("node:test")

let chromium
try {
  ({ chromium } = require("playwright-core"))
} catch {
  chromium = null
}

const defaultBrowserPath = process.platform === "win32"
  ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
  : ""
const browserPath = process.env.TYPORA_PLUGIN_BROWSER_PATH || defaultBrowserPath
const browserAvailable = Boolean(chromium && browserPath && fs.existsSync(browserPath))

const MarpDeck = require("../../plugin/marp/deck.js")

// A tiny opaque PNG, used to prove that an image referenced by path is *not* enough and
// that inlining it as a data URI is what makes it survive rasterization.
const RED_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHgQCAf2m2cMAAAAASUVORK5CYII=",
  "base64",
)

const DECK = `---
theme: gaia
paginate: true
---

# Rasterize Me

hello **world**
`

/**
 * Rasterizes an SVG string in a real browser the way the plugin will, then reports both
 * a pixel probe and the resulting PNG size.
 */
const rasterizeInBrowser = (page, svg, { width, height, probe }) => page.evaluate(
  async ({ svg, width, height, probe }) => {
    const image = new Image()
    const loaded = await new Promise(resolve => {
      image.onload = () => resolve(true)
      image.onerror = () => resolve(false)
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg)
    })
    if (!loaded) return { error: "image failed to decode" }

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    // Magenta is deliberately not a colour Marp's themes use, so it is unambiguous that
    // whatever we probe is slide content rather than the canvas we started with.
    ctx.fillStyle = "#ff00ff"
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)

    const pixels = probe.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data))
    const url = canvas.toDataURL("image/png")
    // A full-canvas scan, so an assertion about "is this colour present at all" does not
    // depend on guessing where a particular element landed.
    const scan = Array.from(ctx.getImageData(0, 0, width, height).data)
    const countColor = (r, g, b) => {
      let hits = 0
      for (let i = 0; i < scan.length; i += 4) {
        if (scan[i] === r && scan[i + 1] === g && scan[i + 2] === b) hits++
      }
      return hits
    }
    return {
      pixels,
      pngBytes: Math.floor((url.length - "data:image/png;base64,".length) * 3 / 4),
      magentaPixels: countColor(255, 0, 255),
      redPixels: countColor(255, 0, 0),
      totalPixels: width * height,
    }
  },
  { svg, width, height, probe },
)

const runBrowserVerification = async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await page.setContent("<!doctype html><html><body></body></html>")

    const deck = new MarpDeck()
    const [slide] = await deck.render(DECK)

    // The whole point: a slide rendered to a bitmap must not be blank. Before the
    // de-scoping fix this probe returned pure magenta (the canvas fill) for every pixel.
    const result = await rasterizeInBrowser(page, slide.svg, {
      width: 1280,
      height: 720,
      probe: [[20, 20], [200, 200], [640, 360]],
    })
    assert.ok(!result.error, result.error)
    for (const pixel of result.pixels) {
      assert.notDeepEqual(pixel, [255, 0, 255, 255], "slide rasterized blank (canvas fill showing through)")
    }
    // The gaia theme paints a light background, so the top-left corner must be light.
    const [r, g, b] = result.pixels[0]
    assert.ok(r > 200 && g > 200 && b > 180, `expected a light themed background, got rgb(${r},${g},${b})`)
    assert.ok(result.pngBytes > 2000, "a themed slide should encode to more than a flat colour")

    // A slide whose image is inlined as a data URI must render that image.
    const dataUri = "data:image/png;base64," + RED_PNG.toString("base64")
    const withImage = new MarpDeck({ resolveImage: async url => (url === "pic.png" ? dataUri : null) })
    const [imageSlide] = await withImage.render("# One\n\n![alt](pic.png)\n")
    const imageResult = await rasterizeInBrowser(page, imageSlide.svg, {
      width: 1280,
      height: 720,
      probe: [[640, 400]],
    })
    assert.ok(!imageResult.error, imageResult.error)
    assert.ok(imageResult.redPixels > 0, "inlined image did not reach the bitmap")

    // Control: the same image referenced by path cannot be resolved from a data: URL svg,
    // which is exactly why inlining is mandatory rather than cosmetic.
    const byPath = await deck.render("# One\n\n![alt](pic.png)\n")
    const pathResult = await rasterizeInBrowser(page, byPath[0].svg, {
      width: 1280,
      height: 720,
      probe: [[640, 400]],
    })
    assert.ok(!pathResult.error, pathResult.error)
    assert.equal(
      pathResult.redPixels,
      0,
      "a path-referenced image unexpectedly rendered; the inlining requirement may no longer hold",
    )
  } finally {
    await browser.close()
  }
}

if (process.env.MARP_BROWSER_VERIFY === "1") {
  runBrowserVerification()
    .then(() => console.log("BROWSER VERIFY OK"))
    .catch(error => {
      console.error(error)
      process.exitCode = 1
    })
} else {
  test("rasterizes a Marp slide to a non-blank bitmap in Chromium", {
    skip: !browserAvailable,
    timeout: 30000,
  }, runBrowserVerification)
}
