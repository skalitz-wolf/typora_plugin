const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const { buildFontFaceCss, fontFamilyFromPath, isFontFile } = require("../../plugin/marp/fonts.js")

describe("marp fonts - recognising font files", () => {
  it("accepts the formats a browser can load", () => {
    for (const name of ["a.ttf", "a.OTF", "a.woff", "a.woff2"]) {
      assert.equal(isFontFile(name), true, `${name} should be a font`)
    }
  })

  it("rejects everything else", () => {
    for (const name of ["a.txt", "a.png", "a", "a.ttf.bak"]) {
      assert.equal(isFontFile(name), false, `${name} should not be a font`)
    }
  })
})

describe("marp fonts - deriving a family name", () => {
  it("uses the file name without its extension", () => {
    assert.equal(fontFamilyFromPath("/fonts/SourceHanSansSC-Regular.otf"), "SourceHanSansSC-Regular")
  })

  it("handles windows separators", () => {
    assert.equal(fontFamilyFromPath("C:\\fonts\\My Font.ttf"), "My Font")
  })
})

describe("marp fonts - building font-face rules", () => {
  const font = (name, data) => ({ path: `/fonts/${name}`, data: Buffer.from(data) })

  it("emits one @font-face rule per font, with a data uri source", () => {
    const css = buildFontFaceCss([
      font("Alpha.ttf", "AAAA"),
      font("Beta.woff2", "BBBB"),
    ])
    assert.equal((css.match(/@font-face/g) || []).length, 2)
    assert.match(css, /font-family:"Alpha"/)
    assert.match(css, /font-family:"Beta"/)
    assert.match(css, /data:font\/ttf;base64,QUFBQQ==/)
    assert.match(css, /data:font\/woff2;base64,QkJCQg==/)
  })

  it("maps each extension to the right mime type", () => {
    const css = buildFontFaceCss([
      font("a.ttf", "x"),
      font("b.otf", "x"),
      font("c.woff", "x"),
      font("d.woff2", "x"),
    ])
    for (const mime of ["font/ttf", "font/otf", "font/woff", "font/woff2"]) {
      assert.ok(css.includes(`data:${mime};base64`), `expected a ${mime} source`)
    }
    for (const format of ["truetype", "opentype", "woff", "woff2"]) {
      assert.ok(css.includes(`format("${format}")`), `expected a ${format} format hint`)
    }
  })

  it("returns nothing for no fonts, rather than an empty rule", () => {
    assert.equal(buildFontFaceCss([]), "")
    assert.equal(buildFontFaceCss(null), "")
  })

  it("escapes a quote in a family name so the stylesheet stays valid", () => {
    const css = buildFontFaceCss([font('We"ird.ttf', "x")])
    assert.ok(!/font-family:"We"ird"/.test(css))
    assert.match(css, /font-family:"We\\"ird"/)
  })

  it("skips entries with no data", () => {
    assert.equal(buildFontFaceCss([{ path: "/fonts/empty.ttf", data: null }]), "")
  })
})

describe("marp fonts - a font stack for the deck", () => {
  it("prepends the supplied families so they win over the theme's own stack", () => {
    const css = buildFontFaceCss([{ path: "/f/A.ttf", data: Buffer.from("x") }], { prependTo: "section" })
    assert.match(css, /section\{font-family:"A"\}/)
  })
})
