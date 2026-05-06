import Foundation
import zlib

private struct TrailRouteCoord {
    let lng: Double
    let lat: Double
}

private struct TrailRouteEdge {
    let to: Int
    let length: Double
}

private struct TrailRouteHeapItem {
    let node: Int
    let cost: Double
}

private final class TrailRouteMinHeap {
    private var items: [TrailRouteHeapItem] = []

    var isEmpty: Bool { items.isEmpty }

    func push(_ item: TrailRouteHeapItem) {
        items.append(item)
        siftUp(items.count - 1)
    }

    func pop() -> TrailRouteHeapItem? {
        guard !items.isEmpty else { return nil }
        if items.count == 1 { return items.removeLast() }
        let out = items[0]
        items[0] = items.removeLast()
        siftDown(0)
        return out
    }

    private func siftUp(_ idx: Int) {
        var child = idx
        while child > 0 {
            let parent = (child - 1) / 2
            if items[parent].cost <= items[child].cost { break }
            items.swapAt(parent, child)
            child = parent
        }
    }

    private func siftDown(_ idx: Int) {
        var parent = idx
        while true {
            let left = parent * 2 + 1
            let right = left + 1
            var best = parent
            if left < items.count && items[left].cost < items[best].cost { best = left }
            if right < items.count && items[right].cost < items[best].cost { best = right }
            if best == parent { break }
            items.swapAt(parent, best)
            parent = best
        }
    }
}

final class TrailRouteGraphRouter {
    static let shared = TrailRouteGraphRouter()

    private let queue = DispatchQueue(label: "app.trailhead.trail-route-graph", qos: .userInitiated)

    private init() {}

