const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const MarpDeck = require("../../plugin/marp/deck.js")

const DECK = `---
theme: gaia
paginate: true
---

# Slide One

hello **world**

---

# Slide Two

- alpha
- beta
`

const render = (markdown, options) => new MarpDeck(options).render(markdown)

describe("marp deck - slide splitting", () => {
  it("produces one entry per slide split on horizontal rules", async () => {
    const slides = await render(DECK)
    assert.equal(slides.length, 2)
  })

  it("indexes slides from zero in document order", async () => {
    const slides = await render(DECK)
    assert.deepEqual(slides.map(s => s.index), [0, 1])
  })

  it("puts each slide's own content in its own entry", async () => {
    const slides = await render(DECK)
    assert.match(slides[0].svg, /Slide One/)
    assert.ok(!slides[0].svg.includes("Slide Two"))
    assert.match(slides[1].svg, /Slide Two/)
  })

  it("honours headingDivider as an alternative split", async () => {
    const slides = await render("# One\n\n## Two\n\n## Three\n", {
      marpOptions: { html: true, headingDivider: 2 },
    })
    assert.equal(slides.length, 3)
  })

  it("renders a single slide deck as one entry", async () => {
    const slides = await render("# Only\n")
    assert.equal(slides.length, 1)
  })
})

describe("marp deck - directives survive", () => {
  it("applies front matter directives to the rendered slide", async () => {
    const slides = await render(DECK)
    assert.match(slides[0].svg, /data-theme="gaia"/)
    assert.match(slides[0].svg, /--paginate:true/)
  })

  it("keeps a per-slide _class directive", async () => {
    const slides = await render(`---\ntheme: gaia\n---\n\n<!-- _class: lead -->\n\n# Big\n`)
    assert.match(slides[0].svg, /data-class="lead"/)
  })

  it("exposes slide comments as notes", async () => {
    const slides = await render(`# One\n\n<!-- a speaker note -->\n\n---\n\n# Two\n`)
    assert.equal(slides[0].notes, "a speaker note")
    assert.equal(slides[1].notes, "")
  })

  it("keeps background images declared through the bg directive", async () => {
    const slides = await render(`# One\n\n![bg](https://example.com/x.png)\n`)
    assert.match(slides[0].svg, /background-image/)
  })
})

describe("marp deck - raster-safe stylesheet", () => {
  it("removes the marpit container scoping so the stylesheet can apply inside a bare svg", async () => {
    const [slide] = await render(DECK)
    assert.ok(!slide.svg.includes("div.marpit"), "de-scoped stylesheet must not reference the stripped container")
  })

  it("drops @charset, which makes a stylesheet inert inside an svg document", async () => {
    const [slide] = await render(DECK)
    assert.ok(!/@charset/.test(slide.svg))
  })

  it("drops remote @import font fetching by default so offline export cannot stall", async () => {
    const [slide] = await render(DECK)
    assert.ok(!/@import/.test(slide.svg))
  })

  it("keeps @import when remote fonts are explicitly allowed", async () => {
    const [slide] = await render(DECK, { allowRemoteFonts: true })
    assert.match(slide.svg, /@import/)
  })

  it("carries the theme rules that actually style slides", async () => {
    const [slide] = await render(DECK)
    assert.match(slide.svg, /<style>/)
    assert.match(slide.svg, /@theme gaia/)
  })
})

describe("marp deck - raster-safe svg shape", () => {
  it("declares the svg namespace, without which an svg data url fails to decode", async () => {
    const [slide] = await render(DECK)
    assert.match(slide.svg, /^<svg[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
  })

  it("gives the root svg an intrinsic size taken from its viewBox", async () => {
    const [slide] = await render(DECK)
    const root = slide.svg.match(/^<svg\b[^>]*>/)[0]
    assert.match(root, /width="1280"/)
    assert.match(root, /height="720"/)
  })

  it("puts foreignObject content in the xhtml namespace", async () => {
    const [slide] = await render(DECK)
    assert.match(slide.svg, /<foreignObject[^>]*><section[^>]*xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/)
  })

  it("removes marp's inline script, which is meaningless in a rasterized slide", async () => {
    const [slide] = await render(DECK)
    assert.ok(!/<script/i.test(slide.svg))
  })

  it("turns marp's remote twemoji images back into text, so emoji survive offline", async () => {
    // Marp rewrites emoji to a remote twemoji <img>, which rasterizes as a broken-image
    // glyph with no network. The alt text carries the original emoji character.
    const [slide] = await render("# Hi 🎉 and 😄\n")
    assert.ok(!/<img[^>]*data-marp-twemoji/.test(slide.svg), "remote emoji images must not reach the bitmap")
    assert.ok(!slide.svg.includes("cdn.jsdelivr.net/gh/jdecked/twemoji"), "no remote emoji asset should remain")
    assert.match(slide.svg, /🎉/)
    assert.match(slide.svg, /😄/)
  })
})

describe("marp deck - image inlining", () => {
  it("rewrites a local image src to a data uri", async () => {
    const resolveImage = async url => (url === "pic.png" ? "data:image/png;base64,AAAA" : null)
    const [slide] = await render("# One\n\n![alt](pic.png)\n", { resolveImage })
    assert.match(slide.svg, /src="data:image\/png;base64,AAAA"/)
    assert.ok(!slide.svg.includes('src="pic.png"'))
  })

  it("rewrites a background image declared through the bg directive", async () => {
    const resolveImage = async url => (url === "bg.png" ? "data:image/png;base64,BBBB" : null)
    const [slide] = await render("# One\n\n![bg](bg.png)\n", { resolveImage })
    assert.match(slide.svg, /data:image\/png;base64,BBBB/)
  })

  it("leaves remote images alone", async () => {
    const resolveImage = async () => null
    const [slide] = await render("# One\n\n![alt](https://example.com/x.png)\n", { resolveImage })
    assert.match(slide.svg, /https:\/\/example\.com\/x\.png/)
  })

  it("works without a resolver, leaving markup untouched", async () => {
    const [slide] = await render("# One\n\n![alt](pic.png)\n")
    assert.match(slide.svg, /pic\.png/)
  })
})

describe("marp deck - per-slide identity", () => {
  it("gives identical slides the same hash", async () => {
    const a = await render("# Same\n")
    const b = await render("# Same\n")
    assert.equal(a[0].hash, b[0].hash)
  })

  it("gives different slides different hashes", async () => {
    const slides = await render(DECK)
    assert.notEqual(slides[0].hash, slides[1].hash)
  })

  it("changes a slide's hash when only that slide's content changes", async () => {
    const before = await render("# One\n\n---\n\n# Two\n")
    const after = await render("# One\n\n---\n\n# Two changed\n")
    assert.equal(before[0].hash, after[0].hash)
    assert.notEqual(before[1].hash, after[1].hash)
  })
})
