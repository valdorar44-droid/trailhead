package expo.modules.tileserver

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TileServerModule : Module() {
    override fun definition() = ModuleDefinition {
        Name("TileServerModule")

        AsyncFunction("startServer") { path: String ->
            TileServer.start(path)
        }

        AsyncFunction("stopServer") {
            TileServer.stop()
        }

        AsyncFunction("isRunning") {
            TileServer.running
        }
    }
}
