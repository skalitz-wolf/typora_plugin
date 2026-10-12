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

**View Mode**:
One of the three ways the deck surface is presented: source, preview, or split.
_Avoid_: layout, 显示模式

**Source** (view mode):
The deck's Markdown shown as editable text.

**Preview** (view mode):
The deck's rendered slides shown without the editor.

**Split** (view mode):
Source and rendered slides shown side by side.
