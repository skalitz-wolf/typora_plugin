const D2Renderer = require("./renderer.js")
// Reuse the upstream zoom/pan maths instead of reimplementing it, so the .d2 file view
// and diagram_enhance's code-block surface behave identically. Coupling to core.js
// (a stable pure-function module) is deliberate: if upstream improves it, we inherit it.
const { clamp, normalizeOptions, panFromStart, roundScale, zoomAtPoint } = require("../diagram_enhance/core")

const EXT = ".d2"
const ACTIVE_CLASS = "plugin-d2-file-active"
const CONTENT_CLASS = "d2fv-content"
const CRLF = "\r\n"

/**
 * Lets Typora open standalone .d2 files: registers the extension, then takes over the
 * editing area with a source pane (a plain textarea) plus a live SVG preview.
 * Mirrors the approach used by the html_editor plugin.
 *
 * The source pane deliberately uses a textarea rather than window.CodeMirror:
 * Typora patches its bundled CodeMirror, and the patched history code reads
 * `cm.editor.sourceView`, which only exists on instances Typora itself created.
 * Handing it a third-party instance throws "Cannot read properties of undefined
 * (reading 'sourceView')" as soon as setValue() runs.
 */
class D2FileView {
  constructor(plugin) {
    this.plugin = plugin
    this.utils = plugin.utils
    this.renderer = new D2Renderer({ config: plugin.config, utils: this.utils })
    this.activeFile = ""
    this.savedSource = ""
    this.currentStat = null
    this.activationToken = 0
    this.renderToken = 0
    this.renderTimer = null
    this.saveTimer = null
    this.lineEnding = "\n"
    this.options = normalizeOptions(plugin.config)
    this.transform = { scale: 1, translateX: 0, translateY: 0 }
    this.fitPending = false
    this.pan = null
    this.selectStart = null
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
    /*
     * d2 emits an outer <svg> with no width/height attributes, only a viewBox, so the
     * SVG spec defaults it to width:100%. If this wrapper is a flex item, its width
     * would come from its content while the content asks for 100% of that width — a
     * circular dependency the browser resolves as 0, rendering nothing. Giving the
     * wrapper a definite width and using block layout breaks the cycle.
     */
    #plugin-d2-file-view .d2fv-preview-pane {
      display: block;
      overflow: hidden;
      position: relative;
      background: #fff;
      cursor: grab;
    }
    #plugin-d2-file-view .d2fv-preview-pane.is-panning {
      cursor: grabbing;
    }
    /* Alt turns the pane into a text-selection surface: drag pans by default, so without
       this hint there is no way to tell the two modes apart. */
    #plugin-d2-file-view .d2fv-preview-pane.is-selecting,
    #plugin-d2-file-view .d2fv-preview-pane.is-selecting .${CONTENT_CLASS},
    #plugin-d2-file-view .d2fv-preview-pane.is-selecting .${CONTENT_CLASS} * {
      cursor: text;
      user-select: text;
    }
    #plugin-d2-file-view .d2fv-preview {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      box-sizing: border-box;
      transform-origin: 0 0;
    }
    /* The transformable layer; scale/translate are applied here, not on the pane. */
    #plugin-d2-file-view .${CONTENT_CLASS} {
      position: absolute;
      top: 0;
      left: 0;
      padding: 16px;
      box-sizing: border-box;
      transform-origin: 0 0;
    }
    /*
     * The renderer copies d2's natural width/height onto the outer <svg>, so it lays out
     * at its true size. Sizing is then entirely the transform's job (_fitToPane shrinks
     * oversized diagrams, wheel zoom scales): a CSS max-width here would silently cap the
     * element first, and _fitToPane would then shrink the already-capped box a second time.
     */
    #plugin-d2-file-view .${CONTENT_CLASS} > svg {
      display: block;
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
          <div class="d2fv-preview"><div class="${CONTENT_CLASS}"></div></div>
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
      previewPane: root.querySelector(".d2fv-preview-pane"),
      content: root.querySelector(`.${CONTENT_CLASS}`),
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

    this._bindPreviewInteraction()

    this.utils.eventHub.on(this.utils.eventHub.eventType.fileContentLoaded, this._onFileContentLoaded)
    this.utils.eventHub.on(this.utils.eventHub.eventType.allPluginsHadInjected, () => this._registerFileTypes(true))
  }

  // ---------- preview zoom & pan ----------

  _bindPreviewInteraction = () => {
    const pane = this.entities.previewPane
    pane.addEventListener("wheel", this._onWheel, { passive: false })
    pane.addEventListener("pointerdown", this._onPointerDown)
    pane.addEventListener("pointermove", this._onPointerMove)
    pane.addEventListener("pointerup", this._onPointerUp)
    pane.addEventListener("pointercancel", this._onPointerUp)
    pane.addEventListener("dblclick", () => this._resetTransform())
    // Alt held = selection mode. Tracked on the document because the modifier can be
    // pressed or released while the pointer is anywhere, and Alt+drag would otherwise
    // be swallowed by the OS/window before reaching the pane.
    document.addEventListener("keydown", this._onModifierChange, true)
    document.addEventListener("keyup", this._onModifierChange, true)
  }

  _onModifierChange = event => {
    if (event.key !== "Alt") return
    this.entities.previewPane.classList.toggle("is-selecting", event.altKey)
    // Leaving selection mode mid-drag would otherwise strand the pan state.
    if (!event.altKey && this.pan) this._endPan(event.pointerId)
  }

  /** Wheel zooms around the cursor, mirroring diagram_enhance's behaviour. */
  _onWheel = event => {
    if (event.deltaY === 0) return
    event.preventDefault()
    event.stopPropagation()
    const factor = event.deltaY > 0 ? (1 - this.options.zoomStep) : (1 + this.options.zoomStep)
    this._applyTransform(zoomAtPoint(this.transform, this.transform.scale * factor, this._pointInPane(event), this.options))
  }

  _onPointerDown = event => {
    if (event.button !== 0 || !this.options.enablePan) return
    // Alt means "select text", so let the browser handle the gesture untouched: no
    // preventDefault (that is what made text unselectable before) and no pan state.
    if (event.altKey) {
      this.selectStart = { clientX: event.clientX, clientY: event.clientY }
      return
    }
    event.preventDefault()
    this.pan = {
      pointerId: event.pointerId,
      startTranslate: { x: this.transform.translateX, y: this.transform.translateY },
      startPointer: this._pointInPane(event),
    }
    this.entities.previewPane.classList.add("is-panning")
    this.entities.previewPane.setPointerCapture?.(event.pointerId)
  }

  _onPointerMove = event => {
    if (!this.pan || this.pan.pointerId !== event.pointerId) return
    event.preventDefault()
    const next = panFromStart(this.pan.startTranslate, this.pan.startPointer, this._pointInPane(event))
    this._applyTransform({ scale: this.transform.scale, ...next })
  }

  _onPointerUp = event => {
    if (this.selectStart) {
      const moved = Math.hypot(
        event.clientX - (this.selectStart.clientX ?? event.clientX),
        event.clientY - (this.selectStart.clientY ?? event.clientY),
      ) > 4
      this.selectStart = null
      // A drag selects a range (the browser already did it, so copy that); a plain click
      // targets a single <text> line.
      if (moved) this._copySelection()
      else this._copyTextAt(event.target)
      return
    }
    if (!this.pan || this.pan.pointerId !== event.pointerId) return
    this._endPan(event.pointerId)
  }

  _endPan = pointerId => {
    this.pan = null
    this.entities.previewPane.classList.remove("is-panning")
    if (pointerId != null) this.entities.previewPane.releasePointerCapture?.(pointerId)
  }

  /** Copy the text of the clicked SVG <text> node (one visual line of the diagram). */
  _copyTextAt = target => {
    const node = target?.closest?.("text")
    const text = node?.textContent?.trim()
    if (text) this._copyToClipboard(text)
  }

  /** Copy whatever the browser has selected (an Alt+drag range). */
  _copySelection = () => {
    const text = window.getSelection?.()?.toString?.().trim()
    if (text) this._copyToClipboard(text)
  }

  _copyToClipboard = text => {
    // Typora's own clipboard helper keeps the rich-text/plain-text pairing consistent
    // with the rest of the app; fall back to the DOM API outside Typora.
    const setClipboard = File?.editor?.UserOp?.setClipboard
    if (typeof setClipboard === "function") setClipboard(null, null, text, true)
    else navigator.clipboard?.writeText?.(text)
  }

  _pointInPane = event => {
    const rect = this.entities.previewPane.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  _applyTransform = next => {
    const scale = Number.isFinite(next.scale) ? next.scale : this.transform.scale
    const translateX = Number.isFinite(next.translateX) ? next.translateX : this.transform.translateX
    const translateY = Number.isFinite(next.translateY) ? next.translateY : this.transform.translateY
    this.transform = { scale, translateX, translateY }
    // Deliberately a plain 2D transform with no will-change: a composited layer would be
    // rasterized once at 1x and then scaled as a bitmap, so text turns blurry when zoomed.
    // A 2D transform keeps the SVG as vectors and re-renders crisply at any scale.
    this.entities.content.style.transform =
      `translate(${translateX}px, ${translateY}px) scale(${scale})`
  }

  /** Shrink an oversized diagram to fit the pane; never enlarge past 100%. */
  _fitToPane = () => {
    const svg = this.entities.content.querySelector(":scope > svg")
    const pane = this.entities.previewPane
    if (!svg || !pane) return
    const naturalWidth = parseFloat(svg.getAttribute("width")) || svg.clientWidth
    const naturalHeight = parseFloat(svg.getAttribute("height")) || svg.clientHeight
    const rect = pane.getBoundingClientRect()
    const padding = 32  // matches the content layer's 16px padding on each side
    if (!naturalWidth || !naturalHeight || rect.width <= padding || rect.height <= padding) return
    const scale = roundScale(clamp(
      Math.min((rect.width - padding) / naturalWidth, (rect.height - padding) / naturalHeight),
      this.options.minScale,
      1,
    ))
    this._applyTransform({ scale, translateX: 0, translateY: 0 })
  }

  _resetTransform = () => {
    this._applyTransform({ scale: 1, translateX: 0, translateY: 0 })
    this._fitToPane()
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
    if (changed && refresh && File.editor?.library?.refreshPanelCommand) File.editor.library.refreshPanelCommand()
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
      // Make sure the previous file's last keystrokes reached disk before we drop them.
      await this._flushSave()
      if (token !== this.activationToken) return
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
      console.error("[d2] failed to open the .d2 file view:", error)
      this._notify(error?.message || String(error), "error")
      this._deactivate()
    }
  }

  /**
   * Flush any pending autosave before the editor is torn down. Awaited by callers that
   * need the write to land first (switching files, closing); fire-and-forget elsewhere.
   */
  _flushSave = async () => {
    if (this.saveTimer) await this.save()
  }

  _deactivate = () => {
    this.activationToken++
    this.renderToken++
    clearTimeout(this.renderTimer)
    // Autosave has usually already written; flush synchronously here so a switch or
    // close never loses the last keystrokes.
    const pending = this._flushSave()
    // This also runs from _activate's catch block, so it must never throw: a failure
    // here would replace the original error with a misleading secondary one.
    try {
      this.entities.content.classList.remove(ACTIVE_CLASS)
      this.entities.root.classList.add("plugin-common-hidden")
      this.activeFile = ""
      this.savedSource = ""
      this.currentStat = null
      this._setEditorValue("")
      this.entities.content.replaceChildren()
      this._resetTransform()
      this._syncUI()
    } catch (error) {
      console.error("[d2] failed to reset the file view:", error)
    }
    return pending
  }

  _loadSource = async filePath => {
    const raw = this._sourceCache?.get(this._normalize(filePath))
      ?? await this.utils.Package.FsExtra.readFile(filePath, "utf8")
    this._sourceCache?.delete(this._normalize(filePath))
    const stat = await this.utils.Package.FsExtra.stat(filePath)
    this.activeFile = this._normalize(filePath)
    // A textarea normalizes CRLF to LF, so remember the file's original line ending and
    // restore it on write. Without this, every CRLF file would report as modified the
    // moment it is opened (and saving would rewrite it with LF).
    this.lineEnding = raw.includes(CRLF) ? CRLF : "\n"
    this.savedSource = this._toEditorText(raw)
    this.currentStat = { mtimeMs: stat.mtimeMs, size: stat.size }
    this._setEditorValue(this.savedSource)
    this._resetTransform()
    this.entities.path.textContent = this.activeFile
    this.entities.path.title = this.activeFile
  }

  /** File text -> textarea text (LF only, since a textarea cannot hold CRLF). */
  _toEditorText = raw => this.lineEnding === CRLF ? raw.replace(/\r\n/g, "\n") : raw

  /** Textarea text -> file text, restoring the file's original line ending. */
  _toFileText = editorText => this.lineEnding === CRLF ? editorText.replace(/\n/g, CRLF) : editorText

  // ---------- editing surface ----------

  _getEditorValue = () => this.entities.textarea.value

  _setEditorValue = value => {
    if (this.entities.textarea.value !== value) this.entities.textarea.value = value
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
    this._scheduleSave()
    if (this.plugin.config.FILE_VIEW_AUTO_PREVIEW) this._scheduleRender()
  }

  // ---------- rendering ----------

  _scheduleRender = () => {
    clearTimeout(this.renderTimer)
    this.renderTimer = setTimeout(() => this._render(), this.plugin.config.FILE_VIEW_DELAY)
  }

  _render = async () => {
    if (!this.activeFile) return
    const token = ++this.renderToken
    const source = this._getEditorValue()
    try {
      const svg = await this.renderer.render(source, this._meta())
      if (token !== this.renderToken) return
      this.entities.content.innerHTML = svg
      this._fitToPane()
    } catch (error) {
      if (token !== this.renderToken) return
      this.entities.content.replaceChildren(this._buildError(error.message))
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
  }

  // ---------- save / reload ----------

  _isDirty = () => Boolean(this.activeFile) && this._getEditorValue() !== this.savedSource

  /**
   * Autosave: writing happens shortly after typing stops, so the file on disk always
   * matches the editor. That is what removes the "unsaved changes" prompt when switching
   * files — there is no unsaved state to ask about.
   */
  _scheduleSave = () => {
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.save(), this.plugin.config.FILE_VIEW_SAVE_DELAY)
  }

  /** Write the current text to disk. Returns false only on a real write failure. */
  save = async () => {
    if (!this.activeFile) return false
    clearTimeout(this.saveTimer)
    const text = this._getEditorValue()
    if (text === this.savedSource) return true
    try {
      const payload = this._toFileText(text)
      await this.utils.Package.FsExtra.writeFile(this.activeFile, payload, "utf8")
      const stat = await this.utils.Package.FsExtra.stat(this.activeFile)
      this.savedSource = text
      this.currentStat = { mtimeMs: stat.mtimeMs, size: stat.size }
      this._syncUI()
      return true
    } catch (error) {
      console.error("[d2] failed to save:", error)
      this._notify(`${this.plugin.i18n.t("fileView.saveFailed")}: ${error.message}`, "error")
      return false
    }
  }

  reload = async () => {
    if (!this.activeFile) return
    await this._flushSave()
    const filePath = this.activeFile
    await this._loadSource(filePath)
    this._scheduleRender()
    this._notify(this.plugin.i18n.t("fileView.reloaded"), "info")
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
