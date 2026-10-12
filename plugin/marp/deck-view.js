const MarpDeck = require("./deck.js")
const { rasterizeDeck } = require("./rasterizer.js")
const { buildPptx } = require("./pptx.js")
const { buildPdf } = require("./pdf.js")
const { buildFontFaceCss, isFontFile } = require("./fonts.js")

const ACTIVE_CLASS = "plugin-marp-deck-active"
const VIEW_MODES = ["source", "preview", "split"]

/**
 * The Deck view: an explicit, remembered per-file switch that turns a Markdown document
 * into slides, plus the three View Modes and the export actions.
 *
 * Docking deliberately differs from the d2 and html_editor file views, which hide
 * Typora's editor and take over the content area. Those plugins exist because `.d2` and
 * `.html` are file types Typora cannot edit; `.md` is Typora's own type, so its editor is
 * the asset and the pane has to sit *beside* it. This follows the docked-panel idiom the
 * right-outline and markmap plugins already use: a fixed panel with the content area
 * narrowed, rather than a full-area overlay.
 */
class MarpDeckView {
  constructor(plugin) {
    this.plugin = plugin
    this.utils = plugin.utils
    this.entities = {}
    this.activeFile = ""
    this.enabledFiles = new Set()
    this.viewMode = "split"
    this.slideCache = new Map()
    this.renderToken = 0
    this.renderTimer = null
    this.paneWidth = 0
    this.baseContentWidth = null
    this.panning = null
    this.exportCancelled = false
    this.exporting = false
    this.deck = new MarpDeck({
      allowRemoteFonts: () => Boolean(this.plugin.config.ALLOW_REMOTE_FONTS),
      resolveImage: this._resolveImage,
      loadFonts: this._loadExtraFonts,
    })
  }

  get enabled() {
    return Boolean(this.plugin.config.ENABLE_DECK_VIEW)
  }

  // ---------- style ----------

  style = () => `
    /* Preview mode hides the editor so the slides get the full width; source and split
       keep Typora's own editor visible. */
    content.${ACTIVE_CLASS}.is-preview > #write,
    content.${ACTIVE_CLASS}.is-preview > #typora-source,
    content.${ACTIVE_CLASS}.is-preview > #ty-oversize-body {
      display: none !important;
    }
    #plugin-marp-deck {
      position: fixed;
      z-index: 9990;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-left: 1px solid var(--window-border-color, rgba(15, 23, 42, .12));
      background: var(--bg-color, #fff);
      color: var(--text-color, #172033);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      font-size: 12px;
    }
    #plugin-marp-deck .marp-deck-header {
      display: flex;
      align-items: center;
      flex: 0 0 auto;
      height: 34px;
      padding: 0 8px;
      border-bottom: 1px solid var(--window-border-color, rgba(15, 23, 42, .12));
      background: var(--side-bar-bg-color, #f8fafc);
    }
    #plugin-marp-deck .marp-deck-resizer {
      flex: 0 0 auto;
      width: 5px;
      height: 100%;
      margin-right: 4px;
      cursor: col-resize;
    }
    #plugin-marp-deck .marp-deck-resizer:hover {
      background: var(--item-hover-bg-color, rgba(15, 23, 42, .1));
    }
    #plugin-marp-deck .marp-deck-title {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      opacity: .72;
    }
    #plugin-marp-deck .marp-deck-button {
      flex: 0 0 auto;
      padding: 3px 8px;
      margin-left: 4px;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
    }
    #plugin-marp-deck .marp-deck-button:hover {
      background: var(--item-hover-bg-color, rgba(15, 23, 42, .06));
    }
    #plugin-marp-deck .marp-deck-button[aria-pressed="true"] {
      background: var(--item-active-bg-color, rgba(66, 133, 244, .14));
    }
    #plugin-marp-deck .marp-deck-button.is-disabled {
      opacity: .4;
      cursor: default;
    }
    #plugin-marp-deck .marp-deck-button.is-disabled:hover {
      background: transparent;
    }
    #plugin-marp-deck .marp-deck-body {
      flex: 1 1 0;
      min-height: 0;
      overflow: auto;
      padding: 12px;
      background: var(--side-bar-bg-color, #f1f3f5);
    }
    /* Each slide is drawn as a page: a white sheet with the slide's own aspect ratio. */
    #plugin-marp-deck .marp-deck-slide {
      margin: 0 auto 12px;
      background: #fff;
      box-shadow: 0 1px 3px rgba(15, 23, 42, .18);
      overflow: hidden;
      position: relative;
    }
    #plugin-marp-deck .marp-deck-slide svg {
      display: block;
      width: 100%;
      height: auto;
    }
    #plugin-marp-deck .marp-deck-placeholder {
      padding: 16px;
      text-align: center;
      opacity: .6;
    }
    #plugin-marp-deck .marp-deck-error {
      margin: 0 0 12px;
      padding: 10px 12px;
      border-radius: 4px;
      white-space: pre-wrap;
      font-family: "Cascadia Code", Consolas, monospace;
      color: #991b1b;
      background: #fee2e2;
    }
    #plugin-marp-deck .marp-deck-progress {
      padding: 8px 10px;
      border-radius: 4px;
      margin-bottom: 8px;
      background: var(--item-active-bg-color, rgba(66, 133, 244, .12));
    }
  `

