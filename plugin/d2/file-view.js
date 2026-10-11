const D2Renderer = require("./renderer.js")

const EXT = ".d2"
const ACTIVE_CLASS = "plugin-d2-file-active"

/**
 * Lets Typora open standalone .d2 files: registers the extension, then takes over the
 * editing area with a source pane (CodeMirror, falling back to a textarea) plus a live
 * SVG preview. Mirrors the approach used by the html_editor plugin.
 */
class D2FileView {
  constructor(plugin) {
    this.plugin = plugin
    this.utils = plugin.utils
    this.renderer = new D2Renderer({ config: plugin.config, utils: this.utils })
    this.editor = null          // CodeMirror instance when available
    this.activeFile = ""
    this.savedSource = ""
    this.currentStat = null
    this.activationToken = 0
    this.renderToken = 0
    this.renderTimer = null
    this.bypassOpenGuard = false
  }

  get enabled() {
    return Boolean(this.plugin.config.ENABLE_FILE_VIEW)
  }

  style = () => `
    content.${ACTIVE_CLASS} {
      overflow: hidden !important;
    }
    content.${ACTIVE_CLASS} > #write,
    content.${ACTIVE_CLASS} > #typora-source,
    content.${ACTIVE_CLASS} > #ty-oversize-body {
      display: none !important;
    }
    content.${ACTIVE_CLASS} ~ footer.ty-footer {
      display: none !important;
    }
    #plugin-d2-file-view {
      position: absolute !important;
      top: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      left: 0 !important;
      width: auto !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      box-sizing: border-box;
      z-index: 20;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: var(--text-color, #172033);
      background: var(--bg-color, #fff);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
    }
    #plugin-d2-file-view .d2fv-header {
      display: flex;
      align-items: center;
      flex: 0 0 auto;
      height: 38px;
      padding: 0 10px;
      border-bottom: 1px solid var(--window-border-color, rgba(15, 23, 42, .12));
      background: var(--side-bar-bg-color, #f8fafc);
      font-size: 12px;
    }
    #plugin-d2-file-view .d2fv-path {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: .72;
      margin-right: 10px;
    }
    #plugin-d2-file-view .d2fv-button {
      flex: 0 0 auto;
      padding: 3px 9px;
      margin-left: 6px;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
    }
    #plugin-d2-file-view .d2fv-button:hover {
      background: var(--item-hover-bg-color, rgba(15, 23, 42, .06));
    }
    #plugin-d2-file-view .d2fv-button[aria-pressed="true"] {
      background: var(--item-active-bg-color, rgba(66, 133, 244, .14));
    }
    #plugin-d2-file-view .d2fv-button.is-disabled {
      opacity: .4;
      cursor: default;
    }
    #plugin-d2-file-view .d2fv-button.is-disabled:hover {
      background: transparent;
    }
    #plugin-d2-file-view .d2fv-workspace {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      flex: 1 1 0;
      min-height: 0;
      overflow: hidden;
    }
    #plugin-d2-file-view.is-source .d2fv-preview-pane,
    #plugin-d2-file-view.is-preview .d2fv-source-pane {
      display: none;
    }
    #plugin-d2-file-view.is-source .d2fv-workspace,
    #plugin-d2-file-view.is-preview .d2fv-workspace {
      grid-template-columns: minmax(0, 1fr);
    }
    #plugin-d2-file-view .d2fv-pane {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
    }
    #plugin-d2-file-view .d2fv-source-pane {
      border-right: 1px solid var(--window-border-color, rgba(15, 23, 42, .12));
    }
    #plugin-d2-file-view .d2fv-source {
      box-sizing: border-box;
      width: 100%;
      height: 100%;
      margin: 0;
      padding: 14px 18px;
      resize: none;
      border: 0;
      outline: 0;
      color: inherit;
      background: inherit;
      font-family: "Cascadia Code", Consolas, "Courier New", monospace;
      font-size: 14px;
      line-height: 1.55;
      tab-size: 2;
      white-space: pre;
    }
    #plugin-d2-file-view .CodeMirror {
      width: 100%;
      height: 100%;
      font-family: "Cascadia Code", Consolas, "Courier New", monospace;
      font-size: 14px;
      line-height: 1.55;
      background: transparent;
      color: inherit;
    }
    #plugin-d2-file-view .d2fv-preview-pane {
      display: flex;
      align-items: flex-start;
      justify-content: center;
      overflow: auto;
      background: #fff;
    }
    #plugin-d2-file-view .d2fv-preview {
      max-width: 100%;
      padding: 16px;
      box-sizing: border-box;
    }
    #plugin-d2-file-view .d2fv-preview svg {
      display: block;
      max-width: 100%;
      height: auto;
      margin: 0 auto;
    }
    #plugin-d2-file-view .d2fv-error {
      margin: 16px;
      padding: 10px 12px;
      border-radius: 4px;
      white-space: pre-wrap;
      font-family: "Cascadia Code", Consolas, monospace;
      font-size: 12px;
      color: #991b1b;
      background: #fee2e2;
    }
  `

