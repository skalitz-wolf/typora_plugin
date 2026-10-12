Status: ready-for-agent
Type: task
Blocked by: 01

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Build the rasterization step that turns one Slide's SVG into a bitmap, inside the Typora
renderer, per ADR-0003. This is the step that would have caught the blank-Slide bug.

## Contract

- Input: one Slide SVG string (from ticket 01) plus a scale factor.
- Output: encoded image bytes.
- Rasterize through the browser's own SVG -> `<img>` -> canvas path. Do **not** add a
  headless-browser dependency; ADR-0003 rejects driving an external browser.
- Honour the scale factor, so the default resolution produces a crisp projected Slide.
- Await image decoding before drawing, and surface a decode failure as an error rather
  than returning a blank image.

## Notes

- The repo has prior art for this exact path in its mindmap export code; follow that shape
  rather than inventing a new one.
- This module needs a DOM, so it cannot be tested with plain `node:test`. See the testing
  ticket.

## Done when

The real-browser verification from ticket 09 passes against a Marp-produced Slide, and a
Slide with a local image rasterizes with the image visible rather than blank.
