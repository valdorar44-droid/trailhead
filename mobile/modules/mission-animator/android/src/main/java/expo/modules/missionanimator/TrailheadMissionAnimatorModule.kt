package expo.modules.missionanimator

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class TrailheadMissionAnimatorModule : Module() {
  private val animator by lazy {
    TrailheadMissionAnimator { event, payload ->
      sendEvent(event, payload)
    }
  }

  override fun definition() = ModuleDefinition {
    Name("TrailheadMissionAnimator")

    Events(
      "onMissionSceneStart",
      "onMissionSceneProgress",
      "onMissionSceneEnd",
      "onMissionComplete",
      "onMissionError",
      "onMissionDebug",
    )

    AsyncFunction("isAvailable") {
      animator.findMapView() != null
    }

    AsyncFunction("getMissionAnimatorFeatureVersion") {
      3
    }

    AsyncFunction("prepareMissionAnimation") { payload: Map<String, Any?> ->
      animator.prepare(payload)
    }

    AsyncFunction("startMissionAnimation") { payload: Map<String, Any?>? ->
      animator.start(payload)
    }

    AsyncFunction("pauseMissionAnimation") {
      animator.pause()
    }

    AsyncFunction("resumeMissionAnimation") {
      animator.resume()
    }

    AsyncFunction("stopMissionAnimation") {
      animator.stop()
    }

    AsyncFunction("clearMissionAnimation") {
      animator.clear()
    }

    AsyncFunction("setMissionAnimationSpeed") { speed: Double ->
      animator.setSpeed(speed)
    }

    AsyncFunction("setMissionAnimationCamera") { camera: Map<String, Any?> ->
      animator.setCameraOptions(camera)
    }

    AsyncFunction("seekMissionAnimation") { ratio: Double ->
      animator.seekTo(ratio)
    }

    AsyncFunction("setMissionAnimationFreeCamera") { enabled: Boolean ->
      animator.setFreeCamera(enabled)
    }

    AsyncFunction("skipMissionAnimationScene") {
      animator.skipScene()
    }

    AsyncFunction("markMissionAnimationNarrationDone") {
      animator.markNarrationDone()
    }
  }
}
