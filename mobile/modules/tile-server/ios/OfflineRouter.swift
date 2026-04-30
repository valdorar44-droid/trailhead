/**
 * Offline road router — reads the local PMTiles file, builds a graph from
 * the 'roads' layer, and runs Dijkstra to find a path.
 *
 * Works entirely from the already-downloaded conus.pmtiles.
 * No network, no extra data files.
 *
 * Accuracy: follows real roads, respects road class weighting (highways fast,
 * paths slow).  Does NOT handle one-way streets or turn restrictions — good
 * enough for overlanding / backcountry nav where road formality is lower.
 */
import Foundation

// ── Coordinate quantisation — snap to ~1m grid for intersection detection ────
private func nodeId(_ lat: Double, _ lng: Double) -> Int64 {
    Int64(lat * 100_000) &* 10_000_000 &+ Int64(lng * 100_000)
}

private struct Edge { let to: Int64; let dist: Double; let name: String; let kind: String }
private typealias Graph = [Int64: [Edge]]

// ── Min-heap priority queue ───────────────────────────────────────────────────
private struct PQ {
    struct Item: Comparable {
        let f: Double; let id: Int64
        static func < (a: Item, b: Item) -> Bool { a.f < b.f }
    }
    private var h = [Item]()
    var isEmpty: Bool { h.isEmpty }
    mutating func push(_ item: Item) {
        h.append(item); siftUp(h.count - 1)
    }
    mutating func pop() -> Item {
        let top = h[0]; h[0] = h.removeLast()
        if !h.isEmpty { siftDown(0) }
        return top
    }
    private mutating func siftUp(_ i: Int) {
        var i = i
        while i > 0 {
            let p = (i - 1) / 2
            if h[p] <= h[i] { break }
            h.swapAt(i, p); i = p
        }
    }
    private mutating func siftDown(_ i: Int) {
        let n = h.count; var i = i
        while true {
            var m = i; let l = 2*i+1, r = 2*i+2
            if l < n && h[l] < h[m] { m = l }
            if r < n && h[r] < h[m] { m = r }
            if m == i { break }
            h.swapAt(i, m); i = m
        }
    }
}

// ── Haversine distance (metres) ───────────────────────────────────────────────
private func haversineM(_ a: (Double, Double), _ b: (Double, Double)) -> Double {
    let R = 6_371_000.0
    let dLat = (b.0 - a.0) * .pi / 180
    let dLng = (b.1 - a.1) * .pi / 180
    let x = sin(dLat/2)*sin(dLat/2) +
            cos(a.0 * .pi/180)*cos(b.0 * .pi/180)*sin(dLng/2)*sin(dLng/2)
    // Clamp to [0,1] — floating-point error with degenerate tile coords can
    // produce x slightly negative, causing sqrt(x) = NaN → Int(NaN) trap.
    let xc = max(0.0, min(1.0, x))
    return R * 2 * atan2(sqrt(xc), sqrt(1 - xc))
}

// ── Tile enumeration for a bounding box ──────────────────────────────────────
private func tilesInBBox(n: Double, s: Double, e: Double, w: Double, z: Int) -> [(x:Int, y:Int)] {
    let n2 = Double(1 << z)
    // Clamp lng to [-180, 180] and lat to Mercator-safe range to prevent Int(±∞) crash
    func tx(_ lng: Double) -> Int {
        let clamped = max(-180.0, min(180.0, lng))
        return Int((clamped + 180) / 360 * n2)
    }
    func ty(_ lat: Double) -> Int {
        let clamped = max(-85.05, min(85.05, lat))
        let r = clamped * .pi / 180
        return Int((1 - log(tan(r) + 1/cos(r)) / .pi) / 2 * n2)
    }
    let x0 = max(0,   tx(w)), x1 = min(Int(n2)-1, tx(e))
    let y0 = max(0,   ty(n)), y1 = min(Int(n2)-1, ty(s))
    guard x0 <= x1, y0 <= y1 else { return [] }
    var result = [(x:Int, y:Int)]()
    for x in x0...x1 { for y in y0...y1 { result.append((x, y)) } }
    return result
}

// ── Public route function ─────────────────────────────────────────────────────
enum OfflineRouter {

    struct Step {
        let type:     String   // depart | turn | continue | arrive
        let modifier: String   // left | right | slight left | straight | etc.
        let name:     String   // "Turn left on Hwy 9" style
        let dist:     Double
        let dur:      Double
        let lat:      Double
        let lng:      Double
    }

    struct RouteResult {
        let coords: [(lat: Double, lng: Double)]
        let steps:  [Step]
        let distanceM: Double
        let durationS: Double
    }

