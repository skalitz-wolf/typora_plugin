# 演示文稿的源码取自 `File.editor.getMarkdown()`

导出与预览读取的 Markdown，一律走 `File.editor.getMarkdown()`（即仓库里的
`utils.getCurrentFileContent`）。**不**强制切换 Typora 的源码模式，也**不**自己读文件。

背景：Marp 把 YAML front matter 和 HTML 注释当作**指令**读取，所以最初的担心是
`getMarkdown()` 在非源码模式下会把它们弄丢。那个担心**是错的**。Typora 的源码里：

```js
getMarkdown() {
  return this.sourceView.inSourceMode
    ? this.sourceView.cm.getValue()                        // 源码模式
    : this.warpContentWithOption(this.nodeMap.toMark())     // 其余模式
}
```

两条分支都保真，理由是：

- **front matter 有专门的节点类型**。`meta_block.toMark()` 会重新拼回 `---` 围栏，而不是
  当成普通分隔线丢掉。
- **HTML 注释走 `html_block`**，其 `toMark()` 原样透传文本，`<!-- _class: lead -->` 不会
  消失。
- `warpContentWithOption` 只补一个行尾换行，**不剥离任何内容**。

所以**源码模式对导出毫无必要**。早先的版本强制切到源码模式，代价有两条：一是 Typora 自己
的规则 `.pin-outline:not(.typora-sourceview-on) #typora-sidebar{display:block}` 会在源码
模式下隐藏固定侧栏，文件树和大纲随之消失；二是它把用户从"所见即所得"里赶了出来。

**未验证的残余风险**：`hr.toMark()` 返回 `this.get("pattern") || "------"`，也就是说
Typora 可能把分隔线规范成 `------`。Marp 认 `---`、`----`、`****` 等为分页符，`------`
应当同样生效，但**这条只做过静态阅读，没有实测**。若日后出现"分页丢失"，先查这里。
