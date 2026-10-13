/**
 * Turns whole-document Markdown into raster-ready slides.
 *
 * Every hazard here fails *silently* as a blank slide rather than as an error, so the
 * transformations below are contractual, not cosmetic (see
 * docs/adr/0003-rasterize-slides-inside-the-typora-renderer.md):
 *
 *  - Marp scopes its stylesheet to `div.marpit > svg > foreignObject > section`. The
 *    array-of-slides render mode strips that `div.marpit` wrapper, so a stylesheet left
 *    as-is matches nothing and every slide rasterizes empty. The selectors must be
 *    de-scoped to match the bare `<svg>` we actually serialize.
 *  - `@charset` and `@import` make a stylesheet inert inside an SVG document, so both are
 *    dropped (the remote-font `@import` unless the caller opts in).
 *  - An SVG data URL without the SVG namespace fails to decode entirely.
 *  - Marp's inline `<script>` (its SVG polyfill / auto-scaling) is meaningless in a
 *    rasterized slide and can break serialization.
 */

// marp-core is a browser bundle that touches `document` as soon as it loads, so it must be
// required lazily - the same reason the fence renderer defers it. Requiring it at module
// scope would make merely importing this file depend on a live DOM.
let MarpClass = null
const loadMarp = () => {
  if (!MarpClass) ({ Marp: MarpClass } = require("./marp-core.min.js"))
  return MarpClass
}

// Marp's container prefix. The `div.marpit > svg` part is stripped by array mode, so all
// three observed forms are removed here.
const SCOPE_PATTERNS = [
  /div\.marpit\s*>\s*svg\s*>\s*foreignObject\s*>\s*/g,
  /div\.marpit\s*>\s*svg(?:\[data-marpit-svg\])?\s*>\s*/g,
  /div\.marpit\s*>\s*/g,
]

const removeScoping = css => SCOPE_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, ""), css)

const stripCharset = css => css.replace(/@charset\s+[^;]*;/gi, "")
const stripImports = css => css.replace(/@import\s+[^;]*;/gi, "")
const stripScripts = html => html.replace(/<script\b[\s\S]*?<\/script>/gi, "")

/**
 * Marp rewrites every emoji into a remote Twemoji `<img>`. That image is fetched over the
 * network, so offline it rasterizes as a broken-image glyph, and it is also the one thing
 * a "no remote assets" export cannot honour. Replacing the image with its own `alt` text
 * puts the emoji character back in the markup, where the system emoji font renders it.
 */
const inlineEmoji = html => html.replace(
  /<img\b[^>]*\bdata-marp-twemoji\b[^>]*>/gi,
  match => {
    const alt = match.match(/\balt="([^"]*)"/)
    return alt ? alt[1] : ""
  },
)

const HASH_INIT = 2166136261
const HASH_PRIME = 16777619

/** FNV-1a. Small, stable, and dependency-free; used only to detect per-slide changes. */
const hash = text => {
  let value = HASH_INIT
  for (let i = 0; i < text.length; i++) {
    value ^= text.charCodeAt(i)
    value = Math.imul(value, HASH_PRIME) >>> 0
  }
  return value.toString(16).padStart(8, "0")
}

