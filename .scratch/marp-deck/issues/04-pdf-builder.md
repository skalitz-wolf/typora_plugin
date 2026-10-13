Status: resolved
Type: task

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Build the pure `slides -> PDF bytes` seam: one Slide per PDF page, so the PDF matches the
Deck rather than Typora's document pagination.

## Contract

- Input: one rasterized page image per Slide, in order, plus the page geometry.
- Output: PDF bytes with exactly one page per input image, each page sized to the Slide
  geometry and the image filling it.
- Reject an empty page list with a clear error.

## Notes

The repo already vendors a PDF library for other plugins; check whether it can build a
PDF from images before adding anything. Building the PDF by hand is also viable for this
narrow case (raster pages only, no text, no fonts) and would keep the module dependency
free — decide and record why in the ticket, and add an ADR only if the choice is
surprising to a future reader.

## Done when

`node:test` coverage asserts: the output parses as a PDF; the page count equals the number
of input images; and the page size matches the Slide geometry.
