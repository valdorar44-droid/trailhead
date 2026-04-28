package expo.modules.tileserver

import java.io.InputStream
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.Executors

/**
 * Minimal HTTP/1.1 server on 127.0.0.1:57832 backed by a local PMTiles file.
 * Uses a fixed thread pool for concurrent tile requests.
 */
object TileServer {
    private const val PORT = 57832
    @Volatile var running = false
        private set
    private var server: ServerSocket? = null
    private var reader: PMTilesReader? = null
    private val pool = Executors.newFixedThreadPool(8)

    fun start(path: String) {
        if (running) return
        reader = PMTilesReader(path)
        server = ServerSocket(PORT).also { it.reuseAddress = true }
        running = true
        Thread {
            val s = server ?: return@Thread
            while (running) {
                try { val c = s.accept(); pool.submit { handle(c) } } catch (_: Exception) {}
            }
        }.also { it.isDaemon = true; it.start() }
    }

    fun stop() {
        running = false
        try { server?.close() } catch (_: Exception) {}
        server = null
        reader?.close(); reader = null
    }

    // ── Handle one connection ─────────────────────────────────────────────────
    private fun handle(socket: Socket) {
        socket.use { s ->
            try {
                val line = s.getInputStream().readLine() ?: return

                // ── Offline route: GET /route?from_lat=&from_lng=&to_lat=&to_lng= ─
                if (line.startsWith("GET /route")) {
                    fun qp(key: String): Double? {
                        val idx = line.indexOf("$key=").takeIf { it >= 0 } ?: return null
                        val start = idx + key.length + 1
                        val end = line.indexOfAny(charArrayOf('&', ' '), start).takeIf { it >= 0 } ?: line.length
                        return line.substring(start, end).toDoubleOrNull()
                    }
                    val fLat = qp("from_lat"); val fLng = qp("from_lng")
                    val tLat = qp("to_lat");   val tLng = qp("to_lng")
                    val rd = reader
                    if (fLat != null && fLng != null && tLat != null && tLng != null && rd != null) {
                        val result = OfflineRouter.route(fLat, fLng, tLat, tLng, rd)
                        if (result != null) {
                            val coords = result.coords.joinToString(",") { "[${it.second},${it.first}]" }
                            val steps  = result.steps.joinToString(",") { st ->
                                val nm = st.name.replace("\"", "'")
                                """{"type":"${st.type}","modifier":"${st.modifier}","name":"$nm","distance":${st.dist.toInt()},"duration":${st.dur.toInt()},"lat":${st.lat},"lng":${st.lng}}"""
                            }
                            val json = """{"coords":[$coords],"steps":[$steps],"distance_m":${result.distanceM.toInt()},"duration_s":${result.durationS.toInt()},"source":"local_pmtiles"}"""
                            respond(s, 200, json.toByteArray(), "application/json")
                        } else {
                            respond(s, 404, "{}".toByteArray())
                        }
                    } else {
                        respond(s, 400, ByteArray(0))
                    }
                    return
                }

                // ── Tile request: GET /api/tiles/{z}/{x}/{y}.pbf ──────────────
                val m = Regex("""GET /api/tiles/(\d+)/(\d+)/(\d+)\.pbf""").find(line)
                if (m == null) { respond(s, 404, ByteArray(0)); return }
                val (z, x, y) = m.destructured.toList().map { it.toInt() }
                val data = reader?.tile(z, x, y)
                if (data != null && data.isNotEmpty()) {
                    respond(s, 200, data, "application/vnd.mapbox-vector-tile", "Content-Encoding: gzip\r\n")
                } else {
                    respond(s, 204, ByteArray(0))
                }
            } catch (_: Exception) {}
        }
    }

    private fun respond(
        socket:       Socket,
        status:       Int,
        body:         ByteArray,
        contentType:  String = "application/octet-stream",
        extraHeaders: String = ""
    ) {
        val phrase = when (status) { 200 -> "OK"; 204 -> "No Content"; else -> "Not Found" }
        val header = "HTTP/1.1 $status $phrase\r\n" +
                     "Content-Type: $contentType\r\n" +
                     "Content-Length: ${body.size}\r\n" +
                     "Access-Control-Allow-Origin: *\r\n" +
                     "Cache-Control: max-age=86400\r\n" +
                     extraHeaders +
                     "Connection: close\r\n\r\n"
        socket.getOutputStream().apply {
            write(header.toByteArray())
            write(body)
            flush()
        }
    }

    private fun InputStream.readLine(): String? {
        val sb = StringBuilder()
        var c: Int
        while (true) {
            c = read()
            if (c < 0) break
            if (c == '\n'.code) break
            if (c != '\r'.code) sb.append(c.toChar())
        }
        return if (sb.isEmpty() && c < 0) null else sb.toString()
    }
}
