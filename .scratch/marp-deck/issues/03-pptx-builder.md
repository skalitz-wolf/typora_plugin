Status: ready-for-agent
Type: task
Blocked by: 02

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Build the pure `slides -> PPTX bytes` seam: an **Image-based PPTX** where each Slide is one
full-page picture, matching what Marp CLI produces for `--pptx`.

## Contract

- Input: one rasterized page image per Slide, in order, plus the page geometry and any
  speaker notes.
- Output: PPTX bytes.
- The presentation's slide size must be derived from the page geometry, so a 16:9 deck is
  16:9 rather than defaulting to 4:3.
- One presentation Slide per page image, in input order, each image filling the page.
- Speaker notes, when supplied, attach to the corresponding Slide.
- Reject an empty page list with a clear error rather than emitting a broken file.

## Notes

- Use the writer from ticket 02. Do not hand-roll XML string concatenation across the
  whole OOXML part set without keeping the parts enumerated somewhere testable.
- Marp's Slide comments are the natural source for speaker notes; the caller supplies them.

## Done when

`node:test` coverage asserts: the output opens as a valid archive containing the expected
OOXML parts; the number of presentation Slides equals the number of input images; the
declared slide size matches the page geometry; and an empty input is rejected.
