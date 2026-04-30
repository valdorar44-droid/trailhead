/**
 * Minimal MVT (Mapbox Vector Tile) protobuf decoder.
 * Only decodes the 'roads' layer — everything else is ignored.
 *
 * MVT protobuf schema (fields we need):
 *   Tile       { Layer layers = 3 }
 *   Layer      { string name = 1; Feature[] features = 2;
 *                string[] keys = 3; Value[] values = 4; uint32 extent = 5 }
 *   Feature    { uint32[] tags = 2; GeomType type = 3; uint32[] geometry = 4 }
 *   Value      { string string_value = 1; bool bool_value = 7 }
 */
import Foundation

struct RoadSegment {
    let coords: [(lat: Double, lng: Double)]
    let kind:   String   // 'highway','major_road','minor_road','path','other'
    let name:   String   // road name, empty if unnamed
    let oneway: Bool

    var weight: Double {
        switch kind {
        case "highway":    return 1.0
        case "major_road": return 1.1
        case "minor_road": return 1.3
        case "other":      return 1.8
        case "path":       return 3.0
        default:           return 2.0
        }
    }
}

// ── Minimal protobuf reader ───────────────────────────────────────────────────
private struct Proto {
    let d: Data
    var p: Int = 0
    mutating func varint() -> UInt64 {
        var r: UInt64 = 0, s = 0
        while p < d.count {
            let b = UInt64(d[p]); p += 1
            r |= (b & 0x7F) << s
            if b & 0x80 == 0 { break }; s += 7
        }
        return r
    }
    mutating func tag() -> (Int, Int)? {
        guard p < d.count else { return nil }
        let v = Int(varint()); return (v >> 3, v & 0x7)
    }
    mutating func skip(_ wt: Int) {
        switch wt {
        case 0: _ = varint()
        case 1: p += 8
        case 2: p += Int(varint())
        case 5: p += 4
        default: break
        }
    }
    mutating func bytes() -> Data {
        let n = Int(varint()); let s = p; p += n
        return Data(d[s..<min(p, d.count)])
    }
    mutating func string() -> String { String(data: bytes(), encoding: .utf8) ?? "" }
    mutating func packed() -> [UInt32] {
        let raw = bytes(); var sub = Proto(d: raw); var out = [UInt32]()
        // truncatingIfNeeded avoids a crash when a malformed varint decodes > UInt32.max
        while sub.p < sub.d.count { out.append(UInt32(truncatingIfNeeded: sub.varint())) }
        return out
    }
}

// ── Tile/Layer/Feature structs ────────────────────────────────────────────────
private struct MVTFeature { var tags = [UInt32](); var type = 0; var geom = [UInt32]() }
private struct MVTLayer {
    var name = ""; var keys = [String](); var values = [String]()
    var features = [MVTFeature](); var extent = 4096
}

// ── MVTDecoder ────────────────────────────────────────────────────────────────
enum MVTDecoder {

    static func roads(from data: Data, z: Int, x: Int, y: Int) -> [RoadSegment] {
        guard let layer = findLayer(name: "roads", in: data) else { return [] }
        return decode(layer: layer, z: z, x: x, y: y)
    }

    // ── Find the 'roads' layer in a tile ────────────────────────────────────
    private static func findLayer(name target: String, in data: Data) -> MVTLayer? {
        var pb = Proto(d: data)
        while let (f, wt) = pb.tag() {
            if f == 3 && wt == 2 {
                let layer = parseLayer(pb.bytes())
                if layer.name == target { return layer }
            } else { pb.skip(wt) }
        }
        return nil
    }

    private static func parseLayer(_ data: Data) -> MVTLayer {
        var pb = Proto(d: data); var layer = MVTLayer()
        while let (f, wt) = pb.tag() {
            switch f {
            case 1: layer.name    = pb.string()
            case 2: layer.features.append(parseFeature(pb.bytes()))
            case 3: layer.keys.append(pb.string())
            case 4: layer.values.append(parseValue(pb.bytes()))
            case 5: layer.extent  = Int(min(pb.varint(), UInt64(Int.max)))
            default: pb.skip(wt)
            }
        }
        return layer
    }

    private static func parseFeature(_ data: Data) -> MVTFeature {
        var pb = Proto(d: data); var feat = MVTFeature()
        while let (f, wt) = pb.tag() {
            switch f {
            case 2: feat.tags = pb.packed()
            case 3: feat.type = Int(pb.varint())
            case 4: feat.geom = pb.packed()
            default: pb.skip(wt)
            }
        }
        return feat
    }

    private static func parseValue(_ data: Data) -> String {
        var pb = Proto(d: data)
        while let (f, wt) = pb.tag() {
            if f == 1 && wt == 2 { return pb.string() }
            pb.skip(wt)
        }
        return ""
    }

    // ── Decode features → RoadSegments ──────────────────────────────────────
    private static func decode(layer: MVTLayer, z: Int, x: Int, y: Int) -> [RoadSegment] {
        var segs = [RoadSegment]()
        let ext  = Double(layer.extent)
        let n    = Double(1 << z)

        for feat in layer.features {
            guard feat.type == 2 else { continue } // LineString only
            var kind = "other"; var name = ""; var oneway = false
            var i = 0
            while i + 1 < feat.tags.count {
                let k = Int(feat.tags[i]); let v = Int(feat.tags[i+1]); i += 2
                if k < layer.keys.count {
                    let key = layer.keys[k]
                    if key == "kind",   v < layer.values.count { kind   = layer.values[v] }
                    if key == "name",   v < layer.values.count { name   = layer.values[v] }
                    if key == "oneway", v < layer.values.count { oneway = layer.values[v] == "true" || layer.values[v] == "yes" }
                }
            }

            // Decode geometry
            var lines = [[(lat: Double, lng: Double)]]()
            var cur   = [(lat: Double, lng: Double)]()
            var cx = 0, cy = 0; var gi = 0
            while gi < feat.geom.count {
                let cmd = Int(feat.geom[gi]) & 0x7
                let cnt = Int(feat.geom[gi]) >> 3; gi += 1
                if cmd == 1 || cmd == 2 { // MoveTo / LineTo
                    if cmd == 1 && !cur.isEmpty { lines.append(cur); cur = [] }
                    for _ in 0..<cnt {
                        guard gi + 1 < feat.geom.count else { break }
                        let rx = Int(feat.geom[gi]); gi += 1
                        let ry = Int(feat.geom[gi]); gi += 1
                        cx += (rx >> 1) ^ -(rx & 1)
                        cy += (ry >> 1) ^ -(ry & 1)
                        let tx = Double(x) + Double(cx) / ext
                        let ty = Double(y) + Double(cy) / ext
                        let lng = tx / n * 360.0 - 180.0
                        let lat = atan(sinh(.pi * (1.0 - 2.0 * ty / n))) * (180.0 / .pi)
                        // Discard degenerate coords — large tile deltas can produce
                        // out-of-range lat/lng that cause NaN in haversineM downstream.
                        guard lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 else { continue }
                        cur.append((lat: lat, lng: lng))
                    }
                } else if cmd == 7 {
                    if !cur.isEmpty { lines.append(cur); cur = [] }
                }
            }
            if !cur.isEmpty { lines.append(cur) }

            for line in lines where line.count >= 2 {
                segs.append(RoadSegment(coords: line, kind: kind, name: name, oneway: oneway))
            }
        }
        return segs
    }
}
