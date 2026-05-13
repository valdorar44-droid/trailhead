import Foundation

struct TrailheadNavCoord {
    let lng: Double
    let lat: Double
}

struct TrailheadNavProjection {
    let progressM: Double
    let remainingM: Double
    let routeDistanceM: Double
    let deviationM: Double
    let segmentIdx: Int
    let projected: TrailheadNavCoord
}

final class TrailheadNavigationEngine {
    static let shared = TrailheadNavigationEngine()

    private let queue = DispatchQueue(label: "app.trailhead.navigation-engine", qos: .userInitiated)
    private var coords: [TrailheadNavCoord] = []
    private var cumulative: [Double] = []
    private var passedSegmentIdx = 0
    private var passedProgressM = 0.0
    private var active = false
    private var follow = false
    private var offRouteStreak = 0

    private init() {}

    func start(routeCoords: [[Double]], follow: Bool) -> [String: Any] {
        queue.sync {
            coords = routeCoords.compactMap { pair in
                guard pair.count >= 2, pair[0].isFinite, pair[1].isFinite else { return nil }
                return TrailheadNavCoord(lng: pair[0], lat: pair[1])
            }
            cumulative = Self.cumulativeDistances(coords)
            passedSegmentIdx = 0
            passedProgressM = 0
            offRouteStreak = 0
            active = coords.count >= 2
            self.follow = follow
            return snapshot(extra: ["reason": "start"])
        }
    }

    func stop() -> [String: Any] {
        queue.sync {
            active = false
            follow = false
            offRouteStreak = 0
            passedSegmentIdx = 0
            passedProgressM = 0
            return snapshot(extra: ["reason": "stop"])
        }
    }

    func setFollow(_ enabled: Bool) -> [String: Any] {
        queue.sync {
            follow = enabled && active
            return snapshot(extra: ["reason": follow ? "follow" : "freepan"])
        }
    }

    func updateLocation(lat: Double, lng: Double, accuracy: Double?, speed: Double?, heading: Double?) -> [String: Any] {
        queue.sync {
            guard active, coords.count >= 2, let projection = project(lat: lat, lng: lng) else {
                var inactive = snapshot(extra: [
                    "reason": "location",
                    "lat": lat,
                    "lng": lng
                ])
                if let speed { inactive["speed"] = speed }
                if let heading { inactive["heading"] = heading }
                return inactive
            }

            if projection.progressM + 5 >= passedProgressM {
                passedSegmentIdx = max(passedSegmentIdx, projection.segmentIdx)
                passedProgressM = max(passedProgressM, projection.progressM)
            }

            let acc = min(max(accuracy ?? 25, 0), 120)
            let threshold = max(50, acc * 1.8 + 25)
            let moving = (speed ?? 0) > 1.2 || projection.deviationM > threshold + 45
            if projection.deviationM > threshold && moving {
                offRouteStreak += 1
            } else if projection.deviationM < threshold * 0.65 {
                offRouteStreak = 0
            }

            var state = snapshot(extra: [
                "reason": "location",
                "lat": lat,
                "lng": lng,
                "distanceM": projection.progressM,
                "remainingM": projection.remainingM,
                "routeDistanceM": projection.routeDistanceM,
                "deviationM": projection.deviationM,
                "segmentIdx": projection.segmentIdx,
                "offRoute": offRouteStreak >= 2,
                "warnOffRoute": offRouteStreak > 0,
                "projectedLng": projection.projected.lng,
                "projectedLat": projection.projected.lat
            ])
            if let speed { state["speed"] = speed }
            if let heading { state["heading"] = heading }
            return state
        }
    }

    func currentSnapshot() -> [String: Any] {
        queue.sync { snapshot(extra: ["reason": "snapshot"]) }
    }

    private func snapshot(extra: [String: Any]) -> [String: Any] {
        var out = extra
        out["active"] = active
        out["follow"] = follow
        out["passedSegmentIdx"] = passedSegmentIdx
        out["passedProgressM"] = passedProgressM
        out["offRouteStreak"] = offRouteStreak
        return out
    }

    private func project(lat: Double, lng: Double) -> TrailheadNavProjection? {
        guard coords.count >= 2, cumulative.count == coords.count else { return nil }
        let point = TrailheadNavCoord(lng: lng, lat: lat)
        let searchStart = max(0, passedSegmentIdx - 8)
        let searchEnd = min(coords.count - 2, passedSegmentIdx + 180)
        let latScale = 111_320.0
        let lngScale = 111_320.0 * cos(lat * .pi / 180.0)
        var best: TrailheadNavProjection?

        for idx in searchStart...searchEnd {
            let a = coords[idx]
            let b = coords[idx + 1]
            let ax = a.lng * lngScale
            let ay = a.lat * latScale
            let bx = b.lng * lngScale
            let by = b.lat * latScale
            let px = point.lng * lngScale
            let py = point.lat * latScale
            let vx = bx - ax
            let vy = by - ay
            let len2 = vx * vx + vy * vy
            if len2 <= 0 { continue }
            let t = min(1.0, max(0.0, ((px - ax) * vx + (py - ay) * vy) / len2))
            let projX = ax + vx * t
            let projY = ay + vy * t
            let dx = px - projX
            let dy = py - projY
            let dist = sqrt(dx * dx + dy * dy)
            let segLen = cumulative[idx + 1] - cumulative[idx]
            let progress = cumulative[idx] + segLen * t
            let total = cumulative.last ?? 0
            let projection = TrailheadNavProjection(
                progressM: progress,
                remainingM: max(0, total - progress),
                routeDistanceM: total,
                deviationM: dist,
                segmentIdx: idx,
                projected: TrailheadNavCoord(lng: projX / lngScale, lat: projY / latScale)
            )
            if best == nil || projection.deviationM < best!.deviationM {
                best = projection
            }
        }
        return best
    }

    private static func cumulativeDistances(_ coords: [TrailheadNavCoord]) -> [Double] {
        guard !coords.isEmpty else { return [] }
        var out = Array(repeating: 0.0, count: coords.count)
        for idx in 1..<coords.count {
            out[idx] = out[idx - 1] + haversineM(coords[idx - 1], coords[idx])
        }
        return out
    }

    private static func haversineM(_ a: TrailheadNavCoord, _ b: TrailheadNavCoord) -> Double {
        let radius = 6_371_000.0
        let dLat = (b.lat - a.lat) * .pi / 180
        let dLng = (b.lng - a.lng) * .pi / 180
        let la1 = a.lat * .pi / 180
        let la2 = b.lat * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(la1) * cos(la2) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * radius * atan2(sqrt(h), sqrt(max(0, 1 - h)))
    }
}
