/**
 * POSIX socket HTTP server — listens on 127.0.0.1:57832, serves
 * GET /api/tiles/{z}/{x}/{y}.pbf from local PMTiles file(s).
 *
 * Tile lookup order:
 *   1. stateReader  — active state pack (z0–z15 for one state)
 *   2. baseReader   — bundled/auto-downloaded low-zoom base (z0–z9 US)
 *   3. 204          — no content
 *
 * Contours are served separately from /api/contours/{z}/{x}/{y}.pbf so the
 * map can mount them as an overlay without mixing them into base map tiles.
 * Trails are served separately from /api/trails/{z}/{x}/{y}.pbf. The trail
 * pack can be regenerated without changing the base map pack and can later be
 * paired with a graph index for complete selected-trail systems.
 *
 * switchState(path:) replaces the state reader without restarting the server.
 * setBase(path:) loads the base reader once on app start.
 */
import Foundation

final class TileServer {
    static let shared = TileServer()
    private(set) var running = false
    private var serverFd: Int32 = -1

    private var stateReader: PMTilesReader?
    private var baseReader:  PMTilesReader?
    private var contourReader: PMTilesReader?
    private var trailReader: PMTilesReader?
    private let lock = NSLock()   // guards reader swaps

    let port: UInt16 = 57832

    // ── Start server (call once on app launch) ────────────────────────────────
    func start() throws {
        guard !running else { return }

        serverFd = socket(AF_INET, SOCK_STREAM, 0)
        guard serverFd >= 0 else {
            throw NSError(domain: "TileServer", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "socket() failed"])
        }

        var on: Int32 = 1
        setsockopt(serverFd, SOL_SOCKET, SO_REUSEADDR, &on, socklen_t(MemoryLayout<Int32>.size))

        var addr        = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port   = port.bigEndian
        addr.sin_addr   = in_addr(s_addr: inet_addr("127.0.0.1"))
        #if os(iOS)
        addr.sin_len    = UInt8(MemoryLayout<sockaddr_in>.size)
        #endif

        let bindOK = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(serverFd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindOK == 0 else {
            close(serverFd); serverFd = -1
            throw NSError(domain: "TileServer", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "bind() failed — port in use?"])
        }

