import AVFoundation
import ExpoModulesCore

public class AudioRouteModule: Module {
    public func definition() -> ModuleDefinition {
        Name("AudioRouteModule")

        AsyncFunction("setSpeakerphoneEnabled") { (enabled: Bool, promise: Promise) in
            DispatchQueue.main.async {
                do {
                    let session = AVAudioSession.sharedInstance()
                    if enabled {
                        try session.setCategory(
                            .playAndRecord,
                            mode: .voiceChat,
                            options: [.defaultToSpeaker, .allowBluetooth, .allowBluetoothA2DP, .duckOthers]
                        )
                        try session.setActive(true)
                        try session.overrideOutputAudioPort(.speaker)
                    } else {
                        try session.overrideOutputAudioPort(.none)
                    }
                    promise.resolve(true)
                } catch {
                    promise.reject("ERR_AUDIO_ROUTE", error.localizedDescription)
                }
            }
        }
    }
}