    static func route(
        from fLat: Double, _ fLng: Double,
        to   tLat: Double, _ tLng: Double,
        reader: PMTilesReader
    ) -> RouteResult? {
        // Choose zoom based on distance — coarser tiles for long routes so we
        // don't load thousands of z12 tiles for a 400-mile trip.
        let distDeg = sqrt(pow(tLat - fLat, 2) + pow(tLng - fLng, 2))
        let ZOOM: Int = distDeg > 3.0 ? 8 : distDeg > 1.0 ? 10 : 12

        // Cap tile count — bail early for routes too large even at coarse zoom
        let buf  = max(abs(tLat - fLat), abs(tLng - fLng)) * 0.15 + 0.05
        let north = max(fLat, tLat) + buf, south = min(fLat, tLat) - buf
        let east  = max(fLng, tLng) + buf, west  = min(fLng, tLng) - buf

        let tiles = tilesInBBox(n: north, s: south, e: east, w: west, z: ZOOM)
        guard !tiles.isEmpty, tiles.count <= 800 else { return nil } // bail if too many tiles

        // Build graph from road segments
        var graph   = Graph()
        var nodePos = [Int64: (Double, Double)]()  // id → (lat, lng)

        for (x, y) in tiles {
            guard let data = reader.tile(z: ZOOM, x: x, y: y), !data.isEmpty else { continue }
            // Decompress if the tile is gzip-encoded (tileCompression == 2)
            let tileData: Data
            if let dec = gzipDecompress(data) {
                tileData = dec
            } else {
                tileData = data
            }
            let segs = MVTDecoder.roads(from: tileData, z: ZOOM, x: x, y: y)
            for seg in segs {
                addSegmentToGraph(seg, &graph, &nodePos)
            }
        }

        guard !graph.isEmpty else { return nil }

        // Snap start/end to nearest graph node
        guard let startId = nearest(lat: fLat, lng: fLng, in: nodePos),
              let endId   = nearest(lat: tLat, lng: tLng, in: nodePos) else { return nil }

        // Dijkstra
        guard let pathIds = dijkstra(from: startId, to: endId,
                                     graph: graph, pos: nodePos,
                                     endLat: tLat, endLng: tLng) else { return nil }

        let steps = buildSteps(pathIds: pathIds, pos: nodePos, graph: graph,
                               fLat: fLat, fLng: fLng, tLat: tLat, tLng: tLng)

        var rawCoords = pathIds.compactMap { nodePos[$0] }
        rawCoords.insert((fLat, fLng), at: 0)
        rawCoords.append((tLat, tLng))

        let distM = zip(rawCoords, rawCoords.dropFirst()).reduce(0.0) { $0 + haversineM($1.0, $1.1) }
        let durS  = distM / 13.0

        let coords: [(lat: Double, lng: Double)] = rawCoords.map { (lat: $0.0, lng: $0.1) }
        return RouteResult(coords: coords, steps: steps, distanceM: distM, durationS: durS)
    }

    // ── Graph construction ────────────────────────────────────────────────────
    private static func addSegmentToGraph(
        _ seg: RoadSegment,
        _ graph: inout Graph,
        _ pos: inout [Int64: (Double, Double)]
    ) {
        let coords = seg.coords
        for i in 0..<coords.count {
            let c  = coords[i]
            let id = nodeId(c.lat, c.lng)
            pos[id] = (c.lat, c.lng)
            if i > 0 {
                let prev = coords[i-1]
                let pid  = nodeId(prev.lat, prev.lng)
                let d    = haversineM((c.lat, c.lng), (prev.lat, prev.lng)) * seg.weight
                graph[pid, default: []].append(Edge(to: id,  dist: d, name: seg.name, kind: seg.kind))
                if !seg.oneway {
                    graph[id,  default: []].append(Edge(to: pid, dist: d, name: seg.name, kind: seg.kind))
                }
            }
        }
    }

    // ── Bearing helpers ───────────────────────────────────────────────────────
    private static func bearing(_ a: (Double, Double), _ b: (Double, Double)) -> Double {
        let la1 = a.0 * .pi/180, la2 = b.0 * .pi/180
        let dL  = (b.1 - a.1) * .pi/180
        let x   = sin(dL) * cos(la2)
        let y   = cos(la1) * sin(la2) - sin(la1) * cos(la2) * cos(dL)
        return atan2(x, y) * 180 / .pi
    }

    private static func bearingDiff(_ a: Double, _ b: Double) -> Double {
        var d = b - a
        while d >  180 { d -= 360 }
        while d < -180 { d += 360 }
        return d
    }

    private static func turnInfo(_ diff: Double, roadName: String, roadKind: String) -> (type: String, modifier: String, label: String) {
        let a   = abs(diff)
        let on  = roadName.isEmpty ? roadKind.replacingOccurrences(of: "_", with: " ") : roadName
        if a < 20  { return ("continue", "straight",    "Continue on \(on)") }
        if a < 45  {
            let mod = diff < 0 ? "slight left" : "slight right"
            return ("turn", mod, "Bear \(mod) on \(on)")
        }
        if a < 135 {
            let mod = diff < 0 ? "left" : "right"
            return ("turn", mod, "Turn \(mod) on \(on)")
        }
        let mod = diff < 0 ? "sharp left" : "sharp right"
        return ("turn", mod, "Turn \(mod) on \(on)")
    }