    func route(graphPath: String, requestJson: String, completion: @escaping (Result<String, Error>) -> Void) {
        queue.async {
            do {
                let result = try self.routeSync(graphPath: graphPath, requestJson: requestJson)
                completion(.success(result))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private func routeSync(graphPath: String, requestJson: String) throws -> String {
        let requestData = Data(requestJson.utf8)
        let raw = try JSONSerialization.jsonObject(with: requestData) as? [String: Any] ?? [:]
        let start = try parseCoord(raw["start"], label: "start")
        let end = try parseOptionalCoord(raw["end"])
        let corridorM = max(500.0, min((raw["corridorM"] as? Double) ?? 2500.0, 40_000.0))
        let bounds = parseBounds(raw["bounds"]) ?? {
            if let end {
                return boundsFor(start: start, end: end, bufferM: corridorM)
            }
            return boundsFor(center: start, bufferM: corridorM)
        }()
        let path = normalizePath(graphPath)

        var nodes: [Int: TrailRouteCoord] = [:]
        var adjacency: [Int: [TrailRouteEdge]] = [:]
        var edgeCount = 0

        try readGzipLines(path: path) { line in
            guard let data = line.data(using: .utf8),
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                return
            }
            if let nodeId = obj["n"] as? Int,
               let lngE6 = obj["lng"] as? Int,
               let latE6 = obj["lat"] as? Int {
                let coord = TrailRouteCoord(lng: Double(lngE6) / 1_000_000.0, lat: Double(latE6) / 1_000_000.0)
                if coord.lng >= bounds.w && coord.lng <= bounds.e && coord.lat >= bounds.s && coord.lat <= bounds.n {
                    nodes[nodeId] = coord
                }
                return
            }
            if obj["e"] != nil,
               let a = obj["a"] as? Int,
               let b = obj["b"] as? Int,
               let length = obj["l"] as? Double,
               nodes[a] != nil,
               nodes[b] != nil {
                adjacency[a, default: []].append(TrailRouteEdge(to: b, length: length))
                adjacency[b, default: []].append(TrailRouteEdge(to: a, length: length))
                edgeCount += 1
            }
        }

        guard nodes.count >= 2, edgeCount > 0 else {
            throw NSError(domain: "TrailRouteGraph", code: 2, userInfo: [NSLocalizedDescriptionKey: "No trail routing graph data in selected corridor"])
        }
        let startNode = nearestNode(to: start, nodes: nodes)
        let endNode = end.flatMap { nearestNode(to: $0, nodes: nodes) }
        guard let startNode else {
            throw NSError(domain: "TrailRouteGraph", code: 3, userInfo: [NSLocalizedDescriptionKey: "No routable trail node near request"])
        }
        let pathNodes: [Int]
        if let endNode {
            pathNodes = try shortestPath(start: startNode, end: endNode, adjacency: adjacency)
        } else {
            pathNodes = connectedTrailPath(start: startNode, adjacency: adjacency, nodes: nodes, maxDistanceM: corridorM * 10)
        }
        let coords = pathNodes.compactMap { nodes[$0] }
        let distanceM = routeDistance(coords)
        let response: [String: Any] = [
            "coords": coords.map { [$0.lng, $0.lat] },
            "distanceM": distanceM,
            "nodeCount": nodes.count,
            "edgeCount": edgeCount,
            "pathNodeCount": coords.count,
            "source": endNode == nil ? "trail_route_graph_component" : "trail_route_graph"
        ]
        let out = try JSONSerialization.data(withJSONObject: response)
        return String(data: out, encoding: .utf8) ?? "{}"
    }

    private func readGzipLines(path: String, onLine: (String) throws -> Void) throws {
        guard let gz = gzopen(path, "rb") else {
            throw NSError(domain: "TrailRouteGraph", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unable to open trail route graph at \(path)"])
        }
        defer { gzclose(gz) }

        let bufferSize = 1 << 16
        let buffer = UnsafeMutablePointer<CChar>.allocate(capacity: bufferSize)
        defer { buffer.deallocate() }

        while gzgets(gz, buffer, Int32(bufferSize)) != nil {
            let line = String(cString: buffer).trimmingCharacters(in: .newlines)
            if !line.isEmpty {
                try onLine(line)
            }
        }
    }

    private func shortestPath(start: Int, end: Int, adjacency: [Int: [TrailRouteEdge]]) throws -> [Int] {
        if start == end { return [start] }
        let heap = TrailRouteMinHeap()
        var dist: [Int: Double] = [start: 0]
        var prev: [Int: Int] = [:]
        var settled = Set<Int>()
        heap.push(TrailRouteHeapItem(node: start, cost: 0))

        while let item = heap.pop() {
            if settled.contains(item.node) { continue }
            settled.insert(item.node)
            if item.node == end { break }
            for edge in adjacency[item.node] ?? [] {
                if settled.contains(edge.to) { continue }
                let nextCost = item.cost + edge.length
                if nextCost < (dist[edge.to] ?? Double.greatestFiniteMagnitude) {
                    dist[edge.to] = nextCost
                    prev[edge.to] = item.node
                    heap.push(TrailRouteHeapItem(node: edge.to, cost: nextCost))
                }
            }
        }

        guard dist[end] != nil else {
            throw NSError(domain: "TrailRouteGraph", code: 4, userInfo: [NSLocalizedDescriptionKey: "No connected trail route found in selected corridor"])
        }

        var out = [end]
        var current = end
        while current != start {
            guard let p = prev[current] else { break }
            out.append(p)
            current = p
        }
        return out.reversed()
    }

    private func connectedTrailPath(start: Int, adjacency: [Int: [TrailRouteEdge]], nodes: [Int: TrailRouteCoord], maxDistanceM: Double) -> [Int] {
        var out: [Int] = [start]
        var seen = Set<Int>([start])
        var current = start
        var distance = 0.0

        while out.count < 4_000 && distance < maxDistanceM {
            let next = (adjacency[current] ?? [])
                .filter { !seen.contains($0.to) && nodes[$0.to] != nil }
                .sorted { $0.length < $1.length }
                .first
            guard let next else { break }
            seen.insert(next.to)
            out.append(next.to)
            distance += next.length
            current = next.to
        }

        if out.count >= 2 { return out }

        var queue = [start]
        while !queue.isEmpty && out.count < 4_000 {
            let node = queue.removeFirst()
            for edge in adjacency[node] ?? [] {
                if seen.contains(edge.to) || nodes[edge.to] == nil { continue }
                seen.insert(edge.to)
                queue.append(edge.to)
                out.append(edge.to)
                if out.count >= 4_000 { break }
            }
        }
        return out
    }

    private func nearestNode(to coord: TrailRouteCoord, nodes: [Int: TrailRouteCoord]) -> Int? {
        var bestId: Int?
        var bestDistance = Double.greatestFiniteMagnitude
        for (id, node) in nodes {
            let d = haversineM(coord, node)
            if d < bestDistance {
                bestDistance = d
                bestId = id
            }
        }
        return bestId
    }

    private func routeDistance(_ coords: [TrailRouteCoord]) -> Double {
        guard coords.count >= 2 else { return 0 }
        var total = 0.0
        for idx in 1..<coords.count {
            total += haversineM(coords[idx - 1], coords[idx])
        }
        return total
    }

    private func normalizePath(_ path: String) -> String {
        if path.hasPrefix("file://"), let url = URL(string: path) {
            return url.path
        }
        return path
    }

    private func parseCoord(_ raw: Any?, label: String) throws -> TrailRouteCoord {
        guard let arr = raw as? [Any], arr.count >= 2,
              let lng = arr[0] as? Double,
              let lat = arr[1] as? Double,
              lng.isFinite,
              lat.isFinite else {
            throw NSError(domain: "TrailRouteGraph", code: 5, userInfo: [NSLocalizedDescriptionKey: "Invalid \(label) coordinate"])
        }
        return TrailRouteCoord(lng: lng, lat: lat)
    }

    private func parseOptionalCoord(_ raw: Any?) throws -> TrailRouteCoord? {
        guard raw != nil, !(raw is NSNull) else { return nil }
        return try parseCoord(raw, label: "end")
    }

    private func parseBounds(_ raw: Any?) -> (w: Double, s: Double, e: Double, n: Double)? {
        guard let arr = raw as? [Any], arr.count >= 4,
              let w = arr[0] as? Double,
              let s = arr[1] as? Double,
              let e = arr[2] as? Double,
              let n = arr[3] as? Double else {
            return nil
        }
        return (w, s, e, n)
    }

    private func boundsFor(start: TrailRouteCoord, end: TrailRouteCoord, bufferM: Double) -> (w: Double, s: Double, e: Double, n: Double) {
        let midLat = (start.lat + end.lat) / 2
        let latDelta = bufferM / 110_540.0
        let lngDelta = bufferM / max(30_000.0, 111_320.0 * cos(midLat * .pi / 180.0))
        return (
            min(start.lng, end.lng) - lngDelta,
            min(start.lat, end.lat) - latDelta,
            max(start.lng, end.lng) + lngDelta,
            max(start.lat, end.lat) + latDelta
        )
    }

    private func boundsFor(center: TrailRouteCoord, bufferM: Double) -> (w: Double, s: Double, e: Double, n: Double) {
        let latDelta = bufferM / 110_540.0
        let lngDelta = bufferM / max(30_000.0, 111_320.0 * cos(center.lat * .pi / 180.0))
        return (
            center.lng - lngDelta,
            center.lat - latDelta,
            center.lng + lngDelta,
            center.lat + latDelta
        )
    }

    private func haversineM(_ a: TrailRouteCoord, _ b: TrailRouteCoord) -> Double {
        let radius = 6_371_000.0
        let dLat = (b.lat - a.lat) * .pi / 180
        let dLng = (b.lng - a.lng) * .pi / 180
        let la1 = a.lat * .pi / 180
        let la2 = b.lat * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(la1) * cos(la2) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * radius * atan2(sqrt(h), sqrt(max(0, 1 - h)))
    }
}
