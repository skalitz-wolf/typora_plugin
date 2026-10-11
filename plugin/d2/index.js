const D2Fence = require("./fence.js")
const D2FileView = require("./file-view.js")

class D2Plugin extends BasePlugin {
  fence = new D2Fence(this)
  fileView = new D2FileView(this)

  prepare = async () => {
    this.fence.utils = this.utils
    this.fileView.utils = this.utils
    await this.fence.prepare()
  }

  hotkey = () => [{ hotkey: this.config.HOTKEY, callback: this.call }]

  style = () => this.fileView.style()

  html = () => (this.config.ENABLE_FILE_VIEW ? this.fileView.html() : "")

  call = () => this.utils.insertBlockCode(null, this.config.LANGUAGE, this.config.TEMPLATE)

  init = () => {
    if (this.config.ENABLE_FILE_VIEW) this.fileView.init()
  }

  process = () => {
    this.fence.register()
    this.fileView.process()
  }

  postprocess = () => this.fileView.postprocess()
}

module.exports = {
  plugin: D2Plugin,
}
