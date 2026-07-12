import CoreLocation
import ExpoModulesCore
import QuartzCore
import Turf
@_spi(Experimental) import MapboxMaps
import UIKit

public class TrailheadMissionAnimatorModule: Module {
    private lazy var animator = NativeMissionAnimator { [weak self] event, payload in
        self?.sendEvent(event, payload)
    }

    private func runOnMain<T>(_ block: () -> T) -> T {
        if Thread.isMainThread {
            return block()
        }
        var result: T!
        DispatchQueue.main.sync {
            result = block()
        }
        return result
    }

    public func definition() -> ModuleDefinition {
        Name("TrailheadMissionAnimator")

        Events(
            "onMissionSceneStart",
            "onMissionSceneProgress",
            "onMissionSceneEnd",
            "onMissionComplete",
            "onMissionError",
            "onMissionDebug"
        )

        AsyncFunction("isAvailable") { () -> Bool in
            self.runOnMain { NativeMissionAnimator.findMapView() != nil }
        }

        AsyncFunction("getMissionAnimatorFeatureVersion") { () -> Int in
            3
        }

        AsyncFunction("prepareMissionAnimation") { (payload: [String: Any]) -> Bool in
            self.runOnMain { self.animator.prepare(payload: payload) }
        }

        AsyncFunction("startMissionAnimation") { (payload: [String: Any]?) -> Bool in
            self.runOnMain { self.animator.start(payload: payload) }
        }

        AsyncFunction("pauseMissionAnimation") { () -> Bool in
            self.runOnMain { self.animator.pause() }
        }

        AsyncFunction("resumeMissionAnimation") { () -> Bool in
            self.runOnMain { self.animator.resume() }
        }

        AsyncFunction("stopMissionAnimation") { () -> Bool in
            self.runOnMain { self.animator.stop() }
        }

        AsyncFunction("clearMissionAnimation") { () -> Bool in
            self.runOnMain { self.animator.clear() }
        }

        AsyncFunction("setMissionAnimationSpeed") { (speed: Double) -> Bool in
            self.runOnMain { self.animator.setSpeed(speed) }
        }

        AsyncFunction("setMissionAnimationCamera") { (camera: [String: Any]) -> Bool in
            self.runOnMain { self.animator.setCameraOptions(camera) }
        }

        AsyncFunction("seekMissionAnimation") { (ratio: Double) -> Bool in
            self.runOnMain { self.animator.seekTo(ratio) }
        }

        AsyncFunction("setMissionAnimationFreeCamera") { (enabled: Bool) -> Bool in
            self.runOnMain { self.animator.setFreeCamera(enabled) }
        }

        AsyncFunction("skipMissionAnimationScene") { () -> Bool in
            self.runOnMain { self.animator.skipScene() }
        }

        AsyncFunction("markMissionAnimationNarrationDone") { () -> Bool in
            self.runOnMain { self.animator.markNarrationDone() }
        }
    }
}

private typealias MissionEmit = (_ event: String, _ payload: [String: Any]) -> Void

private struct MissionSceneModel {
    let id: String
    let type: String
    let durationMs: Double
    let routeSliceStart: Double
    let routeSliceEnd: Double
    let focusLat: Double?
    let focusLng: Double?
    let cameraMode: String
    let cameraZoom: Double?
    let cameraPitch: Double?
    let cameraBearing: Double?
    let cameraOrbitSweep: Double?
    let cameraOrbitDirection: String?
    let warning: Bool
    let pacingKind: String?
    let pacingMinDurationMs: Double?
    let pacingMaxDurationMs: Double?
    let pacingGroundSpeedMpsCap: Double?
}

private struct MissionPoint { var lat: Double; var lng: Double }

