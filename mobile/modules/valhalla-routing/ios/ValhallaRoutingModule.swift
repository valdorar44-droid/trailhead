import ExpoModulesCore
import Foundation

public class ValhallaRoutingModule: Module {
    public func definition() -> ModuleDefinition {
        Name("ValhallaRoutingModule")

        AsyncFunction("route") { (packPath: String, requestJson: String, promise: Promise) in
            ValhallaRouter.shared.route(packPath: packPath, requestJson: requestJson) { result in
                switch result {
                case .success(let json):
                    promise.resolve(json)
                case .failure(let error):
                    promise.reject("ERR_VALHALLA_ROUTE", error.localizedDescription)
                }
            }
        }

        AsyncFunction("diagnose") { (packPath: String, requestJson: String, promise: Promise) in
            ValhallaRouter.shared.diagnose(packPath: packPath, requestJson: requestJson) { result in
                promise.resolve(result)
            }
        }

        AsyncFunction("routeTrailGraph") { (graphPath: String, requestJson: String, promise: Promise) in
            TrailRouteGraphRouter.shared.route(graphPath: graphPath, requestJson: requestJson) { result in
                switch result {
                case .success(let json):
                    promise.resolve(json)
                case .failure(let error):
                    promise.reject("ERR_TRAIL_ROUTE_GRAPH", error.localizedDescription)
                }
            }
        }
    }
}
