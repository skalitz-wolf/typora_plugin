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
    assert.equal(view._storageKey("C:\\notes\\deck.md"), path.resolve("C:\\notes\\deck.md"))
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

describe("marp deck view - docking geometry", () => {
  /**
   * A fake `content` whose measured width reflects whatever inline width has been set on
   * it, the way a real element does. This is what makes the shrinking bug reproducible:
   * measuring after narrowing reads back the narrowed value.
   */
  /**
   * A fake content element whose measured width reflects whatever inline width was set on
   * it, the way a real element does. That is what makes the shrinking bug reproducible:
   * measuring after narrowing reads the narrowed value back.
   */
  const buildLayout = (naturalWidth = 1000) => {
    // `naturalWidth` models the space Typora gives the content area, which the sidebar and
    // the window change. A set inline width wins over it, exactly like a real element.
    const contentEl = {
      style: { width: "" },
      naturalWidth,
      getBoundingClientRect() {
        const set = parseFloat(this.style.width)
        return { left: 0, top: 0, width: Number.isFinite(set) ? set : this.naturalWidth }
      },
    }
    const writeEl = { style: { width: "" } }
    const rootEl = {
      style: {},
      classList: { contains: () => false, add() {}, remove() {}, toggle() {} },
    }
    return { contentEl, writeEl, rootEl }
  }

  const buildView = (naturalWidth, config = {}) => {
    // Class fields are per-instance, so the real constructor must run; its MarpDeck is
    // inert until render is called, which these tests never do.
    const view = new MarpDeckView({
      config: {
        ENABLE_DECK_VIEW: true,
        DECK_PANE_WIDTH_PERCENT: 40,
        DECK_SLIDE_WIDTH: 1280,
        DECK_SLIDE_HEIGHT: 720,
        DECK_EXPORT_SCALE: 2,
        ALLOW_REMOTE_FONTS: false,
        ...config,
      },
      i18n: { t: k => k },
      utils: { Package: { Path: path } },
    })
    const layout = buildLayout(naturalWidth)
    view.entities = { content: layout.contentEl, write: layout.writeEl, root: layout.rootEl }
    // `_onLayoutChanged` ignores events for a document that is not a deck.
    view.activeFile = "C:\\notes\\deck.md"
    return view
  }

  it("splits the full width between editor and pane, not the already-narrowed width", () => {
    const view = buildView(1000)
    view._reposition()
    // 40% of 1000 goes to the pane; the editor keeps 600.
    assert.equal(view.entities.root.style.width, "400px")
    assert.equal(view.entities.content.style.width, "600px")
  })

  it("is idempotent, so entering deck mode twice does not shrink the editor again", () => {
    // The regression: _reposition used to run on activation and again on setting the view
    // mode. Measuring the narrowed content made the second pass shrink by another pane.
    const view = buildView(1000)
    view._reposition()
    view._reposition()
    view._reposition()
    assert.equal(view.entities.content.style.width, "600px")
    assert.equal(view.entities.root.style.width, "400px")
  })

  it("keeps the split correct after the sidebar changes the available width", () => {
    const view = buildView(1000)
    view._reposition()
    // Sidebar opens: the space available to the content area shrinks.
    view.entities.content.naturalWidth = 600
    view._onLayoutChanged()
    // 40% of the new 600 goes to the pane.
    assert.equal(view.entities.root.style.width, "240px")
    assert.equal(view.entities.content.style.width, "360px")
  })

  it("anchors the pane to the content area's right edge, not the window's", () => {
    const view = buildView(1000)
    view._reposition()
    // The pane is position:fixed, so `left` is viewport-relative: the content area's left
    // edge (0 here) plus the full width, less the pane. With a sidebar the content's left
    // is non-zero, which is exactly why anchoring to the window would misplace it.
    assert.equal(view.entities.root.style.left, "600px")
    // Vertical extent comes from CSS (.plugin-common-panel), not from inline styles.
    assert.equal(view.entities.root.style.top, undefined)
    assert.equal(view.entities.root.style.height, undefined)
  })

  it("offsets the pane by the content area's left edge when a sidebar pushes it right", () => {
    const view = buildView(1000)
    view.entities.content.getBoundingClientRect = () => ({ left: 260, top: 40, width: 1000 })
    view._reposition()
    // 260 (content's left) + 1000 (full width) - 400 (pane) = 860
    assert.equal(view.entities.root.style.left, "860px")
  })

  it("restores the editor to full width when the pane goes away", () => {
    const view = buildView(1000)
    view._reposition()
    view._restoreContentWidth()
    assert.equal(view.entities.content.style.width, "")
    assert.equal(view.entities.write.style.width, "")
  })

  it("never squeezes the editor below a usable width", () => {
    const view = buildView(1000, { DECK_PANE_WIDTH_PERCENT: 95 })
    view._reposition()
    assert.ok(parseFloat(view.entities.content.style.width) >= 120)
  })
})