  html = () => `
    <div id="plugin-marp-deck" class="plugin-common-hidden">
      <div class="marp-deck-header">
        <div class="marp-deck-resizer" role="separator" aria-orientation="vertical"></div>
        <div class="marp-deck-title"></div>
        <div class="marp-deck-button" role="button" tabindex="0" data-action="export-pptx">${this.plugin.i18n.t("deck.exportPptx")}</div>
        <div class="marp-deck-button" role="button" tabindex="0" data-action="export-pdf">${this.plugin.i18n.t("deck.exportPdf")}</div>
        <div class="marp-deck-button" role="button" tabindex="0" data-view="source">${this.plugin.i18n.t("deck.source")}</div>
        <div class="marp-deck-button" role="button" tabindex="0" data-view="preview">${this.plugin.i18n.t("deck.preview")}</div>
        <div class="marp-deck-button" role="button" tabindex="0" data-view="split" aria-pressed="true">${this.plugin.i18n.t("deck.split")}</div>
      </div>
      <div class="marp-deck-body"></div>
    </div>
  `

  init = () => {
    const root = document.querySelector("#plugin-marp-deck")
    if (!root) return
    this.entities = {
      root,
      content: this.utils.entities.eContent,
      write: this.utils.entities.eWrite,
      title: root.querySelector(".marp-deck-title"),
      body: root.querySelector(".marp-deck-body"),
      resizer: root.querySelector(".marp-deck-resizer"),
      buttons: [...root.querySelectorAll("[data-action]")],
      views: [...root.querySelectorAll("[data-view]")],
    }
    this.enabledFiles = new Set(this.utils.getStorage("marp_deck_files").get() || [])
  }

  process = () => {
    if (!this.enabled) return

    this.entities.buttons.forEach(button => {
      button.addEventListener("click", () => {
        if (button.classList.contains("is-disabled")) return
        const action = button.dataset.action
        if (action === "export-pptx") this.exportDeck("pptx")
        else if (action === "export-pdf") this.exportDeck("pdf")
      })
    })
    this.entities.views.forEach(button => {
      button.addEventListener("click", () => this.setViewMode(button.dataset.view))
    })
    this._bindResizer()

    this.utils.eventHub.on(this.utils.eventHub.eventType.fileContentLoaded, this._onFileContentLoaded)
    this.utils.eventHub.on(this.utils.eventHub.eventType.fileEdited, this._onFileEdited)
    this.utils.eventHub.on(this.utils.eventHub.eventType.afterToggleSidebar, this._onLayoutChanged)
    this.utils.eventHub.on(this.utils.eventHub.eventType.afterSetSidebarWidth, this._onLayoutChanged)
    window.addEventListener("resize", this._onLayoutChanged)
  }

