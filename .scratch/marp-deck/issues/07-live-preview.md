Status: ready-for-agent
Type: task
Blocked by: 06

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Make Split update live as the user types, without the deck re-rendering wholesale on every
keystroke.

## Contract

- Re-render on the repo's debounced document-edited event.
- Cache per Slide by content hash, so only the Slides whose source actually changed are
  rebuilt. A one-character edit on a long deck must not rebuild every Slide.
- Preserve the pane's scroll offset across an update, so editing a late Slide does not
  jump the view to the top.
- Show a readable error in the pane when the Markdown is invalid, and recover when it is
  fixed, without leaving the editor.
- Stop rendering when Deck mode is left or the file changes, so no stale work lands on a
  different document.

## Notes

- The deck text read here is the same raw text the export uses; keep one read path so the
  preview and the export can never disagree about what the deck is.
- Rendering is asynchronous and the user keeps typing; guard against an older render
  overwriting a newer one.

## Done when

Editing a deck in Split updates the affected Slide within the debounce window, leaves other
Slides' DOM untouched, and does not move the scroll position.
