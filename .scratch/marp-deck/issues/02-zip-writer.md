Status: ready-for-agent
Type: task

Part of the Marp Deck spec: `.scratch/marp-deck/spec.md`.

## Goal

Provide the archive-writing primitive the PPTX builder needs, as a pure, testable module.

## Decision to make and record

The spec currently says a zip-writing library is added and bundled per repo convention.
Reconsider before doing that: PPTX needs only STORE and DEFLATE, no Zip64 and no
encryption, and the repo already ships `extract-zip`/`yauzl` for *reading*. A small
deterministic writer is easier to test than an opaque bundle and avoids build-system churn
and a new vendored artifact.

If you agree, implement the writer and record the deviation from the "bundle npm deps"
convention as an ADR (it is a deliberate deviation from the obvious path, which is exactly
what an ADR is for). If you disagree, add the dependency and bundle it, and update the
spec.

## Contract

- Accept a list of entries, each a path plus bytes.
- Emit a valid archive that a standard reader can open and enumerate.
- Be deterministic: the same input produces byte-identical output, so tests can assert on
  it and rebuilds are stable.
- Handle only what PPTX requires. Reject or explicitly not-support Zip64 and encryption.

## Done when

`node:test` coverage asserts: the output parses as an archive with the expected entry
names and byte-for-byte entry contents; an empty archive is valid; and identical input
produces identical bytes.
