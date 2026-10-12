# 演示文稿的源码取自 `File.editor.getMarkdown()`

导出与预览读取的 Markdown，一律走 `File.editor.getMarkdown()`（即仓库里的
`utils.getCurrentFileContent`）。**不**强制切换源码模式，也**不**自己读文件。

背景：Marp 把 YAML front matter 和 HTML 注释当作**指令**读取。而 `getMarkdown()` 在
Typora 源码里的实现是：

```js
getMarkdown() {
  return this.sourceView.inSourceMode
    ? this.sourceView.cm.getValue()                          // 源码模式：原样
    : this.warpContentWithOption(this.nodeMap.toMark())       // 其余模式：AST 重新序列化
}
```

实测这条差异是**致命的**：把 front matter 和 `_class` 注释去掉后重新渲染，主题、页码、
`_class: lead` 全部失效——幻灯片还在，但样式全丢。所以**非源码模式下不能拿它做预览**。

早先的版本因此强制切到源码模式。那是个错误，代价有两条：一是 Typora 自己的规则
`.pin-outline:not(.typora-sourceview-on) #typora-sidebar{display:block}` 会在源码模式下
隐藏固定侧栏，文件树和大纲随之消失；二是它把用户从"所见即所得"里赶了出来，而
`getMarkdown()` 在源码模式下本来就返回原样文本，这个切换对导出毫无必要。

现在的做法：**不切换模式**。预览与导出都调 `getMarkdown()`，它在源码模式下返回原样文本、
在渲染视图下返回重新序列化的文本——后者会丢指令。因此**实时预览**在用户第一次编辑演示
文稿时，会提示一次并请求切到源码模式（每个文档只问一次；用户拒绝后预览就停止跟随编辑，
不再打扰，导出仍然可用）。

代价与取舍：

- 实时预览仍需要源码模式，但这是**按需请求**而不是**静默强制**。用户可以在实时预览模式下
  看幻灯片、保留侧栏，只在想边写边看时才进源码模式。
- 导出不受影响：用户手动点导出时，如果不在源码模式，导出拿到的就是重新序列化后的文本，
  指令可能已丢。**这是尚未解决的缺口**，理想做法是导出前探测并提示，而不是静默产出样式
  全丢的 PPTX。
- 侧栏在源码模式下消失是 **Typora 自身的行为**，不是插件造成的，插件也不应去改它。
