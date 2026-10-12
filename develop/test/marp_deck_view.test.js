const { describe, it, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")

require("./mocks/dom.mock.js")

const MarpDeckView = require("../../plugin/marp/deck-view.js")

/**
 * Only the view's pure helpers are unit-tested, matching the precedent set by the d2 and
 * html_editor file views: the docking and View Mode DOM work is verified by hand in
 * Typora rather than mocked into a test that would mostly assert its own mocks.
 */
const buildView = (config = {}) => {
  const stored = { value: null }
  const plugin = {
    config: {
      ENABLE_DECK_VIEW: true,
      DECK_PANE_WIDTH_PERCENT: 40,
      DECK_RENDER_DELAY: 400,
      DECK_SLIDE_WIDTH: 1280,
      DECK_SLIDE_HEIGHT: 720,
      DECK_EXPORT_SCALE: 2,
      ALLOW_REMOTE_FONTS: false,
      ...config,
    },
    utils: {
      Package: { Path: path },
      getStorage: () => ({
        get: () => stored.value,
        set: value => { stored.value = value },
      }),
      getFilePath: () => "C:\\notes\\deck.md",
      getFileName: () => "deck.md",
    },
    i18n: { t: key => key },
  }
  const view = new MarpDeckView(plugin)
  view.entities = {}
  view.enabledFiles = new Set()
  return { view, stored }
}

describe("marp deck view - which files can be decks", () => {
  it("accepts the Markdown extensions Typora edits", () => {
    const { view } = buildView()
    for (const name of ["a.md", "a.MD", "a.markdown", "a.mdx", "a.rmd", "a.qmd"]) {
      assert.equal(view.isDeckFile(`C:\\notes\\${name}`), true, `${name} should be a deck candidate`)
    }
  })

  it("rejects other file types, including those other plugins own", () => {
    const { view } = buildView()
    for (const name of ["a.d2", "a.html", "a.txt", "a.png", "a"]) {
      assert.equal(view.isDeckFile(`C:\\notes\\${name}`), false, `${name} should not be a deck candidate`)
    }
  })

  it("treats an empty path as not a deck", () => {
    const { view } = buildView()
    assert.equal(view.isDeckFile(""), false)
    assert.equal(view.isDeckFile(undefined), false)
  })
})

describe("marp deck view - the per-file switch", () => {
  it("is off for a Markdown file until the user switches it on", () => {
    const { view } = buildView()
    assert.equal(view.isEnabled("C:\\notes\\deck.md"), false)
  })

  it("stays off for a file type that cannot be a deck even when switched on", () => {
    const { view } = buildView()
    view.enabledFiles.add(path.resolve("C:\\notes\\a.txt"))
    assert.equal(view.isEnabled("C:\\notes\\a.txt"), false)
  })

  it("remembers the switch across view instances", () => {
    const { view, stored } = buildView()
    view.enabledFiles.add(path.resolve("C:\\notes\\deck.md"))
    view._persistEnabled()

    const { view: restored } = buildView()
    restored.enabledFiles = new Set(stored.value)
    assert.equal(restored.isEnabled("C:\\notes\\deck.md"), true)
  })

  it("keys files by resolved path so the same file is recognised however it is spelled", () => {
    const { view } = buildView()
    assert.equal(view._key("C:\\notes\\deck.md"), path.resolve("C:\\notes\\deck.md"))
  })

  it("does not treat another document as a deck", () => {
    const { view } = buildView()
    view.enabledFiles.add(path.resolve("C:\\notes\\deck.md"))
    assert.equal(view.isEnabled("C:\\notes\\other.md"), false)
  })
})

describe("marp deck view - pane sizing", () => {
  it("derives the pane width from the configured percentage", () => {
    const { view } = buildView({ DECK_PANE_WIDTH_PERCENT: 40 })
    assert.equal(view._paneWidthFor(1000), 400)
  })

  it("never lets the pane squeeze the editor below a usable width", () => {
    const { view } = buildView({ DECK_PANE_WIDTH_PERCENT: 80 })
    assert.ok(view._paneWidthFor(1000) <= 880)
  })

  it("prefers an explicit width from dragging over the configured percentage", () => {
    const { view } = buildView({ DECK_PANE_WIDTH_PERCENT: 40 })
    view.paneWidth = 300
    assert.equal(view._paneWidthFor(1000), 300)
  })
})

describe("marp deck view - view modes", () => {
  it("falls back to split for an unknown mode", () => {
    const { view } = buildView()
    view.entities = {
      root: { classList: { toggle() {}, contains: () => false } },
      content: { classList: { toggle() {}, remove() {}, add() {} } },
      views: [],
      body: { scrollTop: 0 },
    }
    view._ensureSourceMode = () => {}
    view._reposition = () => {}
    view._restoreContentWidth = () => {}
    view.setViewMode("nonsense")
    assert.equal(view.viewMode, "split")
  })
})
