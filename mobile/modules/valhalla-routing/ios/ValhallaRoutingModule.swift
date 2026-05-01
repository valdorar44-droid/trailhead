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
    }
}
