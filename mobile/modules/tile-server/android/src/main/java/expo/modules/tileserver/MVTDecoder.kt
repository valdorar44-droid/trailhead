package expo.modules.tileserver

/**
 * Minimal MVT (Mapbox Vector Tile) decoder — only decodes the 'roads' layer.
 * Matches the iOS Swift version exactly.
 */
data class RoadSegment(
    val coords:  List<Pair<Double, Double>>,  // (lat, lng)
    val kind:    String,
    val name:    String,
    val oneway:  Boolean
) {
    val weight: Double get() = when (kind) {
        "highway"    -> 1.0
        "major_road" -> 1.1
        "minor_road" -> 1.3
        "other"      -> 1.8
        "path"       -> 3.0
        else         -> 2.0
    }
}

object MVTDecoder {

    fun roads(data: ByteArray, z: Int, x: Int, y: Int): List<RoadSegment> {
        val layer = findLayer("roads", data) ?: return emptyList()
        return decodeLayer(layer, z, x, y)
    }

    // ── Minimal protobuf reader ───────────────────────────────────────────────
    private class Proto(val d: ByteArray) {
        var p = 0
        fun varint(): Long {
            var r = 0L; var s = 0
            while (p < d.size) {
                val b = d[p++].toLong() and 0xFF
                r = r or ((b and 0x7F) shl s)
                if (b and 0x80 == 0L) break; s += 7
            }
            return r
        }
        fun tag(): Pair<Int, Int>? {
            if (p >= d.size) return null
            val v = varint().toInt(); return Pair(v shr 3, v and 0x7)
        }
        fun skip(wt: Int) { when (wt) { 0 -> varint(); 1 -> p += 8; 2 -> p += varint().toInt(); 5 -> p += 4 } }
        fun bytes(): ByteArray { val n = varint().toInt(); val s = p; p += n; return d.copyOfRange(s, minOf(p, d.size)) }
        fun str(): String = String(bytes(), Charsets.UTF_8)
        fun packed(): IntArray {
            val raw = bytes(); val sub = Proto(raw); val out = mutableListOf<Int>()
            while (sub.p < sub.d.size) out.add(sub.varint().toInt())
            return out.toIntArray()
        }
    }

    private data class MVTFeature(var tags: IntArray = IntArray(0), var type: Int = 0, var geom: IntArray = IntArray(0))
    private data class MVTLayer(var name: String = "", var keys: MutableList<String> = mutableListOf(),
                                 var values: MutableList<String> = mutableListOf(),
                                 var features: MutableList<MVTFeature> = mutableListOf(), var extent: Int = 4096)

    private fun findLayer(target: String, data: ByteArray): MVTLayer? {
        val pb = Proto(data)
        while (true) {
            val (f, wt) = pb.tag() ?: break
            if (f == 3 && wt == 2) { val l = parseLayer(pb.bytes()); if (l.name == target) return l }
            else pb.skip(wt)
        }
        return null
    }

    private fun parseLayer(data: ByteArray): MVTLayer {
        val pb = Proto(data); val layer = MVTLayer()
        while (true) {
            val (f, wt) = pb.tag() ?: break
            when (f) {
                1 -> layer.name = pb.str()
                2 -> layer.features.add(parseFeature(pb.bytes()))
                3 -> layer.keys.add(pb.str())
                4 -> layer.values.add(parseValue(pb.bytes()))
                5 -> layer.extent = pb.varint().toInt()
                else -> pb.skip(wt)
            }
        }
        return layer
    }

    private fun parseFeature(data: ByteArray): MVTFeature {
        val pb = Proto(data); val f = MVTFeature()
        while (true) {
            val (fn, wt) = pb.tag() ?: break
            when (fn) { 2 -> f.tags = pb.packed(); 3 -> f.type = pb.varint().toInt(); 4 -> f.geom = pb.packed(); else -> pb.skip(wt) }
        }
        return f
    }

    private fun parseValue(data: ByteArray): String {
        val pb = Proto(data)
        while (true) {
            val (f, wt) = pb.tag() ?: break
            if (f == 1 && wt == 2) return pb.str(); pb.skip(wt)
        }
        return ""
    }

    // ── Decode features → RoadSegments ───────────────────────────────────────
    private fun decodeLayer(layer: MVTLayer, z: Int, x: Int, y: Int): List<RoadSegment> {
        val segs = mutableListOf<RoadSegment>()
        val ext  = layer.extent.toDouble()
        val n    = (1 shl z).toDouble()

        for (feat in layer.features) {
            if (feat.type != 2) continue
            var kind = "other"; var name = ""; var oneway = false
            var i = 0
            while (i + 1 < feat.tags.size) {
                val k = feat.tags[i]; val v = feat.tags[i + 1]; i += 2
                if (k < layer.keys.size) {
                    val key = layer.keys[k]
                    if (key == "kind"   && v < layer.values.size) kind   = layer.values[v]
                    if (key == "name"   && v < layer.values.size) name   = layer.values[v]
                    if (key == "oneway" && v < layer.values.size) oneway = layer.values[v].let { it == "true" || it == "yes" }
                }
            }

            val lines = mutableListOf<MutableList<Pair<Double, Double>>>()
            var cur   = mutableListOf<Pair<Double, Double>>()
            var cx = 0; var cy = 0; var gi = 0
            while (gi < feat.geom.size) {
                val cmd = feat.geom[gi] and 0x7
                val cnt = feat.geom[gi] shr 3; gi++
                if (cmd == 1 || cmd == 2) {
                    if (cmd == 1 && cur.isNotEmpty()) { lines.add(cur); cur = mutableListOf() }
                    repeat(cnt) {
                        if (gi + 1 >= feat.geom.size) return@repeat
                        val rx = feat.geom[gi++]; val ry = feat.geom[gi++]
                        cx += (rx shr 1) xor -(rx and 1); cy += (ry shr 1) xor -(ry and 1)
                        val tx = x.toDouble() + cx.toDouble() / ext
                        val ty = y.toDouble() + cy.toDouble() / ext
                        val lng = tx / n * 360.0 - 180.0
                        val lat = Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1.0 - 2.0 * ty / n))))
                        cur.add(Pair(lat, lng))
                    }
                } else if (cmd == 7) { if (cur.isNotEmpty()) { lines.add(cur); cur = mutableListOf() } }
            }
            if (cur.isNotEmpty()) lines.add(cur)

            for (line in lines) {
                if (line.size >= 2) segs.add(RoadSegment(line, kind, name, oneway))
            }
        }
        return segs
    }
}