  html = () => `
    <div id="plugin-d2-file-view" class="plugin-common-hidden is-split" aria-label="D2">
      <div class="d2fv-header">
        <div class="d2fv-path"></div>
        <div class="d2fv-button" role="button" tabindex="0" data-action="save" aria-disabled="true">${this.plugin.i18n.t("fileView.save")}</div>
        <div class="d2fv-button" role="button" tabindex="0" data-action="reload">${this.plugin.i18n.t("fileView.reload")}</div>
        <div class="d2fv-button" role="button" tabindex="0" data-action="external">${this.plugin.i18n.t("fileView.external")}</div>
        <div class="d2fv-button" role="button" tabindex="0" data-view="source">${this.plugin.i18n.t("fileView.source")}</div>
        <div class="d2fv-button" role="button" tabindex="0" data-view="preview">${this.plugin.i18n.t("fileView.preview")}</div>
        <div class="d2fv-button" role="button" tabindex="0" data-view="split" aria-pressed="true">${this.plugin.i18n.t("fileView.split")}</div>
      </div>
      <div class="d2fv-workspace">
        <div class="d2fv-pane d2fv-source-pane">
          <textarea class="d2fv-source" spellcheck="false" aria-label="${this.plugin.i18n.t("fileView.source")}"></textarea>
        </div>
        <div class="d2fv-pane d2fv-preview-pane">
          <div class="d2fv-preview"></div>
        </div>
      </div>
    </div>
  `

  init = () => {
    const root = document.querySelector("#plugin-d2-file-view")
    this.entities = {
      root,
      content: this.utils.entities.eContent,
      path: root.querySelector(".d2fv-path"),
      sourcePane: root.querySelector(".d2fv-source-pane"),
      textarea: root.querySelector(".d2fv-source"),
      preview: root.querySelector(".d2fv-preview"),
      save: root.querySelector('[data-action="save"]'),
      reload: root.querySelector('[data-action="reload"]'),
      external: root.querySelector('[data-action="external"]'),
      views: [...root.querySelectorAll("[data-view]")],
    }
  }

  process = () => {
    if (!this.enabled) return
    this._registerFileTypes()
    this._installReadMask()
    this._installOpenGuard()
    this._installSaveRedirect()

    this.entities.save.addEventListener("click", () => {
      if (this.entities.save.getAttribute("aria-disabled") !== "true") this.save()
    })
    this.entities.reload.addEventListener("click", () => this.reload())
    this.entities.external.addEventListener("click", () => this.activeFile && this.utils.openPath(this.activeFile))
    this.entities.views.forEach(button => {
      button.addEventListener("click", () => this._setViewMode(button.dataset.view))
    })
    this.entities.textarea.addEventListener("input", () => this._onInput())
    this.entities.textarea.addEventListener("keydown", event => this._onKeydown(event))

    this.utils.eventHub.on(this.utils.eventHub.eventType.fileContentLoaded, this._onFileContentLoaded)
    this.utils.eventHub.on(this.utils.eventHub.eventType.allPluginsHadInjected, () => this._registerFileTypes(true))
  }

  postprocess = () => {
    if (!this.enabled) return
    this.renderer.load().catch(() => undefined)
  }

  // ---------- file tree registration ----------

  _registerFileTypes = (refresh = false) => {
    if (!Array.isArray(File?.SupportedFiles)) return false
    let changed = false
    if (!File.SupportedFiles.includes(EXT.slice(1))) {
      File.SupportedFiles.push(EXT.slice(1))
      changed = true
    }
    if (changed && refresh) File.editor.library.refreshPanelCommand()
    return changed
  }

  // ---------- activation ----------

  _onFileContentLoaded = filePath => {
    const target = filePath || this.utils.getFilePath()
    if (this._isD2File(target)) {
      this._activate(target)
    } else {
      this._deactivate()
    }
  }

  _activate = async filePath => {
    const token = ++this.activationToken
    try {
      await this._loadSource(filePath)
      if (token !== this.activationToken) return
      // Stop Typora from trying to parse the file as Markdown.
      if (File?.bundle) {
        File.bundle.unsupported = File.UNSUPPORTED_REASON?.OTHER_FILE || "OTHER_FILE"
      }
      this.entities.content.classList.add(ACTIVE_CLASS)
      this.entities.root.classList.remove("plugin-common-hidden")
      this._setViewMode(this.plugin.config.FILE_VIEW_DEFAULT_MODE)
      this._scheduleRender()
    } catch (error) {
      this._notify(error.message, "error")
      this._deactivate()
    }
  }

