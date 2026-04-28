package expo.modules.tileserver

import java.util.PriorityQueue
import kotlin.math.*

object OfflineRouter {

    data class Step(val type: String, val modifier: String, val name: String,
                    val dist: Double, val dur: Double, val lat: Double, val lng: Double)
    data class RouteResult(val coords: List<Pair<Double,Double>>, val steps: List<Step>,
                           val distanceM: Double, val durationS: Double)

    private data class Edge(val to: Long, val dist: Double, val name: String, val kind: String)

    private fun nodeId(lat: Double, lng: Double): Long =
        lat.times(100_000).toLong() * 10_000_000L + lng.times(100_000).toLong()

    private fun haversineM(a: Pair<Double, Double>, b: Pair<Double, Double>): Double {
        val R = 6_371_000.0
        val dLat = Math.toRadians(b.first  - a.first)
        val dLng = Math.toRadians(b.second - a.second)
        val x = sin(dLat/2).pow(2) + cos(Math.toRadians(a.first)) * cos(Math.toRadians(b.first)) * sin(dLng/2).pow(2)
        return R * 2 * atan2(sqrt(x), sqrt(1-x))
    }

    private fun tilesInBBox(n: Double, s: Double, e: Double, w: Double, z: Int): List<Pair<Int,Int>> {
        val n2 = (1 shl z).toDouble()
        fun tx(lng: Double) = ((lng + 180) / 360 * n2).toInt().coerceIn(0, (n2-1).toInt())
        fun ty(lat: Double): Int {
            val r = Math.toRadians(lat)
            return ((1 - ln(tan(r) + 1/cos(r)) / PI) / 2 * n2).toInt().coerceIn(0, (n2-1).toInt())
        }
        val x0=tx(w); val x1=tx(e); val y0=ty(n); val y1=ty(s)
        return (x0..x1).flatMap { x -> (y0..y1).map { y -> Pair(x, y) } }
    }

    private fun bearing(a: Pair<Double,Double>, b: Pair<Double,Double>): Double {
        val la1 = Math.toRadians(a.first); val la2 = Math.toRadians(b.first)
        val dL  = Math.toRadians(b.second - a.second)
        return Math.toDegrees(atan2(sin(dL)*cos(la2), cos(la1)*sin(la2) - sin(la1)*cos(la2)*cos(dL)))
    }
    private fun bearingDiff(a: Double, b: Double): Double {
        var d = b - a; while (d > 180) d -= 360; while (d < -180) d += 360; return d
    }
    private fun compassDir(b: Double): String {
        val dirs = listOf("north","northeast","east","southeast","south","southwest","west","northwest")
        return dirs[((b + 22.5).mod(360.0) / 45).toInt().coerceIn(0, 7)]
    }
    private fun turnInfo(diff: Double, roadName: String, roadKind: String): Triple<String,String,String> {
        val on = if (roadName.isNotEmpty()) roadName else roadKind.replace("_", " ")
        val a  = abs(diff)
        if (a < 20)  return Triple("continue", "straight",    "Continue on $on")
        if (a < 45)  { val m = if (diff < 0) "slight left" else "slight right"; return Triple("turn", m, "Bear $m on $on") }
        if (a < 135) { val m = if (diff < 0) "left" else "right"; return Triple("turn", m, "Turn $m on $on") }
        val m = if (diff < 0) "sharp left" else "sharp right"; return Triple("turn", m, "Turn $m on $on")
    }

    private fun buildSteps(pathIds: List<Long>, pos: Map<Long,Pair<Double,Double>>,
                            graph: Map<Long,List<Edge>>,
                            fLat: Double, fLng: Double, tLat: Double, tLng: Double): List<Step> {
        if (pathIds.size < 2) return emptyList()
        data class Seg(val lat: Double, val lng: Double, val name: String, val kind: String)
        val segs = pathIds.mapIndexed { i, id ->
            val (lat, lng) = pos[id] ?: Pair(0.0, 0.0)
            var name = ""; var kind = "road"
            if (i > 0) {
                val e = graph[pathIds[i-1]]?.firstOrNull { it.to == id }
                if (e != null) { name = e.name; kind = e.kind }
            }
            Seg(lat, lng, name, kind)
        }

        val steps = mutableListOf<Step>()
        val first = segs[1]
        val dep   = bearing(Pair(fLat, fLng), Pair(first.lat, first.lng))
        steps.add(Step("depart", "", "Head ${compassDir(dep)}${if (first.name.isNotEmpty()) " on ${first.name}" else ""}",
                       0.0, 0.0, fLat, fLng))

        var stepDist = 0.0; var stepDur = 0.0; var prevBear = dep
        var curName = first.name

        for (i in 1 until segs.size - 1) {
            val cur = segs[i]; val next = segs[i+1]
            val d   = haversineM(Pair(cur.lat, cur.lng), Pair(next.lat, next.lng))
            stepDist += d; stepDur += d / 13.0
            val outBear    = bearing(Pair(cur.lat, cur.lng), Pair(next.lat, next.lng))
            val diff       = bearingDiff(prevBear, outBear)
            val nameChange = next.name.isNotEmpty() && next.name != curName
            if (abs(diff) > 20 || nameChange) {
                val (type, mod, label) = turnInfo(diff, next.name, next.kind)
                steps.add(Step(type, mod, label, stepDist, stepDur, cur.lat, cur.lng))
                stepDist = 0.0; stepDur = 0.0; curName = next.name
            }
            prevBear = outBear
        }
        steps.add(Step("arrive", "", "Arrive at destination", stepDist, stepDur, tLat, tLng))
        return steps
    }

