<!--
  Published copy. The canonical spec lives at .scratch/marp-deck/spec.md, which is where
  docs/agents/issue-tracker.md says issues are tracked. Edit that one; this file is
  regenerated from it so the two cannot drift.
-->
## Problem Statement

I write Markdown in Typora and want to turn a document into a slide deck and share it as
PowerPoint. Today Typora cannot show me slides at all: it renders my `.md` as a document,
and the plugin's existing `marp` support only renders ```marp fenced code blocks, which I
never use. I have no way to see what the deck will look like while I write it, and no way
to produce a PPTX. I do not have Microsoft Office, so whatever I produce has to be a
self-contained file that any viewer can open.

## Solution

I can turn any `.md` file into a Deck: the whole document becomes the source, Marp's
directives and `---` page breaks define the slides. The Deck opens in two columns — Typora's
own editor on the left and the live rendered slides on the right, updating as I type — and
two buttons let me isolate either column when I want to look at one thing closely. From the
Slide Column (or from the command palette, without opening it at all) I export the Deck as
an image-based PPTX or a
PDF. Each slide becomes one full-page picture, so the result opens identically in any
viewer regardless of fonts or whether the recipient has Office.

## User Stories

1. As a Typora user, I want to turn the current `.md` document into a Deck, so that I can author slides in the editor I already use.
2. As a Typora user, I want Deck mode to be something I switch on for a specific file, so that my ordinary notes are never accidentally treated as slides.
3. As a Typora user, I want the Deck switch to be remembered per file, so that reopening a deck puts me back where I was.
4. As a Typora user, I want the Deck to open in two columns, so that I see my edits reflected immediately without arranging anything.
5. As a Typora user, I want a button that isolates the editor at full width, so that I can concentrate on writing.
6. As a Typora user, I want a button that isolates the slides at full width, so that I can review the deck without the editor in the way.
7. As a Typora user, I want pressing either button while a column is isolated to bring both columns back, so that there is one rule to remember rather than one per button.
8. As a Typora user, I want the two-column view to update live as I type, so that I do not have to trigger a refresh.
9. As a Typora user, I want the live update to re-render only the slides that actually changed, so that typing stays responsive on a long deck.
10. As a Typora user, I want the preview to keep my scroll position when a slide updates, so that editing slide 40 does not jump me back to the top.
11. As a Typora user, I want all slides stacked vertically and scrollable, so that I can see the deck's structure at a glance.
12. As a Typora user, I want to resize the Slide Column by dragging, so that I can trade editor width against slide size.
13. As a Typora user, I want the two-column layout to stay correct when I open or close Typora's sidebar, so that the layout does not break.
14. As a Typora user, I want the layout to stay correct when I resize the window, so that the pane never overflows or collapses.
15. As a Typora user, I want to leave Deck mode and get my normal editor back exactly as it was, so that the mode is safe to toggle.
16. As a Typora user, I want to trigger Deck mode from the command palette, so that I can switch without remembering a hotkey.
17. As a Typora user, I want to trigger Deck mode from the right-click menu, so that it is discoverable.
18. As a Typora user, I want to trigger Deck mode from a hotkey, so that I can work quickly.
19. As a Typora user, I want an Export action in the Slide Column's title bar, so that exporting is adjacent to the preview.
20. As a Typora user, I want to export from the command palette without opening the preview, so that I can go straight from document to PPTX.
21. As a Typora user, I want to export an image-based PPTX, so that each slide is a full-page picture and renders identically everywhere.
22. As a Typora user, I want to export a PDF, so that I have a universally readable fallback.
23. As a Typora user, I want the PDF paginated one slide per page, so that it matches the deck rather than Typora's document pagination.
24. As a Typora user, I want to choose the export resolution, so that slides are crisp when projected but not needlessly huge.
25. As a Typora user, I want a sensible default resolution matching Marp CLI's PPTX default, so that I do not have to think about it.
26. As a Typora user, I want local images in my deck to appear in the export, so that my slides are not blank where the images should be.
27. As a Typora user, I want to see export progress, so that a long deck does not look frozen.
28. As a Typora user, I want to cancel an export in progress, so that I am not stuck waiting on a mistake.
29. As a Typora user, I want a clear message when export fails, so that I know whether it was my Markdown, a missing file, or the disk.
30. As a Typora user, I want Marp directives — front matter, `_class`, background images — to survive into the export, so that my deck looks the way I authored it.
31. As a Typora user, I want my unsaved edits included in the export, so that I do not have to remember to save first.
32. As a Typora user, I want to be told when the document must be saved before exporting, so that the exported file matches what I see.
33. As a Typora user, I want Chinese text and emoji to render correctly in the export, so that non-Latin decks are usable.
34. As a Typora user, I want to point the plugin at an extra font directory, so that I can improve the export's typography if I care.
35. As a Typora user, I want to choose whether remote fonts are fetched during export, so that I can export offline without a stall.
36. As a Typora user, I want the deck to keep rendering correctly after I switch files and come back, so that the mode is stable across navigation.
37. As a Typora user, I want an error shown in the preview when my Markdown is invalid, so that I can fix it without leaving the editor.
38. As a maintainer, I want the Deck logic isolated from Typora's DOM, so that I can test it with plain `node:test`.
39. As a maintainer, I want the rasterization behaviour pinned by tests, so that a future Marp or Chromium change is caught rather than silently producing blank slides.
40. As a maintainer, I want the new UI held to the repo's Chrome 84 compatibility rules, so that the plugin keeps working on Typora 0.9.98.
41. As a maintainer, I want the new UI to avoid native `select`/`option`/`button` elements, so that user themes cannot break it.