const VIEWBOX_SIZE = /viewBox\s*=\s*["']\s*[-\d.]+[,\s]+[-\d.]+[,\s]+([\d.]+)[,\s]+([\d.]+)/

/**
 * Marp writes background images into inline `style` attributes, where the URL's quotes
 * arrive HTML-escaped (`background-image:url(&quot;bg.png&quot;)`). Unescape before
 * resolving so the resolver sees the real path, and re-escape when substituting.
 */
const unescapeHtml = value => value
  .replace(/&quot;/g, "\"")
  .replace(/&#0?39;|&apos;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")

const escapeAttr = value => value
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")

/**
 * Marp emits background-image URLs inside inline styles, where the surrounding quotes
 * arrive HTML-escaped (`url(&quot;bg.png&quot;)`). The resolver must see the real path,
 * so normalise at every read site rather than at one of them.
 */
const normalizeUrl = value => unescapeHtml(String(value)).trim().replace(/^["']|["']$/g, "")

/**
 * Give the root <svg> an intrinsic size. Marp emits only a viewBox, which the SVG spec
 * resolves to width:100%; rasterizing such an element produces a zero-sized bitmap.
 */
const applyIntrinsicSize = svg => {
  const root = svg.match(/^<svg\b[^>]*>/)
  if (!root || /\bwidth\s*=/.test(root[0])) return svg
  const size = root[0].match(VIEWBOX_SIZE)
  if (!size) return svg
  return svg.replace(/^<svg\b/, `<svg width="${size[1]}" height="${size[2]}"`)
}

const ensureSvgNamespace = svg => svg.replace(
  /^<svg\b/,
  match => /xmlns=/.test(svg.slice(0, svg.indexOf(">") + 1)) ? match : `${match} xmlns="http://www.w3.org/2000/svg"`,
)

/**
 * HTML inside <foreignObject> is parsed as SVG unless it declares the XHTML namespace,
 * in which case the browser renders nothing inside the foreign object.
 */
const ensureForeignObjectNamespace = svg => svg.replace(
  /<foreignObject(\s[^>]*)?>\s*<section(?![^>]*\bxmlns=)/g,
  (match, attrs) => match.replace(/<section/, '<section xmlns="http://www.w3.org/1999/xhtml"'),
)

const rewriteUrls = (text, mapper) => text.replace(/url\((["']?)([^"')]+)\1\)/g, (match, quote, url) => {
  const mapped = mapper(normalizeUrl(url))
  return mapped ? `url(${quote}${escapeAttr(mapped)}${quote})` : match
})

const rewriteAttr = (text, attr, mapper) => text.replace(
  new RegExp(`\\b${attr}=(["'])([^"']+)\\1`, "g"),
  (match, quote, value) => {
    const mapped = mapper(normalizeUrl(value))
    return mapped ? `${attr}=${quote}${escapeAttr(mapped)}${quote}` : match
  },
)

class MarpDeck {
  constructor(options = {}) {
    this.options = options
    this.marp = null
  }

  _getMarp = () => {
    if (!this.marp) {
      const Marp = loadMarp()
      this.marp = new Marp({ html: true, ...this.options.marpOptions })
    }
    return this.marp
  }

  /**
   * @returns {Promise<Array<{index: number, svg: string, hash: string, notes: string}>>}
   */
  render = async markdown => {
    const result = this._getMarp().render(markdown || "", { htmlAsArray: true })
    const css = await this._buildCss(result.css)
    const lineRanges = this._slideLineRanges()
    const slides = []

    for (let index = 0; index < result.html.length; index++) {
      const svg = await this._toRasterReadySvg(result.html[index], css)
      slides.push({
        index,
        svg,
        hash: hash(svg),
        notes: (result.comments?.[index] || []).join("\n\n"),
        ...lineRanges[index],
      })
    }
    return slides
  }

  /**
   * Each slide's span in the source, read from the tokens Marp just parsed.
   *
   * Marp records a `map` of `[startLine, endLine]` per token, so a slide's span is the
   * union of its tokens' maps. This is what makes scroll sync anchored to slides rather
   * than a pixel ratio: a two-line slide and a fifty-line slide are the same height on
   * screen, so without the source spans the two columns cannot be lined up correctly.
   */
  _slideLineRanges = () => {
    const tokenGroups = this._getMarp().lastSlideTokens
    if (!Array.isArray(tokenGroups)) return []

    return tokenGroups.map(tokens => {
      const maps = (tokens || []).filter(token => token?.map).map(token => token.map)
      if (!maps.length) return {}
      const start = Math.min(...maps.map(m => m[0]))
      const end = Math.max(...maps.map(m => m[1]))
      return { startLine: start, endLine: end }
    })
  }

  _buildCss = async css => {
    let out = stripCharset(css)
    // `allowRemoteFonts` may be a predicate, so a deck reads the setting at render time
    // rather than freezing it at construction. Treating the function itself as truthy
    // would silently leave every remote `@import` in place.
    const allow = typeof this.options.allowRemoteFonts === "function"
      ? this.options.allowRemoteFonts()
      : this.options.allowRemoteFonts
    if (!allow) out = stripImports(out)
    out = removeScoping(out)
    // Extra fonts come after the theme so they can override its stack, but before the
    // scoping removal has any effect on them (they carry no marpit prefix).
    const extra = await this._loadExtraFonts()
    return extra ? `${out}\n${extra}` : out
  }

  /** Loads any configured extra fonts once, so a deck with many slides reads them once. */
  _loadExtraFonts = async () => {
    if (this._extraFontsCss !== undefined) return this._extraFontsCss
    const load = this.options.loadFonts
    if (typeof load !== "function") {
      this._extraFontsCss = ""
      return this._extraFontsCss
    }
    try {
      this._extraFontsCss = (await load()) || ""
    } catch (error) {
      console.error("[marp] could not load extra fonts:", error)
      this._extraFontsCss = ""
    }
    return this._extraFontsCss
  }

  _toRasterReadySvg = async (slideHtml, css) => {
    let svg = stripScripts(slideHtml)
    svg = inlineEmoji(svg)
    svg = ensureSvgNamespace(svg)
    svg = ensureForeignObjectNamespace(svg)
    svg = applyIntrinsicSize(svg)
    svg = await this._inlineImages(svg)
    return svg.replace(/(<svg\b[^>]*>)/, `$1<style>${css}</style>`)
  }

  /** Local images must become data URIs: a data: URL SVG cannot resolve sibling files. */
  _inlineImages = async svg => {
    const resolve = this.options.resolveImage
    if (typeof resolve !== "function") return svg

    const cache = new Map()
    const lookup = async url => {
      if (cache.has(url)) return cache.get(url)
      let mapped = null
      try {
        mapped = (await resolve(url)) || null
      } catch {
        mapped = null
      }
      cache.set(url, mapped)
      return mapped
    }

    // Background images live in inline styles (`url(...)`); ordinary images are `src`.
    // Collect the normalised form, so the resolver and the rewriter agree on the key.
    const urls = new Set()
    for (const [, , url] of svg.matchAll(/url\((["']?)([^"')]+)\1\)/g)) urls.add(normalizeUrl(url))
    for (const [, , url] of svg.matchAll(/\bsrc=(["'])([^"']+)\1/g)) urls.add(normalizeUrl(url))

    const resolved = new Map()
    for (const url of urls) {
      if (/^data:/i.test(url)) continue
      const mapped = await lookup(url)
      if (mapped) resolved.set(url, mapped)
    }
    if (!resolved.size) return svg

    const mapper = url => resolved.get(url)
    return rewriteAttr(rewriteUrls(svg, mapper), "src", mapper)
  }
}

module.exports = MarpDeck
