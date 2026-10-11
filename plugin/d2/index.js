const { spawn } = require("child_process")

class D2Plugin extends BasePlugin {
  seq = 0
  exePath = null
  version = null
  renderCached = null

  prepare = async () => {
    this.renderCached = this.utils.memoizeLimited(this._render, {
      cap: this.config.CACHE_SIZE,
      keyResolver: (content, meta) => content + "\u0000" + JSON.stringify(meta),
    })
  }

  hotkey = () => [{ hotkey: this.config.HOTKEY, callback: this.call }]

  call = () => this.utils.insertBlockCode(null, this.config.LANGUAGE, this.config.TEMPLATE)

  process = () => {
    const parser = this.utils.thirdPartyDiagramParser
    parser.register({
      lang: this.config.LANGUAGE,
      mappingLang: this.config.MAPPING_LANGUAGE,
      destroyWhenUpdate: false,
      interactiveMode: this.config.INTERACTIVE_MODE,
      metaConfigSchema: {
        ...parser.helpers.styleMetaConfigSchema.wrapDefaultStyle({
          height: this.config.DEFAULT_FENCE_HEIGHT,
          backgroundColor: this.config.DEFAULT_FENCE_BACKGROUND_COLOR,
        }),
        theme: { type: "number", default: this.config.THEME },
        layout: { type: "string", enum: ["dagre", "elk", "tala"], default: this.config.LAYOUT },
        sketch: { type: "boolean", default: this.config.SKETCH },
        pad: { type: "number", default: this.config.PAD },
        scale: { type: "number", default: this.config.SCALE },
      },
      checkSelector: ".plugin-d2-content",
      wrapElement: `<div class="plugin-d2-content"></div>`,
      lazyLoadFunc: this.lazyLoad,
      beforeRenderFunc: null,
      renderStyleGetter: parser.helpers.renderStyle.base,
      createFunc: this.create,
      updateFunc: null,
      destroyFunc: null,
      beforeExportToNative: null,
      beforeExportToHTML: null,
      exportStyleGetter: parser.helpers.exportStyle.svg,
      versionGetter: this.getVersion,
    })
  }

  create = async ($wrap, content, meta) => {
    const svg = await this.renderCached(content, meta)
    $wrap[0].innerHTML = this._uniquify(svg)
  }

  getVersion = () => this.version

  lazyLoad = async () => {
    this.exePath = await this._resolveExe()
    this.version = (await this._exec(["--version"], "").catch(() => "")).trim().split("\n")[0]
  }

  /**
   * d2 给每张图生成的前缀是内容哈希，同一篇文档里两段相同源码会撞 id。
   * 追加自增后缀保证唯一；base64 字体数据里不含 "-"，所以这个替换是安全的。
   */
  _uniquify = svg => svg.replace(/(d2-\d+)/g, `$1-${++this.seq}`)

  /** D2_PATH 是绝对路径就核对存在性；是裸命令名（如 "d2"）就交给 PATH 解析。 */
  _resolveExe = async () => {
    const exe = this.config.D2_PATH
    const isAbsolute = this.utils.Package.Path.isAbsolute(exe)
    if (isAbsolute && !await this.utils.existPath(exe)) {
      throw new Error(`D2_PATH 指向的文件不存在：${exe}`)
    }
    return exe
  }

  _render = async (content, meta) => {
    const args = ["--stdout-format", "svg", "--no-xml-tag", "--timeout", String(this.config.TIMEOUT)]
    if (meta.theme !== undefined) args.push("--theme", String(meta.theme))
    if (meta.layout) args.push("--layout", meta.layout)
    if (meta.sketch) args.push("--sketch")
    if (Number.isFinite(meta.pad)) args.push("--pad", String(meta.pad))
    if (Number.isFinite(meta.scale) && meta.scale > 0) args.push("--scale", String(meta.scale))
    if (this.config.FONT_REGULAR && await this.utils.existPath(this.config.FONT_REGULAR)) {
      args.push("--font-regular", this.config.FONT_REGULAR)
    }
    // "-" 进 "-" 出：源码走 stdin，SVG 走 stdout，不落临时文件
    args.push("-", "-")
    return this._exec(args, content)
  }

  _exec = (args, input) => new Promise((resolve, reject) => {
    const child = spawn(this.exePath || this.config.D2_PATH, args, { windowsHide: true })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", chunk => stdout += chunk)
    child.stderr.on("data", chunk => stderr += chunk)
    child.on("error", err => reject(new Error(
      err.code === "ENOENT"
        ? `找不到 d2 可执行文件（D2_PATH = ${this.config.D2_PATH}）`
        : err.message,
    )))
    child.on("close", code => {
      if (code === 0) return resolve(stdout)
      reject(new Error(stderr.trim() || `d2 exited with code ${code}`))
    })
    child.stdin.on("error", () => {})  // d2 语法出错会提前退出，忽略 EPIPE
    child.stdin.end(input, "utf8")
  })
}

module.exports = {
  plugin: D2Plugin,
}
