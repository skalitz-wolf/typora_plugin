const { describe, it, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const proxyquire = require("proxyquire")

require("./mocks/dom.mock.js")
const mockUtils = require("./mocks/utils.mock.js")

// The framework exposes BasePlugin as a global; load the real class but stub its utils
// so no Typora runtime (fs-extra from the install dir) is needed.
const BasePlugin = proxyquire("../../plugin/global/core/plugin.js", {
  "./utils": { ...mockUtils, "@noCallThru": true },
})
global.BasePlugin = BasePlugin

const D2Renderer = require("../../plugin/d2/renderer.js")
const D2Fence = require("../../plugin/d2/fence.js")

const memoizeLimited = (fn, { cap = 100, keyResolver = (...a) => JSON.stringify(a) } = {}) => {
  const cache = new Map()
  return (...args) => {
    const key = keyResolver(...args)
    if (cache.has(key)) return cache.get(key)
    const value = fn(...args)
    cache.set(key, value)
    if (cache.size > cap) cache.delete(cache.keys().next().value)
    return value
  }
}

const CONFIG = {
  LANGUAGE: "d2",
  MAPPING_LANGUAGE: "yaml",
  INTERACTIVE_MODE: true,
  D2_PATH: "d2",
  TIMEOUT: 60,
  CACHE_SIZE: 50,
  FONT_REGULAR: "",
  THEME: 0,
  LAYOUT: "dagre",
  SKETCH: false,
  PAD: 40,
  SCALE: 0,
  DEFAULT_FENCE_HEIGHT: "auto",
  DEFAULT_FENCE_BACKGROUND_COLOR: "transparent",
}

const buildUtils = () => ({
  memoizeLimited,
  existPath: async () => true,
  Package: { Path: path },
})

const createRenderer = (overrides = {}) => new D2Renderer({
  config: { ...CONFIG, ...overrides },
  utils: buildUtils(),
})

const createFence = async () => {
  const plugin = { config: CONFIG, utils: buildUtils() }
  const fence = new D2Fence(plugin)
  await fence.prepare()
  return fence
}

describe("d2 renderer - option mapping", () => {
  let renderer

  beforeEach(() => {
    renderer = createRenderer()
    renderer.exePath = "d2"
  })

  const captureArgs = async (content, meta) => {
    let captured = null
    renderer.exec = args => {
      captured = args
      return Promise.resolve("<svg></svg>")
    }
    await renderer._render(content, meta)
    return captured
  }

  it("always requests SVG on stdout with the XML tag omitted", async () => {
    const args = await captureArgs("x -> y", {})
    assert.deepEqual(args.slice(0, 4), ["--stdout-format", "svg", "--no-xml-tag", "--timeout"])
    assert.equal(args.at(-2), "-")
    assert.equal(args.at(-1), "-")
  })

  it("maps meta options onto d2 CLI flags", async () => {
    const args = await captureArgs("x -> y", { theme: 3, layout: "elk", sketch: true, pad: 10, scale: 2 })
    assert.equal(args[args.indexOf("--theme") + 1], "3")
    assert.equal(args[args.indexOf("--layout") + 1], "elk")
    assert.ok(args.includes("--sketch"))
    assert.equal(args[args.indexOf("--pad") + 1], "10")
    assert.equal(args[args.indexOf("--scale") + 1], "2")
  })

  it("omits flags whose meta value means 'keep the default'", async () => {
    const args = await captureArgs("x -> y", { sketch: false, scale: 0 })
    assert.ok(!args.includes("--sketch"))
    assert.ok(!args.includes("--scale"))
  })

  it("passes the font flag only when FONT_REGULAR is configured", async () => {
    assert.ok(!(await captureArgs("x -> y", {})).includes("--font-regular"))

    renderer = createRenderer({ FONT_REGULAR: "C:\\Windows\\Fonts\\simhei.ttf" })
    renderer.exePath = "d2"
    const args = await captureArgs("x -> y", {})
    assert.equal(args[args.indexOf("--font-regular") + 1], "C:\\Windows\\Fonts\\simhei.ttf")
  })
})

describe("d2 renderer - SVG uniquification", () => {
  it("copies the natural size from the inner svg onto the outer one", async () => {
    // d2 emits `<svg viewBox=...><svg width=W height=H>`; without a width the outer
    // element defaults to 100% and small diagrams stretch to fill the container.
    const renderer = createRenderer()
    const svg = '<svg viewBox="0 0 10 10"><svg width="256" height="434" viewBox="0 0 1 1"></svg></svg>'
    assert.match(renderer._applyNaturalSize(svg), /^<svg width="256" height="434"/)
  })

  it("leaves an outer svg that already declares its size untouched", async () => {
    const renderer = createRenderer()
    const svg = '<svg width="100" height="200"><svg width="256" height="434"></svg></svg>'
    assert.equal(renderer._applyNaturalSize(svg), svg)
  })

  it("leaves markup without a measurable inner svg untouched", async () => {
    const renderer = createRenderer()
    for (const svg of ["<svg viewBox='0 0 1 1'></svg>", "<svg><svg></svg></svg>", "not svg at all"]) {
      assert.equal(renderer._applyNaturalSize(svg), svg)
    }
  })

  it("appends a distinct suffix to every d2-<hash> prefix so repeated diagrams do not share ids", async () => {
    const renderer = createRenderer()
    renderer.exePath = "d2"
    const svg = '<svg id="d2-123"></svg><style>.d2-123 text{}</style>'
    renderer.exec = () => Promise.resolve(svg)

    const first = await renderer.render("x -> y")
    const second = await renderer.render("a -> b")

    assert.match(first, /id="d2-123-1"/)
    assert.match(second, /id="d2-123-2"/)
    assert.ok(first.includes(".d2-123-1 text"))
    assert.ok(second.includes(".d2-123-2 text"))
  })
})

describe("d2 renderer - error handling", () => {
  it("surfaces a missing executable as an actionable message", async () => {
    const renderer = createRenderer({ D2_PATH: "C:\\nope\\d2.exe" })
    renderer.exePath = "C:\\nope\\d2.exe"
    await assert.rejects(
      () => renderer.exec(["--version"], ""),
      err => err.message.includes("D2_PATH"),
    )
  })

  it("rejects when d2 exits non-zero, keeping the stderr text", async () => {
    const renderer = createRenderer()
    renderer.exePath = process.execPath  // node: exits non-zero on a bogus flag
    await assert.rejects(() => renderer.exec(["--definitely-not-a-flag"], ""))
  })

  it("accepts a bare command name but rejects an absolute path that does not exist", async () => {
    const bare = createRenderer({ D2_PATH: "d2" })
    bare.utils.existPath = async () => false
    assert.equal(await bare._resolveExe(), "d2")

    const absolute = createRenderer({ D2_PATH: "C:\\nope\\d2.exe" })
    absolute.utils.existPath = async () => false
    await assert.rejects(() => absolute._resolveExe(), /D2_PATH/)
  })
})

describe("d2 fence - caching", () => {
  it("caches by content and options, so identical input renders once", async () => {
    const fence = await createFence()
    let calls = 0
    fence.renderer.render = () => { calls++; return Promise.resolve("<svg></svg>") }
    fence.renderCached = memoizeLimited(
      (content, meta) => fence.renderer.render(content, meta),
      { cap: 50, keyResolver: (content, meta) => content + "\u0000" + JSON.stringify(meta) },
    )

    await fence.renderCached("x -> y", {})
    await fence.renderCached("x -> y", {})
    await fence.renderCached("x -> y", { theme: 1 })

    assert.equal(calls, 2)
  })

  it("writes the rendered SVG into the wrap element", async () => {
    const fence = await createFence()
    fence.renderCached = () => Promise.resolve('<svg id="d2-1-1"></svg>')
    const $wrap = [{ innerHTML: "" }]
    await fence.create($wrap, "x -> y", {})
    assert.equal($wrap[0].innerHTML, '<svg id="d2-1-1"></svg>')
  })
})

describe("d2 file view - source handling", () => {
  const D2FileView = require("../../plugin/d2/file-view.js")

  const buildFileView = (config = {}) => {
    const plugin = {
      config: { ...CONFIG, ENABLE_FILE_VIEW: true, FILE_VIEW_DEFAULT_MODE: "split", FILE_VIEW_AUTO_PREVIEW: true, FILE_VIEW_DELAY: 300, ...config },
      utils: buildUtils(),
      i18n: { t: key => key },
      pluginName: "D2",
    }
    return new D2FileView(plugin)
  }

  it("only claims .d2 paths, case-insensitively", () => {
    const view = buildFileView()
    assert.equal(view._isD2File("C:\\a\\b.d2"), true)
    assert.equal(view._isD2File("C:\\a\\b.D2"), true)
    assert.equal(view._isD2File("C:\\a\\b.md"), false)
    assert.equal(view._isD2File("C:\\a\\d2"), false)
    assert.equal(view._isD2File(""), false)
  })

  it("compares paths case-insensitively on Windows", () => {
    const view = buildFileView()
    if (process.platform !== "win32") return
    assert.equal(view._samePath("C:\\A\\B.d2", "c:\\a\\b.d2"), true)
    assert.equal(view._samePath("C:\\A\\B.d2", "C:\\a\\c.d2"), false)
  })

  it("is dirty only when the editor text differs from what was saved", () => {
    const view = buildFileView()
    view.entities = { textarea: { value: "x -> y" } }
    view.activeFile = ""
    assert.equal(view._isDirty(), false)

    view.activeFile = "C:\\a\\b.d2"
    view.savedSource = "x -> y"
    assert.equal(view._isDirty(), false)

    view.entities.textarea.value = "x -> z"
    assert.equal(view._isDirty(), true)
  })

  it("renders with the configured defaults, since a whole file has no meta block", () => {
    const view = buildFileView({ THEME: 3, LAYOUT: "elk", SKETCH: true, PAD: 20, SCALE: 0 })
    assert.deepEqual(view._meta(), { theme: 3, layout: "elk", sketch: true, pad: 20, scale: 0 })
  })

  it("reads and writes through the textarea, never through window.CodeMirror", () => {
    const view = buildFileView()
    const textarea = { value: "x -> y" }
    view.entities = { textarea }
    // Typora patches its bundled CodeMirror so third-party instances break on setValue;
    // the file view must therefore never touch it.
    window.CodeMirror = () => { throw new Error("must not be instantiated") }
    assert.equal(view._getEditorValue(), "x -> y")
    view._setEditorValue("a -> b")
    assert.equal(textarea.value, "a -> b")
    assert.equal(view.editor, undefined)
    window.CodeMirror = undefined
  })
})