    // ── Step generation from path ─────────────────────────────────────────────
    private static func buildSteps(
        pathIds: [Int64],
        pos:     [Int64: (Double, Double)],
        graph:   Graph,
        fLat: Double, fLng: Double,
        tLat: Double, tLng: Double
    ) -> [Step] {
        guard pathIds.count >= 2 else { return [] }

        // Resolve (coord, road name, road kind) for each node transition
        struct Seg { let lat: Double; let lng: Double; let name: String; let kind: String }
        var segs = [Seg]()
        for i in 0..<pathIds.count {
            let id = pathIds[i]
            let (lat, lng) = pos[id] ?? (0,0)
            // Find the edge used to reach this node (look at prev→cur edge)
            var name = ""; var kind = "road"
            if i > 0 {
                let prevId = pathIds[i-1]
                if let edge = graph[prevId]?.first(where: { $0.to == id }) {
                    name = edge.name; kind = edge.kind
                }
            }
            segs.append(Seg(lat: lat, lng: lng, name: name, kind: kind))
        }

        var steps = [Step]()
        // Depart step
        let first = segs[1]
        let dep   = bearing((fLat, fLng), (first.lat, first.lng))
        let card  = compassDir(dep)
        steps.append(Step(type: "depart", modifier: "", name: "Head \(card)\(first.name.isEmpty ? "" : " on \(first.name)")",
                          dist: 0, dur: 0, lat: fLat, lng: fLng))

        // Intermediate turns
        var stepDist = 0.0; var stepDur = 0.0
        var prevBearing = dep
        var curName = first.name; var curKind = first.kind

        for i in 1..<segs.count - 1 {
            let cur  = segs[i]; let next = segs[i+1]
            let segD = haversineM((cur.lat, cur.lng), (next.lat, next.lng))
            stepDist += segD; stepDur += segD / 13.0

            let outBearing = bearing((cur.lat, cur.lng), (next.lat, next.lng))
            let diff       = bearingDiff(prevBearing, outBearing)
            let nameChange = !next.name.isEmpty && next.name != curName

            // New step on significant turn OR road name change
            if abs(diff) > 20 || nameChange {
                let (type, modifier, label) = turnInfo(diff, roadName: next.name, roadKind: next.kind)
                steps.append(Step(type: type, modifier: modifier, name: label,
                                  dist: stepDist, dur: stepDur,
                                  lat: cur.lat, lng: cur.lng))
                stepDist = 0; stepDur = 0
                curName = next.name; curKind = next.kind
            }
            prevBearing = outBearing
        }

        // Arrive step
        steps.append(Step(type: "arrive", modifier: "", name: "Arrive at destination",
                          dist: stepDist, dur: stepDur, lat: tLat, lng: tLng))
        return steps
    }

    private static func compassDir(_ bearing: Double) -> String {
        let dirs = ["north","northeast","east","southeast","south","southwest","west","northwest"]
        let idx  = Int((bearing + 22.5).truncatingRemainder(dividingBy: 360) / 45)
        return dirs[max(0, min(7, idx))]
    }

    // ── Nearest node (brute-force for small graphs) ───────────────────────────
    private static func nearest(lat: Double, lng: Double,
                                 in pos: [Int64: (Double, Double)]) -> Int64? {
        var best: Int64?; var bestD = Double.infinity
        for (id, (nlat, nlng)) in pos {
            let d = (nlat-lat)*(nlat-lat) + (nlng-lng)*(nlng-lng)
            if d < bestD { bestD = d; best = id }
        }
        return best
    }

    // ── Dijkstra with A* heuristic ────────────────────────────────────────────
    private static func dijkstra(
        from start: Int64, to end: Int64,
        graph: Graph, pos: [Int64: (Double, Double)],
        endLat: Double, endLng: Double
    ) -> [Int64]? {
        var dist = [Int64: Double]()
        var prev = [Int64: Int64]()
        var pq   = PQ()
        dist[start] = 0
        pq.push(.init(f: 0, id: start))

        while !pq.isEmpty {
            let cur = pq.pop()
            if cur.id == end { break }
            let curDist = dist[cur.id] ?? .infinity
            if cur.f > curDist + 1e-6 { continue } // stale

            for edge in graph[cur.id] ?? [] {
                let newDist = curDist + edge.dist
                if newDist < (dist[edge.to] ?? .infinity) {
                    dist[edge.to] = newDist
                    prev[edge.to] = cur.id
                    if let (nlat, nlng) = pos[edge.to] {
                        let h = haversineM((nlat, nlng), (endLat, endLng))
                        pq.push(.init(f: newDist + h, id: edge.to))
                    }
                }
            }
        }

        guard dist[end] != nil else { return nil }
        var path = [Int64](); var c: Int64? = end
        while let n = c { path.append(n); c = prev[n] }
        return path.reversed()
    }
}
