import ExpoModulesCore
import Foundation

public class TrailheadNavigationModule: Module {
    public func definition() -> ModuleDefinition {
        Name("TrailheadNavigationModule")
        Events("onNavigationState")

        AsyncFunction("startSession") { (routeCoords: [[Double]], follow: Bool, promise: Promise) in
            let state = TrailheadNavigationEngine.shared.start(routeCoords: routeCoords, follow: follow)
            self.sendEvent("onNavigationState", state)
            promise.resolve(state)
        }

        AsyncFunction("stopSession") { (promise: Promise) in
            let state = TrailheadNavigationEngine.shared.stop()
            self.sendEvent("onNavigationState", state)
            promise.resolve(state)
        }

        AsyncFunction("setFollow") { (enabled: Bool, promise: Promise) in
            let state = TrailheadNavigationEngine.shared.setFollow(enabled)
            self.sendEvent("onNavigationState", state)
            promise.resolve(state)
        }

        AsyncFunction("updateLocation") { (lat: Double, lng: Double, accuracy: Double?, speed: Double?, heading: Double?, promise: Promise) in
            let state = TrailheadNavigationEngine.shared.updateLocation(lat: lat, lng: lng, accuracy: accuracy, speed: speed, heading: heading)
            self.sendEvent("onNavigationState", state)
            promise.resolve(state)
        }

        AsyncFunction("getSnapshot") { (promise: Promise) in
            promise.resolve(TrailheadNavigationEngine.shared.currentSnapshot())
        }
    }
}
