# 在 Typora 渲染器内光栅化幻灯片，而不是调用外部浏览器

导出图片式 PPTX / PDF 时，把每一页幻灯片用「SVG → `<img>` → canvas」在 Typora 渲染器内
转成位图，而不是像 marp-cli 那样驱动外部 headless 浏览器，也不复用 Typora 自己的打印管线。

背景：Typora 的渲染进程本身就是完整 Chromium（开发机 Typora 1.14.10 = Electron 42.2.0 /
Chrome 148），插件代码可直接用 `document.createElement("canvas")`；仓库里已有同类先例
——`plugin/markmap/downloader.js:115` 就是 SVG → `<img>` → canvas → PNG。而 marp-cli 的
`--pptx` 走 puppeteer-core 驱动外部 Chrome/Edge 截图，需要浏览器发现逻辑、子进程，还得先
把 Markdown 落盘。Typora 自己的打印/导出管线则不可用：预览态把 `#write` 隐藏了，打印出来
会是编辑器而不是幻灯片。

代价与实测踩到的坑（这些是实现约束，不是可选优化）：

- Marp 的幻灯片 CSS 选择器是 `div.marpit > svg > foreignObject > section`，而
  `render(md, { htmlAsArray: true })` 恰好把 `div.marpit` 这层剥掉。直接把每页 SVG 序列化
  去光栅化会**整页空白**——必须把选择器去作用域，并剥掉样式里的 `@charset` / `@import`，
  否则整个 `<style>` 在 SVG 文档里会失效。
- 按**路径**引用的图片在光栅化时不会加载（`data:` URL 形式的 SVG 解析不到同级文件），
  导出前必须把本地图片内联成 data URI。
- `foreignObject` 内的 HTML 必须处于 XHTML 命名空间。

因此产物是图片式的：文字不可选中、不可搜索。若将来需要可编辑 PPTX，那是另一条
（PDF → LibreOffice Impress）路线，不在本决策范围内。
