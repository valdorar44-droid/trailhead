import CoreLocation
import QuartzCore
import Turf
@_spi(Experimental) import MapboxMaps
import UIKit

// MARK: - Payload models

private struct MissionCameraConfig {
    let pitch: Double
    let minZoom: Double
    let maxZoom: Double
    let lookaheadM: Double
}

private struct MissionSceneCamera {
    let mode: String
    let zoom: Double?
    let pitch: Double?
    let bearing: Double?
    let preset: String?
    let orbitDirection: String?
    let orbitSweepDeg: Double?
}

private struct MissionSceneCallout {
    let id: String
    let title: String
    let lat: Double
    let lng: Double
    let kind: String
}

private struct MissionSceneModel {
    let id: String
    let type: String
    let durationMs: Double
    let routeSliceStart: Double
    let routeSliceEnd: Double
    let focusLat: Double?
    let focusLng: Double?
    let rejoinRatio: Double?
    let camera: MissionSceneCamera
    let warning: Bool
    let callouts: [MissionSceneCallout]
}

private struct MissionPoint {
    var lat: Double
    var lng: Double
}

// MARK: - Event bridge

protocol TrailheadMissionAnimatorDelegate: AnyObject {
    func missionAnimator(_ animator: TrailheadMissionAnimator, sceneStart sceneId: String, index: Int, type: String)
    func missionAnimator(_ animator: TrailheadMissionAnimator, sceneProgress sceneId: String, index: Int, progress: Double)
    func missionAnimator(_ animator: TrailheadMissionAnimator, sceneEnd sceneId: String, index: Int)
    func missionAnimatorComplete(_ animator: TrailheadMissionAnimator)
    func missionAnimator(_ animator: TrailheadMissionAnimator, error message: String, code: String?)
    func missionAnimator(_ animator: TrailheadMissionAnimator, debug kind: String, details: [String: Any])
}

// MARK: - Animator

final class TrailheadMissionAnimator: NSObject {
    weak var delegate: TrailheadMissionAnimatorDelegate?

    private weak var mapView: MapView?
    private var styleCancelables = Set<AnyCancelable>()
    private var displayLink: CADisplayLink?
    private var preparedPayload: [String: Any]?

    private var route: [[Double]] = []
    private var routeCum: [Double] = []
    private var routeTotal: Double = 0
    private var scenes: [MissionSceneModel] = []
    private var cameraConfig = MissionCameraConfig(pitch: 64, minZoom: 8.5, maxZoom: 14.2, lookaheadM: 600)

    private var playing = false
    private var paused = false
    private var stopped = false
    private var speed: Double = 1
    private var sceneIndex = -1
    private var sceneStartTs: CFTimeInterval = 0
    private var pausedAt: CFTimeInterval = 0
    private var pausedTotal: CFTimeInterval = 0
    private var sceneDuration: CFTimeInterval = 7
    private var sceneEstablishMs: CFTimeInterval = 0
    private var smoothedBearing: Double?
    private var lastCamDist: Double?
    private var lastCamPoint: MissionPoint?
    private var lastCamBearing: Double?
    private var lastProgressEmit: CFTimeInterval = 0
    private var warningActive = false

    private let sceneFloorMs: CFTimeInterval = 7
    private let bearingEase = 0.16
    private let progressMaxPoints = 140

    static func canImportMapbox() -> Bool {
        true
    }