describe("marp deck view - view modes", () => {
  const buildModeView = (naturalWidth = 1000) => {
    const classes = new Set()
    const contentClasses = new Set()
    const view = new MarpDeckView({
      config: { ENABLE_DECK_VIEW: true, DECK_PANE_WIDTH_PERCENT: 40 },
      i18n: { t: k => k },
      utils: { Package: { Path: path } },
    })
    const contentEl = {
      style: { width: "" },
      naturalWidth,
      getBoundingClientRect() {
        const set = parseFloat(this.style.width)
        return { left: 0, top: 0, width: Number.isFinite(set) ? set : this.naturalWidth }
      },
      classList: {
        toggle: (name, on) => (on ? contentClasses.add(name) : contentClasses.delete(name)),
        add: name => contentClasses.add(name),
        remove: name => contentClasses.delete(name),
        contains: name => contentClasses.has(name),
      },
    }
    const rootEl = {
      style: {},
      classList: {
        toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
        add: name => classes.add(name),
        remove: name => classes.delete(name),
        contains: name => classes.has(name),
      },
    }
    view.entities = {
      root: rootEl,
      content: contentEl,
      write: { style: {} },
      body: {
        scrollTop: 0,
        classList: {
          toggle() {}, add() {}, remove() {}, contains: () => false,
        },
      },
      views: [
        { dataset: { view: "editor" }, setAttribute() {} },
        { dataset: { view: "preview" }, setAttribute() {} },
      ],
    }
    view.activeFile = "deck.md"
    return { view, classes, contentClasses }
  }

  it("falls back to two columns for an unknown layout", () => {
    const { view } = buildModeView()
    view._applyLayout("nonsense")
    assert.equal(view.layout, "split")
  })

  it("starts in two columns", () => {
    const { view } = buildModeView()
    assert.equal(view.layout, "split")
  })

  it("isolates the editor when Editor is pressed from two columns", () => {
    const { view } = buildModeView()
    view.setLayoutFromButton("editor")
    assert.equal(view.layout, "editor")
  })

  it("isolates the slides when Preview is pressed from two columns", () => {
    const { view } = buildModeView()
    view.setLayoutFromButton("preview")
    assert.equal(view.layout, "preview")
  })

  it("returns to two columns when either button is pressed while isolated", () => {
    // One rule for both buttons, so there is nothing to remember.
    for (const pressed of ["editor", "preview"]) {
      for (const isolated of ["editor", "preview"]) {
        const { view } = buildModeView()
        view._applyLayout(isolated)
        view.setLayoutFromButton(pressed)
        assert.equal(view.layout, "split", `${isolated} + ${pressed} should give two columns`)
      }
    }
  })

  it("takes two presses to go from editor-only to slides-only", () => {
    // Deliberate: the first press returns to two columns rather than jumping across.
    const { view } = buildModeView()
    view.setLayoutFromButton("editor")
    assert.equal(view.layout, "editor")
    view.setLayoutFromButton("preview")
    assert.equal(view.layout, "split", "the first press must return to two columns")
    view.setLayoutFromButton("preview")
    assert.equal(view.layout, "preview")
  })

  it("never hides the pane, so the buttons are always reachable", () => {
    // The regression: isolating a column used to hide the whole pane, and the buttons went
    // with it, making the choice a one-way trip.
    for (const layout of ["split", "editor", "preview"]) {
      const { view, classes } = buildModeView()
      view._applyLayout(layout)
      assert.ok(!classes.has("plugin-common-hidden"), `the pane must stay visible in ${layout}`)
    }
  })

  it("hides only the slide column when the editor is isolated", () => {
    const { view } = buildModeView()
    let bodyHidden = null
    view.entities.body.classList = {
      toggle: (name, on) => { if (name === "plugin-common-hidden") bodyHidden = on },
      add() {}, remove() {}, contains: () => false,
    }
    view._applyLayout("editor")
    assert.equal(bodyHidden, true, "the slide column should be hidden")
    view._applyLayout("split")
    assert.equal(bodyHidden, false, "the slide column should return")
  })

  it("gives the editor the full width when it is isolated", () => {
    const { view } = buildModeView(1000)
    view._applyLayout("split")
    assert.equal(view.entities.content.style.width, "600px")
    view._applyLayout("editor")
    assert.equal(view.entities.content.style.width, "", "the editor must not be narrowed")
  })

  it("hides the editor rather than narrowing it when the slides are isolated", () => {
    const { view, contentClasses } = buildModeView()
    view._applyLayout("preview")
    assert.ok(contentClasses.has("is-preview"))
    view._applyLayout("split")
    assert.ok(!contentClasses.has("is-preview"))
  })

  it("marks the pane compact only while the editor is isolated", () => {
    const { view, classes } = buildModeView()
    view._applyLayout("editor")
    assert.ok(classes.has("is-editor-only"))
    view._applyLayout("preview")
    assert.ok(!classes.has("is-editor-only"))
  })

  it("presses of the two buttons are the only way the layout changes", () => {
    // A button that names a layout the plugin does not have must be ignored rather than
    // silently treated as one of the real ones.
    const { view } = buildModeView()
    view.setLayoutFromButton("split")
    assert.equal(view.layout, "split", "there is no Split button; it must not be accepted")
  })

  it("gives the pane the whole width when the slides are isolated", () => {
    // The bug: isolating the slides hid the editor but left the pane at its split width, so
    // it stayed a strip against the right edge with empty space where the editor had been.
    const { view } = buildModeView(1000)
    view._applyLayout("split")
    assert.equal(view.entities.root.style.width, "400px")
    view._applyLayout("preview")
    assert.equal(view.entities.root.style.width, "1000px", "the pane must take the full width")
    assert.equal(view.entities.root.style.left, "0px", "and start at the content area's edge")
  })

  it("gives the editor the whole width and shrinks the pane when the editor is isolated", () => {
    const { view } = buildModeView(1000)
    view._applyLayout("editor")
    assert.equal(view.entities.content.style.width, "", "the editor must not be narrowed")
    assert.ok(parseFloat(view.entities.root.style.width) < 1000, "the pane must collapse")
  })

  it("returns the pane to its split share when two columns come back", () => {
    const { view } = buildModeView(1000)
    view._applyLayout("preview")
    assert.equal(view.entities.root.style.width, "1000px")
    view._applyLayout("split")
    assert.equal(view.entities.root.style.width, "400px")
    assert.equal(view.entities.content.style.width, "600px")
  })
})

