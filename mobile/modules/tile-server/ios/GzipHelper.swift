import Foundation
import zlib

/// Decompress gzip/zlib-encoded bytes (windowBits = 47 = auto-detect gzip or zlib).
/// Returns nil on failure.
func gzipDecompress(_ data: Data) -> Data? {
    guard data.count >= 2 else { return nil }

    return data.withUnsafeBytes { srcPtr -> Data? in
        var stream = z_stream()
        stream.next_in  = UnsafeMutablePointer(mutating: srcPtr.bindMemory(to: Bytef.self).baseAddress!)
        stream.avail_in = uInt(data.count)

        guard inflateInit2_(&stream, 47, ZLIB_VERSION, Int32(MemoryLayout<z_stream>.size)) == Z_OK else {
            return nil
        }
        defer { inflateEnd(&stream) }

        let chunk = 65536
        var buf   = [UInt8](repeating: 0, count: chunk)
        var out   = Data()

        repeat {
            let status = buf.withUnsafeMutableBytes { outPtr -> Int32 in
                stream.next_out  = outPtr.bindMemory(to: Bytef.self).baseAddress!
                stream.avail_out = uInt(chunk)
                return inflate(&stream, Z_SYNC_FLUSH)
            }
            guard status == Z_OK || status == Z_STREAM_END else { break }
            out.append(contentsOf: buf[0..<(chunk - Int(stream.avail_out))])
            if status == Z_STREAM_END { return out.isEmpty ? nil : out }
        } while stream.avail_out == 0

        return out.isEmpty ? nil : out
    }
}
