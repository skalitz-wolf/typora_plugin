## Problem Statement

I write Markdown in Typora and want to turn a document into a slide deck and share it as
PowerPoint. Today Typora cannot show me slides at all: it renders my `.md` as a document,
and the plugin's existing `marp` support only renders ```marp fenced code blocks, which I
never use. I have no way to see what the deck will look like while I write it, and no way
to produce a PPTX. I do not have Microsoft Office, so whatever I produce has to be a
self-contained file that any viewer can open.

## Solution

I can turn any `.md` file into a Deck: the whole document becomes the source, Marp's
directives and `---` page breaks define the slides. I get three View Modes — Source,
Preview, and Split — where Split keeps Typora's own editor on the left and the live
rendered slides on the right, updating as I type. From the Preview Pane (or from the
command palette, without opening it at all) I export the Deck as an image-based PPTX or a
PDF. Each slide becomes one full-page picture, so the result opens identically in any
viewer regardless of fonts or whether the recipient has Office.

## User Stories

1. As a Typora user, I want to turn the current `.md` document into a Deck, so that I can author slides in the editor I already use.
2. As a Typora user, I want Deck mode to be something I switch on for a specific file, so that my ordinary notes are never accidentally treated as slides.
3. As a Typora user, I want the Deck switch to be remembered per file, so that reopening a deck puts me back where I was.
4. As a Typora user, I want a Source View Mode that shows the Deck's raw Markdown, so that I can edit front matter and `_class` directives precisely.
5. As a Typora user, I want a Preview View Mode that shows the rendered slides without the editor, so that I can review the deck at full width.
6. As a Typora user, I want a Split View Mode with the editor on the left and slides on the right, so that I can see my edits reflected immediately.
7. As a Typora user, I want Split to update live as I type, so that I do not have to trigger a refresh.
8. As a Typora user, I want the live update to re-render only the slides that actually changed, so that typing stays responsive on a long deck.
9. As a Typora user, I want the preview to keep my scroll position when a slide updates, so that editing slide 40 does not jump me back to the top.
10. As a Typora user, I want all slides stacked vertically and scrollable, so that I can see the deck's structure at a glance.
11. As a Typora user, I want to resize the preview pane by dragging, so that I can trade editor width against slide size.
12. As a Typora user, I want the split to stay correct when I open or close Typora's sidebar, so that the layout does not break.
13. As a Typora user, I want the split to stay correct when I resize the window, so that the pane never overflows or collapses.
14. As a Typora user, I want to leave Deck mode and get my normal editor back exactly as it was, so that the mode is safe to toggle.
15. As a Typora user, I want to trigger Deck mode from the command palette, so that I can switch without remembering a hotkey.
16. As a Typora user, I want to trigger Deck mode from the right-click menu, so that it is discoverable.
17. As a Typora user, I want to trigger Deck mode from a hotkey, so that I can work quickly.
18. As a Typora user, I want an Export action in the Preview Pane's title bar, so that exporting is adjacent to the preview.
19. As a Typora user, I want to export from the command palette without opening the preview, so that I can go straight from document to PPTX.
20. As a Typora user, I want to export an image-based PPTX, so that each slide is a full-page picture and renders identically everywhere.
21. As a Typora user, I want to export a PDF, so that I have a universally readable fallback.
22. As a Typora user, I want the PDF paginated one slide per page, so that it matches the deck rather than Typora's document pagination.
23. As a Typora user, I want to choose the export resolution, so that slides are crisp when projected but not needlessly huge.
24. As a Typora user, I want a sensible default resolution matching Marp CLI's PPTX default, so that I do not have to think about it.
25. As a Typora user, I want local images in my deck to appear in the export, so that my slides are not blank where the images should be.
26. As a Typora user, I want to see export progress, so that a long deck does not look frozen.
27. As a Typora user, I want to cancel an export in progress, so that I am not stuck waiting on a mistake.
28. As a Typora user, I want a clear message when export fails, so that I know whether it was my Markdown, a missing file, or the disk.
29. As a Typora user, I want Marp directives — front matter, `_class`, background images — to survive into the export, so that my deck looks the way I authored it.
30. As a Typora user, I want my unsaved edits included in the export, so that I do not have to remember to save first.
31. As a Typora user, I want to be told when the document must be saved before exporting, so that the exported file matches what I see.
32. As a Typora user, I want Chinese text and emoji to render correctly in the export, so that non-Latin decks are usable.
33. As a Typora user, I want to point the plugin at an extra font directory, so that I can improve the export's typography if I care.
34. As a Typora user, I want to choose whether remote fonts are fetched during export, so that I can export offline without a stall.
35. As a Typora user, I want the deck to keep rendering correctly after I switch files and come back, so that the mode is stable across navigation.
36. As a Typora user, I want an error shown in the preview when my Markdown is invalid, so that I can fix it without leaving the editor.
37. As a maintainer, I want the Deck logic isolated from Typora's DOM, so that I can test it with plain `node:test`.
38. As a maintainer, I want the rasterization behaviour pinned by tests, so that a future Marp or Chromium change is caught rather than silently producing blank slides.
39. As a maintainer, I want the new UI held to the repo's Chrome 84 compatibility rules, so that the plugin keeps working on Typora 0.9.98.
40. As a maintainer, I want the new UI to avoid native `select`/`option`/`button` elements, so that user themes cannot break it.