        listen(serverFd, 16)
        running = true
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in self?.acceptLoop() }
    }

    func stop() {
        running = false
        if serverFd >= 0 { close(serverFd); serverFd = -1 }
        lock.lock(); stateReader = nil; baseReader = nil; contourReader = nil; trailReader = nil; lock.unlock()
    }

    // ── Swap state file without restarting the socket ─────────────────────────
    func switchState(path: String) throws {
        let r = try PMTilesReader(path: path)
        lock.lock(); stateReader = r; lock.unlock()
    }

    // ── Load base file (z0–z9 US coverage, called once) ──────────────────────
    func setBase(path: String) throws {
        let r = try PMTilesReader(path: path)
        lock.lock(); baseReader = r; lock.unlock()
    }

    // ── Load contour overlay file ─────────────────────────────────────────────
    func setContours(path: String) throws {
        let r = try PMTilesReader(path: path)
        lock.lock(); contourReader = r; lock.unlock()
    }

    func clearContours() {
        lock.lock(); contourReader = nil; lock.unlock()
    }

    // ── Load dedicated trail overlay file ─────────────────────────────────────
    func setTrails(path: String) throws {
        let r = try PMTilesReader(path: path)
        lock.lock(); trailReader = r; lock.unlock()
    }

    func clearTrails() {
        lock.lock(); trailReader = nil; lock.unlock()
    }

    // ── Accept loop ───────────────────────────────────────────────────────────
    private func acceptLoop() {
        while running {
            let fd = accept(serverFd, nil, nil)
            guard fd >= 0 else { continue }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.handle(fd: fd)
            }
        }
    }

    // ── Request handler ───────────────────────────────────────────────────────
    private func handle(fd: Int32) {
        defer { close(fd) }

        var buf = [UInt8](repeating: 0, count: 2048)
        let n   = recv(fd, &buf, buf.count - 1, 0)
        guard n > 0 else { return }

        let req = String(bytes: buf[0..<n], encoding: .utf8) ?? ""

        if req.hasPrefix("GET /health") {
            sendString(fd, "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nOK")
            return
        }

        if req.hasPrefix("GET /route") {
            handleRoute(fd: fd, req: req)
            return
        }

        let pattern = #"GET /api/(tiles|contours|trails)/(\d+)/(\d+)/(\d+)\.pbf"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let m = regex.firstMatch(in: req, range: NSRange(req.startIndex..., in: req)),
              m.numberOfRanges == 5 else {
            respond(fd: fd, status: 404, body: Data())
            return
        }

        func rng(_ i: Int) -> String { (req as NSString).substring(with: m.range(at: i)) }
        let lane = rng(1)
        guard let z = Int(rng(2)), let x = Int(rng(3)), let y = Int(rng(4)) else {
            respond(fd: fd, status: 400, body: Data()); return
        }

        // Snapshot readers under lock so a swap mid-request is safe
        lock.lock()
        let sr = stateReader
        let br = baseReader
        let cr = contourReader
        let tr = trailReader
        lock.unlock()

        let data: Data?
        if lane == "contours" {
            data = (cr?.tile(z: z, x: x, y: y)).flatMap { $0.isEmpty ? nil : $0 }
        } else if lane == "trails" {
            data = (tr?.tile(z: z, x: x, y: y)).flatMap { $0.isEmpty ? nil : $0 }
        } else {
            data = (sr?.tile(z: z, x: x, y: y)).flatMap { $0.isEmpty ? nil : $0 }
                ?? (br?.tile(z: z, x: x, y: y)).flatMap { $0.isEmpty ? nil : $0 }
        }

        if let data {
            respond(fd: fd, status: 200, body: data,
                    type: "application/vnd.mapbox-vector-tile",
                    extraHeaders: "Content-Encoding: gzip\r\n")
        } else {
            respond(fd: fd, status: 204, body: Data(),
                    extraHeaders: "Cache-Control: no-store\r\n")
        }
    }

    // ── Route handler ─────────────────────────────────────────────────────────
    private func handleRoute(fd: Int32, req: String) {
        func qp(_ name: String) -> Double? {
            guard let r = req.range(of: "\(name)=") else { return nil }
            let rest = req[r.upperBound...]
            // Value ends at next & delimiter, space (end of request line), \r, or end of string
            let terminator = rest.range(of: "&") ?? rest.range(of: " ") ?? rest.range(of: "\r")
            let raw = terminator != nil
                ? String(rest[..<terminator!.lowerBound])
                : String(rest)
            return Double(raw.trimmingCharacters(in: .whitespaces))
        }
        guard let fLat = qp("from_lat"), let fLng = qp("from_lng"),
              let tLat = qp("to_lat"),   let tLng = qp("to_lng"),
              fLat.isFinite && fLng.isFinite && tLat.isFinite && tLng.isFinite,
              fLat >= -90 && fLat <= 90 && fLng >= -180 && fLng <= 180,
              tLat >= -90 && tLat <= 90 && tLng >= -180 && tLng <= 180 else {
            respond(fd: fd, status: 400, body: Data()); return
        }

        lock.lock(); let rd = stateReader ?? baseReader; lock.unlock()
        guard let rd else { respond(fd: fd, status: 503, body: Data()); return }

        if let result = OfflineRouter.route(from: fLat, fLng, to: tLat, tLng, reader: rd) {
            // Int(NaN) traps at runtime — use safeInt everywhere a Double→Int cast appears
            func safeInt(_ v: Double) -> Int { v.isFinite ? Int(max(0, v)) : 0 }
            let coordsJson = result.coords.map { "[\($0.lng),\($0.lat)]" }.joined(separator: ",")
            let stepsJson  = result.steps.map { s in
                let nm = s.name.replacingOccurrences(of: "\"", with: "'")
                return """
                {"type":"\(s.type)","modifier":"\(s.modifier)","name":"\(nm)",
                 "distance":\(safeInt(s.dist)),"duration":\(safeInt(s.dur)),
                 "lat":\(s.lat),"lng":\(s.lng)}
                """
            }.joined(separator: ",")
            let json = """
            {"coords":[\(coordsJson)],
             "steps":[\(stepsJson)],
             "distance_m":\(safeInt(result.distanceM)),
             "duration_s":\(safeInt(result.durationS)),
             "source":"local_pmtiles"}
            """
            respond(fd: fd, status: 200, body: json.data(using: .utf8)!,
                    type: "application/json")
        } else {
            respond(fd: fd, status: 404, body: "{}".data(using: .utf8)!)
        }
    }

    // ── HTTP response helper ──────────────────────────────────────────────────
    private func respond(fd: Int32, status: Int, body: Data,
                         type ct: String = "application/octet-stream",
                         extraHeaders: String = "") {
        let phrase  = status == 200 ? "OK" : status == 204 ? "No Content" : "Not Found"
        let headers = "HTTP/1.1 \(status) \(phrase)\r\n" +
                      "Content-Type: \(ct)\r\n" +
                      "Content-Length: \(body.count)\r\n" +
                      "Access-Control-Allow-Origin: *\r\n" +
                      (extraHeaders.contains("Cache-Control:")
                        ? ""
                        : "Cache-Control: max-age=86400\r\n") +
                      extraHeaders +
                      "Connection: close\r\n\r\n"
        var out = headers.data(using: .utf8)!
        out.append(body)
        out.withUnsafeBytes { _ = Darwin.send(fd, $0.baseAddress!, out.count, 0) }
    }

    private func sendString(_ fd: Int32, _ s: String) {
        guard let d = s.data(using: .utf8) else { return }
        d.withUnsafeBytes { _ = Darwin.send(fd, $0.baseAddress!, d.count, 0) }
    }
}
