# fork typora_plugin 并在其上开发 D2 插件

Typora 没有插件 API，能加代码的地方只有 `resources/window.html` 注入脚本。
选择 fork `obgnail/typora_plugin` 并在它的框架上开发 D2 渲染插件，
而不是自己写注入、或做成只含 `plugin/d2/` 的独立小仓库。

背景：Typora 的 Markdown 解析器 `atom.compiled.dist.jsc` 是 V8 字节码，读不了也改不了，
唯一的注入点是 `window.html`。`typora_plugin` 已经把这层做好了，而且自带
`thirdPartyDiagramParser`——代码块的增删改监听、防抖、语法报错展示、导出时保留 SVG、
切文档时销毁实例，它都实现完了，D2 只需要注册一个语言和一个渲染函数。
独立仓库方案每次升级都要手工把文件拷进 `C:\Program Files\Typora\resources\`，
而且没有 merge 上游修复的通道。对比过 `d2-obsidian` 与 Marp 的 `--engine` 口子：
两者都不能同时满足「在 Typora 内编辑」「跟随上游」「可自己改核心」。

代价：仓库体积大（上游 70+ 个插件），需要定期 `git merge upstream/master`，
冲突面随自己改动增加。上游在积极加图表插件（1.19.8 加 infographic / function-plot，
1.19.9 加 vega_lite），将来可能新增 `plugin/d2` 与我们的目录撞名，届时需要改名。

因此：框架自带的 updater 必须关闭（`[updater] ENABLE = false`）。
它的 `atomicSync()` 会把上游包整体替换进 `plugin/`，只保留上游包中不存在的文件，
因此会静默覆盖对上游文件的修改，且绕过 git 历史——这与「fork 保有改动能力」直接冲突。
上游同步只走 `git merge upstream/master`。部署用目录联接（junction）把
`resources/plugin` 指向本仓库的 `plugin`，避免每次手工拷贝。
