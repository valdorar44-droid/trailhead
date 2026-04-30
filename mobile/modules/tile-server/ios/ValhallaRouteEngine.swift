import Foundation
import Valhalla
import ValhallaConfigModels

final class ValhallaRouteEngine {
    static let shared = ValhallaRouteEngine()

    private var currentPackPath: String?
    private var currentEngine: Valhalla?
    private let lock = NSLock()

    func route(packPath: String, requestJson: String) throws -> String {
        lock.lock()
        defer { lock.unlock() }

        let engine = try engine(for: packPath)
        return engine.route(rawRequest: requestJson)
    }

    private func engine(for packPath: String) throws -> Valhalla {
        if currentPackPath == packPath, let currentEngine {
            return currentEngine
        }

        guard FileManager.default.fileExists(atPath: packPath) else {
            throw NSError(
                domain: "ValhallaRouteEngine",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "routing pack not found"]
            )
        }

        let url = URL(fileURLWithPath: packPath)
        let config = try ValhallaConfig(tileExtractTar: url)
        let engine = try Valhalla(config)
        currentPackPath = packPath
        currentEngine = engine
        return engine
    }
}