  _deactivate = () => {
    this.activationToken++
    this.renderToken++
    clearTimeout(this.renderTimer)
    this.entities.content.classList.remove(ACTIVE_CLASS)
    this.entities.root.classList.add("plugin-common-hidden")
    this.activeFile = ""
    this.savedSource = ""
    this.currentStat = null
    this._setEditorValue("")
    this.entities.preview.replaceChildren()
    this._syncUI()
  }

  _loadSource = async filePath => {
    const source = this._sourceCache?.get(this._normalize(filePath))
      ?? await this.utils.Package.FsExtra.readFile(filePath, "utf8")
    this._sourceCache?.delete(this._normalize(filePath))
    const stat = await this.utils.Package.FsExtra.stat(filePath)
    this.activeFile = this._normalize(filePath)
    this.savedSource = source
    this.currentStat = { mtimeMs: stat.mtimeMs, size: stat.size }
    this._setEditorValue(source)
    this.entities.path.textContent = this.activeFile
    this.entities.path.title = this.activeFile
  }

  // ---------- editing surface ----------

  /**
   * Prefer CodeMirror (Typora exposes it globally) for syntax highlighting, and fall
   * back to the plain textarea when the bundled build cannot be instantiated.
   */
  _ensureEditor = () => {
    if (this.editor || this._editorAttempted) return
    this._editorAttempted = true
    const CodeMirror = window.CodeMirror
    if (typeof CodeMirror !== "function") return
    try {
      const host = this._createHost()
      this.entities.sourcePane.appendChild(host)
      this.entities.textarea.classList.add("plugin-common-hidden")
      this.editor = CodeMirror(host, {
        value: this._getEditorValue(),
        mode: this.plugin.config.MAPPING_LANGUAGE,
        lineNumbers: true,
        lineWrapping: false,
        theme: "typora-default",
        viewportMargin: 50,
      })
      this.editor.on("change", () => this._onInput())
    } catch (error) {
      this.editor = null
      this.entities.textarea.classList.remove("plugin-common-hidden")
    }
  }

  _createHost = () => document.createElement("div")

  _getEditorValue = () => this.editor ? this.editor.getValue() : this.entities.textarea.value

  _setEditorValue = value => {
    if (this.editor) {
      if (this.editor.getValue() !== value) this.editor.setValue(value)
    } else {
      this.entities.textarea.value = value
    }
  }

  _onKeydown = event => {
    if (event.key === "Tab") {
      event.preventDefault()
      const el = this.entities.textarea
      const start = el.selectionStart
      el.value = el.value.slice(0, start) + "  " + el.value.slice(el.selectionEnd)
      el.selectionStart = el.selectionEnd = start + 2
      this._onInput()
      return
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault()
      this.save()
    }
  }

  _onInput = () => {
    this._syncUI()
    if (this.plugin.config.FILE_VIEW_AUTO_PREVIEW) this._scheduleRender()
  }

  // ---------- rendering ----------

  _scheduleRender = () => {
    clearTimeout(this.renderTimer)
    this.renderTimer = setTimeout(() => this._render(), this.plugin.config.FILE_VIEW_DELAY)
  }

  _render = async () => {
    if (!this.activeFile) return
    this._ensureEditor()
    const token = ++this.renderToken
    const source = this._getEditorValue()
    try {
      const svg = await this.renderer.render(source, this._meta())
      if (token !== this.renderToken) return
      this.entities.preview.innerHTML = svg
    } catch (error) {
      if (token !== this.renderToken) return
      this.entities.preview.replaceChildren(this._buildError(error.message))
    }
  }

  /** File view has no per-fence metadata block, so it uses the configured defaults. */
  _meta = () => ({
    theme: this.plugin.config.THEME,
    layout: this.plugin.config.LAYOUT,
    sketch: this.plugin.config.SKETCH,
    pad: this.plugin.config.PAD,
    scale: this.plugin.config.SCALE,
  })

  _buildError = message => {
    const el = document.createElement("div")
    el.className = "d2fv-error"
    el.textContent = message
    return el
  }

  // ---------- view mode ----------

