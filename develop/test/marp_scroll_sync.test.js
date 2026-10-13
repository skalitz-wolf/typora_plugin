const { describe, it } = require("node:test")
const assert = require("node:assert/strict")

const {
  clamp01,
  scrollRange,
  slideSpans,
  toSlideFraction,
  toSourceFraction,
} = require("../../plugin/marp/scroll-sync.js")

// Three slides over a 30-line document, deliberately unequal so a pixel-ratio sync would
// visibly drift: 2 lines, 20 lines, 8 lines.
const SLIDES = [
  { startLine: 0, endLine: 2 },
  { startLine: 2, endLine: 22 },
  { startLine: 22, endLine: 30 },
]
const SPANS = slideSpans(SLIDES, 30)

describe("marp scroll sync - slide spans", () => {
  it("turns line ranges into fractions of the document", () => {
    assert.deepEqual(SPANS[0], { from: 0, to: 2 / 30 })
    assert.deepEqual(SPANS[1], { from: 2 / 30, to: 22 / 30 })
    assert.deepEqual(SPANS[2], { from: 22 / 30, to: 1 })
  })

  it("returns nothing when there is nothing to sync", () => {
    assert.deepEqual(slideSpans([], 30), [])
    assert.deepEqual(slideSpans(null, 30), [])
    assert.deepEqual(slideSpans(SLIDES, 0), [])
  })

  it("clamps spans that run past the end of the document", () => {
    const spans = slideSpans([{ startLine: 10, endLine: 999 }], 20)
    assert.deepEqual(spans, [{ from: 0.5, to: 1 }])
  })
})

describe("marp scroll sync - source to slides", () => {
  it("puts the matching slide at the top of the column", () => {
    // Start of each slide's source -> that slide sits at the top.
    assert.equal(toSlideFraction(0, SPANS), 0)
    assert.equal(toSlideFraction(2 / 30, SPANS), 1 / 3)
    assert.equal(toSlideFraction(22 / 30, SPANS), 2 / 3)
  })

  it("proceeds smoothly within a slide", () => {
    // Halfway through slide 2's 20 lines -> slide 2, half shown.
    const halfway = 12 / 30
    const result = toSlideFraction(halfway, SPANS)
    assert.ok(result > 1 / 3 && result < 2 / 3, `expected inside slide 2, got ${result}`)
    assert.ok(Math.abs(result - (1 + 0.5) / 3) < 0.001)
  })

  it("reaches the very bottom at the end of the document", () => {
    assert.equal(toSlideFraction(1, SPANS), 1)
  })

  it("interpolates smoothly near the end instead of snapping", () => {
    // 29.9/30 is still inside the last slide (0.733..1), at 98.75% through it, so the
    // column should be at 99.58% - not snapped to 1, and not stuck at 0.733.
    const nearEnd = 29.9 / 30
    const result = toSlideFraction(nearEnd, SPANS)
    assert.ok(Math.abs(result - (2 + 0.9875) / 3) < 0.001, `got ${result}`)
    assert.ok(result < 1, "near the end is not the end")
    assert.ok(result > 2 / 3, "near the end is past the start of the last slide")
  })

  it("holds at the bottom when the document runs past the last slide", () => {
    // Defensive: if the last slide's span ends short of the document's end, anything past
    // it must still resolve to the bottom rather than overshooting.
    const short = slideSpans([{ startLine: 0, endLine: 2 }, { startLine: 2, endLine: 10 }], 20)
    assert.equal(toSlideFraction(1, short), 1)
    assert.equal(toSlideFraction(0.95, short), 1)
  })

  it("never leaves the unit range", () => {
    for (const at of [-1, 0, 0.25, 0.5, 0.9, 1, 2]) {
      const value = toSlideFraction(at, SPANS)
      assert.ok(value >= 0 && value <= 1, `${at} -> ${value}`)
    }
  })

  it("falls back to a plain ratio when there are no slides", () => {
    assert.equal(toSlideFraction(0.4, []), 0.4)
  })
})

describe("marp scroll sync - slides to source", () => {
  it("maps the top of each slide back to that slide's first line", () => {
    assert.ok(Math.abs(toSourceFraction(0, SPANS) - 0) < 0.001)
    assert.ok(Math.abs(toSourceFraction(1 / 3, SPANS) - 2 / 30) < 0.001)
    assert.ok(Math.abs(toSourceFraction(2 / 3, SPANS) - 22 / 30) < 0.001)
  })

  it("round-trips, so syncing back and forth does not drift", () => {
    for (const at of [0, 0.1, 0.33, 0.5, 0.66, 0.9, 1]) {
      const there = toSlideFraction(at, SPANS)
      const back = toSourceFraction(there, SPANS)
      assert.ok(Math.abs(back - at) < 0.02, `${at} -> ${there} -> ${back}`)
    }
  })

  it("never leaves the unit range", () => {
    for (const at of [-1, 0, 0.5, 1, 2]) {
      const value = toSourceFraction(at, SPANS)
      assert.ok(value >= 0 && value <= 1, `${at} -> ${value}`)
    }
  })

  it("falls back to a plain ratio when there are no slides", () => {
    assert.equal(toSourceFraction(0.4, []), 0.4)
  })
})

describe("marp scroll sync - why anchoring matters", () => {
  it("would be wrong if it used a plain pixel ratio", () => {
    // Slide 2 starts 6.7% into the document but is the SECOND of three slides, so the
    // column must be a third down - not 6.7% down. A plain ratio gets this badly wrong.
    const anchored = toSlideFraction(2 / 30, SPANS)
    assert.ok(Math.abs(anchored - 1 / 3) < 0.001)
    assert.ok(Math.abs(anchored - 2 / 30) > 0.25, "anchored sync must differ from raw ratio")
  })
})

describe("marp scroll sync - helpers", () => {
  it("clamps and treats non-numbers as zero", () => {
    assert.equal(clamp01(0.5), 0.5)
    assert.equal(clamp01(-2), 0)
    assert.equal(clamp01(9), 1)
    assert.equal(clamp01(undefined), 0)
    assert.equal(clamp01("x"), 0)
  })

  it("reports zero scrollable range when it cannot scroll", () => {
    assert.equal(scrollRange(null), 0)
    assert.equal(scrollRange({ scrollHeight: 100, clientHeight: 100 }), 0)
    assert.equal(scrollRange({ scrollHeight: 300, clientHeight: 100 }), 200)
  })
})
