Status: resolved
Type: task
Blocked by: 01

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Make the export's typography controllable, and make the font trade-off explicit rather
than accidental.

## Contract

- Marp's own web fonts are not bundled, so a Deck rendered offline falls back to system
  fonts. This is intended, not a bug — but it means exported text will not match Marp's
  own demo.
- Provide a setting for an **extra font directory**, used when rendering, so a user who
  cares about typography can point the plugin at local fonts.
- Provide a setting controlling whether **remote fonts may be fetched** during export,
  defaulting to off, so exporting offline never stalls.
- Non-Latin text and emoji must render correctly by falling back to system fonts. Verify
  this for at least one CJK deck and one emoji deck.

## Notes

- These settings need entries in the plugin's settings section, labels in all three locale
  files, and controls in the preferences schema, per repo convention.
- Prefer reusing the existing shared form/dropdown components over new UI.

## Done when

A CJK deck and an emoji deck both export with correct glyphs; a custom font directory
changes the rendered font; and export with remote fonts disabled works with no network.
