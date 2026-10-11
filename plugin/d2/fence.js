const D2Renderer = require("./renderer.js")

/** Renders ```d2 code blocks inside Markdown through the shared d2 renderer. */
class D2Fence {
  constructor(plugin) {
    this.plugin = plugin
    this.utils = plugin.utils
    this.renderer = null
    this.renderCached = null
  }

  prepare = () => {
    this.renderer = new D2Renderer({ config: this.plugin.config, utils: this.utils })
    this.renderCached = this.utils.memoizeLimited(
      (content, meta) => this.renderer.render(content, meta),
      {
        cap: this.plugin.config.CACHE_SIZE,
        keyResolver: (content, meta) => content + "\u0000" + JSON.stringify(meta),
      },
    )
  }

  register = () => {
    const parser = this.utils.thirdPartyDiagramParser
    parser.register({
      lang: this.plugin.config.LANGUAGE,
      mappingLang: this.plugin.config.MAPPING_LANGUAGE,
      destroyWhenUpdate: false,
      interactiveMode: this.plugin.config.INTERACTIVE_MODE,
      metaConfigSchema: {
        ...parser.helpers.styleMetaConfigSchema.wrapDefaultStyle({
          height: this.plugin.config.DEFAULT_FENCE_HEIGHT,
          backgroundColor: this.plugin.config.DEFAULT_FENCE_BACKGROUND_COLOR,
        }),
        theme: { type: "number", default: this.plugin.config.THEME },
        layout: { type: "string", enum: ["dagre", "elk", "tala"], default: this.plugin.config.LAYOUT },
        sketch: { type: "boolean", default: this.plugin.config.SKETCH },
        pad: { type: "number", default: this.plugin.config.PAD },
        scale: { type: "number", default: this.plugin.config.SCALE },
      },
      checkSelector: ".plugin-d2-content",
      wrapElement: `<div class="plugin-d2-content"></div>`,
      lazyLoadFunc: this.renderer.load,
      beforeRenderFunc: null,
      renderStyleGetter: parser.helpers.renderStyle.base,
      createFunc: this.create,
      updateFunc: null,
      destroyFunc: null,
      beforeExportToNative: null,
      beforeExportToHTML: null,
      exportStyleGetter: parser.helpers.exportStyle.svg,
      versionGetter: () => this.renderer.version,
    })
  }

  create = async ($wrap, content, meta) => {
    $wrap[0].innerHTML = await this.renderCached(content, meta)
  }
}

module.exports = D2Fence
