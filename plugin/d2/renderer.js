const { spawn } = require("child_process")

/**
 * Thin wrapper around the local d2 executable. Shared by the fence renderer and
 * the standalone .d2 file view, so both go through one code path.
 */
class D2Renderer {
  constructor({ config, utils }) {
    this.config = config
    this.utils = utils
    this.exePath = null
    this.version = null
    this.seq = 0
  }

  /** Resolve the executable once and cache the reported version. */
  load = async () => {
    this.exePath = await this._resolveExe()
    this.version = (await this.exec(["--version"], "").catch(() => "")).trim().split("\n")[0]
  }

  /**
   * d2 derives its CSS class and element-id prefix from a hash of the source, so two
   * identical diagrams in one document collide. Appending a counter keeps them apart;
   * base64 font payloads contain no "-", so this substitution is safe.
   */
  uniquify = svg => svg.replace(/(d2-\d+)/g, `$1-${++this.seq}`)

  render = async (content, meta = {}) => this.uniquify(await this._render(content, meta))

  /** D2_PATH is either an absolute path (must exist) or a bare command name (resolved via PATH). */
  _resolveExe = async () => {
    const exe = this.config.D2_PATH
    const isAbsolute = this.utils.Package.Path.isAbsolute(exe)
    if (isAbsolute && !await this.utils.existPath(exe)) {
      throw new Error(`D2_PATH points to a file that does not exist: ${exe}`)
    }
    return exe
  }

  _render = async (content, meta) => {
    const args = ["--stdout-format", "svg", "--no-xml-tag", "--timeout", String(this.config.TIMEOUT)]
    if (meta.theme !== undefined && meta.theme !== null) args.push("--theme", String(meta.theme))
    if (meta.layout) args.push("--layout", meta.layout)
    if (meta.sketch) args.push("--sketch")
    if (Number.isFinite(meta.pad)) args.push("--pad", String(meta.pad))
    if (Number.isFinite(meta.scale) && meta.scale > 0) args.push("--scale", String(meta.scale))
    if (this.config.FONT_REGULAR && await this.utils.existPath(this.config.FONT_REGULAR)) {
      args.push("--font-regular", this.config.FONT_REGULAR)
    }
    // "-" in, "-" out: source on stdin, SVG on stdout, no temp files.
    args.push("-", "-")
    return this.exec(args, content)
  }

  exec = (args, input) => new Promise((resolve, reject) => {
    const child = spawn(this.exePath || this.config.D2_PATH, args, { windowsHide: true })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", chunk => stdout += chunk)
    child.stderr.on("data", chunk => stderr += chunk)
    child.on("error", err => reject(new Error(
      err.code === "ENOENT"
        ? `Cannot find the d2 executable (D2_PATH = ${this.config.D2_PATH})`
        : err.message,
    )))
    child.on("close", code => {
      if (code === 0) return resolve(stdout)
      reject(new Error(stderr.trim() || `d2 exited with code ${code}`))
    })
    child.stdin.on("error", () => {})  // d2 may exit early on a syntax error; ignore EPIPE
    child.stdin.end(input, "utf8")
  })
}

module.exports = D2Renderer
