Status: resolved
Type: task
Blocked by: 03, 04, 05

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Wire the export pipeline to the user: actions, progress, cancellation, and failure
reporting.

## Contract

- Export to Image-based PPTX and to PDF, both from one entry point.
- Expose both formats (and Deck mode itself) through the repo's standard action
  declaration, so they appear in the command palette, the right-click menu, and via
  hotkeys from a single declaration.
- Add an Export control to the Preview Pane title bar, as a `div`.
- Export must work **without** opening the Preview Pane, so a user can go straight from
  document to PPTX.
- Flush unsaved changes before reading the deck. If the document cannot be saved, stop
  with a message rather than exporting stale content.
- Report progress through the shared notification component, and allow cancelling a run
  in progress. Cancellation is cooperative: check a token between pages.
- On failure, distinguish a Markdown error, a missing local image, and a write failure in
  the message.
- Offer a save dialog with sensible filters and reveal the result on success.

## Notes

- Do not route this through Typora's own Export menu; the spec puts that out of scope.
- Default the export resolution to Marp CLI's PPTX default, and make it configurable.

## Done when

Both formats export end to end from the command palette on a document whose preview pane
was never opened; progress is visible; cancelling stops the run and leaves no partial file;
and a deliberately broken deck produces an actionable message.