    fun route(fLat: Double, fLng: Double, tLat: Double, tLng: Double, reader: PMTilesReader): RouteResult? {
        val distDeg = sqrt((tLat - fLat).pow(2) + (tLng - fLng).pow(2))
        val ZOOM = when { distDeg > 3.0 -> 8; distDeg > 1.0 -> 10; else -> 12 }
        val buf  = maxOf(abs(tLat - fLat), abs(tLng - fLng)) * 0.15 + 0.05
        val tiles = tilesInBBox(maxOf(fLat,tLat)+buf, minOf(fLat,tLat)-buf,
                                maxOf(fLng,tLng)+buf, minOf(fLng,tLng)-buf, ZOOM)
        if (tiles.isEmpty() || tiles.size > 800) return null

        val graph   = HashMap<Long, MutableList<Edge>>()
        val nodePos = HashMap<Long, Pair<Double, Double>>()

        for ((x, y) in tiles) {
            val raw = reader.tile(ZOOM, x, y) ?: continue
            if (raw.isEmpty()) continue
            val data = PMTilesReader.gunzip(raw) ?: raw
            for (seg in MVTDecoder.roads(data, ZOOM, x, y)) {
                for (i in seg.coords.indices) {
                    val c  = seg.coords[i]; val id = nodeId(c.first, c.second)
                    nodePos[id] = c
                    if (i > 0) {
                        val p = seg.coords[i-1]; val pid = nodeId(p.first, p.second)
                        val d = haversineM(c, p) * seg.weight
                        graph.getOrPut(pid) { mutableListOf() }.add(Edge(id,  d, seg.name, seg.kind))
                        if (!seg.oneway) graph.getOrPut(id) { mutableListOf() }.add(Edge(pid, d, seg.name, seg.kind))
                    }
                }
            }
        }
        if (graph.isEmpty()) return null

        fun nearest(lat: Double, lng: Double): Long? =
            nodePos.minByOrNull { (_, p) -> (p.first-lat).pow(2) + (p.second-lng).pow(2) }?.key

        val startId = nearest(fLat, fLng) ?: return null
        val endId   = nearest(tLat, tLng) ?: return null

        // Dijkstra with A* heuristic
        val dist = HashMap<Long, Double>()
        val prev = HashMap<Long, Long>()
        val pq   = PriorityQueue<Pair<Double, Long>>(compareBy { it.first })
        dist[startId] = 0.0; pq.add(Pair(0.0, startId))

        while (pq.isNotEmpty()) {
            val (f, cur) = pq.poll()
            if (cur == endId) break
            val curDist = dist[cur] ?: Double.MAX_VALUE
            if (f > curDist + 1e-6) continue
            for (edge in graph[cur] ?: emptyList()) {
                val nd = curDist + edge.dist
                if (nd < (dist[edge.to] ?: Double.MAX_VALUE)) {
                    dist[edge.to] = nd; prev[edge.to] = cur
                    val (nlat, nlng) = nodePos[edge.to] ?: continue
                    pq.add(Pair(nd + haversineM(Pair(nlat, nlng), Pair(tLat, tLng)), edge.to))
                }
            }
        }
        if (!dist.containsKey(endId)) return null

        val pathIds = mutableListOf<Long>()
        var cur: Long? = endId
        while (cur != null) { pathIds.add(cur); cur = prev[cur] }
        pathIds.reverse()

        val steps  = buildSteps(pathIds, nodePos, graph, fLat, fLng, tLat, tLng)
        val coords = mutableListOf(Pair(fLat, fLng)) + pathIds.mapNotNull { nodePos[it] } + listOf(Pair(tLat, tLng))
        val distM  = coords.zipWithNext().sumOf { (a, b) -> haversineM(a, b) }
        return RouteResult(coords, steps, distM, distM / 13.0)
    }
}
