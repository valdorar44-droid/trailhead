import ExpoModulesCore

public class TrailheadMissionAnimatorModule: Module {
    private let animator = TrailheadMissionAnimator()

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

        OnCreate {
            self.animator.delegate = self
        }

        AsyncFunction("isAvailable") { () -> Bool in
            TrailheadMissionAnimator.canImportMapbox() && TrailheadMissionAnimator.findMapView() != nil
        }

        AsyncFunction("prepareMissionAnimation") { (payload: [String: Any]) -> Bool in
            DispatchQueue.main.sync {
                self.animator.prepare(payload: payload)
            }
        }

        AsyncFunction("startMissionAnimation") { (payload: [String: Any]?) -> Bool in
            var ok = false
            DispatchQueue.main.sync {
                ok = self.animator.start(payload: payload)
            }
            return ok
        }

        AsyncFunction("pauseMissionAnimation") { () -> Bool in
            DispatchQueue.main.sync { self.animator.pause() }
        }

        AsyncFunction("resumeMissionAnimation") { () -> Bool in
            DispatchQueue.main.sync { self.animator.resume() }
        }

        AsyncFunction("stopMissionAnimation") { () -> Bool in
            DispatchQueue.main.sync { self.animator.stop() }
        }

        AsyncFunction("clearMissionAnimation") { () -> Bool in
            DispatchQueue.main.sync { self.animator.clear() }
        }

        AsyncFunction("setMissionAnimationSpeed") { (speed: Double) -> Bool in
            DispatchQueue.main.sync { self.animator.setSpeed(speed) }
        }
    }
}

extension TrailheadMissionAnimatorModule: TrailheadMissionAnimatorDelegate {
    func missionAnimator(_ animator: TrailheadMissionAnimator, sceneStart sceneId: String, index: Int, type: String) {
        sendEvent("onMissionSceneStart", [
            "sceneId": sceneId,
            "index": index,
            "type": type,
        ])
    }

    func missionAnimator(_ animator: TrailheadMissionAnimator, sceneProgress sceneId: String, index: Int, progress: Double) {
        sendEvent("onMissionSceneProgress", [
            "sceneId": sceneId,
            "index": index,
            "progress": progress,
        ])
    }

    func missionAnimator(_ animator: TrailheadMissionAnimator, sceneEnd sceneId: String, index: Int) {
        sendEvent("onMissionSceneEnd", [
            "sceneId": sceneId,
            "index": index,
        ])
    }

    func missionAnimatorComplete(_ animator: TrailheadMissionAnimator) {
        sendEvent("onMissionComplete", [:])
    }

    func missionAnimator(_ animator: TrailheadMissionAnimator, error message: String, code: String?) {
        var payload: [String: Any] = ["message": message]
        if let code { payload["code"] = code }
        sendEvent("onMissionError", payload)
    }

    func missionAnimator(_ animator: TrailheadMissionAnimator, debug kind: String, details: [String: Any]) {
        sendEvent("onMissionDebug", [
            "kind": kind,
            "details": details,
        ])
    }
}
