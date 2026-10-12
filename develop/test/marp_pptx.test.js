const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const { buildPptx, EMU_PER_PIXEL } = require("../../plugin/marp/pptx.js")
const { readArchive } = require("../../plugin/marp/zip.js")

const PNG = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  Buffer.alloc(64, 7),
])

const page = (index = 0) => ({ data: PNG, mime: "image/png", name: `page${index}` })

const entriesOf = archive => {
  const entries = readArchive(archive)
  return new Map(entries.map(e => [e.name, e.data]))
}

const SLIDE = { width: 1280, height: 720 }

describe("pptx - package structure", () => {
  it("contains every part a reader needs to open the deck", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE }))
    for (const required of [
      "[Content_Types].xml",
      "_rels/.rels",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/theme/theme1.xml",
      "ppt/slides/slide1.xml",
      "ppt/slides/_rels/slide1.xml.rels",
      "ppt/media/image1.png",
    ]) {
      assert.ok(parts.has(required), `missing part: ${required}`)
    }
  })

  it("points the package relationship at the presentation part", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE }))
    assert.match(parts.get("_rels/.rels").toString(), /ppt\/presentation\.xml/)
  })

  it("declares a content type override for every slide", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0), page(1), page(2)], slideSize: SLIDE }))
    const types = parts.get("[Content_Types].xml").toString()
    for (const n of [1, 2, 3]) {
      assert.match(types, new RegExp(`/ppt/slides/slide${n}\\.xml`))
    }
  })

  it("defaults the png extension so image parts are typed", () => {
    const types = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE })).get("[Content_Types].xml").toString()
    assert.match(types, /Extension="png"[^>]*ContentType="image\/png"/)
  })
})

describe("pptx - one slide per page image", () => {
  it("creates exactly one slide part per image", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0), page(1), page(2)], slideSize: SLIDE }))
    const slides = [...parts.keys()].filter(k => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    assert.deepEqual(slides.sort(), ["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"])
  })

  it("creates exactly one media part per image", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0), page(1)], slideSize: SLIDE }))
    const media = [...parts.keys()].filter(k => k.startsWith("ppt/media/"))
    assert.deepEqual(media.sort(), ["ppt/media/image1.png", "ppt/media/image2.png"])
  })

  it("lists every slide in the presentation, in order", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0), page(1), page(2)], slideSize: SLIDE }))
    const presentation = parts.get("ppt/presentation.xml").toString()
    const ids = [...presentation.matchAll(/<p:sldId id="(\d+)" r:id="(rId\d+)"/g)].map(m => m[2])
    assert.deepEqual(ids, ["rId2", "rId3", "rId4"])
  })

  it("wires each slide to its own image, not a shared one", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0), page(1)], slideSize: SLIDE }))
    const first = parts.get("ppt/slides/_rels/slide1.xml.rels").toString()
    const second = parts.get("ppt/slides/_rels/slide2.xml.rels").toString()
    assert.match(first, /\.\.\/media\/image1\.png/)
    assert.match(second, /\.\.\/media\/image2\.png/)
    assert.ok(!first.includes("image2.png"))
  })

  it("keeps the media bytes intact", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE }))
    assert.deepEqual(parts.get("ppt/media/image1.png"), PNG)
  })

  it("puts the image on the slide, referenced by the slide's own relationship id", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE }))
    const slide = parts.get("ppt/slides/slide1.xml").toString()
    const rels = parts.get("ppt/slides/_rels/slide1.xml.rels").toString()
    const embed = slide.match(/<a:blip r:embed="(rId\d+)"/)[1]
    assert.ok(rels.includes(`Id="${embed}"`), "slide must reference a relationship it declares")
  })
})

describe("pptx - page geometry", () => {
  it("derives the slide size from the page geometry rather than defaulting to 4:3", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: { width: 1280, height: 720 } }))
    const presentation = parts.get("ppt/presentation.xml").toString()
    const size = presentation.match(/<p:sldSz cx="(\d+)" cy="(\d+)"/)
    const cx = Number(size[1])
    const cy = Number(size[2])
    assert.equal(cx, 1280 * EMU_PER_PIXEL)
    assert.equal(cy, 720 * EMU_PER_PIXEL)
    // 16:9, not the 10x7.5in default a naive writer would emit.
    assert.ok(Math.abs(cx / cy - 16 / 9) < 0.001)
  })

  it("sizes the picture to fill the whole slide", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: { width: 1280, height: 720 } }))
    const slide = parts.get("ppt/slides/slide1.xml").toString()
    // The picture's own transform is the last <a:ext>; the first belongs to the shape tree.
    const extents = [...slide.matchAll(/<a:ext cx="(\d+)" cy="(\d+)"/g)]
    const picture = extents[extents.length - 1]
    assert.equal(Number(picture[1]), 1280 * EMU_PER_PIXEL)
    assert.equal(Number(picture[2]), 720 * EMU_PER_PIXEL)
  })

  it("honours a 4:3 page geometry", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: { width: 960, height: 720 } }))
    const presentation = parts.get("ppt/presentation.xml").toString()
    assert.equal(Number(presentation.match(/<p:sldSz cx="(\d+)"/)[1]), 960 * EMU_PER_PIXEL)
  })
})

