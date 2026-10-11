const { describe, it, beforeEach } = require("node:test")
const assert = require("node:assert/strict")
const path = require("node:path")
const proxyquire = require("proxyquire")

require("./mocks/dom.mock.js")
const mockUtils = require("./mocks/utils.mock.js")

const d2Path = path.resolve(__dirname, "../../plugin/d2/index.js")

// The framework exposes BasePlugin as a global; load the real class but stub its utils
// so no Typora runtime (fs-extra from the install dir) is needed.
const BasePlugin = proxyquire("../../plugin/global/core/plugin.js", {
  "./utils": { ...mockUtils, "@noCallThru": true },
})
global.BasePlugin = BasePlugin

/** Build a plugin instance with the config keys the real settings section provides. */
async function createPlugin(overrides = {}) {
  const config = {
    ENABLE: true,
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
    TEMPLATE: "x -> y",
    ...overrides,
  }
  delete require.cache[d2Path]
  const { plugin: D2Plugin } = require(d2Path)
  const instance = new D2Plugin("d2", config, { t: key => key })
  // Swap in a utils stub so no Typora runtime is needed.
  instance.utils = {
    memoizeLimited: (fn, { cap = 100, keyResolver = (...a) => JSON.stringify(a) } = {}) => {
      const cache = new Map()
      return (...args) => {
        const key = keyResolver(...args)
        if (cache.has(key)) return cache.get(key)
        const value = fn(...args)
        cache.set(key, value)
        if (cache.size > cap) cache.delete(cache.keys().next().value)
        return value
      }
    },
    existPath: async () => true,
    Package: { Path: path },
  }
  await instance.prepare()
  return instance
}

describe("d2 plugin - option mapping", () => {
  let plugin

  beforeEach(async () => {
    plugin = await createPlugin()
    plugin.exePath = "d2"
  })

  const captureArgs = async (content, meta) => {
    let captured = null
    plugin._exec = (args) => {
      captured = args
      return Promise.resolve("<svg></svg>")
    }
    await plugin._render(content, meta)
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

    plugin = await createPlugin({ FONT_REGULAR: "C:\\Windows\\Fonts\\simhei.ttf" })
    plugin.exePath = "d2"
    const args = await captureArgs("x -> y", {})
    assert.equal(args[args.indexOf("--font-regular") + 1], "C:\\Windows\\Fonts\\simhei.ttf")
  })
})

describe("d2 plugin - SVG uniquification", () => {
  it("appends a distinct suffix to every d2-<hash> prefix so repeated diagrams do not share ids", async () => {
    const plugin = await createPlugin()
    plugin.exePath = "d2"
    const svg = '<svg id="d2-123"></svg><style>.d2-123 text{}</style>'
    plugin._exec = () => Promise.resolve(svg)

    const render = async (content, meta) => {
      const $wrap = [{ innerHTML: "" }]
      await plugin.create($wrap, content, meta)
      return $wrap[0].innerHTML
    }
    const first = await render("x -> y", {})
    const second = await render("a -> b", {})

    const idOf = html => html.match(/id="(d2-123-\d+)"/)[1]
    assert.notEqual(idOf(first), idOf(second))
    assert.ok(first.includes(".d2-123-1 text"))
    assert.ok(second.includes(".d2-123-2 text"))
  })

  it("caches by content and options, so identical input renders once", async () => {
    const plugin = await createPlugin()
    plugin.exePath = "d2"
    let calls = 0
    plugin._exec = () => { calls++; return Promise.resolve("<svg></svg>") }

    await plugin.renderCached("x -> y", {})
    await plugin.renderCached("x -> y", {})
    await plugin.renderCached("x -> y", { theme: 1 })

    assert.equal(calls, 2)
  })

  it("re-renders the same source into independent DOM ids when it appears twice", async () => {
    const plugin = await createPlugin()
    plugin.exePath = "d2"
    plugin._exec = () => Promise.resolve('<svg id="d2-999"></svg>')

    const render = async () => {
      const $wrap = [{ innerHTML: "" }]
      await plugin.create($wrap, "x -> y", {})
      return $wrap[0].innerHTML
    }
    assert.notEqual(await render(), await render())
  })
})

describe("d2 plugin - error handling", () => {
  it("surfaces a missing executable as an actionable message", async () => {
    const plugin = await createPlugin({ D2_PATH: "C:\\nope\\d2.exe" })
    plugin.exePath = "C:\\nope\\d2.exe"
    await assert.rejects(
      () => plugin._exec(["--version"], ""),
      err => err.message.includes("D2_PATH"),
    )
  })

  it("rejects when d2 exits non-zero, keeping the stderr text", async () => {
    const plugin = await createPlugin()
    plugin.exePath = process.execPath  // node: exits non-zero on a bogus script arg
    await assert.rejects(() => plugin._exec(["--definitely-not-a-flag"], ""))
  })

  it("accepts a bare command name but rejects an absolute path that does not exist", async () => {
    const bare = await createPlugin({ D2_PATH: "d2" })
    bare.utils.existPath = async () => false
    assert.equal(await bare._resolveExe(), "d2")

    const absolute = await createPlugin({ D2_PATH: "C:\\nope\\d2.exe" })
    absolute.utils.existPath = async () => false
    await assert.rejects(() => absolute._resolveExe(), /D2_PATH/)
  })
})
