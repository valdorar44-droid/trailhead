import Foundation

private enum ValhallaTzdataError: LocalizedError {
    case missingResource
    case invalidArchive(String)

    var errorDescription: String? {
        switch self {
        case .missingResource:
            return "Valhalla tzdata.tar resource missing"
        case .invalidArchive(let message):
            return "Valhalla tzdata.tar invalid: \(message)"
        }
    }
}

enum ValhallaTzdata {
    static let markerRelativePath = "tzdata/zone1970.tab"
    private static let tarTypeRegular = UInt8(48)
    private static let tarTypeDirectory = UInt8(53)

    static func markerUrl() -> URL {
        FileManager.default
            .urls(for: .libraryDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(markerRelativePath)
    }

    static func injectIfNeeded() throws {
        let fm = FileManager.default
        let marker = markerUrl()
        if fm.fileExists(atPath: marker.path) {
            return
        }

        guard let tarUrl = resourceUrl() else {
            throw ValhallaTzdataError.missingResource
        }

        let target = marker.deletingLastPathComponent()
        try fm.createDirectory(at: target, withIntermediateDirectories: true)
        try extractTar(at: tarUrl, to: target)
    }

    private static func resourceUrl() -> URL? {
        let bundles = [Bundle.main, Bundle(for: ValhallaRouter.self)] + Bundle.allBundles
        for bundle in bundles {
            if let url = bundle.url(forResource: "tzdata", withExtension: "tar") {
                return url
            }
            if let urls = bundle.urls(forResourcesWithExtension: "tar", subdirectory: nil),
               let url = urls.first(where: { $0.lastPathComponent == "tzdata.tar" }) {
                return url
            }
        }
        return nil
    }

    private static func extractTar(at tarUrl: URL, to target: URL) throws {
        let data = try Data(contentsOf: tarUrl)
        let blockSize = 512
        var offset = 0

        while offset + blockSize <= data.count {
            let header = data.subdata(in: offset..<(offset + blockSize))
            if header.allSatisfy({ $0 == 0 }) {
                return
            }

            guard let size = parseOctal(header, start: 124, length: 12) else {
                throw ValhallaTzdataError.invalidArchive("bad size header")
            }
            let typeFlag = header[header.startIndex + 156]
            let name = parsePath(header)

            offset += blockSize
            guard offset + size <= data.count else {
                throw ValhallaTzdataError.invalidArchive("entry exceeds archive size")
            }

            if let relativePath = cleanPath(name), !shouldSkip(relativePath) {
                let destination = target.appendingPathComponent(relativePath)
                if typeFlag == tarTypeDirectory {
                    try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
                } else if typeFlag == 0 || typeFlag == tarTypeRegular {
                    try FileManager.default.createDirectory(
                        at: destination.deletingLastPathComponent(),
                        withIntermediateDirectories: true
                    )
                    try data.subdata(in: offset..<(offset + size)).write(to: destination, options: [.atomic])
                }
            }

            offset += paddedSize(size, blockSize: blockSize)
        }

        throw ValhallaTzdataError.invalidArchive("missing end marker")
    }

    private static func paddedSize(_ size: Int, blockSize: Int) -> Int {
        ((size + blockSize - 1) / blockSize) * blockSize
    }

    private static func parsePath(_ header: Data) -> String {
        let name = parseString(header, start: 0, length: 100)
        let prefix = parseString(header, start: 345, length: 155)
        return prefix.isEmpty ? name : "\(prefix)/\(name)"
    }

    private static func parseString(_ data: Data, start: Int, length: Int) -> String {
        let bytes = data.dropFirst(start).prefix(length).prefix { $0 != 0 }
        return String(bytes: bytes, encoding: .utf8) ?? ""
    }

    private static func parseOctal(_ data: Data, start: Int, length: Int) -> Int? {
        let text = parseString(data, start: start, length: length).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? 0 : Int(text, radix: 8)
    }

    private static func cleanPath(_ path: String) -> String? {
        let parts = path.split(separator: "/").map(String.init)
        var cleaned: [String] = []
        for part in parts {
            if part.isEmpty || part == "." {
                continue
            }
            if part == ".." {
                return nil
            }
            cleaned.append(part)
        }
        return cleaned.isEmpty ? nil : cleaned.joined(separator: "/")
    }

    private static func shouldSkip(_ path: String) -> Bool {
        path.hasPrefix("._") || path.contains("/._")
    }
}