    static func findMapView() -> MapView? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        for window in scenes.flatMap({ $0.windows }).filter({ !$0.isHidden }) {
            if let found = findMapView(in: window) { return found }
        }
        return nil
    }

    private static func findMapView(in view: UIView) -> MapView? {
        if let map = view as? MapView { return map }
        for child in view.subviews {
            if let found = findMapView(in: child) { return found }
        }
        return nil
    }

    func prepare(payload: [String: Any]) -> Bool {
        guard parsePayload(payload) else { return false }
        preparedPayload = payload
        attachMapIfNeeded()
        installMissionLayers()
        return mapView != nil
    }

    func start(payload: [String: Any]?) -> Bool {
        if let payload {
            guard parsePayload(payload) else {
                delegate?.missionAnimator(self, error: "Invalid mission payload", code: "invalid_payload")
                return false
            }
            preparedPayload = payload
        } else if preparedPayload == nil {
            delegate?.missionAnimator(self, error: "No prepared mission animation", code: "not_prepared")
            return false
        }
        attachMapIfNeeded()
        guard let mapView else {
            delegate?.missionAnimator(self, error: "MapView not found", code: "no_map")
            return false
        }
        installMissionLayers()
        updateFullRoute()
        stopped = false
        paused = false
        playing = true
        sceneIndex = -1
        pausedTotal = 0
        startDisplayLink()
        advanceScene(on: mapView)
        return true
    }

    func pause() -> Bool {
        guard playing, !paused else { return false }
        paused = true
        pausedAt = CACurrentMediaTime()
        displayLink?.isPaused = true
        return true
    }

    func resume() -> Bool {
        guard playing, paused else { return false }
        paused = false
        pausedTotal += CACurrentMediaTime() - pausedAt
        displayLink?.isPaused = false
        return true
    }

    func stop() -> Bool {
        playing = false
        paused = false
        stopped = true
        stopDisplayLink()
        clearOverlaySources()
        return true
    }

    func clear() -> Bool {
        _ = stop()
        preparedPayload = nil
        route = []
        routeCum = []
        scenes = []
        return true
    }

    func setSpeed(_ next: Double) -> Bool {
        speed = max(0.25, min(3, next))
        return true
    }

    // MARK: - Setup

    private func attachMapIfNeeded() {
        guard mapView == nil else { return }
        guard let found = Self.findMapView() else { return }
        mapView = found
        found.mapboxMap.onStyleLoaded.observe { [weak self] _ in
            self?.installMissionLayers()
            self?.updateFullRoute()
        }.store(in: &styleCancelables)
    }

    private func parsePayload(_ payload: [String: Any]) -> Bool {
        guard let rawRoute = payload["route"] as? [[Any]], rawRoute.count >= 2 else { return false }
        route = rawRoute.compactMap { pair -> [Double]? in
            guard pair.count >= 2 else { return nil }
            let lng = doubleValue(pair[0])
            let lat = doubleValue(pair[1])
            guard let lng, let lat else { return nil }
            return [lng, lat]
        }
        guard route.count >= 2 else { return false }
        routeCum = cumulativeDistances(route: route)
        routeTotal = routeCum.last ?? 0

        if let cam = payload["camera"] as? [String: Any] {
            cameraConfig = MissionCameraConfig(
                pitch: doubleValue(cam["pitch"]) ?? 64,
                minZoom: doubleValue(cam["minZoom"]) ?? 8.5,
                maxZoom: doubleValue(cam["maxZoom"]) ?? 14.2,
                lookaheadM: doubleValue(cam["lookaheadM"]) ?? 600
            )
        }
        speed = max(0.25, min(3, doubleValue(payload["speed"]) ?? 1))

        guard let rawScenes = payload["scenes"] as? [[String: Any]], rawScenes.count >= 1 else { return false }
        scenes = rawScenes.compactMap { parseScene($0) }
        return scenes.count >= 1
    }

    private func parseScene(_ raw: [String: Any]) -> MissionSceneModel? {
        guard let id = raw["id"] as? String, let type = raw["type"] as? String else { return nil }
        let slice = raw["routeSlice"] as? [Any]
        let sliceStart = slice.flatMap { $0.count > 0 ? doubleValue($0[0]) : nil } ?? 0
        let sliceEnd = slice.flatMap { $0.count > 1 ? doubleValue($0[1]) : nil } ?? 1
        let focus = raw["focus"] as? [String: Any]
        let camRaw = raw["camera"] as? [String: Any] ?? [:]
        let orbit = camRaw["orbit"] as? [String: Any]
        let layers = raw["layers"] as? [String: Any] ?? [:]
        let calloutsRaw = raw["callouts"] as? [[String: Any]] ?? []
        let callouts = calloutsRaw.compactMap { c -> MissionSceneCallout? in
            guard let cid = c["id"] as? String,
                  let title = c["title"] as? String,
                  let lat = doubleValue(c["lat"]),
                  let lng = doubleValue(c["lng"]) else { return nil }
            return MissionSceneCallout(
                id: cid,
                title: title,
                lat: lat,
                lng: lng,
                kind: (c["kind"] as? String) ?? type
            )
        }
        let camera = MissionSceneCamera(
            mode: (camRaw["mode"] as? String) ?? "follow",
            zoom: doubleValue(camRaw["zoom"]),
            pitch: doubleValue(camRaw["pitch"]),
            bearing: doubleValue(camRaw["bearing"]),
            preset: camRaw["preset"] as? String,
            orbitDirection: orbit?["direction"] as? String,
            orbitSweepDeg: doubleValue(orbit?["sweepDeg"])
        )
        return MissionSceneModel(
            id: id,
            type: type,
            durationMs: doubleValue(raw["durationMs"]) ?? 12000,
            routeSliceStart: max(0, min(1, sliceStart)),
            routeSliceEnd: max(sliceStart, min(1, sliceEnd)),
            focusLat: doubleValue(focus?["lat"]),
            focusLng: doubleValue(focus?["lng"]),
            rejoinRatio: doubleValue(raw["rejoinRatio"]),
            camera: camera,
            warning: (layers["warning"] as? Bool) == true || ["risk_focus", "weather_focus", "offline_readiness"].contains(type),
            callouts: callouts
        )
    }

    // MARK: - Layers

    private func installMissionLayers() {
        guard let mapView else { return }
        let style = mapView.mapboxMap.style
        let sources = [
            "mission-full-route-source",
            "mission-progress-route-source",
            "mission-marker-source",
            "mission-callouts-source",
        ]
        for id in sources where !style.sourceExists(withId: id) {
            var source = GeoJSONSource(id: id)
            source.data = .featureCollection(FeatureCollection(features: []))
            try? style.addSource(source)
        }
        addLineLayer(style: style, id: "th-mission-full-casing", source: "mission-full-route-source", color: UIColor(red: 0.01, green: 0.02, blue: 0.09, alpha: 0.85), width: 9)
        addLineLayer(style: style, id: "th-mission-full-line", source: "mission-full-route-source", color: UIColor(red: 0.89, green: 0.91, blue: 0.94, alpha: 0.9), width: 4.5)
        addLineLayer(style: style, id: "th-mission-progress-shadow", source: "mission-progress-route-source", color: UIColor(red: 0.01, green: 0.02, blue: 0.09, alpha: 0.7), width: 10)
        addLineLayer(style: style, id: "th-mission-progress-line", source: "mission-progress-route-source", color: UIColor(red: 0.22, green: 0.88, blue: 1, alpha: 1), width: 6.5)
        addCircleLayer(style: style, id: "th-mission-marker-glow", source: "mission-marker-source", radius: 12, color: UIColor(red: 0, green: 0.65, blue: 1, alpha: 0.22), stroke: 0)
        addCircleLayer(style: style, id: "th-mission-marker-dot", source: "mission-marker-source", radius: 7, color: UIColor(red: 0, green: 0.65, blue: 1, alpha: 1), stroke: 2.5, strokeColor: .white)
        addCircleLayer(style: style, id: "th-mission-callout-dot", source: "mission-callouts-source", radius: 8, color: UIColor(red: 0.07, green: 0.09, blue: 0.15, alpha: 1), stroke: 2, strokeColor: .white)
    }

    private func addLineLayer(style: Style, id: String, source: String, color: UIColor, width: Double) {
        guard !style.layerExists(withId: id) else { return }
        var layer = LineLayer(id: id, source: source)
        layer.lineColor = .constant(StyleColor(color))
        layer.lineWidth = .constant(width)
        layer.lineCap = .constant(.round)
        layer.lineJoin = .constant(.round)
        try? style.addLayer(layer)
    }

    private func addCircleLayer(style: Style, id: String, source: String, radius: Double, color: UIColor, stroke: Double, strokeColor: UIColor = .clear) {
        guard !style.layerExists(withId: id) else { return }
        var layer = CircleLayer(id: id, source: source)
        layer.circleRadius = .constant(radius)
        layer.circleColor = .constant(StyleColor(color))
        layer.circleStrokeWidth = .constant(stroke)
        if stroke > 0 {
            layer.circleStrokeColor = .constant(StyleColor(strokeColor))
        }
        try? style.addLayer(layer)
    }

    private func updateFullRoute() {
        guard route.count >= 2, let mapView else { return }
        let coords = route.map { LocationCoordinate2D(latitude: $0[1], longitude: $0[0]) }
        let feature = Feature(geometry: .lineString(LineString(coords)))
        try? mapView.mapboxMap.style.updateGeoJSONSource(withId: "mission-full-route-source", geoJSON: .feature(feature))
    }

    private func clearOverlaySources() {
        guard let mapView else { return }
        let empty = GeoJSONObject.featureCollection(FeatureCollection(features: []))
        let style = mapView.mapboxMap.style
        for id in ["mission-progress-route-source", "mission-marker-source", "mission-callouts-source"] {
            try? style.updateGeoJSONSource(withId: id, geoJSON: empty)
        }
    }

    // MARK: - Loop

    private func startDisplayLink() {
        stopDisplayLink()
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func stopDisplayLink() {
        displayLink?.invalidate()
        displayLink = nil
    }

    @objc private func tick(_ link: CADisplayLink) {
        guard playing, !paused, !stopped, sceneIndex >= 0, sceneIndex < scenes.count, let mapView else { return }
        let now = CACurrentMediaTime()
        let scene = scenes[sceneIndex]
        let elapsed = now - sceneStartTs - pausedTotal
        let glideMs = max(0.001, sceneDuration - sceneEstablishMs)
        let t = max(0, min(1, (elapsed - sceneEstablishMs) / glideMs))

        if elapsed >= sceneDuration {
            finishScene(scene, on: mapView)
            return
        }

        switch scene.camera.mode {
        case "follow":
            tickFollow(scene: scene, t: t, on: mapView)
        case "orbit":
            tickOrbit(scene: scene, t: t, on: mapView)
        default:
            if scene.type == "whole_route" || scene.camera.mode == "fit" {
                emitProgress(scene: scene, ratio: t, markerDist: routeTotal * (scene.routeSliceStart + (scene.routeSliceEnd - scene.routeSliceStart) * t))
            }
        }

        if now - lastProgressEmit >= 0.5 {
            lastProgressEmit = now
            delegate?.missionAnimator(self, sceneProgress: scene.id, index: sceneIndex, progress: t)
        }
    }

    private func advanceScene(on mapView: MapView) {
        sceneIndex += 1
        guard sceneIndex < scenes.count else {
            playing = false
            stopDisplayLink()
            delegate?.missionAnimatorComplete(self)
            return
        }
        let scene = scenes[sceneIndex]
        sceneStartTs = CACurrentMediaTime()
        pausedTotal = 0
        lastProgressEmit = 0
        sceneDuration = max(sceneFloorMs, (scene.durationMs / 1000) / max(0.25, speed))
        warningActive = scene.warning
        updateProgressLineColor(warning: warningActive)
        applySceneOverlays(scene)
        sceneEstablishMs = applyEstablishingCamera(scene, on: mapView) / 1000
        delegate?.missionAnimator(self, sceneStart: scene.id, index: sceneIndex, type: scene.type)
        delegate?.missionAnimator(self, debug: "scene_start", details: ["scene_id": scene.id, "index": sceneIndex])
    }

    private func finishScene(_ scene: MissionSceneModel, on mapView: MapView) {
        delegate?.missionAnimator(self, sceneEnd: scene.id, index: sceneIndex)
        advanceScene(on: mapView)
    }

    // MARK: - Scene motion

    private func tickFollow(scene: MissionSceneModel, t: Double, on mapView: MapView) {
        guard routeTotal > 0 else { return }
        let startDist = routeTotal * scene.routeSliceStart
        let endDist = routeTotal * scene.routeSliceEnd
        let lookaheadM = lookaheadForSlice(start: startDist, end: endDist)
        let d = startDist + (endDist - startDist) * t
        let nominal = min(routeTotal, d + lookaheadM)
        let camDist = lastCamDist.map { max($0, nominal) } ?? nominal
        lastCamDist = camDist
        let camPt = pointAtDistance(dist: camDist)
        let aheadPt = pointAtDistance(dist: min(routeTotal, camDist + lookaheadM))
        let targetBearing = bearing(from: camPt, to: aheadPt)
        smoothedBearing = smoothAngle(prev: smoothedBearing, target: targetBearing, factor: bearingEase)
        let sliceLenKm = max(0, endDist - startDist) / 1000
        let zoom = zoomForSliceLengthKm(sliceLenKm, requested: scene.camera.zoom)
        setCamera(center: camPt, zoom: zoom, pitch: clampPitch(scene.camera.pitch), bearing: smoothedBearing ?? targetBearing, on: mapView)
        emitProgress(scene: scene, ratio: routeTotal > 0 ? d / routeTotal : t, markerDist: d)
        delegate?.missionAnimator(self, debug: "camera", details: ["scene_id": scene.id])
    }

    private func tickOrbit(scene: MissionSceneModel, t: Double, on mapView: MapView) {
        guard let lat = scene.focusLat, let lng = scene.focusLng else { return }
        let sweep = scene.camera.orbitSweepDeg ?? 80
        let dir: Double = scene.camera.orbitDirection == "ccw" ? -1 : 1
        let start = scene.camera.bearing ?? lastCamBearing ?? 0
        let bearing = start + sweep * dir * t
        let zoom = min(scene.camera.zoom ?? 13, cameraConfig.maxZoom)
        setCamera(center: MissionPoint(lat: lat, lng: lng), zoom: zoom, pitch: clampPitch(scene.camera.pitch ?? 58), bearing: bearing, on: mapView)
        emitProgress(scene: scene, ratio: t, markerDist: routeTotal * scene.routeSliceStart)
    }

    private func applyEstablishingCamera(_ scene: MissionSceneModel, on mapView: MapView) -> Double {
        smoothedBearing = nil
        let cam = scene.camera
        if cam.mode == "fit" || scene.type == "intro" || scene.type == "whole_route" || scene.type == "mission_recap" {
            let coords = sliceRoute(start: scene.routeSliceStart, end: scene.routeSliceEnd)
            if let bounds = boundsFromCoords(coords) {
                let spanDeg = max(bounds.span, 0.02)
                let zoom = max(4.5, min(12.5, log2(190 / spanDeg)))
                setCamera(center: bounds.center, zoom: zoom, pitch: cam.pitch ?? 54, bearing: nil, on: mapView, animated: true, duration: 2.6)
                lastCamPoint = bounds.center
                lastCamDist = nil
                return 2600
            }
        }
        if cam.mode == "follow", routeTotal > 0 {
            let startDist = routeTotal * scene.routeSliceStart
            let endDist = routeTotal * scene.routeSliceEnd
            let lookaheadM = lookaheadForSlice(start: startDist, end: endDist)
            let leadDist = min(routeTotal, startDist + lookaheadM)
            if let lastCamDist, abs(leadDist - lastCamDist) < max(400, lookaheadM) {
                smoothedBearing = lastCamBearing
                return 0
            }
            let start = pointAtDistance(dist: leadDist)
            let ahead = pointAtDistance(dist: min(routeTotal, leadDist + lookaheadM))
            let bearing = bearing(from: start, to: ahead)
            smoothedBearing = bearing
            let zoom = zoomForSliceLengthKm(max(0, endDist - startDist) / 1000, requested: cam.zoom)
            setCamera(center: start, zoom: zoom, pitch: clampPitch(cam.pitch), bearing: bearing, on: mapView, animated: true, duration: 1.8)
            lastCamDist = leadDist
            lastCamPoint = start
            lastCamBearing = bearing
            return 1800
        }
        if let lat = scene.focusLat, let lng = scene.focusLng {
            let zoom = min(cam.zoom ?? 12.5, cameraConfig.maxZoom)
            setCamera(center: MissionPoint(lat: lat, lng: lng), zoom: zoom, pitch: clampPitch(cam.pitch ?? 62), bearing: cam.bearing, on: mapView, animated: true, duration: 2.0)
            lastCamPoint = MissionPoint(lat: lat, lng: lng)
            lastCamDist = nil
            return 2000
        }
        return 0
    }

    private func applySceneOverlays(_ scene: MissionSceneModel) {
        if !scene.callouts.isEmpty {
            let features = scene.callouts.map { c -> Feature in
            var f = Feature(geometry: .point(Point(LocationCoordinate2D(latitude: c.lat, longitude: c.lng))))
            f.properties = [
                "label": .string(calloutLabel(for: c)),
                "warning": .number(warningActive ? 1 : 0),
            ]
                return f
            }
            try? mapView?.mapboxMap.style.updateGeoJSONSource(withId: "mission-callouts-source", geoJSON: .featureCollection(FeatureCollection(features: features)))
        } else {
            try? mapView?.mapboxMap.style.updateGeoJSONSource(withId: "mission-callouts-source", geoJSON: .featureCollection(FeatureCollection(features: [])))
        }
    }

    private func emitProgress(scene: MissionSceneModel, ratio: Double, markerDist: Double) {
        let progressCoords = downsample(progressRoute(ratio: ratio), max: progressMaxPoints)
        if progressCoords.count >= 2 {
            let coords = progressCoords.map { LocationCoordinate2D(latitude: $0[1], longitude: $0[0]) }
            let feature = Feature(geometry: .lineString(LineString(coords)))
            try? mapView?.mapboxMap.style.updateGeoJSONSource(withId: "mission-progress-route-source", geoJSON: .feature(feature))
        }
        let marker = pointAtDistance(dist: markerDist)
        var feature = Feature(geometry: .point(Point(LocationCoordinate2D(latitude: marker.lat, longitude: marker.lng))))
        feature.properties = ["warning": .number(warningActive ? 1 : 0)]
        try? mapView?.mapboxMap.style.updateGeoJSONSource(withId: "mission-marker-source", geoJSON: .feature(feature))
        delegate?.missionAnimator(self, debug: "overlay", details: ["scene_id": scene.id])
    }

    private func setCamera(center: MissionPoint, zoom: Double, pitch: Double, bearing: Double?, on mapView: MapView, animated: Bool = false, duration: Double = 0.05) {
        var options = CameraOptions(
            center: CLLocationCoordinate2D(latitude: center.lat, longitude: center.lng),
            padding: nil,
            zoom: max(cameraConfig.minZoom, min(cameraConfig.maxZoom, zoom)),
            bearing: bearing,
            pitch: pitch
        )
        if animated {
            mapView.camera.ease(to: options, duration: duration)
        } else {
            try? mapView.mapboxMap.setCamera(to: options)
        }
        lastCamPoint = center
        if let bearing { lastCamBearing = bearing }
    }

    private func updateProgressLineColor(warning: Bool) {
        guard let mapView, mapView.mapboxMap.style.layerExists(withId: "th-mission-progress-line") else { return }
        let color = warning ? UIColor(red: 0.96, green: 0.62, blue: 0.04, alpha: 1) : UIColor(red: 0.22, green: 0.88, blue: 1, alpha: 1)
        try? mapView.mapboxMap.style.updateLayer(withId: "th-mission-progress-line", type: LineLayer.self) { layer in
            layer.lineColor = .constant(StyleColor(color))
        }
    }

    // MARK: - Geometry helpers

    private func cumulativeDistances(route: [[Double]]) -> [Double] {
        var cum = [0.0]
        for i in 1..<route.count {
            cum.append(cum[i - 1] + haversine(a: route[i - 1], b: route[i]))
        }
        return cum
    }

    private func haversine(a: [Double], b: [Double]) -> Double {
        let R = 6371000.0
        let dLat = (b[1] - a[1]) * .pi / 180
        let dLng = (b[0] - a[0]) * .pi / 180
        let lat1 = a[1] * .pi / 180
        let lat2 = b[1] * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * R * asin(min(1, sqrt(h)))
    }

    private func pointAtDistance(dist: Double) -> MissionPoint {
        guard route.count >= 2, routeTotal > 0 else {
            return MissionPoint(lat: route.first?[1] ?? 0, lng: route.first?[0] ?? 0)
        }
        let d = max(0, min(routeTotal, dist))
        var i = 1
        while i < routeCum.count && routeCum[i] < d { i += 1 }
        let i0 = max(0, i - 1)
        let i1 = min(route.count - 1, i)
        let seg = routeCum[i1] - routeCum[i0]
        let f = seg > 0 ? (d - routeCum[i0]) / seg : 0
        return MissionPoint(
            lat: route[i0][1] + (route[i1][1] - route[i0][1]) * f,
            lng: route[i0][0] + (route[i1][0] - route[i0][0]) * f
        )
    }

    private func bearing(from: MissionPoint, to: MissionPoint) -> Double {
        let lat1 = from.lat * .pi / 180
        let lat2 = to.lat * .pi / 180
        let dLng = (to.lng - from.lng) * .pi / 180
        let y = sin(dLng) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
        return atan2(y, x) * 180 / .pi
    }

    private func smoothAngle(prev: Double?, target: Double, factor: Double) -> Double {
        guard let prev else { return target }
        let diff = ((target - prev + 540).truncatingRemainder(dividingBy: 360)) - 180
        return prev + diff * factor
    }

    private func sliceRoute(start: Double, end: Double) -> [[Double]] {
        guard route.count >= 2 else { return route }
        let s = max(0, min(1, start))
        let e = max(s, min(1, end))
        let si = Int(floor(s * Double(route.count - 1)))
        let ei = max(si + 1, Int(ceil(e * Double(route.count - 1))))
        return Array(route[si...min(route.count - 1, ei)])
    }

    private func progressRoute(ratio: Double) -> [[Double]] {
        guard route.count >= 2 else { return route }
        let r = max(0, min(1, ratio))
        let endIdx = max(1, Int(ceil(r * Double(route.count - 1))))
        return Array(route[0...min(route.count - 1, endIdx)])
    }

    private func downsample(_ coords: [[Double]], max: Int) -> [[Double]] {
        guard coords.count > max else { return coords }
        let step = Int(ceil(Double(coords.count) / Double(max)))
        var out: [[Double]] = []
        var i = 0
        while i < coords.count {
            out.append(coords[i])
            i += step
        }
        if out.last != coords.last { out.append(coords.last!) }
        return out
    }

    private func boundsFromCoords(_ coords: [[Double]]) -> (center: MissionPoint, span: Double)? {
        guard !coords.isEmpty else { return nil }
        let lats = coords.map { $0[1] }
        let lngs = coords.map { $0[0] }
        return (
            center: MissionPoint(lat: (lats.max()! + lats.min()!) / 2, lng: (lngs.max()! + lngs.min()!) / 2),
            span: max(lats.max()! - lats.min()!, lngs.max()! - lngs.min()!)
        )
    }

    private func lookaheadForSlice(start: Double, end: Double) -> Double {
        max(180, min(cameraConfig.lookaheadM, (end - start) * 0.05))
    }

    private func zoomForSliceLengthKm(_ km: Double, requested: Double?) -> Double {
        let base: Double
        if km > 140 { base = 11.4 }
        else if km > 70 { base = 12.2 }
        else if km > 35 { base = 12.9 }
        else if km > 15 { base = 13.4 }
        else { base = 14 }
        let zoom = requested ?? base
        return max(12.8, min(zoom, cameraConfig.maxZoom))
    }

    private func clampPitch(_ pitch: Double?) -> Double {
        max(58, min(68, pitch ?? cameraConfig.pitch))
    }

    private func calloutLabel(for callout: MissionSceneCallout) -> String {
        let kind = callout.kind.lowercased()
        if kind.contains("fuel") { return "F" }
        if kind.contains("camp") { return "C" }
        if kind.contains("warning") || kind.contains("risk") { return "!" }
        if kind.contains("trail") { return "T" }
        if kind.contains("scout") { return "S" }
        return String(callout.title.prefix(1)).uppercased()
    }

    private func doubleValue(_ value: Any?) -> Double? {
        if let v = value as? Double { return v }
        if let v = value as? NSNumber { return v.doubleValue }
        if let v = value as? String { return Double(v) }
        return nil
    }
}