describe("marp deck view - markup contract", () => {
  /**
   * The pane's positioning comes from the shared plugin-common-panel class rather than from
   * this plugin's own CSS, so losing that class silently breaks the docking. These tests
   * pin the contract that the docking maths depends on.
   */
  const buildViewForMarkup = () => new MarpDeckView({
    config: { ENABLE_DECK_VIEW: true, DECK_PANE_WIDTH_PERCENT: 40 },
    i18n: { t: k => k },
    utils: { Package: { Path: path } },
  })

  it("carries the shared panel class, which supplies the fixed positioning", () => {
    const html = buildViewForMarkup().html()
    assert.match(html, /id="plugin-marp-deck"[^>]*class="[^"]*plugin-common-panel/)
  })

  it("starts hidden, so the pane only appears once deck mode is switched on", () => {
    assert.match(buildViewForMarkup().html(), /plugin-common-hidden/)
  })

  it("offers exactly the two layout buttons and both export formats, as divs", () => {
    const html = buildViewForMarkup().html()
    assert.ok(html.includes('data-view="editor"'))
    assert.ok(html.includes('data-view="preview"'))
    // There is deliberately no Split button: two columns is the resting state, not a choice.
    assert.ok(!html.includes('data-view="split"'), "there must be no Split button")
    assert.ok(html.includes('data-action="export-pptx"'))
    assert.ok(html.includes('data-action="export-pdf"'))
    // Repo rule: plugin UI must not use native button elements.
    assert.ok(!/<button/i.test(html), "the pane must not use a native button")
  })

  it("does not set its own position, deferring to the shared panel class", () => {
    const css = buildViewForMarkup().style()
    const paneBlock = css.match(/#plugin-marp-deck\s*\{[^}]*\}/)[0]
    assert.ok(!/position\s*:/.test(paneBlock), "the pane must not override the shared positioning")
    assert.match(paneBlock, /right:\s*0/)
    assert.match(paneBlock, /height:\s*100%/)
  })
})
