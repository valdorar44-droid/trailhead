import ExpoModulesCore

public class TrailheadMissionAnimatorModule: Module {
    private lazy var animator: TrailheadMissionAnimator = {
        TrailheadMissionAnimator { [weak self] event, payload in
            self?.sendEvent(event, payload)
        }
    }()

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
