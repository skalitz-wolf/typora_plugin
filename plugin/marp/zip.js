const zlib = require("zlib")

/**
 * A minimal, deterministic ZIP writer, and the reader the tests use to verify it.
 *
 * PPTX needs only STORE and DEFLATE entries, no Zip64 and no encryption, so a small
 * writer beats vendoring a dependency: the repo already ships readers (`extract-zip`,
 * `yauzl`) and bundling a writer would add build-system churn for a narrow need.
 *
 * Determinism matters twice over: the tests assert on bytes, and rebuilding the same deck
 * should not produce a different file. That is why no timestamp is written (the DOS date
 * field is pinned) and entries keep their caller-supplied order.
 *
 * CRC-32 is implemented here rather than taken from `zlib.crc32`, which is far newer than
 * this project's Node 12.14 compatibility floor.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_HEADER_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50

const METHOD_STORE = 0
const METHOD_DEFLATE = 8

const FLAG_UTF8_NAMES = 0x0800
const VERSION_NEEDED = 20
const VERSION_MADE_BY = 20

// A fixed DOS timestamp: 1980-01-01 00:00:00, the earliest a DOS date can express.
const DOS_TIME = 0
const DOS_DATE = 0x0021

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1
    }
    table[i] = value
  }
  return table
})()

const crc32 = buffer => {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff]
  }
  return (crc ^ -1) >>> 0
}

const toBuffer = data => {
  if (Buffer.isBuffer(data)) return data
  if (typeof data === "string") return Buffer.from(data, "utf8")
  if (data instanceof Uint8Array) return Buffer.from(data)
  throw new TypeError("entry data must be a Buffer, Uint8Array, or string")
}

/**
 * @param {Array<{name: string, data: Buffer|string}>} entries
 * @returns {Buffer} archive bytes
 */
const createArchive = entries => {
  if (!Array.isArray(entries)) throw new TypeError("entries must be an array")

  const seen = new Set()
  const prepared = entries.map(entry => {
    if (!entry || typeof entry.name !== "string" || entry.name === "") {
      throw new TypeError("every entry needs a non-empty name")
    }
    if (seen.has(entry.name)) throw new Error(`duplicate entry name: ${entry.name}`)
    seen.add(entry.name)

    const name = Buffer.from(entry.name, "utf8")
    const data = toBuffer(entry.data)
    const deflated = zlib.deflateRawSync(data, { level: 9 })
    // Storing is only worth it when deflate failed to help; otherwise always deflate.
    const useStore = deflated.length >= data.length
    return {
      name,
      data,
      method: useStore ? METHOD_STORE : METHOD_DEFLATE,
      payload: useStore ? data : deflated,
      crc: crc32(data),
    }
  })

  const localParts = []
  const centralParts = []
  let offset = 0

  for (const entry of prepared) {
    const local = Buffer.alloc(30)
    local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0)
    local.writeUInt16LE(VERSION_NEEDED, 4)
    local.writeUInt16LE(FLAG_UTF8_NAMES, 6)
    local.writeUInt16LE(entry.method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(entry.crc, 14)
    local.writeUInt32LE(entry.payload.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(entry.name.length, 26)
    local.writeUInt16LE(0, 28)
    localParts.push(local, entry.name, entry.payload)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0)
    central.writeUInt16LE(VERSION_MADE_BY, 4)
    central.writeUInt16LE(VERSION_NEEDED, 6)
    central.writeUInt16LE(FLAG_UTF8_NAMES, 8)
    central.writeUInt16LE(entry.method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(entry.crc, 16)
    central.writeUInt32LE(entry.payload.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(entry.name.length, 28)
    central.writeUInt16LE(0, 30)  // extra length
    central.writeUInt16LE(0, 32)  // comment length
    central.writeUInt16LE(0, 34)  // disk number
    central.writeUInt16LE(0, 36)  // internal attributes
    central.writeUInt32LE(0, 38)  // external attributes
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, entry.name)

    offset += local.length + entry.name.length + entry.payload.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0)
  end.writeUInt16LE(0, 4)  // disk number
  end.writeUInt16LE(0, 6)  // disk with central directory
  end.writeUInt16LE(prepared.length, 8)
  end.writeUInt16LE(prepared.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)  // comment length

  return Buffer.concat([...localParts, centralDirectory, end])
}

/**
 * Minimal reader, used to verify the writer without depending on a zip library.
 * Walks the central directory rather than the local headers, which is what real readers do.
 */
const readArchive = buffer => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error("not a zip archive")

  const eocd = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (eocd < 0 || buffer.readUInt32LE(eocd) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new Error("not a zip archive: end of central directory not found")
  }

  const count = buffer.readUInt16LE(eocd + 10)
  let cursor = buffer.readUInt32LE(eocd + 16)
  const entries = []

  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error("corrupt zip archive: bad central directory entry")
    }
    const method = buffer.readUInt16LE(cursor + 10)
    const crc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.slice(cursor + 46, cursor + 46 + nameLength).toString("utf8")

    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    const payload = buffer.slice(dataStart, dataStart + compressedSize)
    const data = method === METHOD_STORE ? payload : zlib.inflateRawSync(payload)

    if (data.length !== uncompressedSize) throw new Error(`corrupt zip archive: size mismatch in ${name}`)
    if (crc32(data) !== crc) throw new Error(`corrupt zip archive: checksum mismatch in ${name}`)

    entries.push({ name, data })
    cursor += 46 + nameLength + extraLength + commentLength
  }

  return entries
}

module.exports = { createArchive, readArchive, crc32 }
