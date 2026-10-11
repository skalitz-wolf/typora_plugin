# 在 Typora 内打开并预览独立 .d2 文件

让 Typora 能直接打开 `.d2` 文件：注册扩展名、接管编辑区，用源码 + 实时预览
左右分栏展示，可编辑并保存回原文件。

背景：Typora 支持的文件扩展名是硬编码在 `frame.js` 里的
（`["mdtxt","mdtext","apib","rmarkdown","rmd","qmd","txt","text"]` 加上
`["md","markdown","mmd","mkd","mdwn","mdown","mdx"]`），**不含 `d2`**，
所以双击 `.d2` 文件 Typora 根本不会打开它。而 `thirdPartyDiagramParser`
是面向代码块的（依赖 `$pre` / `cid`），无法渲染整个文件。

实现方式照搬 `html_editor` 插件已验证的那套：把扩展名推进 `File.SupportedFiles`
以进入文件树；监听 `fileContentLoaded` 判断是否 `.d2`；用 CSS 隐藏
`content > #write / #typora-source / #ty-oversize-body` 并挂上自己的面板；
把 `File.bundle.unsupported` 标成 `OTHER_FILE` 以阻止 Typora 按 Markdown 解析；
用 `decorator` 接管 `readContentFrom`（避免 Typora 读走内容）、`openFile`
（未保存时切文件先确认）、`saveUseNode`（Ctrl+S 走自己的保存）。

代价：会接管 Typora 的编辑区，出问题时影响所有文件，因此用 `ENABLE_FILE_VIEW`
单独开关，与代码块渲染解耦。预览不落盘为 `.svg`——编辑时每次写盘会污染 git diff，
而发布所需的 `.svg` 由 d2-vscode 的导出功能负责。

源码编辑器优先用全局 `window.CodeMirror`（Typora 在 `frame.js` 里暴露，
含 112 个 mode），借 `yaml` 语法高亮（Typora 无 d2 mode）；实例化失败则退回
纯 `textarea`，保证在打包版 API 被裁剪时仍可用。
