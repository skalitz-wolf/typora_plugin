const { describe, it } = require("node:test")
const assert = require("node:assert/strict")
const zlib = require("node:zlib")

const { createArchive, readArchive } = require("../../plugin/marp/zip.js")

const bytes = text => Buffer.from(text, "utf8")
const utf8 = buffer => buffer.toString("utf8")

describe("zip - archive round trip", () => {
  it("reads back the entries it wrote", () => {
    const archive = createArchive([
      { name: "a.txt", data: bytes("hello") },
      { name: "dir/b.txt", data: bytes("world") },
    ])
    const entries = readArchive(archive)
    assert.deepEqual(entries.map(e => e.name), ["a.txt", "dir/b.txt"])
    assert.equal(utf8(entries[0].data), "hello")
    assert.equal(utf8(entries[1].data), "world")
  })

  it("preserves byte-exact contents", () => {
    const data = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
    const [entry] = readArchive(createArchive([{ name: "bin", data }]))
    assert.deepEqual(entry.data, data)
  })

  it("round-trips a payload larger than one deflate block", () => {
    const data = Buffer.alloc(300000, "abcdefghij")
    const [entry] = readArchive(createArchive([{ name: "big", data }]))
    assert.deepEqual(entry.data, data)
  })

  it("round-trips empty content", () => {
    const [entry] = readArchive(createArchive([{ name: "empty", data: Buffer.alloc(0) }]))
    assert.equal(entry.data.length, 0)
  })

  it("produces a valid empty archive", () => {
    assert.deepEqual(readArchive(createArchive([])), [])
  })

  it("keeps non-ascii entry names", () => {
    const [entry] = readArchive(createArchive([{ name: "图片/幻灯片1.xml", data: bytes("x") }]))
    assert.equal(entry.name, "图片/幻灯片1.xml")
  })

  it("handles many entries", () => {
    const input = Array.from({ length: 64 }, (_, i) => ({ name: `s${i}.xml`, data: bytes(`<x>${i}</x>`) }))
    const entries = readArchive(createArchive(input))
    assert.equal(entries.length, 64)
    assert.equal(utf8(entries[63].data), "<x>63</x>")
  })
})

describe("zip - archive structure", () => {
  it("starts with the local file header signature", () => {
    const archive = createArchive([{ name: "a", data: bytes("x") }])
    assert.equal(archive.readUInt32LE(0), 0x04034b50)
  })

  it("ends with a well-formed end-of-central-directory record", () => {
    const archive = createArchive([{ name: "a", data: bytes("x") }])
    const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
    assert.ok(eocd >= 0, "end of central directory signature missing")
    const count = archive.readUInt16LE(eocd + 10)
    const cdSize = archive.readUInt32LE(eocd + 12)
    const cdOffset = archive.readUInt32LE(eocd + 16)
    assert.equal(count, 1)
    assert.equal(cdOffset + cdSize, eocd)
  })

  it("declares entry sizes and a checksum that match the payload", () => {
    const data = bytes("hello")
    const archive = createArchive([{ name: "a", data }])
    // Local header layout: crc at 14, compressed size at 18, uncompressed size at 22.
    const crc = archive.readUInt32LE(14)
    assert.equal(crc, zlib.crc32(data))
    assert.equal(archive.readUInt32LE(22), data.length)
    assert.ok(archive.readUInt32LE(18) > 0)
  })

  it("compresses repetitive content rather than storing it verbatim", () => {
    const data = Buffer.alloc(20000, "aaaa")
    const archive = createArchive([{ name: "a", data }])
    assert.ok(archive.length < data.length / 4, "expected deflate to shrink repetitive content")
  })

  it("sets the utf-8 name flag when a name needs it", () => {
    const archive = createArchive([{ name: "图片.xml", data: bytes("x") }])
    assert.equal(archive.readUInt16LE(6) & 0x0800, 0x0800)
  })

  it("rejects duplicate entry names, which produce a corrupt archive", () => {
    assert.throws(
      () => createArchive([{ name: "a", data: bytes("1") }, { name: "a", data: bytes("2") }]),
      /duplicate/i,
    )
  })
})

describe("zip - determinism", () => {
  it("produces byte-identical output for identical input", () => {
    const input = () => [
      { name: "a.txt", data: bytes("hello") },
      { name: "b/c.txt", data: bytes("world world world") },
    ]
    assert.deepEqual(createArchive(input()), createArchive(input()))
  })

  it("does not embed the current time", () => {
    // A real clock would make two archives built a moment apart differ.
    const first = createArchive([{ name: "a", data: bytes("x") }])
    const second = createArchive([{ name: "a", data: bytes("x") }])
    assert.deepEqual(first, second)
  })
})

describe("zip - readArchive validation", () => {
  it("rejects a buffer that is not an archive", () => {
    assert.throws(() => readArchive(bytes("not a zip at all")), /archive/i)
  })
})
