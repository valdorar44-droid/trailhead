/**
 * PMTiles v3 reader — header parse + Hilbert tile-ID lookup + byte-range reads.
 *
 * File layout:
 *   [0..127)       Header
 *   [rootDirOffset..+rootDirLength)    Root directory (gzip-compressed)
 *   [leafDirsOffset..+leafDirsLength)  Leaf directories (gzip-compressed)
 *   [tileDataOffset..+tileDataLength)  Tile data blobs
 *
 * Directory entries use LEB128 delta encoding (4 arrays: tileId, runLength,
 * length, offset — each delta-compressed separately).
 */
import Foundation

// PMTiles v3 header (fields we need)
struct PMHeader {
    let rootDirOffset:   UInt64
    let rootDirLength:   UInt64
    let leafDirsOffset:  UInt64
    let tileDataOffset:  UInt64
    let internalComp:    UInt8   // 2 = gzip
}

struct DirEntry {
    let tileId:    UInt64
    let offset:    UInt64
    let length:    UInt32
    let runLength: UInt32  // 0 = leaf directory pointer
}

final class PMTilesReader {
    private let fh:          FileHandle
    private let header:      PMHeader
    private let rootEntries: [DirEntry]
    private var leafCache    = [UInt64: [DirEntry]]()  // offset → parsed leaf
    private let q            = DispatchQueue(label: "tile-server.pmtiles", qos: .userInitiated)

    init(path: String) throws {
        guard let handle = FileHandle(forReadingAtPath: path) else {
            throw NSError(domain: "PMTiles", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "Cannot open \(path)"])
        }
        fh = handle

        // Read 127-byte header
        fh.seek(toFileOffset: 0)
        let hd = fh.readData(ofLength: 127)
        guard hd.count == 127,
              hd[0] == 0x50, hd[1] == 0x4d, hd[2] == 0x54 else {    // "PMT"
            throw NSError(domain: "PMTiles", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "Bad magic bytes"])
        }

        func u64(_ o: Int) -> UInt64 {
            hd.withUnsafeBytes { $0.load(fromByteOffset: o, as: UInt64.self).littleEndian }
        }
        header = PMHeader(
            rootDirOffset:  u64(8),
            rootDirLength:  u64(16),
            leafDirsOffset: u64(40),
            tileDataOffset: u64(56),
            internalComp:   hd[97]
        )

        // Parse root directory
        fh.seek(toFileOffset: header.rootDirOffset)
        var raw = fh.readData(ofLength: Int(header.rootDirLength))
        if header.internalComp == 2, let d = gzipDecompress(raw) { raw = d }
        rootEntries = PMTilesReader.parseDir(raw)
    }

    deinit { fh.closeFile() }

    // ── Public: fetch tile bytes ────────────────────────────────────────────
    func tile(z: Int, x: Int, y: Int) -> Data? {
        let id = PMTilesReader.tileId(z: z, x: x, y: y)
        return q.sync { lookup(entries: rootEntries, id: id) }
    }

    // ── Private ─────────────────────────────────────────────────────────────
    private func lookup(entries: [DirEntry], id: UInt64) -> Data? {
        guard let e = bsearch(entries, id) else { return nil }

        if e.runLength == 0 {
            // Leaf directory — cache by its offset key
            let leafEntries: [DirEntry]
            if let cached = leafCache[e.offset] {
                leafEntries = cached
            } else {
                fh.seek(toFileOffset: header.leafDirsOffset + e.offset)
                var raw = fh.readData(ofLength: Int(e.length))
                if header.internalComp == 2, let d = gzipDecompress(raw) { raw = d }
                leafEntries = PMTilesReader.parseDir(raw)
                leafCache[e.offset] = leafEntries
            }
            return lookup(entries: leafEntries, id: id)
        } else {
            fh.seek(toFileOffset: header.tileDataOffset + e.offset)
            return fh.readData(ofLength: Int(e.length))
        }
    }

    private func bsearch(_ entries: [DirEntry], _ id: UInt64) -> DirEntry? {
        var lo = 0, hi = entries.count - 1
        while lo <= hi {
            let mid = (lo + hi) >> 1
            let e   = entries[mid]
            if e.tileId == id { return e }
            if e.tileId  < id { lo = mid + 1 } else { hi = mid - 1 }
        }
        if lo > 0 {
            let prev = entries[lo - 1]
            if prev.runLength == 0 { return prev }                           // leaf pointer
            if id < prev.tileId + UInt64(prev.runLength) { return prev }    // tile run
        }
        return nil
    }

    // ── Directory parsing (LEB128 delta-encoded) ─────────────────────────────
    static func parseDir(_ data: Data) -> [DirEntry] {
        var pos = 0

        func varint() -> UInt64 {
            var r: UInt64 = 0, s = 0
            while pos < data.count {
                let b = UInt64(data[pos]); pos += 1
                r |= (b & 0x7F) << s
                if b & 0x80 == 0 { break }
                s += 7
            }
            return r
        }

        let n = Int(varint())
        var entries = [DirEntry](repeating: DirEntry(tileId:0, offset:0, length:0, runLength:0), count: n)

        // 1. tile IDs (cumulative delta)
        var last: UInt64 = 0
        for i in 0..<n { entries[i] = DirEntry(tileId: last + varint(), offset: 0, length: 0, runLength: 0); last = entries[i].tileId }
        // 2. run lengths
        var rl = [UInt32](repeating: 0, count: n)
        for i in 0..<n { rl[i] = UInt32(varint()) }
        // 3. lengths
        var le = [UInt32](repeating: 0, count: n)
        for i in 0..<n { le[i] = UInt32(varint()) }
        // 4. offsets — PMTiles v3 encodes as (offset+1), with 0 meaning "delta from prev"
        var offsets = [UInt64](repeating: 0, count: n)
        for i in 0..<n {
            let tmp = varint()
            if i > 0 && tmp == 0 {
                offsets[i] = offsets[i-1] + UInt64(le[i-1])
            } else {
                offsets[i] = tmp > 0 ? tmp - 1 : 0
            }
        }

        for i in 0..<n {
            entries[i] = DirEntry(tileId: entries[i].tileId, offset: offsets[i], length: le[i], runLength: rl[i])
        }
        return entries
    }

    // ── Hilbert curve: (z, x, y) → PMTiles tile ID ──────────────────────────
    static func tileId(z: Int, x: Int, y: Int) -> UInt64 {
        if z == 0 { return 0 }
        // Base = Σ 4^i for i in [0, z-1] = (4^z - 1) / 3
        let base: UInt64 = (UInt64(1) << (2 * z) &- 1) / 3
        let n = 1 << z
        var x = x, y = y, d: UInt64 = 0, s = n >> 1
        while s > 0 {
            let rx = (x & s) != 0 ? 1 : 0
            let ry = (y & s) != 0 ? 1 : 0
            d += UInt64(s * s) * UInt64((3 * rx) ^ ry)
            if ry == 0 {
                if rx == 1 { x = s - 1 - x; y = s - 1 - y }
                let t = x; x = y; y = t
            }
            s >>= 1
        }
        return base &+ d
    }
}