  postprocess = () => {
    if (!this.enabled) return
    // A deck may already be open when the plugin loads.
    this._onFileContentLoaded(this.utils.getFilePath())
  }

  // ---------- enabling a document as a deck ----------

  /** `.md` and the other Markdown extensions Typora edits; `.d2`/`.html` are other plugins' business. */
  isDeckFile = filePath => {
    if (!filePath) return false
    const ext = String(filePath).toLowerCase().split(".").pop()
    return ["md", "markdown", "mmd", "mkd", "mdwn", "mdown", "mdx", "rmd", "qmd"].includes(ext)
  }

  isEnabled = filePath => this.isDeckFile(filePath) && this.enabledFiles.has(this._key(filePath))

  /** Toggles Deck mode for the current document. The switch is explicit and remembered. */
  toggleDeckMode = () => {
    const filePath = this.utils.getFilePath()
    if (!this.isDeckFile(filePath)) {
      this._notify(this.plugin.i18n.t("deck.notMarkdown"), "error")
      return
    }
    const key = this._key(filePath)
    if (this.enabledFiles.has(key)) {
      this.enabledFiles.delete(key)
      this._deactivate()
    } else {
      this.enabledFiles.add(key)
      this._activate(filePath)
    }
    this._persistEnabled()
  }

  _persistEnabled = () => {
    try {
      this.utils.getStorage("marp_deck_files").set([...this.enabledFiles])
    } catch (error) {
      console.error("[marp] could not remember which files are decks:", error)
    }
  }

  _onFileContentLoaded = filePath => {
    const target = filePath || this.utils.getFilePath()
    if (this.isEnabled(target)) this._activate(target)
    else this._deactivate()
  }

  _activate = filePath => {
    this.activeFile = this._key(filePath)
    this.entities.root.classList.remove("plugin-common-hidden")
    this.entities.content.classList.add(ACTIVE_CLASS)
    this.entities.title.textContent = this.utils.getFileName() || this.activeFile
    this.entities.title.title = filePath
    this.setViewMode(this.viewMode)
    this._reposition()
    this._render()
  }

  _deactivate = () => {
    this.renderToken++
    clearTimeout(this.renderTimer)
    this.activeFile = ""
    this.slideCache.clear()
    try {
      this.entities.root.classList.add("plugin-common-hidden")
      this.entities.content.classList.remove(ACTIVE_CLASS, "is-preview")
      this._restoreContentWidth()
      this.entities.body.replaceChildren()
    } catch (error) {
      console.error("[marp] failed to leave deck mode:", error)
    }
  }

  // ---------- view modes ----------

