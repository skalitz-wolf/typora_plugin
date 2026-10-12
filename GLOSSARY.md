# typora_plugin

An extensible plugin system for the Typora Markdown editor. This glossary covers the
vocabulary introduced by the Marp presentation work; the rest of the plugin system
keeps upstream's language.

## Presentations

**Slide**:
One page of a presentation, produced by Marp from one segment of Markdown (segments are
split on `---`).
_Avoid_: page, 画面, 一页

**Deck**:
The ordered sequence of slides produced from a single Markdown file.
_Avoid_: PPT, presentation file, 幻灯片 (when you mean the whole deck)

**Directive**:
Metadata that Marp reads to control rendering (front matter, `<!-- _class: ... -->`,
`![bg](...)`) rather than content that appears on a slide.
_Avoid_: option, 配置

**Theme**:
A named set of Marp styles (e.g. `gaia`, `default`) selected per deck, distinct from the
Typora editor theme.
_Avoid_: style, 样式

**Rasterize**:
To turn a rendered slide into a bitmap. The result is fixed pixels: its text can no
longer be selected, searched, or edited.
_Avoid_: 截图, export image

**Image-based PPTX**:
A PPTX in which every slide is a single full-page bitmap. Distinct from an editable
PPTX, where each slide is real PowerPoint text and shapes.
_Avoid_: 截图 PPT, 不可编辑 PPTX

## Presentation UI

**Preview Pane**:
The plugin-owned surface that shows the rendered deck, docked beside or over Typora's
editor.
_Avoid_: viewer, 幻灯片面板

**Deck Mode**:
The per-file switch that turns a Markdown document into a Deck. Off, the document behaves
as an ordinary note and none of the controls below exist.
_Avoid_: presentation mode, 演示模式

**Layout**:
Whether the deck surface shows one column or two. Independent of what the editor column
is showing.
_Avoid_: split view, view mode, 显示模式

**Editor Column**:
The column that holds the document being edited. It shows either Typora's rendered editor
or a plain-text source surface; which one is a property of the column, not a mode the
whole editor enters.
_Avoid_: source pane, 源码面板

**Slide Column**:
The column that shows the rendered Slides.
_Avoid_: preview pane, 预览栏

**Source Surface**:
The plain-text editor the plugin shows in the Editor Column when the user asks for
Markdown rather than the rendered view. Typora is not switched into its own source mode to
provide it.
_Avoid_: source mode, 源码模式
