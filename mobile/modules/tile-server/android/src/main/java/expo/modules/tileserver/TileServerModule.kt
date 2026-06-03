package expo.modules.tileserver

import android.content.pm.PackageManager
import android.os.Build
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

        AsyncFunction("setContours") { path: String ->
            TileServer.setContours(path)
        }

        AsyncFunction("clearContours") {
            TileServer.clearContours()
        }

        AsyncFunction("setTrails") { path: String ->
            TileServer.setTrails(path)
        }

        AsyncFunction("clearTrails") {
            TileServer.clearTrails()
        }

        AsyncFunction("stopServer") {
            TileServer.stop()
        }

        AsyncFunction("isRunning") {
            TileServer.running
        }

        AsyncFunction("getExtremeMapboxCapabilities") {
            val context = appContext.reactContext
            val pm = context?.packageManager
            val vulkanVersion = pm
                ?.systemAvailableFeatures
                ?.firstOrNull { it.name == PackageManager.FEATURE_VULKAN_HARDWARE_VERSION }
                ?.version ?: 0
            val minVulkan11 = (1 shl 22) or (1 shl 12)
            val isAndroid12 = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            val isArm64 = Build.SUPPORTED_64_BIT_ABIS.any { it == "arm64-v8a" }
            val hasVulkan11 = vulkanVersion >= minVulkan11
            val supported = isAndroid12 && isArm64 && hasVulkan11
            val reason = when {
                !isAndroid12 -> "android_12_required"
                !isArm64 -> "arm64_required"
                !hasVulkan11 -> "vulkan_1_1_required"
                else -> "supported"
            }

            mapOf(
                "supported" to supported,
                "renderer" to if (supported) "vulkan" else "opengl",
                "reason" to reason,
                "androidApi" to Build.VERSION.SDK_INT,
                "androidVulkanVersion" to vulkanVersion,
                "androidArm64" to isArm64
            )
        }
    }
}
