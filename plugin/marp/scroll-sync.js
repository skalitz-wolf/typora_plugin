/**
 * Scroll synchronisation between the editor column and the slide column.
 *
 * A naive implementation links the two by pixel ratio, which drifts badly on a deck:
 * slides are discrete pages of equal aspect, while the Markdown behind them is not - a
 * ten-line slide and a fifty-line slide occupy very different source heights. Scrolling
 * the editor to the middle of the document would then land nowhere near the middle slide.
 *
 * So sync is anchored to slide boundaries. Marp reports the source line range of every
 * slide, which gives each slide a known span of the document, and the two columns are
 * lined up on those spans: scroll to the start of a slide's source and you see that
 * slide; scroll to a third of the way through it and you see a third of the way into it.
 *
 * This module is pure - it only maps numbers - so the behaviour can be tested without a
 * browser.
 */

/** Clamp to [0, 1], treating NaN as 0. */
const clamp01 = value => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.min(1, Math.max(0, n))
}

/**
 * @param {Array<{startLine: number, endLine: number}>} slides source line spans, ascending
 * @param {number} totalLines line count of the whole document
 * @returns {Array<{from: number, to: number}>} each slide's span as a fraction of the document
 */
const slideSpans = (slides, totalLines) => {
  const total = Number(totalLines)
  if (!Array.isArray(slides) || slides.length === 0 || !Number.isFinite(total) || total <= 0) return []
  return slides.map(slide => {
    const start = Number.isFinite(slide?.startLine) ? slide.startLine : 0
    const end = Number.isFinite(slide?.endLine) ? slide.endLine : start
    return { from: clamp01(start / total), to: clamp01(end / total) }
  })
}

/**
 * Where in the slide column to scroll, given a position in the document.
 *
 * The result is a fraction of the slide column's own scrollable range, chosen so that the
 * slide containing the current source position sits at the top of the column, offset by
 * how far into that slide we are.
 *
 * @param {number} sourceFraction position in the document, 0..1
 * @param {Array<{from: number, to: number}>} spans from slideSpans
 * @returns {number} 0..1
 */
const toSlideFraction = (sourceFraction, spans) => {
  const at = clamp01(sourceFraction)
  if (!Array.isArray(spans) || spans.length === 0) return at

  const count = spans.length
  for (let i = 0; i < count; i++) {
    const span = spans[i]
    if (at < span.to || i === count - 1) {
      const width = Math.max(span.to - span.from, Number.EPSILON)
      // On the final slide, running past its end is still "at the bottom" - the column has
      // nowhere further to go - so only clamp there rather than snapping early.
      const within = i === count - 1
        ? Math.min(1, Math.max(0, (at - span.from) / width))
        : clamp01((at - span.from) / width)
      // i slides are fully above the current one, out of `count` in total.
      return clamp01((i + within) / count)
    }
  }
  return at
}

/**
 * Where in the document to scroll, given a position in the slide column. The inverse of
 * toSlideFraction.
 *
 * @param {number} slideFraction position in the slide column, 0..1
 * @param {Array<{from: number, to: number}>} spans from slideSpans
 * @returns {number} 0..1
 */
const toSourceFraction = (slideFraction, spans) => {
  const at = clamp01(slideFraction)
  if (!Array.isArray(spans) || spans.length === 0) return at

  const count = spans.length
  const scaled = at * count
  const index = Math.min(count - 1, Math.floor(scaled))
  const within = scaled - index
  const span = spans[index]
  return clamp01(span.from + (span.to - span.from) * within)
}

/** Scrollable distance of an element, or 0 when it cannot scroll. */
const scrollRange = element => {
  if (!element) return 0
  return Math.max(0, element.scrollHeight - element.clientHeight)
}

module.exports = {
  clamp01,
  scrollRange,
  slideSpans,
  toSlideFraction,
  toSourceFraction,
}