## Implementation Decisions

**Placement.** The feature extends the existing `marp` plugin, reusing its `Marp` instance
and its local-image path resolution. The existing ```marp fenced-code-block rendering
stays untouched: it is upstream code, and deleting it would only increase merge conflict
surface against `upstream` (see ADR-0001).

**Data source.** A Deck is the whole `.md` document, read as raw bytes from disk, not via
Typora's markdown serializer, because Marp treats YAML front matter and HTML comments as
directives and a normalized re-serialization may drop them. Because the export reads from
disk, unsaved changes must be flushed first; when the document cannot be saved, the export
stops with a message rather than exporting stale content.

**Module boundaries (the seams).**

1. A pure `Markdown → slides` module. Input: raw deck text plus options. Output: per-slide
   SVG strings that are already safe to rasterize. It owns all of the rasterization
   hazards, so none of them leak into the UI layer.
2. A pure `slides → file bytes` module for PPTX and PDF. Input: rasterized page images
   plus page geometry and metadata. Output: bytes. Pure and Node-testable; this is where
   the zip-writing dependency is contained.
3. The Deck view controller, which owns View Modes, the pane, and wiring to Typora
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

**View Modes.** Source = Typora's native source mode, full width. Preview = rendered slides
at full width, with Typora's editor temporarily hidden. Split = Typora's native source mode
plus a docked slide pane. The pane is docked by narrowing the content area and positioning
the pane to the right of it — the idiom the right-outline and markmap plugins already use —
rather than hiding the editor and taking over the content area the way the d2 and
html_editor file views do. `.md` is Typora's own file type, so its editor is an asset to
keep, not a surface to replace.

**Live preview.** Re-render on the debounced document-edited event, keyed per slide by a
content hash, so only changed slides are rebuilt. Preserve the pane's scroll offset across
updates.

**Rasterization fidelity.** Export resolution defaults to Marp CLI's PPTX default and is
configurable. Remote `@import` font fetching is off by default, with a setting to enable
it. Non-Latin text falls back to system fonts, with a configurable extra font directory.

**Entry points.** One `staticActions` declaration exposes Deck mode and both export
formats to the command palette, the right-click menu, and hotkeys; the Preview Pane title
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

**Not tested.** The view controller's DOM work — docking, resizing, View Mode switching —
is not unit-tested, matching the precedent set by the d2 and html_editor file views, which
test only their pure helpers.

## Out of Scope

- Editable (non-image) PPTX export, which would require a PDF → LibreOffice Impress path.
- Rendering the deck from ```marp fenced code blocks; only whole `.md` documents are Decks.
- Per-slide PNG export and archive-of-images export.
- Marp's presenter view, speaker notes editing, and PDF handout modes.
- Bundling Marp's own web fonts into the plugin.
- A thumbnail-grid View Mode.
- Typora's built-in Export menu gaining a PPTX entry; export is exposed through the
  plugin's own surfaces.

## Further Notes

- `docs/adr/0003-rasterize-slides-inside-the-typora-renderer.md` records why rasterization
  happens in the renderer, and the three hazards, with the prototype evidence.
- Vocabulary used above is defined in `GLOSSARY.md`: Deck, Slide, Directive, Theme,
  Rasterize, Image-based PPTX, Preview Pane, View Mode, Source, Preview, Split.
- Two facts are cheap to confirm during implementation and worth checking early, because
  they change where code goes rather than what it does: whether the plugin mount point
  really sits inside the content element, and whether the raw-read → Marp → export path is
  lossless for front matter and HTML comments.
