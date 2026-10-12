const { createArchive } = require("./zip.js")
const { normalizePages, normalizeSlideSize } = require("./slides.js")

/**
 * Builds an Image-based PPTX: one presentation slide per rasterized page, each a single
 * full-page picture. This is what Marp CLI's --pptx produces, and it is what makes the
 * deck render identically for a recipient with no fonts, themes, or Marp installed.
 *
 * The trade-off is inherent: text in the output is pixels, so it cannot be selected,
 * searched, or edited. An editable PPTX would be a different route entirely (PDF through
 * LibreOffice Impress), and is out of scope - see the deck spec.
 *
 * This module is pure: bytes in, bytes out. Everything that needs the DOM lives in the
 * rasterization step, and everything that needs to know about Marp lives in the renderer.
 */

// OOXML measures in English Metric Units: 914400 per inch, 96 pixels per inch.
const EMU_PER_PIXEL = 9525

const NS = {
  presentation: "http://schemas.openxmlformats.org/presentationml/2006/main",
  relationships: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  drawing: "http://schemas.openxmlformats.org/drawingml/2006/main",
  packageRels: "http://schemas.openxmlformats.org/package/2006/relationships",
  contentType: "http://schemas.openxmlformats.org/package/2006/content-types",
}

const XML_DECLARATION = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"

const contentTypes = (pages, imageTypes) => {
  const defaults = [
    ["rels", "application/vnd.openxmlformats-package.relationships+xml"],
    ["xml", "application/xml"],
    ...imageTypes.map(type => [type.ext, type.mime]),
  ]
  const overrides = [
    ["/ppt/presentation.xml", "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"],
    ["/ppt/slideMasters/slideMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"],
    ["/ppt/slideLayouts/slideLayout1.xml", "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"],
    ["/ppt/theme/theme1.xml", "application/vnd.openxmlformats-officedocument.theme+xml"],
    ["/ppt/notesMasters/notesMaster1.xml", "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"],
    ...pages.map((_, index) => [
      `/ppt/slides/slide${index + 1}.xml`,
      "application/vnd.openxmlformats-officedocument.presentationml.slide+xml",
    ]),
    ...pages
      .map((_, index) => index)
      .filter(index => pages[index].hasNotes)
      .map(index => [
        `/ppt/notesSlides/notesSlide${index + 1}.xml`,
        "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml",
      ]),
  ]
  return [
    XML_DECLARATION,
    `<Types xmlns="${NS.contentType}">`,
    ...defaults.map(([ext, type]) => `<Default Extension="${ext}" ContentType="${type}"/>`),
    ...overrides.map(([part, type]) => `<Override PartName="${part}" ContentType="${type}"/>`),
    "</Types>",
  ].join("")
}

const packageRels = () => [
  XML_DECLARATION,
  `<Relationships xmlns="${NS.packageRels}">`,
  `<Relationship Id="rId1" Type="${NS.relationships}/officeDocument" Target="ppt/presentation.xml"/>`,
  "</Relationships>",
].join("")

