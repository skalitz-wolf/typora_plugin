const MarpDeck = require("./deck.js")
const { rasterizeDeck } = require("./rasterizer.js")
const { buildPptx } = require("./pptx.js")
const { buildPdf } = require("./pdf.js")
const { buildFontFaceCss, isFontFile } = require("./fonts.js")
const { mimeForExtension } = require("./slides.js")
const {
  scrollRange,
  slideSpans,
  toSlideFraction,
  toSourceFraction,
} = require("./scroll-sync.js")

const ACTIVE_CLASS = "plugin-marp-deck-active"
/*
 * What the deck surface is showing. Two columns are the resting state; the two buttons
 * each ask for one column alone, and pressing either button while already alone returns to
 * two columns. So there is no separate "split" button - two columns is simply what you get
 * when neither column has been isolated.
 */
const LAYOUT_SPLIT = "split"
const LAYOUTS = [LAYOUT_SPLIT, "editor", "preview"]

/**
 * The Deck view: an explicit, remembered per-file switch that turns a Markdown document
 * into slides, plus the two layout buttons and the export actions.
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
    this.layout = LAYOUT_SPLIT
    this.slideCache = new Map()
    this.renderToken = 0
    this.renderTimer = null
    this.paneWidth = 0
    this.panning = null
    this.slideSpans = []
    this.syncingScroll = false
    this.syncRaf = null
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
    /*
     * Position and vertical extent come from the shared plugin-common-panel class, the same
     * way right_outline docks its panel. Only the horizontal placement is set here, from
     * JavaScript, because it depends on the content area's current width.
     */
    #plugin-marp-deck {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border-left: 1px solid var(--window-border-color, rgba(15, 23, 42, .12));
      background: var(--bg-color, #fff);
      color: var(--text-color, #172033);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif;
      font-size: 12px;
      right: 0;
      height: 100%;
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
    /*
     * In Source the pane is just the toolbar. It must not stretch down the page: the editor
     * needs the full height, and a full-height transparent overlay would swallow every click
     * on the text behind it.
     */
    #plugin-marp-deck.is-editor-only {
      height: auto;
      background: transparent;
      border-left: 0;
      box-shadow: none;
      pointer-events: none;
    }
    #plugin-marp-deck.is-editor-only .marp-deck-header {
      pointer-events: auto;
      border: 1px solid var(--window-border-color, rgba(15, 23, 42, .12));
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(15, 23, 42, .12);
    }
    #plugin-marp-deck.is-editor-only .marp-deck-resizer {
      display: none;
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
    <div id="plugin-marp-deck" class="plugin-common-panel plugin-common-hidden">
      <div class="marp-deck-header">
        <div class="marp-deck-resizer" role="separator" aria-orientation="vertical"></div>
        <div class="marp-deck-title"></div>
        <div class="marp-deck-button" role="button" tabindex="0" data-action="export-pptx">${this.plugin.i18n.t("deck.exportPptx")}</div>
        <div class="marp-deck-button" role="button" tabindex="0" data-action="export-pdf">${this.plugin.i18n.t("deck.exportPdf")}</div>
        <div class="marp-deck-button" role="button" tabindex="0" data-view="editor">${this.plugin.i18n.t("deck.editor")}</div>
        <div class="marp-deck-button" role="button" tabindex="0" data-view="preview">${this.plugin.i18n.t("deck.preview")}</div>
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

    this._bindViewModeButtons()
    this._bindResizer()
    this._bindScrollSync()

    this.utils.eventHub.on(this.utils.eventHub.eventType.fileContentLoaded, this._onFileContentLoaded)
    this.utils.eventHub.on(this.utils.eventHub.eventType.fileEdited, this._onFileEdited)
    this.utils.eventHub.on(this.utils.eventHub.eventType.afterToggleSidebar, this._onLayoutChanged)
    this.utils.eventHub.on(this.utils.eventHub.eventType.afterSetSidebarWidth, this._onLayoutChanged)
    window.addEventListener("resize", this._onLayoutChanged)
  }

  _bindViewModeButtons = () => {
    this.entities.buttons.forEach(button => {
      button.addEventListener("click", () => {
        // While an export is running the export controls become Cancel, so the user is
        // never stuck waiting on a deck they did not mean to start.
        if (this.exporting && button.dataset.action?.startsWith("export")) {
          this.cancelExport()
          return
        }
        if (button.classList.contains("is-disabled")) return
        this.exportDeck(this._formatForAction(button.dataset.action))
      })
    })
    this.entities.views.forEach(button => {
      button.addEventListener("click", () => this.setLayoutFromButton(button.dataset.view))
    })
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

  isEnabled = filePath => this.isDeckFile(filePath) && this.enabledFiles.has(this._storageKey(filePath))

  /** Toggles Deck mode for the current document. The switch is explicit and remembered. */
  toggleDeckMode = () => {
    const filePath = this.utils.getFilePath()
    if (!this.isDeckFile(filePath)) {
      this._notify(this.plugin.i18n.t("deck.notMarkdown"), "error")
      return
    }
    const key = this._storageKey(filePath)
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
    this.activeFile = this._storageKey(filePath)
    this.entities.root.classList.remove("plugin-common-hidden")
    this.entities.content.classList.add(ACTIVE_CLASS)
    this.entities.title.textContent = this.utils.getFileName() || this.activeFile
    this.entities.title.title = filePath
    // Entering deck mode always starts in two columns, regardless of how the last deck was
    // left, so the layout a document opens in is predictable.
    this._applyLayout(LAYOUT_SPLIT)
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
      this._teardownScrollSync()
    } catch (error) {
      console.error("[marp] failed to leave deck mode:", error)
    }
  }

  // ---------- layout ----------

  /**
   * Handles a press of one of the two layout buttons.
   *
   * Two columns are the resting state, so the buttons do not name it: each button asks for
   * one column on its own, and pressing a button while a single column is already showing
   * returns to two columns. That is one rule for both buttons, and it means "show me just
   * the editor" and "show me just the slides" are each one press away from two columns.
   *
   * Consequence worth knowing: going from editor-only to slides-only takes two presses,
   * because the first one returns to two columns. That is deliberate - the single-column
   * states are for looking closely at one thing, not for switching between them.
   */
  setLayoutFromButton = column => {
    if (column !== "editor" && column !== "preview") return
    this._applyLayout(this.layout === LAYOUT_SPLIT ? column : LAYOUT_SPLIT)
  }

  _applyLayout = layout => {
    const next = LAYOUTS.includes(layout) ? layout : LAYOUT_SPLIT
    this.layout = next

    const { root, body, content } = this.entities
    if (!root) return

    // The pane is never hidden: its header carries the buttons that get you back out.
    root.classList.remove("plugin-common-hidden")
    root.classList.toggle("is-editor-only", next === "editor")
    if (body) body.classList.toggle("plugin-common-hidden", next === "editor")
    // Hiding the editor is what makes the slide column full width.
    content.classList.toggle("is-preview", next === "preview")
    this.entities.views.forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.view === next))
    })

    this._applyPaneGeometry()
  }

  /**
   * Where the pane sits, and how wide, for the current layout.
   *
   * The three layouts need genuinely different geometry, and an earlier version got this
   * wrong by always docking the pane at its split width - so isolating the slides hid the
   * editor and left the pane a narrow strip against the right edge instead of letting it
   * fill the space the editor had vacated.
   */
  _applyPaneGeometry = () => {
    if (this.layout === "editor") return this._collapsePaneForEditor()
    if (this.layout === "preview") return this._expandPaneForPreview()
    return this._reposition()
  }

  /**
   * Editor-only: the editor takes the full width and the pane shrinks to its header, which
   * floats over the editor's top-right so the buttons stay reachable.
   */
  _collapsePaneForEditor = () => {
    const { root, content } = this.entities
    this._restoreContentWidth()
    const full = this._baseContentWidth()
    if (full <= 0) return
    const contentRect = content.getBoundingClientRect()
    const width = Math.min(this._toolbarWidth(full), full)
    root.style.left = `${contentRect.left + full - width}px`
    root.style.width = `${width}px`
  }

  /**
   * Slides-only: the editor is hidden, so the pane takes the whole content area rather than
   * its split share. The editor's own width is reset too, so returning to two columns
   * re-measures from the true full width instead of from a leftover narrowed value.
   */
  _expandPaneForPreview = () => {
    const { root, content } = this.entities
    const full = this._baseContentWidth()
    if (full <= 0) return
    const contentRect = content.getBoundingClientRect()
    root.style.left = `${contentRect.left}px`
    root.style.width = `${full}px`
  }

  /** Enough room for the buttons, but never more than the content area itself. */
  _toolbarWidth = available => Math.min(Math.max(available * 0.5, 320), available)

  // ---------- docking ----------

  /**
   * Width of the pane within the available space.
   *
   * The editor keeps a minimum share so the pane can never swallow it, and the pane keeps
   * a minimum too so a narrow window still shows something. Both minimums are clamped
   * against the available width rather than assumed to fit inside it.
   */
  _paneWidthFor = availableWidth => {
    const editorMin = Math.min(240, Math.round(availableWidth * 0.4))
    const paneMin = Math.min(160, Math.round(availableWidth * 0.2))
    const wanted = this.paneWidth > 0
      ? this.paneWidth
      : Math.round(availableWidth * (Number(this.plugin.config.DECK_PANE_WIDTH_PERCENT) || 40) / 100)
    return Math.max(paneMin, Math.min(wanted, availableWidth - editorMin))
  }

  /**
   * The full width available to the content area, with the pane's own narrowing undone.
   *
   * This must be measured with the inline width cleared: the pane narrows `content` by
   * setting an inline width, so measuring the current rect would read back the narrowed
   * value and each reposition would shrink by another pane width. Clearing first also
   * re-measures the sidebar's current state, which is what makes the split survive a
   * sidebar toggle.
   */
  _baseContentWidth = () => {
    const { content } = this.entities
    const previous = content.style.width
    content.style.width = ""
    const width = content.getBoundingClientRect().width
    content.style.width = previous
    return width
  }

  _reposition = () => {
    const { content, root } = this.entities
    if (!content || !root || root.classList.contains("plugin-common-hidden")) return

    const full = this._baseContentWidth()
    if (full <= 0) return

    const paneWidth = this._paneWidthFor(full)

    // The pane is `position: fixed` via .plugin-common-panel, so `left` is measured from the
    // viewport. Anchor it to the content area's right edge rather than to the window, so it
    // sits beside the editor instead of under the sidebar.
    const contentRect = content.getBoundingClientRect()
    root.style.left = `${contentRect.left + full - paneWidth}px`
    root.style.width = `${paneWidth}px`
    // Narrow the editor rather than covering it. `#write` carries its own max-width, so it
    // is reset to `initial` for the narrower column, exactly as the other docked panels do.
    content.style.width = `${full - paneWidth}px`
    if (this.entities.write) this.entities.write.style.width = "initial"
  }

  _restoreContentWidth = () => {
    this.entities.content.style.width = ""
    if (this.entities.write) this.entities.write.style.width = ""
  }

  _onLayoutChanged = () => {
    if (!this.activeFile) return
    // The sidebar and the window can both change the content area's width, and there is no
    // resize event for the content element itself. The geometry helpers re-measure from
    // scratch, so nothing needs invalidating here.
    this._applyPaneGeometry()
  }

  // ---------- scroll sync ----------

  /**
   * Records where each slide sits in the document, so the two columns can be lined up.
   * Without the source spans the best possible sync is a pixel ratio, which drifts because
   * slides of very different source lengths are all the same height on screen.
   */
  _recordSlideSpans = (slides, totalLines) => {
    this.slideSpans = slideSpans(slides, totalLines)
  }

  /** Bind the two scroll listeners once. */
  _bindScrollSync = () => {
    if (this._scrollSyncBound) return
    this._scrollSyncBound = true
    const { content, body } = this.entities
    content?.addEventListener("scroll", this._onEditorScroll, { passive: true })
    body?.addEventListener("scroll", this._onSlideScroll, { passive: true })
  }

  /**
   * Editor -> slides. Guarded by `syncingScroll` so that moving one column does not bounce
   * the other back, which is what turns a sync into a fight.
   */
  _onEditorScroll = () => {
    if (this.syncingScroll || this.layout !== LAYOUT_SPLIT) return
    if (!this.plugin.config.DECK_SYNC_SCROLL) return
    const { content, body } = this.entities
    const range = scrollRange(content)
    if (range <= 0) return

    const target = scrollRange(body) * toSlideFraction(content.scrollTop / range, this.slideSpans)
    this.syncingScroll = true
    body.scrollTop = target
    this._releaseSync()
  }

  /** Slides -> editor. The inverse mapping, for scrolling the slide column. */
  _onSlideScroll = () => {
    if (this.syncingScroll || this.layout !== LAYOUT_SPLIT) return
    if (!this.plugin.config.DECK_SYNC_SCROLL) return
    const { content, body } = this.entities
    const range = scrollRange(body)
    if (range <= 0) return

    const target = scrollRange(content) * toSourceFraction(body.scrollTop / range, this.slideSpans)
    this.syncingScroll = true
    content.scrollTop = target
    this._releaseSync()
  }

  /** Clear the guard after the assignment has been applied, so the echo is swallowed. */
  _releaseSync = () => {
    cancelAnimationFrame(this.syncRaf)
    this.syncRaf = requestAnimationFrame(() => { this.syncingScroll = false })
  }

  /** Drop sync when leaving two columns; nothing to line up without both columns. */
  _teardownScrollSync = () => {
    cancelAnimationFrame(this.syncRaf)
    this.syncingScroll = false
    this.slideSpans = []
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

  /**
   * Reads the deck's Markdown.
   *
   * `getMarkdown()` is faithful in both of Typora's modes - front matter survives as a
   * `meta_block` whose serialization rebuilds the `---` fences, and HTML comments pass
   * through verbatim - so this is safe for the preview and the export alike, and needs no
   * mode switch. See ADR-0005.
   */
  _readDeckSource = async () => {
    if (typeof this.utils.getCurrentFileContent === "function") {
      const content = this.utils.getCurrentFileContent()
      if (typeof content === "string") return content
    }
    return this._readDeckFromDisk()
  }

  /** Fallback for when Typora's own accessor is unavailable. */
  _readDeckFromDisk = async () => {
    const filePath = this.utils.getFilePath()
    if (!filePath) return ""
    return this.utils.Package.FsExtra.readFile(filePath, "utf8")
  }

  _render = async () => {
    if (!this.activeFile || this.layout === "editor") return
    const token = ++this.renderToken
    const scrollTop = this.entities.body.scrollTop
    try {
      const source = await this._readDeckSource()
      if (token !== this.renderToken) return
      const slides = await this.deck.render(source)
      if (token !== this.renderToken) return
      this._recordSlideSpans(slides, source.split("\n").length)
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
      const mime = mimeForExtension(this.utils.Package.Path.extname(absolute))
      if (!mime) return null
      return `data:${mime};base64,${binary.toString("base64")}`
    } catch (error) {
      console.error(`[marp] could not inline image ${url}:`, error)
      return null
    }
  }

  // ---------- export ----------

  /** The pane's buttons and the plugin actions name formats the same way; one mapping. */
  _formatForAction = action => (action === "export-pdf" || action === "export_pdf" ? "pdf" : "pptx")

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

      // Outside source mode the raw text only exists on disk, so the export saves first and
      // reads back. That is what keeps Marp's directives intact in the output.
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
        ? buildPptx({
          pages: images.map(data => ({ data: Buffer.from(data) })),
          slideSize: { width, height },
          notes: slides.map(slide => slide.notes),
        })
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
        // The underlying messages come from the writers and are English prose; the user
        // sees the localised label, and the detail is kept for the console.
        this._notify(this.plugin.i18n.t("deck.exportFailed"), "error")
      }
    } finally {
      this.exporting = false
      this._setExportBusy(false)
      this._clearProgress()
    }
  }

  cancelExport = () => {
    if (this.exporting) this.exportCancelled = true
  }

  _setExportBusy = busy => {
    this.entities.buttons?.forEach(button => {
      if (!button.dataset.action?.startsWith("export")) return
      // Idle: enabled and labelled Export. Busy: still enabled, but now it cancels.
      button.classList.remove("is-disabled")
      const label = this.plugin.i18n.t(busy ? "deck.cancel" : this._labelForAction(button.dataset.action))
      if (button.textContent !== label) button.textContent = label
    })
  }

  _labelForAction = action => (this._formatForAction(action) === "pdf" ? "deck.exportPdf" : "deck.exportPptx")

  _showProgress = (done, total) => {
    const message = `${this.plugin.i18n.t("deck.exporting")} ${done}/${total}`
    // Progress goes through the shared notification component so it is visible even when
    // the pane is closed or the user is in Source view, where an in-pane bar would not be.
    this._progressClose?.()
    this._progressClose = this.utils.notification.show(message, "info", 0)
    if (this.entities.body) {
      let element = this.entities.body.querySelector(".marp-deck-progress")
      if (!element) {
        element = document.createElement("div")
        element.className = "marp-deck-progress"
        this.entities.body.prepend(element)
      }
      element.textContent = message
    }
  }

  _clearProgress = () => {
    this._progressClose?.()
    this._progressClose = null
    this.entities.body?.querySelector(".marp-deck-progress")?.remove()
  }

  // ---------- helpers ----------

  _notify = (message, type = "info", duration = 4500) => this.utils.notification.show(message, type, duration)

  _storageKey = filePath => this.utils.Package.Path.resolve(String(filePath || ""))
}

module.exports = MarpDeckView