describe("pptx - image types", () => {
  it("names and types a jpeg page correctly", () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 3)])
    const parts = entriesOf(buildPptx({ pages: [{ data: jpeg }], slideSize: SLIDE }))
    assert.ok(parts.has("ppt/media/image1.jpeg"))
    assert.match(parts.get("[Content_Types].xml").toString(), /Extension="jpeg"[^>]*ContentType="image\/jpeg"/)
  })

  it("infers the type from the image's own bytes when no mime is given", () => {
    const parts = entriesOf(buildPptx({ pages: [{ data: PNG }], slideSize: SLIDE }))
    assert.ok(parts.has("ppt/media/image1.png"))
  })
})

describe("pptx - input validation", () => {
  it("rejects an empty page list instead of writing a broken file", () => {
    assert.throws(() => buildPptx({ pages: [], slideSize: SLIDE }), /at least one page/i)
  })

  it("rejects a page with no image data", () => {
    assert.throws(() => buildPptx({ pages: [{ data: Buffer.alloc(0) }], slideSize: SLIDE }), /image/i)
  })

  it("rejects a page geometry that is missing or zero", () => {
    assert.throws(() => buildPptx({ pages: [page(0)] }), /slideSize/i)
    assert.throws(() => buildPptx({ pages: [page(0)], slideSize: { width: 0, height: 720 } }), /slideSize/i)
  })
})

describe("pptx - speaker notes", () => {
  it("attaches notes to the slide they belong to", () => {
    const parts = entriesOf(buildPptx({
      pages: [page(0), page(1)],
      slideSize: SLIDE,
      notes: ["first note", ""],
    }))
    assert.ok(parts.has("ppt/notesSlides/notesSlide1.xml"))
    assert.ok(!parts.has("ppt/notesSlides/notesSlide2.xml"), "an empty note should not create a part")
    assert.match(parts.get("ppt/notesSlides/notesSlide1.xml").toString(), /first note/)
  })

  it("wires a notes slide back to its own slide", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE, notes: ["x"] }))
    assert.match(parts.get("ppt/notesSlides/_rels/notesSlide1.xml.rels").toString(), /\.\.\/slides\/slide1\.xml/)
  })

  it("links the slide to its notes slide, which is what makes the notes reachable", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE, notes: ["x"] }))
    const rels = parts.get("ppt/slides/_rels/slide1.xml.rels").toString()
    assert.match(rels, /notesSlide1\.xml/)
    assert.match(rels, /\/notesSlide"/)
  })

  it("does not link a slide to notes that do not exist", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE }))
    assert.ok(!/notesSlide/.test(parts.get("ppt/slides/_rels/slide1.xml.rels").toString()))
  })

  it("declares the content type for a notes slide", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE, notes: ["x"] }))
    assert.match(parts.get("[Content_Types].xml").toString(), /notesSlide/)
  })

  it("omits every notes part when there are no notes at all", () => {
    const names = [...entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE })).keys()]
    assert.deepEqual(names.filter(n => /notesSlide/.test(n)), [])
  })

  it("escapes markup in a note so the xml stays valid", () => {
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE, notes: ["<b> & \"x\""] }))
    assert.match(parts.get("ppt/notesSlides/notesSlide1.xml").toString(), /&lt;b&gt; &amp; &quot;x&quot;/)
  })

  it("keeps the note text in a shape a reader can find, rather than an inherited placeholder", () => {
    // A placeholder body inherits from the notes master, and readers treat the master's
    // empty body as authoritative, losing the text. An explicit text shape avoids that.
    const parts = entriesOf(buildPptx({ pages: [page(0)], slideSize: SLIDE, notes: ["hello"] }))
    const notes = parts.get("ppt/notesSlides/notesSlide1.xml").toString()
    assert.match(notes, /txBox="1"/)
    assert.ok(!/<p:ph /.test(notes), "the note must not be a placeholder")
    assert.match(notes, /<a:t>hello<\/a:t>/)
  })
})

describe("pptx - determinism", () => {
  it("produces byte-identical output for identical input", () => {
    const build = () => buildPptx({ pages: [page(0), page(1)], slideSize: SLIDE })
    assert.deepEqual(build(), build())
  })
})
