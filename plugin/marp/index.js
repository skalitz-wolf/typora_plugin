const MarpDeckView = require("./deck-view.js")

class MarpPlugin extends BasePlugin {
  marp = null
  deckView = new MarpDeckView(this)

  staticActions = this.i18n.fillActions([
    { act_value: "toggle_deck_mode", act_hotkey: this.config.DECK_HOTKEY },
    { act_value: "export_pptx" },
    { act_value: "export_pdf" },
  ])

  style = () => `
    #write .plugin-marp-content { all: initial; }
    ${this.deckView.style()}
  `

  hotkey = () => [{ hotkey: this.config.HOTKEY, callback: this.call }]

  call = action => {
    if (action === "toggle_deck_mode") return this.deckView.toggleDeckMode()
    if (action === "export_pptx") return this.deckView.exportDeck("pptx")
    if (action === "export_pdf") return this.deckView.exportDeck("pdf")
    return this.utils.insertBlockCode(null, this.config.LANGUAGE, this.config.TEMPLATE)
  }

  html = () => this.deckView.html()

  init = () => this.deckView.init()

  postprocess = () => this.deckView.postprocess()

  process = () => {
    this.deckView.process()
    const parser = this.utils.thirdPartyDiagramParser
    parser.register({
      lang: this.config.LANGUAGE,
      mappingLang: "markdown",
      destroyWhenUpdate: false,
      interactiveMode: this.config.INTERACTIVE_MODE,
      metaConfigSchema: null,
      checkSelector: ".plugin-marp-content",
      wrapElement: `<div class="plugin-marp-content"></div>`,
      lazyLoadFunc: this.lazyLoad,
      beforeRenderFunc: null,
      renderStyleGetter: null,
      createFunc: this.create,
      updateFunc: null,
      destroyFunc: this.destroy,
      beforeExportToNative: null,
      beforeExportToHTML: null,
      exportStyleGetter: null,
      versionGetter: this.getVersion,
    })
  }

  create = ($wrap, content) => {
    const { html, css } = this.marp.render(content)
    // Use shadowDOM to isolate styles
    const shadowRoot = $wrap[0].shadowRoot ?? $wrap[0].attachShadow({ mode: "open" })
    // The `adoptedStyleSheets` approach cannot be used because it does not allow @import rules
    shadowRoot.innerHTML = `<style>${css}</style>` + html
    return shadowRoot
  }

  destroy = shadowRoot => shadowRoot.replaceChildren()

  getVersion = () => "marp-core@4.4.0"

  lazyLoad = () => {
    const { Marp } = require("./marp-core.min.js")
    this.marp = new Marp(this.config.MARP_CORE_OPTIONS).use(absImagePathPlugin(this.utils))
  }
}

const absImagePathPlugin = utils => {
  return imagePathPlugin(url => {
    const decodedURL = decodeURIComponent(url)
    const absPath = utils.isLocalImage(decodedURL) ? utils.resolveLocalPath(decodedURL) : decodedURL
    return absPath.split(utils.Package.Path.sep).join("/")
  })
}

const imagePathPlugin = resolvePath => {
  return marp => {
    const originNormalizeLink = marp.normalizeLink
    const originImageRule = marp.renderer.rules.image

    // Image commands (`![bg](...) `): They will be processed by `marp.normalizeLink`, replaced to the `background-image: url(...)` in `style` attribute.
    marp.normalizeLink = (url) => resolvePath(originNormalizeLink(url))

    // Ordinary images (`![alt](...) `): They will be processed by `md.renderer.rules.images`, replaced to the `src` attribute of the `<img>` tag.
    marp.renderer.rules.image = (tokens, idx, options, env, self) => {
      const token = tokens[idx]
      const srcIndex = token.attrIndex("src")
      if (srcIndex >= 0) {
        token.attrs[srcIndex][1] = resolvePath(token.attrs[srcIndex][1])
      }
      return originImageRule ? originImageRule(tokens, idx, options, env, self) : self.renderToken(tokens, idx, options)
    }
  }
}

module.exports = {
  plugin: MarpPlugin,
}
