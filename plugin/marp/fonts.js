/**
 * Optional font support for the deck export.
 *
 * Marp's own themes ask for web fonts (Lato, Roboto Mono) that are not installed on a
 * typical machine, and its stylesheet fetches them from a CDN. Bundling those fonts would
 * bloat the plugin and drag in licensing questions, so the default is to let the browser
 * fall back to system fonts - which is what makes CJK and emoji render correctly anyway.
 *
 * This module covers the case where a user does care about typography: point the plugin at
 * a directory of local font files and they get embedded into the exported slide as data
 * URIs, so the export stays self-contained and offline.
 */

const MIME_BY_EXTENSION = {
  ttf: "font/ttf",
  otf: "font/otf",
  woff: "font/woff",
  woff2: "font/woff2",
}

const FORMAT_BY_EXTENSION = {
  ttf: "truetype",
  otf: "opentype",
  woff: "woff",
  woff2: "woff2",
}

const extensionOf = filePath => String(filePath || "").toLowerCase().split(".").pop()

const isFontFile = filePath => Object.hasOwn(MIME_BY_EXTENSION, extensionOf(filePath))

const fontFamilyFromPath = filePath => {
  const name = String(filePath || "").split(/[\\/]/).pop() || ""
  return name.replace(/\.[^.]+$/, "")
}

const escapeCssString = value => String(value).replace(/\\/g, "\\\\").replace(/"/g, "\\\"")

/**
 * @param {Array<{path: string, data: Buffer|Uint8Array}>} fonts
 * @param {{prependTo?: string}} options when `prependTo` is set, also emit a rule that puts
 *   the supplied families at the front of that selector's font stack, so they beat the
 *   theme's own choice.
 * @returns {string} CSS
 */
const buildFontFaceCss = (fonts, { prependTo } = {}) => {
  if (!Array.isArray(fonts) || fonts.length === 0) return ""

  const families = []
  const rules = []
  for (const font of fonts) {
    if (!font?.data || !font.path) continue
    const ext = extensionOf(font.path)
    const mime = MIME_BY_EXTENSION[ext]
    const format = FORMAT_BY_EXTENSION[ext]
    if (!mime) continue

    const family = fontFamilyFromPath(font.path)
    families.push(family)
    const base64 = Buffer.isBuffer(font.data) ? font.data.toString("base64") : Buffer.from(font.data).toString("base64")
    rules.push(
      `@font-face{font-family:"${escapeCssString(family)}";` +
      `src:url(data:${mime};base64,${base64}) format("${format}");font-display:swap}`,
    )
  }
  if (!rules.length) return ""

  const stack = families.map(family => `"${escapeCssString(family)}"`).join(",")
  if (prependTo) rules.push(`${prependTo}{font-family:${stack}}`)
  return rules.join("\n")
}

module.exports = { buildFontFaceCss, fontFamilyFromPath, isFontFile, MIME_BY_EXTENSION }
