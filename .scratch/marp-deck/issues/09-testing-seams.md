Status: resolved
Type: task
Blocked by: 05

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Put the Deck feature's behaviour under test at the seams the spec defines, and extend the
repo's existing compatibility guard to cover the new UI.

## Contract

**Pure module tests** (plain `node:test`, no DOM), following the repo's existing
diagram-core and third-party-parser test style:

- `Markdown -> slides`: Slide count; directive survival (front matter and HTML comments);
  the stylesheet carrying neither `@charset` nor `@import`; the XHTML namespace; a local
  image becoming a data URI; Marp's `<script>` removed. These must assert **external**
  behaviour — given this deck text, these Slides come out — not private method names.
- Archive writer: entry names and contents round-trip; deterministic bytes.
- PPTX builder: valid archive, one presentation Slide per image, correct slide size, empty
  input rejected.
- PDF builder: parses as PDF, one page per image, correct page size.

**Real-browser verification** for rasterization, reusing the harness the repo already uses
for diagram-enhance verification (it launches Edge via `playwright-core` and skips when no
browser is present). This is the only place a browser is needed and is the test that
catches a blank Slide.

**Compatibility guard**: add the `marp` plugin to the existing compatibility test's plugin
list, so the new pane is held to the Chrome 84 boundary and the no-native-controls rule.

**Explicitly not tested**: the view controller's DOM work (docking, resizing, View Mode
switching), matching the precedent of the d2 and html_editor file views, which test only
their pure helpers.

## Done when

`npm test` covers the pure modules and the compatibility guard, the browser verification
passes locally, and the browser test still skips cleanly on a machine without Edge.
