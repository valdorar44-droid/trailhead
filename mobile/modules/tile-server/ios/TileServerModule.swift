import ExpoModulesCore

public class TileServerModule: Module {
    public func definition() -> ModuleDefinition {
        Name("TileServerModule")

        // Start the HTTP server (call once on app launch).
        AsyncFunction("startServer") { (promise: Promise) in
            do {
                try TileServer.shared.start()
                promise.resolve(nil)
            } catch {
                promise.reject("ERR_TILE_SERVER", error.localizedDescription)
            }
        }

        // Swap the active state file without restarting the socket.
        AsyncFunction("switchState") { (path: String, promise: Promise) in
            do {
                try TileServer.shared.switchState(path: path)
                promise.resolve(nil)
            } catch {
                promise.reject("ERR_TILE_SERVER", error.localizedDescription)
            }
        }

        // Load the base (z0–z9 US) file. Called once; survives state switches.
        AsyncFunction("setBase") { (path: String, promise: Promise) in
            do {
                try TileServer.shared.setBase(path: path)
                promise.resolve(nil)
            } catch {
                promise.reject("ERR_TILE_SERVER", error.localizedDescription)
            }
        }

        AsyncFunction("stopServer") { (promise: Promise) in
            TileServer.shared.stop()
            promise.resolve(nil)
        }

        AsyncFunction("isRunning") { (promise: Promise) in
            promise.resolve(TileServer.shared.running)
        }

        AsyncFunction("routeValhalla") { (packPath: String, requestJson: String, promise: Promise) in
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    let json = try ValhallaRouteEngine.shared.route(packPath: packPath, requestJson: requestJson)
                    promise.resolve(json)
                } catch {
                    promise.reject("ERR_VALHALLA_ROUTE", error.localizedDescription)
                }
            }
        }
    }
}