private final class NativeMissionAnimator: NSObject {
    private let emit: MissionEmit
    private weak var mapView: MapView?
    private var styleCancelables = Set<AnyCancelable>()
    private var displayLink: CADisplayLink?
    private var route: [[Double]] = []
    private var routeCum: [Double] = []
    private var routeTotal: Double = 0
    private var scenes: [MissionSceneModel] = []
    private var speed: Double = 1
    private var playing = false
    private var paused = false
    private var sceneIndex = -1
    private var sceneStartTs: CFTimeInterval = 0
    private var pausedTotal: CFTimeInterval = 0
    private var pauseStartedTs: CFTimeInterval = 0
    private var sceneDuration: CFTimeInterval = 7
    private var smoothedBearing: Double?
    private var lastCamDist: Double?
    private var lastCamBearing: Double?
    private var orbitBaseBearing: Double = 0
    private var lastProgressEmit: CFTimeInterval = 0
    private var warningActive = false
    private var freeCamera = false
    private var narrationDone = true
    private let narrationCap: CFTimeInterval = 11
    private var cameraPitch: Double = 58
    private var minZoom: Double = 10.3
    private var maxZoom: Double = 15.2
    private var lookaheadM: Double = 280

    init(emit: @escaping MissionEmit) { self.emit = emit }

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
        attachMapIfNeeded()
        installLayers()
        return mapView != nil
    }

    func start(payload: [String: Any]?) -> Bool {
        if let payload, !parsePayload(payload) {
            emit("onMissionError", ["message": "Invalid mission payload", "code": "invalid_payload"])
            return false
        }
        attachMapIfNeeded()
        guard mapView != nil else {
            emit("onMissionError", ["message": "MapView not found", "code": "no_map"])
            return false
        }
        resetPlaybackContinuity()
        installLayers()
        clearOverlays()
        updateFullRoute()
        playing = true
        paused = false
        sceneIndex = -1
        pausedTotal = 0
        startDisplayLink()
        advanceScene()
        return true
    }

    private func resetPlaybackContinuity() {
        smoothedBearing = nil
        lastCamDist = nil
        lastCamBearing = nil
        orbitBaseBearing = 0
        lastProgressEmit = 0
        warningActive = false
        freeCamera = false
        narrationDone = true
    }

    func pause() -> Bool {
        guard playing, !paused else { return false }
        paused = true
        pauseStartedTs = CACurrentMediaTime()
        displayLink?.isPaused = true
        return true
    }
    func resume() -> Bool {
        guard playing, paused else { return false }
        paused = false
        pausedTotal += CACurrentMediaTime() - pauseStartedTs
        displayLink?.isPaused = false
        return true
    }
    func stop() -> Bool { playing = false; paused = false; stopDisplayLink(); clearOverlays(); return true }
    func clear() -> Bool { _ = stop(); route = []; scenes = []; return true }
    func setSpeed(_ next: Double) -> Bool {
        speed = max(0.1, min(3, next))
        guard sceneIndex >= 0, sceneIndex < scenes.count else { return true }
        let scene = scenes[sceneIndex]
        let elapsed = CACurrentMediaTime() - sceneStartTs - pausedTotal
        let oldDuration = max(0.001, sceneDuration)
        let progress = max(0, min(1, elapsed / oldDuration))
        sceneDuration = computeSceneDuration(scene)
        sceneStartTs = CACurrentMediaTime() - (progress * sceneDuration) - pausedTotal
        return true
    }

    func setCameraOptions(_ camera: [String: Any]) -> Bool {
        cameraPitch = max(42, min(70, doubleValue(camera["pitch"]) ?? cameraPitch))
        minZoom = max(4, min(16, doubleValue(camera["minZoom"]) ?? minZoom))
        maxZoom = max(5, min(17, doubleValue(camera["maxZoom"]) ?? maxZoom))
        lookaheadM = max(120, min(1200, doubleValue(camera["lookaheadM"]) ?? lookaheadM))
        return true
    }

    func setFreeCamera(_ enabled: Bool) -> Bool {
        freeCamera = enabled
        return true
    }

    func seekTo(_ ratio: Double) -> Bool {
        guard route.count >= 2, !scenes.isEmpty else { return false }
        attachMapIfNeeded()
        guard mapView != nil else { return false }
        let clamped = max(0, min(1, ratio))
        let nextIndex = sceneIndexForProgress(clamped)
        guard nextIndex >= 0, nextIndex < scenes.count else { return false }
        let scene = scenes[nextIndex]
        let span = max(0.001, scene.routeSliceEnd - scene.routeSliceStart)
        let localT = max(0, min(1, (clamped - scene.routeSliceStart) / span))
        sceneIndex = nextIndex
        sceneDuration = computeSceneDuration(scene)
        sceneStartTs = CACurrentMediaTime() - (localT * sceneDuration)
        pausedTotal = 0
        pauseStartedTs = CACurrentMediaTime()
        paused = true
        playing = true
        narrationDone = true
        displayLink?.isPaused = true
        warningActive = scene.warning
        if scene.cameraMode == "follow" {
            tickFollow(scene: scene, t: localT)
        } else if scene.cameraMode == "fit", let lat = scene.focusLat, let lng = scene.focusLng {
            setCamera(MissionPoint(lat: lat, lng: lng), zoom: scene.cameraZoom ?? 12, pitch: scene.cameraPitch ?? 54, bearing: nil, animated: true)
            updateProgress(clamped, markerDist: routeTotal * clamped)
        } else {
            updateProgress(clamped, markerDist: routeTotal * clamped)
        }
        emit("onMissionSceneStart", ["sceneId": scene.id, "index": sceneIndex, "type": scene.type])
        emit("onMissionSceneProgress", ["sceneId": scene.id, "index": sceneIndex, "progress": clamped, "localProgress": localT])
        emit("onMissionDebug", ["kind": "seek", "details": ["ratio": clamped, "scene_id": scene.id]])
        return true
    }

    func skipScene() -> Bool {
        guard playing, sceneIndex >= 0, sceneIndex < scenes.count else { return false }
        narrationDone = true
        finishScene(scenes[sceneIndex])
        return true
    }

    func markNarrationDone() -> Bool {
        narrationDone = true
        return true
    }

    private func attachMapIfNeeded() {
        guard mapView == nil, let found = Self.findMapView() else { return }
        mapView = found
        found.mapboxMap.onStyleLoaded.observe { [weak self] _ in
            self?.installLayers()
            self?.updateFullRoute()
        }.store(in: &styleCancelables)
    }

    private func parsePayload(_ payload: [String: Any]) -> Bool {
        guard let rawRoute = payload["route"] as? [[Any]], rawRoute.count >= 2 else { return false }
        route = rawRoute.compactMap { pair -> [Double]? in
            guard pair.count >= 2, let lng = doubleValue(pair[0]), let lat = doubleValue(pair[1]) else { return nil }
            return [lng, lat]
        }
        guard route.count >= 2 else { return false }
        routeCum = cumulativeDistances(route)
        routeTotal = routeCum.last ?? 0
        speed = max(0.1, min(3, doubleValue(payload["speed"]) ?? 1))
        if let camera = payload["camera"] as? [String: Any] {
            _ = setCameraOptions(camera)
        }
        guard let rawScenes = payload["scenes"] as? [[String: Any]], !rawScenes.isEmpty else { return false }
        scenes = rawScenes.compactMap { raw in
            guard let id = raw["id"] as? String, let type = raw["type"] as? String else { return nil }
            let slice = raw["routeSlice"] as? [Any]
            let start = slice.flatMap { $0.count > 0 ? doubleValue($0[0]) : nil } ?? 0
            let end = slice.flatMap { $0.count > 1 ? doubleValue($0[1]) : nil } ?? 1
            let focus = raw["focus"] as? [String: Any]
            let cam = raw["camera"] as? [String: Any] ?? [:]
            let orbit = cam["orbit"] as? [String: Any]
            let layers = raw["layers"] as? [String: Any] ?? [:]
            let pacing = raw["pacing"] as? [String: Any] ?? [:]
            let warning = (layers["warning"] as? Bool) == true
            let sweep = doubleValue(orbit?["sweepDeg"]).map { max(30, min(360, $0)) }
            return MissionSceneModel(
                id: id, type: type, durationMs: doubleValue(raw["durationMs"]) ?? 12000,
                routeSliceStart: start, routeSliceEnd: max(start, end),
                focusLat: doubleValue(focus?["lat"]), focusLng: doubleValue(focus?["lng"]),
                cameraMode: cam["mode"] as? String ?? "follow",
                cameraZoom: doubleValue(cam["zoom"]), cameraPitch: doubleValue(cam["pitch"]),
                cameraBearing: doubleValue(cam["bearing"]),
                cameraOrbitSweep: sweep,
                cameraOrbitDirection: orbit?["direction"] as? String,
                warning: warning,
                pacingKind: pacing["kind"] as? String,
                pacingMinDurationMs: doubleValue(pacing["minDurationMs"]),
                pacingMaxDurationMs: doubleValue(pacing["maxDurationMs"]),
                pacingGroundSpeedMpsCap: doubleValue(pacing["groundSpeedMpsCap"])
            )
        }
        return !scenes.isEmpty
    }

    private func scenePacingKind(_ scene: MissionSceneModel) -> String {
        if let kind = scene.pacingKind, !kind.isEmpty { return kind }
        if scene.type == "route_rejoin" { return "rejoin" }
        if scene.cameraMode == "orbit" { return "scenic_orbit" }
        if scene.cameraMode == "follow" || scene.type == "drive_leg" || scene.type == "day_flyover" { return "route_leg" }
        return "context"
    }

    private func pacingDefaults(_ kind: String) -> (minMs: Double, maxMs: Double, groundSpeedMpsCap: Double?) {
        switch kind {
        case "scenic_orbit": return (14_000, 24_000, nil)
        case "scenic_low_pass": return (10_000, 18_000, nil)
        case "route_leg": return (10_000, 30_000, 12_000)
        case "rejoin": return (3_600, 6_500, nil)
        default: return (6_000, 14_000, nil)
        }
    }

    private func sceneRouteDistanceM(_ scene: MissionSceneModel) -> Double {
        let start = max(0, min(1, scene.routeSliceStart))
        let end = max(start, min(1, scene.routeSliceEnd))
        return max(0, (end - start) * routeTotal)
    }

    private func computeSceneDuration(_ scene: MissionSceneModel) -> Double {
        let defaults = pacingDefaults(scenePacingKind(scene))
        let minMs = max(1500, scene.pacingMinDurationMs ?? defaults.minMs)
        let maxMs = max(minMs, scene.pacingMaxDurationMs ?? defaults.maxMs)
        var base = max(scene.durationMs, minMs)
        let cap = scene.pacingGroundSpeedMpsCap ?? defaults.groundSpeedMpsCap
        var groundSpeedFloorMs = 0.0
        if let cap, cap > 0, routeTotal > 0 {
            groundSpeedFloorMs = (sceneRouteDistanceM(scene) / cap) * 1000
        }
        let clamped = max(minMs, min(maxMs, base))
        return max(1.5, max(clamped, groundSpeedFloorMs) / 1000 / max(0.1, speed))
    }

    private func installLayers() {
        guard let mapView else { return }
        let style = mapView.mapboxMap.style
        for id in ["mission-full-route-source", "mission-progress-route-source", "mission-marker-source"] where !style.sourceExists(withId: id) {
            var source = GeoJSONSource(id: id)
            source.data = .featureCollection(FeatureCollection(features: []))
            try? style.addSource(source)
        }
        if !style.layerExists(withId: "th-mission-full-line") {
            var layer = LineLayer(id: "th-mission-full-line", source: "mission-full-route-source")
            layer.lineColor = .constant(StyleColor(UIColor(white: 0.9, alpha: 0.85)))
            layer.lineWidth = .constant(4.5)
            layer.lineCap = .constant(.round)
            layer.lineJoin = .constant(.round)
            try? style.addLayer(layer)
        }
        if !style.layerExists(withId: "th-mission-progress-line") {
            var layer = LineLayer(id: "th-mission-progress-line", source: "mission-progress-route-source")
            layer.lineColor = .constant(StyleColor(UIColor(red: 0.22, green: 0.88, blue: 1, alpha: 1)))
            layer.lineWidth = .constant(6.5)
            layer.lineCap = .constant(.round)
            layer.lineJoin = .constant(.round)
            try? style.addLayer(layer)
        }
        if !style.layerExists(withId: "th-mission-marker-dot") {
            var layer = CircleLayer(id: "th-mission-marker-dot", source: "mission-marker-source")
            layer.circleRadius = .constant(7)
            layer.circleColor = .constant(StyleColor(UIColor(red: 0, green: 0.65, blue: 1, alpha: 1)))
            layer.circleStrokeColor = .constant(StyleColor(.white))
            layer.circleStrokeWidth = .constant(2.5)
            try? style.addLayer(layer)
        }
    }

    private func updateFullRoute() {
        guard route.count >= 2, let mapView else { return }
        let coords = route.map { LocationCoordinate2D(latitude: $0[1], longitude: $0[0]) }
        let feature = Feature(geometry: .lineString(LineString(coords)))
        try? mapView.mapboxMap.style.updateGeoJSONSource(withId: "mission-full-route-source", geoJSON: .feature(feature))
    }

    private func clearOverlays() {
        guard let mapView else { return }
        let empty = GeoJSONObject.featureCollection(FeatureCollection(features: []))
        let style = mapView.mapboxMap.style
        for id in ["mission-progress-route-source", "mission-marker-source"] {
            try? style.updateGeoJSONSource(withId: id, geoJSON: empty)
        }
    }

    private func startDisplayLink() {
        stopDisplayLink()
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    private func stopDisplayLink() { displayLink?.invalidate(); displayLink = nil }

    @objc private func tick(_ link: CADisplayLink) {
        guard playing, !paused, sceneIndex >= 0, sceneIndex < scenes.count else { return }
        let scene = scenes[sceneIndex]
        let elapsed = CACurrentMediaTime() - sceneStartTs - pausedTotal
        let t = max(0, min(1, elapsed / max(0.001, sceneDuration)))
        if elapsed >= sceneDuration {
            if !narrationDone && elapsed < sceneDuration + narrationCap {
                updateProgress(1, markerDist: routeTotal * scene.routeSliceEnd)
                return
            }
            finishScene(scene)
            return
        }
        if scene.cameraMode == "follow", routeTotal > 0 {
            tickFollow(scene: scene, t: t)
        } else if scene.cameraMode == "orbit" {
            tickOrbit(scene: scene, t: t)
        }
        if CACurrentMediaTime() - lastProgressEmit >= 0.5 {
            lastProgressEmit = CACurrentMediaTime()
            let routeProgress = max(0, min(1, scene.routeSliceStart + (scene.routeSliceEnd - scene.routeSliceStart) * t))
            emit("onMissionSceneProgress", ["sceneId": scene.id, "index": sceneIndex, "progress": routeProgress, "localProgress": t])
        }
    }

    private func advanceScene() {
        sceneIndex += 1
        guard sceneIndex < scenes.count else {
            playing = false
            stopDisplayLink()
            emit("onMissionComplete", [:])
            return
        }
        let scene = scenes[sceneIndex]
        narrationDone = false
        sceneStartTs = CACurrentMediaTime()
        pausedTotal = 0
        sceneDuration = computeSceneDuration(scene)
        warningActive = scene.warning
        emit("onMissionSceneStart", ["sceneId": scene.id, "index": sceneIndex, "type": scene.type])
        orbitBaseBearing = scene.cameraBearing ?? lastCamBearing ?? 0
        if scene.cameraMode == "fit", let lat = scene.focusLat, let lng = scene.focusLng {
            setCamera(MissionPoint(lat: lat, lng: lng), zoom: scene.cameraZoom ?? 12, pitch: scene.cameraPitch ?? 54, bearing: nil, animated: true)
        } else if scene.cameraMode == "orbit", let lat = scene.focusLat, let lng = scene.focusLng {
            setCamera(MissionPoint(lat: lat, lng: lng), zoom: scene.cameraZoom ?? 12.8, pitch: scene.cameraPitch ?? 66, bearing: orbitBaseBearing, animated: true)
        }
    }

    private func finishScene(_ scene: MissionSceneModel) {
        emit("onMissionSceneEnd", ["sceneId": scene.id, "index": sceneIndex])
        advanceScene()
    }

    private func tickFollow(scene: MissionSceneModel, t: Double) {
        let startDist = routeTotal * scene.routeSliceStart
        let endDist = routeTotal * scene.routeSliceEnd
        let lookahead = max(120, min(lookaheadM, (endDist - startDist) * 0.05))
        let d = startDist + (endDist - startDist) * t
        let camDist = lastCamDist.map { max($0, min(routeTotal, d + lookahead)) } ?? min(routeTotal, d + lookahead)
        lastCamDist = camDist
        let camPt = pointAtDistance(camDist)
        let aheadPt = pointAtDistance(min(routeTotal, camDist + lookahead))
        let targetBearing = bearing(from: camPt, to: aheadPt)
        smoothedBearing = smoothAngle(smoothedBearing, target: targetBearing, factor: 0.16)
        let zoom = max(minZoom, min(scene.cameraZoom ?? maxZoom - 0.45, maxZoom))
        setCamera(camPt, zoom: zoom, pitch: scene.cameraPitch ?? cameraPitch, bearing: smoothedBearing, animated: false)
        lastCamBearing = smoothedBearing ?? targetBearing
        updateProgress(d / max(routeTotal, 1), markerDist: d)
        emit("onMissionDebug", ["kind": "camera", "details": ["scene_id": scene.id]])
    }

    private func tickOrbit(scene: MissionSceneModel, t: Double) {
        guard let lat = scene.focusLat, let lng = scene.focusLng else { return }
        let direction = scene.cameraOrbitDirection == "ccw" ? -1.0 : 1.0
        let bearing = orbitBaseBearing + (scene.cameraOrbitSweep ?? 120) * direction * t
        setCamera(
            MissionPoint(lat: lat, lng: lng),
            zoom: min(scene.cameraZoom ?? 12.8, maxZoom),
            pitch: scene.cameraPitch ?? 66,
            bearing: bearing,
            animated: false
        )
        lastCamDist = nil
        lastCamBearing = bearing
        updateProgress(scene.routeSliceStart, markerDist: routeTotal * scene.routeSliceStart)
        emit("onMissionDebug", ["kind": "camera", "details": ["scene_id": scene.id]])
    }

    private func updateProgress(_ ratio: Double, markerDist: Double) {
        guard let mapView else { return }
        let style = mapView.mapboxMap.style
        let endIdx = max(1, Int(ceil(ratio * Double(route.count - 1))))
        let slice = route[0...min(route.count - 1, endIdx)]
        let coords = slice.map { LocationCoordinate2D(latitude: $0[1], longitude: $0[0]) }
        if coords.count >= 2 {
            let feature = Feature(geometry: .lineString(LineString(coords)))
            try? style.updateGeoJSONSource(withId: "mission-progress-route-source", geoJSON: .feature(feature))
        }
        let marker = pointAtDistance(markerDist)
        let mFeature = Feature(geometry: .point(Point(LocationCoordinate2D(latitude: marker.lat, longitude: marker.lng))))
        try? style.updateGeoJSONSource(withId: "mission-marker-source", geoJSON: .feature(mFeature))
        emit("onMissionDebug", ["kind": "overlay", "details": [:]])
    }

    private func setCamera(_ center: MissionPoint, zoom: Double, pitch: Double, bearing: Double?, animated: Bool) {
        guard let mapView else { return }
        if freeCamera { return }
        let options = CameraOptions(center: CLLocationCoordinate2D(latitude: center.lat, longitude: center.lng), zoom: zoom, bearing: bearing, pitch: pitch)
        if animated {
            mapView.camera.ease(to: options, duration: 1.8, curve: .easeInOut) { _ in }
        } else { try? mapView.mapboxMap.setCamera(to: options) }
        if let bearing { lastCamBearing = bearing }
    }

    private func cumulativeDistances(_ route: [[Double]]) -> [Double] {
        var cum = [0.0]
        for i in 1..<route.count { cum.append(cum[i - 1] + haversine(route[i - 1], route[i])) }
        return cum
    }

    private func haversine(_ a: [Double], _ b: [Double]) -> Double {
        let R = 6371000.0
        let dLat = (b[1] - a[1]) * .pi / 180, dLng = (b[0] - a[0]) * .pi / 180
        let lat1 = a[1] * .pi / 180, lat2 = b[1] * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * R * asin(min(1, sqrt(h)))
    }

    private func pointAtDistance(_ dist: Double) -> MissionPoint {
        guard route.count >= 2, routeTotal > 0 else { return MissionPoint(lat: route.first?[1] ?? 0, lng: route.first?[0] ?? 0) }
        let d = max(0, min(routeTotal, dist))
        var i = 1; while i < routeCum.count && routeCum[i] < d { i += 1 }
        let i0 = max(0, i - 1), i1 = min(route.count - 1, i)
        let seg = routeCum[i1] - routeCum[i0], f = seg > 0 ? (d - routeCum[i0]) / seg : 0
        return MissionPoint(lat: route[i0][1] + (route[i1][1] - route[i0][1]) * f, lng: route[i0][0] + (route[i1][0] - route[i0][0]) * f)
    }

    private func bearing(from: MissionPoint, to: MissionPoint) -> Double {
        let lat1 = from.lat * .pi / 180, lat2 = to.lat * .pi / 180, dLng = (to.lng - from.lng) * .pi / 180
        let y = sin(dLng) * cos(lat2), x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLng)
        return atan2(y, x) * 180 / .pi
    }

    private func smoothAngle(_ prev: Double?, target: Double, factor: Double) -> Double {
        guard let prev else { return target }
        let diff = ((target - prev + 540).truncatingRemainder(dividingBy: 360)) - 180
        return prev + diff * factor
    }

    private func sceneIndexForProgress(_ ratio: Double) -> Int {
        let clamped = max(0, min(1, ratio))
        var fallback = 0
        for i in scenes.indices {
            let scene = scenes[i]
            let a = min(scene.routeSliceStart, scene.routeSliceEnd)
            let b = max(scene.routeSliceStart, scene.routeSliceEnd)
            if clamped >= a - 0.001 && clamped <= b + 0.001 {
                if scene.cameraMode == "follow" || scene.type.contains("day") || scene.type.contains("drive") {
                    return i
                }
                fallback = i
            }
        }
        return clamped >= 0.97 ? max(0, scenes.count - 1) : fallback
    }

    private func doubleValue(_ value: Any?) -> Double? {
        if let v = value as? Double { return v }
        if let v = value as? NSNumber { return v.doubleValue }
        if let v = value as? String { return Double(v) }
        return nil
    }
}