## Implementation Decisions

**Placement.** The feature extends the existing `marp` plugin, reusing its `Marp` instance
and its local-image path resolution. The existing ```marp fenced-code-block rendering
stays untouched: it is upstream code, and deleting it would only increase merge conflict
surface against `upstream` (see ADR-0001).

**Data source.** A Deck is the whole `.md` document, read through `File.editor.getMarkdown()`
(the repo's `utils.getCurrentFileContent`). That accessor is faithful in both of Typora's
modes: front matter survives as a `meta_block` whose serialization rebuilds the `---` fences,
and HTML comments pass through verbatim. Reading the file from disk remains the fallback when
the accessor is unavailable. See ADR-0005.

**Module boundaries (the seams).**

1. A pure `Markdown → slides` module. Input: raw deck text plus options. Output: per-slide
   SVG strings that are already safe to rasterize. It owns all of the rasterization
   hazards, so none of them leak into the UI layer.
2. A pure `slides → file bytes` module for PPTX and PDF. Input: rasterized page images
   plus page geometry and metadata. Output: bytes. Pure and Node-testable; this is where
   the zip-writing dependency is contained.
3. The Deck view controller, which owns the Layout state, the pane, and wiring to Typora
   events. It is not unit-tested (see Testing Decisions).

**Rasterization (see ADR-0003).** Slides are rendered with Marp's array-of-slides mode,
then each slide is turned into a bitmap inside the Typora renderer via SVG → `<img>` →
canvas. Three hazards were found by prototype and are contractual:

- Marp's stylesheet is scoped to a container that the array mode strips. The stylesheet
  must be de-scoped and its `@charset`/`@import` rules removed, or the slide rasterizes
  blank.
- Images referenced by path do not load during rasterization. Local images must be inlined
  as data URIs first. The repo already has this capability in its export-enhancement
  plugin and it should be reused rather than reimplemented.
- HTML inside `foreignObject` must be in the XHTML namespace.

**Layout.** Two columns are the resting state, so no button names it: the Deck opens with
Typora's editor on the left and the Slide Column docked to its right. Two buttons isolate
one column each — Editor and Preview — and pressing either button while a column is isolated
returns to two columns. That is one rule for both buttons. A consequence worth stating: going
from editor-only to slides-only takes two presses, because the first returns to two columns.
The single-column states are for looking closely at one thing, not for switching between
them.

There is deliberately **no source view**. Reading the Markdown is already served by Typora's
own source mode (`Ctrl+/`), and `getMarkdown()` is faithful in both of Typora's modes, so the
Deck never needs to switch Typora into source mode — which matters, because Typora's own rule
hides the pinned sidebar in source mode. See ADR-0006.

The Slide Column is docked by narrowing the content area and positioning the pane to the
right of it — the idiom the right-outline and markmap plugins already use — rather than
hiding the editor and taking over the content area the way the d2 and html_editor file views
do. `.md` is Typora's own file type, so its editor is an asset to keep, not a surface to
replace. Each layout needs its own geometry: in two columns the pane takes its share, when
the editor is isolated the pane collapses to a floating toolbar over the editor, and when the
slides are isolated the pane takes the whole content area.

**Live preview.** Re-render on the debounced document-edited event, keyed per slide by a
content hash, so only changed slides are rebuilt. Preserve the pane's scroll offset across
updates.

**Rasterization fidelity.** Export resolution defaults to Marp CLI's PPTX default and is
configurable. Remote `@import` font fetching is off by default, with a setting to enable
it. Non-Latin text falls back to system fonts, with a configurable extra font directory.

**Entry points.** One `staticActions` declaration exposes Deck mode and both export
formats to the command palette, the right-click menu, and hotkeys; the Slide Column title
bar additionally carries an Export control. The pane's controls are `div` elements per
repo rules.

**Progress and cancellation.** Export reports progress through the shared notification
component and can be cancelled; the pane's Export control becomes Cancel for the duration.
Cancellation is cooperative via a token checked between pages.

**Dependencies.** A zip-writing library is added and bundled into the plugin's shared
library directory by the existing build, per repo convention. No runtime install is
introduced.

## Testing Decisions

A good test here asserts external behaviour at a seam: given this deck text, these slides
come out; given these page images, this PPTX opens as a valid presentation. Tests must not
assert private method names or internal call sequences, so the modules stay refactorable.

**Module 1 (`Markdown → slides`)** — the highest-value target, because every hazard in
ADR-0003 lives here and every one of them fails *silently* as a blank slide rather than an
error. Tests use plain `node:test` with no DOM, following the precedent of the existing
diagram-core and third-party-parser tests. They must cover: slide count from `---` breaks;
directive survival (front matter and HTML comments reach Marp intact); the de-scoped
stylesheet being free of `@charset`/`@import`; every slide carrying the XHTML namespace
where required; and local images becoming data URIs.

**Module 2 (`slides → bytes`)** — pure byte-level assertions, in the style of the existing
updater test: the output parses as a valid archive, contains one slide per page image, and
declares the correct page geometry. The PDF side is asserted through its page count and
page size.

**Rasterization** — the DOM-dependent half (inline SVG → `<img>` → canvas → PNG) is
verified in a real browser through the harness the repo already uses for diagram-enhance
verification, which launches Edge via `playwright-core` and skips when no browser is
present. This is the only place a real browser is needed, and it is the test that would
have caught the blank-slide bug.

**Compatibility** — the existing compatibility test currently guards three plugin UIs; the
`marp` plugin joins that list so the new pane cannot drift into Chrome-84-incompatible CSS
or native `select`/`option`/`button` elements.

**Not tested.** The view controller's DOM work — docking, resizing, Layout switching —
is not unit-tested, matching the precedent set by the d2 and html_editor file views, which
test only their pure helpers.

## Out of Scope

- Editable (non-image) PPTX export, which would require a PDF → LibreOffice Impress path.
- Rendering the deck from ```marp fenced code blocks; only whole `.md` documents are Decks.
- Per-slide PNG export and archive-of-images export.
- Marp's presenter view, speaker notes editing, and PDF handout modes.
- Bundling Marp's own web fonts into the plugin.
- A thumbnail-grid Layout.
- Typora's built-in Export menu gaining a PPTX entry; export is exposed through the
  plugin's own surfaces.

## Further Notes

- `docs/adr/0003-rasterize-slides-inside-the-typora-renderer.md` records why rasterization
  happens in the renderer, and the three hazards, with the prototype evidence.
- Vocabulary used above is defined in `GLOSSARY.md`: Deck, Slide, Directive, Theme,
Rasterize, Image-based PPTX, Deck Mode, Layout, Editor Column, Slide Column.
- Two facts are cheap to confirm during implementation and worth checking early, because
  they change where code goes rather than what it does: whether the plugin mount point
  really sits inside the content element, and whether the raw-read → Marp → export path is
  lossless for front matter and HTML comments.
