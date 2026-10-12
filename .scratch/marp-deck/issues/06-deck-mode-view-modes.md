Status: resolved
Type: task
Blocked by: 05

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Make a `.md` file behave as a Deck: an explicit, remembered per-file switch, and the three
View Modes.

## Contract

- **Deck mode is explicit per file**, not inferred from content, and is remembered per
  file across navigation. Ordinary notes must never be treated as slides.
- **Source**: Typora's own source mode, full width. No slide pane.
- **Preview**: rendered Slides at full width, with Typora's editor temporarily hidden.
- **Split**: Typora's own source mode plus a docked slide pane to its right.
- Leaving Deck mode restores the editor exactly as it was, including whichever mode
  Typora was in before.

## Docking decision

Dock by narrowing the content area and positioning the pane to the right of it — the idiom
the right-outline and mindmap plugins already use. Do **not** hide the editor and take
over the content area the way the d2 and html_editor file views do: `.md` is Typora's own
type, so its editor is an asset to keep.

## Layout correctness

The split must stay correct when Typora's sidebar is opened or closed, when the sidebar is
resized, and when the window is resized. The repo has events for the first two and none for
the third; handle the third explicitly rather than assuming a resize event exists.

## Notes

- Confirm early that the plugin mount point really sits inside the content element; the
  test mock and the shipping overlays disagree, and this decides where the pane attaches.
- The pane's controls are `div` elements, not native `button`/`select`/`option`.

## Done when

Toggling Deck mode on a `.md` shows the three View Modes and the correct pane in each;
toggling it off leaves the document as it was; and the split survives sidebar and window
resizing.
