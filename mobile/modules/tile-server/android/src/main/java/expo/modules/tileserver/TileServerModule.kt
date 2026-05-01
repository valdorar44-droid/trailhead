package expo.modules.tileserver

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TileServerModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("TileServerModule")

        AsyncFunction("startServer") {
            TileServer.start()
        }

        AsyncFunction("switchState") { path: String ->
            TileServer.switchState(path)
        }

        AsyncFunction("setBase") { path: String ->
            TileServer.setBase(path)
        }

        AsyncFunction("stopServer") {
            TileServer.stop()
        }

        AsyncFunction("isRunning") {
            TileServer.running
        }
    }
}
