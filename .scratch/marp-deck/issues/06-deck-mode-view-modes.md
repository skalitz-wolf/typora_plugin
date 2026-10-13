Status: resolved
Type: task
Blocked by: 05

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Make a `.md` file behave as a Deck: an explicit, remembered per-file switch, and the two
buttons that control the Layout.

## Contract

- **Deck mode is explicit per file**, not inferred from content, and is remembered per
  file across navigation. Ordinary notes must never be treated as slides.
- The Deck opens in **two columns**: Typora's editor on the left, the Slide Column docked to
  its right. Two columns are the resting state, so no button names it.
- **Editor**: isolates the editor at full width; the pane collapses to a floating toolbar so
  the buttons stay reachable.
- **Preview**: isolates the slides at full width, with the editor hidden and the pane taking
  the whole content area.
- Pressing either button while a column is isolated returns to two columns — one rule for
  both buttons. Going from editor-only to slides-only therefore takes two presses.
- There is **no source view**; Typora's own `Ctrl+/` covers reading the Markdown (ADR-0006).
- Leaving Deck mode restores the editor exactly as it was, including whichever mode
  Typora was in before.

## Docking decision

Dock by narrowing the content area and positioning the pane to the right of it — the idiom
the right-outline and mindmap plugins already use. Do **not** hide the editor and take
over the content area the way the d2 and html_editor file views do: `.md` is Typora's own
type, so its editor is an asset to keep.

Each layout needs its own geometry, and they are not variations of one measurement: two
columns gives the pane its share, Editor collapses it to a toolbar, and Preview expands it to
the full content width. Treating them as one docked width is what produced a pane that stayed
a narrow strip when the slides were isolated.

## Layout correctness

The split must stay correct when Typora's sidebar is opened or closed, when the sidebar is
resized, and when the window is resized. The repo has events for the first two and none for
the third; handle the third explicitly rather than assuming a resize event exists.

## Notes

- Confirm early that the plugin mount point really sits inside the content element; the
  test mock and the shipping overlays disagree, and this decides where the pane attaches.
- The pane's controls are `div` elements, not native `button`/`select`/`option`.

## Done when

Toggling Deck mode on a `.md` shows two columns; each button isolates its column and pressing
it again restores two columns; toggling Deck mode off leaves the document as it was; and the
layout survives sidebar and window resizing.