  _setViewMode = mode => {
    const view = ["source", "preview", "split"].includes(mode) ? mode : "split"
    this.entities.root.classList.remove("is-source", "is-preview", "is-split")
    this.entities.root.classList.add(`is-${view}`)
    this.entities.views.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.view === view))
    })
    if (this.editor) this.editor.refresh()
  }

  // ---------- save / reload ----------

  _isDirty = () => Boolean(this.activeFile) && this._getEditorValue() !== this.savedSource

  save = async () => {
    if (!this.activeFile) return false
    try {
      if (await this._hasExternalChange() && !await this._confirmExternalOverwrite()) return false
      const source = this._getEditorValue()
      await this.utils.Package.FsExtra.writeFile(this.activeFile, source, "utf8")
      const stat = await this.utils.Package.FsExtra.stat(this.activeFile)
      this.savedSource = source
      this.currentStat = { mtimeMs: stat.mtimeMs, size: stat.size }
      this._syncUI()
      this._notify(this.plugin.i18n.t("fileView.saved"), "success")
      return true
    } catch (error) {
      this._notify(error.message, "error")
      return false
    }
  }

  reload = async () => {
    if (!this.activeFile) return
    if (this._isDirty() && !await this._confirmDiscard()) return
    const filePath = this.activeFile
    await this._loadSource(filePath)
    this._scheduleRender()
    this._notify(this.plugin.i18n.t("fileView.reloaded"), "info")
  }

  _hasExternalChange = async () => {
    if (!this.currentStat) return false
    try {
      const stat = await this.utils.Package.FsExtra.stat(this.activeFile)
      return stat.mtimeMs !== this.currentStat.mtimeMs || stat.size !== this.currentStat.size
    } catch {
      return true
    }
  }

  _confirmExternalOverwrite = async () => {
    const { response } = await this.utils.showMessageBox({
      type: "warning",
      title: this.plugin.pluginName,
      message: this.plugin.i18n.t("fileView.externalChanged"),
      detail: this.activeFile,
      buttons: [this.plugin.i18n.t("fileView.overwrite"), this.plugin.i18n.t("fileView.cancel")],
    })
    return response === 0
  }

  _confirmDiscard = async () => {
    const { response } = await this.utils.showMessageBox({
      type: "warning",
      title: this.plugin.pluginName,
      message: this.plugin.i18n.t("fileView.unsavedChanges"),
      detail: this.activeFile,
      buttons: [this.plugin.i18n.t("fileView.discard"), this.plugin.i18n.t("fileView.cancel")],
    })
    return response === 0
  }

  // ---------- guards ----------

  /** Keep Typora from reading .d2 content into its own Markdown pipeline. */
  _installReadMask = () => {
    this.utils.decorator.modifyReturn(
      () => File,
      "readContentFrom",
      async (result, filePath) => {
        const payload = await result
        if (!this._isD2File(filePath) || !Array.isArray(payload) || !payload[0]) return payload
        const encoding = payload[2] || "utf8"
        let source = String(payload[1] || "")
        if (!source && Buffer.isBuffer(payload[3]) && payload[3].length) {
          source = payload[3].toString(encoding.replace(/-bom$/i, ""))
        }
        this._sourceCache ??= new Map()
        this._sourceCache.set(this._normalize(filePath), source)
        return [true, "", encoding, Buffer.alloc(0)]
      },
      { priority: -200 },
    ).catch(error => console.error("[d2] readContentFrom hook failed:", error))
  }

  /** Prompt before navigating away from unsaved changes. */
  _installOpenGuard = () => {
    this.utils.decorator.preventCallIf(
      () => File?.editor?.library,
      "openFile",
      target => {
        if (this.bypassOpenGuard || !this._isDirty() || this._samePath(target, this.activeFile)) return false
        this._confirmDiscard().then(confirmed => {
          if (!confirmed) return
          this.bypassOpenGuard = true
          try {
            File.editor.library.openFile(target)
          } finally {
            this.bypassOpenGuard = false
          }
        })
        return true
      },
      { priority: -200 },
    ).catch(error => console.error("[d2] openFile hook failed:", error))
  }

  /** Ctrl+S inside Typora goes through saveUseNode; route it to our own save. */
  _installSaveRedirect = () => {
    this.utils.decorator.preventCallIf(
      () => File,
      "saveUseNode",
      () => {
        if (!this.activeFile || !this._samePath(this.utils.getFilePath(), this.activeFile)) return false
        this.save()
        return true
      },
      { priority: -200 },
    ).catch(error => console.error("[d2] saveUseNode hook failed:", error))
  }

  // ---------- helpers ----------

  _syncUI = () => {
    const dirty = this._isDirty()
    this.entities.save.classList.toggle("is-disabled", !dirty)
    this.entities.save.setAttribute("aria-disabled", String(!dirty))
  }

  _notify = (message, type = "info") => this.utils.notification.show(message, type, 4500)

  _isD2File = filePath => Boolean(filePath) && String(filePath).toLowerCase().endsWith(EXT)

  _normalize = filePath => this.utils.Package.Path.resolve(String(filePath || ""))

  _samePath = (first, second) => {
    if (!first || !second) return false
    const a = this._normalize(first)
    const b = this._normalize(second)
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b
  }
}

module.exports = D2FileView