  setViewMode = mode => {
    const view = VIEW_MODES.includes(mode) ? mode : "split"
    this.viewMode = view
    this.entities.root.classList.toggle("plugin-common-hidden", view === "source")
    this.entities.content.classList.toggle("is-preview", view === "preview")
    this.entities.views.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.view === view))
    })

    // Source is Typora's own source mode; the deck pane is irrelevant there. Preview and
    // split both want source mode so the user edits Markdown rather than the rendered
    // document, which would not round-trip Marp's directives.
    if (view !== "preview") this._ensureSourceMode(true)

    if (view === "source") this._restoreContentWidth()
    else this._reposition()
  }

  _ensureSourceMode = want => {
    const sourceView = File?.editor?.sourceView
    if (!sourceView || typeof File.toggleSourceMode !== "function") return
    if (want && !sourceView.inSourceMode) File.toggleSourceMode()
  }

  // ---------- docking ----------

  /** Width of the pane as a percentage of the content area, or an explicit pixel width. */
  _paneWidthFor = contentWidth => {
    if (this.paneWidth > 0) return Math.min(this.paneWidth, Math.max(120, contentWidth - 120))
    const percent = Number(this.plugin.config.DECK_PANE_WIDTH_PERCENT) || 40
    return Math.round(contentWidth * percent / 100)
  }

  _reposition = () => {
    const { content, root } = this.entities
    if (!content || !root || root.classList.contains("plugin-common-hidden")) return
    const rect = content.getBoundingClientRect()
    if (rect.width <= 0) return

    if (this.baseContentWidth === null) this.baseContentWidth = rect.width
    const width = this._paneWidthFor(this.baseContentWidth)
    root.style.top = `${rect.top}px`
    root.style.height = `${rect.height}px`
    root.style.left = `${rect.left + rect.width - width}px`
    root.style.width = `${width}px`
    // Narrow the editor rather than covering it. `#write` carries its own max-width, so it
    // is reset to `initial` for the narrower column, exactly as the other docked panels do.
    content.style.width = `${rect.width - width}px`
    if (this.entities.write) this.entities.write.style.width = "initial"
  }

  _restoreContentWidth = () => {
    if (this.baseContentWidth === null) return
    this.entities.content.style.width = ""
    if (this.entities.write) this.entities.write.style.width = ""
    this.baseContentWidth = null
  }

  _onLayoutChanged = () => {
    if (!this.activeFile) return
    // The sidebar and the window can both change the content area's width, and there is no
    // resize event for the content element itself, so re-derive from scratch each time.
    this.baseContentWidth = null
    if (this.viewMode !== "source") this._reposition()
  }

  _bindResizer = () => {
    const { resizer } = this.entities
    if (!resizer) return
    resizer.addEventListener("pointerdown", event => {
      if (event.button !== 0) return
      event.preventDefault()
      this.panning = { pointerId: event.pointerId, startX: event.clientX, startWidth: this.entities.root.getBoundingClientRect().width }
      resizer.setPointerCapture?.(event.pointerId)
    })
    resizer.addEventListener("pointermove", event => {
      if (!this.panning || this.panning.pointerId !== event.pointerId) return
      event.preventDefault()
      const delta = this.panning.startX - event.clientX
      this.paneWidth = Math.max(160, this.panning.startWidth + delta)
      this._reposition()
    })
    const stop = event => {
      if (!this.panning || this.panning.pointerId !== event.pointerId) return
      this.panning = null
      resizer.releasePointerCapture?.(event.pointerId)
    }
    resizer.addEventListener("pointerup", stop)
    resizer.addEventListener("pointercancel", stop)
  }

  // ---------- live preview ----------

  _onFileEdited = () => {
    if (!this.activeFile || this.viewMode === "source") return
    if (!this.plugin.config.DECK_AUTO_PREVIEW) return
    clearTimeout(this.renderTimer)
    this.renderTimer = setTimeout(this._render, this.plugin.config.DECK_RENDER_DELAY)
  }

  /** Reads the deck's source. Raw text, not a markdown re-serialization: Marp reads front
      matter and HTML comments as directives, which a normalized round-trip can drop. */
  _readDeckSource = async () => {
    const filePath = this.utils.getFilePath()
    if (!filePath) return ""
    try {
      return await this.utils.Package.FsExtra.readFile(filePath, "utf8")
    } catch (error) {
      // The document may be brand new and not yet on disk; fall back to the buffer.
      const fallback = this.utils.getCurrentFileContent?.()
      if (typeof fallback === "string") return fallback
      throw error
    }
  }

  _render = async () => {
    if (!this.activeFile || this.viewMode === "source") return
    const token = ++this.renderToken
    const scrollTop = this.entities.body.scrollTop
    try {
      const source = await this._readDeckSource()
      if (token !== this.renderToken) return
      const slides = await this.deck.render(source)
      if (token !== this.renderToken) return
      this._paint(slides, scrollTop)
    } catch (error) {
      if (token !== this.renderToken) return
      this.entities.body.replaceChildren(this._buildError(error?.message || String(error)))
    }
  }

  /**
   * Rebuilds only the slides whose content changed, so typing in a long deck does not
   * throw away every slide's DOM (which would also reset scroll and restart any
   * per-slide work the browser had done).
   */
  _paint = (slides, scrollTop) => {
    const body = this.entities.body
    const existing = [...body.querySelectorAll(".marp-deck-slide")]
    const keep = []

    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i]
      const current = existing[i]
      const cached = this.slideCache.get(i)
      if (current && cached === slide.hash && current.dataset.hash === slide.hash) {
        keep.push(current)
        continue
      }
      const element = this._buildSlide(slide)
      if (current) current.replaceWith(element)
      keep.push(element)
    }
    // Slides that no longer exist.
    for (let i = slides.length; i < existing.length; i++) existing[i].remove()

    // Append any that are not already attached, preserving order.
    for (const element of keep) {
      if (element.parentNode !== body) body.appendChild(element)
    }
    const error = body.querySelector(".marp-deck-error")
    if (error) error.remove()
    if (!slides.length) {
      body.appendChild(this._buildPlaceholder(this.plugin.i18n.t("deck.empty")))
    } else {
      const placeholder = body.querySelector(".marp-deck-placeholder")
      if (placeholder) placeholder.remove()
    }

    this.slideCache = new Map(slides.map((slide, i) => [i, slide.hash]))
    body.scrollTop = scrollTop
  }

  _buildSlide = slide => {
    const element = document.createElement("div")
    element.className = "marp-deck-slide"
    element.dataset.hash = slide.hash
    // The slide svg is already a complete, self-contained document fragment.
    element.innerHTML = slide.svg
    return element
  }

  _buildPlaceholder = text => {
    const element = document.createElement("div")
    element.className = "marp-deck-placeholder"
    element.textContent = text
    return element
  }

  _buildError = message => {
    const element = document.createElement("div")
    element.className = "marp-deck-error"
    element.textContent = message
    return element
  }

  // ---------- images ----------

  /**
   * Extra fonts, when the user pointed the plugin at a font directory. Read once and
   * cached, because a deck renders on every keystroke pause.
   */
  _loadExtraFonts = async () => {
    if (this._fontsCss !== undefined) return this._fontsCss
    const dir = this.plugin.config.FONT_DIR
    this._fontsCss = ""
    if (!dir) return this._fontsCss
    try {
      const FsExtra = this.utils.Package.FsExtra
      if (!await this.utils.existPath(dir)) return this._fontsCss
      const entries = await FsExtra.readdir(dir)
      const fonts = []
      for (const name of entries) {
        if (!isFontFile(name)) continue
        const data = await FsExtra.readFile(this.utils.Package.Path.join(dir, name))
        fonts.push({ path: name, data })
      }
      // Prepend the families to the slide's own font stack so they beat the theme's.
      this._fontsCss = buildFontFaceCss(fonts, { prependTo: "section" })
    } catch (error) {
      console.error("[marp] could not read the font directory:", error)
    }
    return this._fontsCss
  }

  /**
   * Resolves a local image to a data URI. Rasterization happens from a `data:` URL svg,
   * which cannot resolve sibling files, so an image left as a path silently disappears.
   */
  _resolveImage = async url => {
    if (!url || /^data:/i.test(url) || /^(https?|ftp):\/\//i.test(url)) return null
    try {
      if (!this.utils.isLocalImage(url)) return null
      const absolute = this.utils.resolveLocalPath(url)
      if (!absolute || !await this.utils.existPath(absolute)) return null
      const binary = await this.utils.Package.FsExtra.readFile(absolute)
      const ext = this.utils.Package.Path.extname(absolute).toLowerCase().replace(/^\./, "")
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp" }[ext]
      if (!mime) return null
      return `data:${mime};base64,${binary.toString("base64")}`
    } catch (error) {
      console.error(`[marp] could not inline image ${url}:`, error)
      return null
    }
  }

  // ---------- export ----------

  /** Exports the current document. Works with or without the pane being open. */
  exportDeck = async format => {
    if (this.exporting) {
      this._notify(this.plugin.i18n.t("deck.exportBusy"), "error")
      return
    }
    const filePath = this.utils.getFilePath()
    if (!this.isDeckFile(filePath)) {
      this._notify(this.plugin.i18n.t("deck.notMarkdown"), "error")
      return
    }

    this.exporting = true
    this.exportCancelled = false
    this._setExportBusy(true)
    const baseName = (this.utils.getFileName() || "deck").replace(/\.[^.]+$/, "")

    try {
      const { canceled, filePath: target } = await JSBridge.invoke("dialog.showSaveDialog", {
        title: this.plugin.i18n.t(format === "pptx" ? "deck.exportPptx" : "deck.exportPdf"),
        properties: ["saveFile", "showOverwriteConfirmation"],
        defaultPath: this.utils.Package.Path.join(this.utils.getCurrentDirPath() || this.utils.tempFolder, `${baseName}.${format}`),
        filters: [{ name: format.toUpperCase(), extensions: [format] }],
      })
      if (canceled || !target) return

      // Read from disk, so make sure what is on disk is what the user sees.
      const saved = await this._flushDocument()
      if (!saved) {
        this._notify(this.plugin.i18n.t("deck.saveFirst"), "error")
        return
      }

      const source = await this._readDeckSource()
      const slides = await this.deck.render(source)
      if (!slides.length) {
        this._notify(this.plugin.i18n.t("deck.empty"), "error")
        return
      }

      const width = this.plugin.config.DECK_SLIDE_WIDTH
      const height = this.plugin.config.DECK_SLIDE_HEIGHT
      const scale = Number(this.plugin.config.DECK_EXPORT_SCALE) || 2
      const images = await rasterizeDeck(
        slides,
        { width, height, scale },
        {
          isCancelled: () => this.exportCancelled,
          onProgress: (done, total) => this._showProgress(done, total),
        },
      )

      const bytes = format === "pptx"
        ? buildPptx({ pages: images.map(data => ({ data: Buffer.from(data) })), slideSize: { width, height } })
        : buildPdf({ pages: images.map(data => ({ data: Buffer.from(data) })), slideSize: { width, height } })

      const ok = await this.utils.writeFile(target, bytes)
      if (!ok) return
      this._notify(this.plugin.i18n.t("deck.exported"), "info")
      this.utils.showInFinder(target)
    } catch (error) {
      if (this.exportCancelled || /cancelled/i.test(error?.message || "")) {
        this._notify(this.plugin.i18n.t("deck.exportCancelled"), "info")
      } else {
        console.error("[marp] export failed:", error)
        this._notify(`${this.plugin.i18n.t("deck.exportFailed")}: ${error?.message || error}`, "error")
      }
    } finally {
      this.exporting = false
      this._setExportBusy(false)
      this._clearProgress()
    }
  }

  /** Ctrl+S is Typora's; this just asks it to save and reports whether the document is clean. */
  _flushDocument = async () => {
    const filePath = this.utils.getFilePath()
    if (!filePath) return false
    try {
      if (typeof File?.editor?.saveUseNode === "function") {
        await File.editor.saveUseNode()
      } else if (typeof File?.saveUseNode === "function") {
        await File.saveUseNode()
      }
      return true
    } catch (error) {
      console.error("[marp] could not save before exporting:", error)
      return false
    }
  }

  cancelExport = () => {
    if (this.exporting) this.exportCancelled = true
  }

  _setExportBusy = busy => {
    this.entities.buttons?.forEach(button => {
      const isExport = button.dataset.action?.startsWith("export")
      if (isExport) button.classList.toggle("is-disabled", busy)
    })
  }

  _showProgress = (done, total) => {
    if (!this.entities.body) return
    let element = this.entities.body.querySelector(".marp-deck-progress")
    if (!element) {
      element = document.createElement("div")
      element.className = "marp-deck-progress"
      this.entities.body.prepend(element)
    }
    element.textContent = `${this.plugin.i18n.t("deck.exporting")} ${done}/${total}`
  }

  _clearProgress = () => {
    this.entities.body?.querySelector(".marp-deck-progress")?.remove()
  }

  // ---------- helpers ----------

  _notify = (message, type = "info") => this.utils.notification.show(message, type, 4500)

  _key = filePath => this.utils.Package.Path.resolve(String(filePath || ""))
}

module.exports = MarpDeckView
