import Foundation

private enum ValhallaRouterError: LocalizedError {
    case missingPack(String)
    case missingResource(String)
    case invalidDefaultConfig
    case configWriteFailed(String)
    case engineInitFailed(String)
    case emptyResponse

    var errorDescription: String? {
        switch self {
        case .missingPack(let path):
            return "Valhalla routing pack missing: \(path)"
        case .missingResource(let name):
            return "Valhalla resource missing: \(name)"
        case .invalidDefaultConfig:
            return "Valhalla default config is invalid"
        case .configWriteFailed(let message):
            return "Valhalla config write failed: \(message)"
        case .engineInitFailed(let message):
            return "Valhalla engine init failed: \(message)"
        case .emptyResponse:
            return "Valhalla returned an empty response"
        }
    }
}

final class ValhallaRouter {
    static let shared = ValhallaRouter()

    private let queue = DispatchQueue(label: "app.trailhead.valhalla-routing")
    private var wrapperByPackPath: [String: ValhallaWrapper] = [:]

    private init() {}

    func route(packPath: String, requestJson: String, completion: @escaping (Result<String, Error>) -> Void) {
        queue.async {
            do {
                let wrapper = try self.wrapper(packPath: packPath)
                let response = wrapper.route(requestJson)
                guard !response.isEmpty else {
                    throw ValhallaRouterError.emptyResponse
                }
                completion(.success(response))
            } catch {
                completion(.failure(error))
            }
        }
    }

    private func wrapper(packPath: String) throws -> ValhallaWrapper {
        if let wrapper = wrapperByPackPath[packPath] {
            return wrapper
        }

        guard FileManager.default.fileExists(atPath: packPath) else {
            throw ValhallaRouterError.missingPack(packPath)
        }

        let configPath = try writeConfig(packPath: packPath)
        let wrapper: ValhallaWrapper
        do {
            wrapper = try ValhallaWrapper(configPath: configPath)
        } catch {
            throw ValhallaRouterError.engineInitFailed(error.localizedDescription)
        }
        wrapperByPackPath[packPath] = wrapper
        return wrapper
    }

    private func writeConfig(packPath: String) throws -> String {
        guard let defaultConfigUrl = Bundle.main.url(forResource: "default", withExtension: "json") ??
            Bundle(for: ValhallaRouter.self).url(forResource: "default", withExtension: "json") else {
            throw ValhallaRouterError.missingResource("default.json")
        }

        let data = try Data(contentsOf: defaultConfigUrl)
        guard var config = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              var mjolnir = config["mjolnir"] as? [String: Any] else {
            throw ValhallaRouterError.invalidDefaultConfig
        }

        let supportDir = try supportDirectory()
        mjolnir["tile_extract"] = packPath
        mjolnir["tile_dir"] = supportDir.appendingPathComponent("tiles").path
        mjolnir["traffic_extract"] = supportDir.appendingPathComponent("traffic.tar").path
        mjolnir["admin"] = supportDir.appendingPathComponent("admins.sqlite").path
        mjolnir["timezone"] = supportDir.appendingPathComponent("timezones.sqlite").path
        mjolnir["transit_dir"] = supportDir.appendingPathComponent("transit").path
        mjolnir["transit_feeds_dir"] = supportDir.appendingPathComponent("transit_feeds").path
        config["mjolnir"] = mjolnir

        if var additionalData = config["additional_data"] as? [String: Any] {
            additionalData["elevation"] = supportDir.appendingPathComponent("elevation").path
            config["additional_data"] = additionalData
        }

        let configData = try JSONSerialization.data(withJSONObject: config, options: [.prettyPrinted, .sortedKeys])
        let configUrl = supportDir.appendingPathComponent("valhalla-config.json")
        do {
            try configData.write(to: configUrl, options: [.atomic])
        } catch {
            throw ValhallaRouterError.configWriteFailed(error.localizedDescription)
        }
        return configUrl.path
    }

    private func supportDirectory() throws -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dir = base.appendingPathComponent("TrailheadValhalla", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }
}