const presentationXml = (pages, size) => [
  XML_DECLARATION,
  `<p:presentation xmlns:p="${NS.presentation}" xmlns:a="${NS.drawing}" xmlns:r="${NS.relationships}">`,
  "<p:sldMasterIdLst><p:sldMasterId id=\"2147483648\" r:id=\"rId1\"/></p:sldMasterIdLst>",
  "<p:sldIdLst>",
  ...pages.map((_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`),
  "</p:sldIdLst>",
  `<p:sldSz cx="${Math.round(size.width * EMU_PER_PIXEL)}" cy="${Math.round(size.height * EMU_PER_PIXEL)}"/>`,
  "<p:notesSz cx=\"6858000\" cy=\"9144000\"/>",
  "</p:presentation>",
].join("")

const presentationRels = pages => [
  XML_DECLARATION,
  `<Relationships xmlns="${NS.packageRels}">`,
  `<Relationship Id="rId1" Type="${NS.relationships}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
  ...pages.map((_, index) => (
    `<Relationship Id="rId${index + 2}" Type="${NS.relationships}/slide" Target="slides/slide${index + 1}.xml"/>`
  )),
  "</Relationships>",
].join("")

const slideMasterXml = () => [
  XML_DECLARATION,
  `<p:sldMaster xmlns:p="${NS.presentation}" xmlns:a="${NS.drawing}" xmlns:r="${NS.relationships}">`,
  "<p:cSld><p:spTree>",
  "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>",
  "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>",
  "</p:spTree></p:cSld>",
  "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\"",
  " accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>",
  "<p:sldLayoutIdLst><p:sldLayoutId id=\"2147483649\" r:id=\"rId1\"/></p:sldLayoutIdLst>",
  "</p:sldMaster>",
].join("")

const slideMasterRels = () => [
  XML_DECLARATION,
  `<Relationships xmlns="${NS.packageRels}">`,
  `<Relationship Id="rId1" Type="${NS.relationships}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`,
  `<Relationship Id="rId2" Type="${NS.relationships}/theme" Target="../theme/theme1.xml"/>`,
  "</Relationships>",
].join("")

const slideLayoutXml = () => [
  XML_DECLARATION,
  `<p:sldLayout xmlns:p="${NS.presentation}" xmlns:a="${NS.drawing}" xmlns:r="${NS.relationships}" type="blank" preserve="1">`,
  "<p:cSld name=\"Blank\"><p:spTree>",
  "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>",
  "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>",
  "</p:spTree></p:cSld>",
  "<p:clrMapOvr><a:overrideClrMapping bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\"",
  " accent2=\"accent2\" accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/></p:clrMapOvr>",
  "</p:sldLayout>",
].join("")

const slideLayoutRels = () => [
  XML_DECLARATION,
  `<Relationships xmlns="${NS.packageRels}">`,
  `<Relationship Id="rId1" Type="${NS.relationships}/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`,
  "</Relationships>",
].join("")

/** A minimal but complete Office theme; PPTX requires one to resolve colour and font refs. */
const themeXml = () => [
  XML_DECLARATION,
  `<a:theme xmlns:a="${NS.drawing}" name="Marp Deck">`,
  "<a:themeElements>",
  "<a:clrScheme name=\"Marp\">",
  "<a:dk1><a:sysClr val=\"windowText\" lastClr=\"000000\"/></a:dk1>",
  "<a:lt1><a:sysClr val=\"window\" lastClr=\"FFFFFF\"/></a:lt1>",
  "<a:dk2><a:srgbClr val=\"44546A\"/></a:dk2>",
  "<a:lt2><a:srgbClr val=\"E7E6E6\"/></a:lt2>",
  "<a:accent1><a:srgbClr val=\"4472C4\"/></a:accent1>",
  "<a:accent2><a:srgbClr val=\"ED7D31\"/></a:accent2>",
  "<a:accent3><a:srgbClr val=\"A5A5A5\"/></a:accent3>",
  "<a:accent4><a:srgbClr val=\"FFC000\"/></a:accent4>",
  "<a:accent5><a:srgbClr val=\"5B9BD5\"/></a:accent5>",
  "<a:accent6><a:srgbClr val=\"70AD47\"/></a:accent6>",
  "<a:hlink><a:srgbClr val=\"0563C1\"/></a:hlink>",
  "<a:folHlink><a:srgbClr val=\"954F72\"/></a:folHlink>",
  "</a:clrScheme>",
  "<a:fontScheme name=\"Marp\">",
  "<a:majorFont><a:latin typeface=\"Calibri Light\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:majorFont>",
  "<a:minorFont><a:latin typeface=\"Calibri\"/><a:ea typeface=\"\"/><a:cs typeface=\"\"/></a:minorFont>",
  "</a:fontScheme>",
  "<a:fmtScheme name=\"Marp\">",
  "<a:fillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:fillStyleLst>",
  "<a:lnStyleLst><a:ln w=\"6350\" cap=\"flat\" cmpd=\"sng\" algn=\"ctr\"><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:ln></a:lnStyleLst>",
  "<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>",
  "<a:bgFillStyleLst><a:solidFill><a:schemeClr val=\"phClr\"/></a:solidFill></a:bgFillStyleLst>",
  "</a:fmtScheme>",
  "</a:themeElements>",
  "</a:theme>",
].join("")

const slideXml = size => [
  XML_DECLARATION,
  `<p:sld xmlns:p="${NS.presentation}" xmlns:a="${NS.drawing}" xmlns:r="${NS.relationships}">`,
  "<p:cSld><p:spTree>",
  "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>",
  "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>",
  "<p:pic>",
  "<p:nvPicPr><p:cNvPr id=\"2\" name=\"Slide\"/><p:cNvPicPr><a:picLocks noChangeAspect=\"1\"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>",
  "<p:blipFill><a:blip r:embed=\"rId1\"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>",
  "<p:spPr>",
  "<a:xfrm><a:off x=\"0\" y=\"0\"/>",
  `<a:ext cx="${Math.round(size.width * EMU_PER_PIXEL)}" cy="${Math.round(size.height * EMU_PER_PIXEL)}"/></a:xfrm>`,
  "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom>",
  "</p:spPr>",
  "</p:pic>",
  "</p:spTree></p:cSld>",
  "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>",
  "</p:sld>",
].join("")

const slideRels = (index, ext, hasNotes) => [
  XML_DECLARATION,
  `<Relationships xmlns="${NS.packageRels}">`,
  `<Relationship Id="rId1" Type="${NS.relationships}/image" Target="../media/image${index + 1}.${ext}"/>`,
  // The notes slide only becomes reachable through the slide's own relationship, so this
  // link - not the notes part alone - is what makes the notes appear.
  ...(hasNotes
    ? [`<Relationship Id="rId2" Type="${NS.relationships}/notesSlide" Target="../notesSlides/notesSlide${index + 1}.xml"/>`]
    : []),
  "</Relationships>",
].join("")

const escapeXml = value => String(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")

const notesMasterXml = () => [
  XML_DECLARATION,
  `<p:notesMaster xmlns:p="${NS.presentation}" xmlns:a="${NS.drawing}" xmlns:r="${NS.relationships}">`,
  "<p:cSld><p:spTree>",
  "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>",
  "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>",
  "</p:spTree></p:cSld>",
  "<p:clrMap bg1=\"lt1\" tx1=\"dk1\" bg2=\"lt2\" tx2=\"dk2\" accent1=\"accent1\" accent2=\"accent2\"",
  " accent3=\"accent3\" accent4=\"accent4\" accent5=\"accent5\" accent6=\"accent6\" hlink=\"hlink\" folHlink=\"folHlink\"/>",
  "</p:notesMaster>",
].join("")

const notesMasterRels = () => [
  XML_DECLARATION,
  `<Relationships xmlns="${NS.packageRels}">`,
  `<Relationship Id="rId1" Type="${NS.relationships}/theme" Target="../theme/theme1.xml"/>`,
  "</Relationships>",
].join("")

/**
 * A speaker-notes slide: one explicit text shape carrying the text.
 *
 * It is deliberately not a placeholder. A placeholder inherits its text body from the
 * notes master, and readers then treat the master's empty body as authoritative for the
 * inherited properties, which loses the text. A plain shape with its own position, size
 * and text body is unambiguous.
 */
const notesSlideXml = text => [
  XML_DECLARATION,
  `<p:notes xmlns:p="${NS.presentation}" xmlns:a="${NS.drawing}" xmlns:r="${NS.relationships}">`,
  "<p:cSld><p:spTree>",
  "<p:nvGrpSpPr><p:cNvPr id=\"1\" name=\"\"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>",
  "<p:grpSpPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"0\" cy=\"0\"/></a:xfrm></p:grpSpPr>",
  "<p:sp>",
  "<p:nvSpPr><p:cNvPr id=\"2\" name=\"Notes\"/><p:cNvSpPr txBox=\"1\"/><p:nvPr/></p:nvSpPr>",
  "<p:spPr><a:xfrm><a:off x=\"685800\" y=\"4343400\"/><a:ext cx=\"5486400\" cy=\"3657600\"/></a:xfrm>",
  "<a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></p:spPr>",
  "<p:txBody><a:bodyPr wrap=\"square\"/><a:lstStyle/>",
  `<a:p><a:r><a:rPr lang="en-US" dirty="0"/><a:t>${escapeXml(text)}</a:t></a:r></a:p>`,
  "</p:txBody>",
  "</p:sp>",
  "</p:spTree></p:cSld>",
  "<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>",
  "</p:notes>",
].join("")

const notesSlideRels = index => [
  XML_DECLARATION,
  `<Relationships xmlns="${NS.packageRels}">`,
  `<Relationship Id="rId1" Type="${NS.relationships}/slide" Target="../slides/slide${index + 1}.xml"/>`,
  `<Relationship Id="rId2" Type="${NS.relationships}/notesMaster" Target="../notesMasters/notesMaster1.xml"/>`,
  "</Relationships>",
].join("")

/**
 * @param {{pages: Array<{data: Buffer, mime?: string}>, slideSize: {width: number, height: number}, notes?: string[]}} options
 * @returns {Buffer} PPTX bytes
 */
const buildPptx = ({ pages, slideSize, notes } = {}) => {
  const normalized = normalizePages(pages, "presentation").map((page, index) => {
    const text = Array.isArray(notes) ? notes[index] : undefined
    return { ...page, notes: text ? String(text) : "", hasNotes: Boolean(text) }
  })
  const size = normalizeSlideSize(slideSize)

  const imageTypes = []
  for (const page of normalized) {
    if (!imageTypes.some(type => type.ext === page.ext)) imageTypes.push({ ext: page.ext, mime: page.mime })
  }

  const entries = [
    { name: "[Content_Types].xml", data: contentTypes(normalized, imageTypes) },
    { name: "_rels/.rels", data: packageRels() },
    { name: "ppt/presentation.xml", data: presentationXml(normalized, size) },
    { name: "ppt/_rels/presentation.xml.rels", data: presentationRels(normalized) },
    { name: "ppt/slideMasters/slideMaster1.xml", data: slideMasterXml() },
    { name: "ppt/slideMasters/_rels/slideMaster1.xml.rels", data: slideMasterRels() },
    { name: "ppt/slideLayouts/slideLayout1.xml", data: slideLayoutXml() },
    { name: "ppt/slideLayouts/_rels/slideLayout1.xml.rels", data: slideLayoutRels() },
    { name: "ppt/notesMasters/notesMaster1.xml", data: notesMasterXml() },
    { name: "ppt/notesMasters/_rels/notesMaster1.xml.rels", data: notesMasterRels() },
    { name: "ppt/theme/theme1.xml", data: themeXml() },
  ]

  normalized.forEach((page, index) => {
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, data: slideXml(size) })
    entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: slideRels(index, page.ext, page.hasNotes) })
    entries.push({ name: `ppt/media/image${index + 1}.${page.ext}`, data: page.data })
    if (page.hasNotes) {
      entries.push({ name: `ppt/notesSlides/notesSlide${index + 1}.xml`, data: notesSlideXml(page.notes) })
      entries.push({ name: `ppt/notesSlides/_rels/notesSlide${index + 1}.xml.rels`, data: notesSlideRels(index) })
    }
  })

  return createArchive(entries)
}

module.exports = { buildPptx, EMU_PER_PIXEL }
