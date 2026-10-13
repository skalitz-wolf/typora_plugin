Status: resolved
Type: task

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Build the pure `Markdown -> slides` seam. Input: raw deck text plus options. Output: one
string per Slide, each already safe to rasterize. No DOM, no Typora globals, no file
system beyond an injected image resolver.

This is the highest-value seam in the spec, because every hazard recorded in ADR-0003
lives here and every one of them fails **silently** as a blank Slide rather than as an
error.

## Contract

The module must, for a given deck text:

1. Produce one entry per Slide, split on Marp's own rules (`---` at top level, and
   `headingDivider` if configured) — do not reimplement splitting, delegate to Marp's
   array-of-slides render mode.
2. Return each Slide as an SVG string whose embedded stylesheet is **de-scoped** from
   Marp's container selector and free of `@charset` and `@import`, because either one
   makes the whole `<style>` inert inside an SVG document and the Slide rasterizes blank.
3. Put HTML inside `foreignObject` in the XHTML namespace.
4. Rewrite images that resolve to local files into data URIs, via an injected resolver, so
   that rasterization does not silently drop them. Remote URLs are left alone unless the
   caller enables remote fetching.
5. Strip Marp's appended inline `<script>` (its SVG polyfill / auto-scaling), which is
   meaningless in a rasterized Slide and breaks serialization.
6. Expose the per-Slide identity needed for content-hash caching by the caller.

Options the caller passes: the Marp core options, whether remote fonts may be fetched, and
an extra font directory. Resolution scaling is **not** this module's concern.

## Notes

- Prototype evidence for items 2 and 3 is in ADR-0003; do not treat them as optional.
- Reuse the repo's existing local-image detection and path resolution rather than writing
  new ones.
- Marp's own web fonts are not bundled (spec: Out of Scope), so expect font fallback.

## Done when

`node:test` coverage asserts, at minimum: Slide count from `---` breaks; front matter and
HTML comments reaching Marp intact; the emitted stylesheet containing neither `@charset`
nor `@import`; the XHTML namespace being present where required; a local image becoming a
data URI; and Marp's `<script>` being gone.
