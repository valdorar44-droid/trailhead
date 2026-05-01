package expo.modules.tileserver

import java.io.ByteArrayOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.GZIPInputStream

/**
 * PMTiles v3 reader — identical logic to the iOS Swift version.
 * Uses RandomAccessFile for thread-safe byte-range reads after construction.
 * Leaf directory entries are cached to avoid re-parsing on repeated access.
 */
data class DirEntry(val tileId: Long, val offset: Long, val length: Int, val runLength: Int)

data class PMHeader(
    val rootDirOffset:  Long,
    val rootDirLength:  Long,
    val leafDirsOffset: Long,
    val tileDataOffset: Long,
    val internalComp:   Int
)

class PMTilesReader(path: String) : AutoCloseable {
    private val raf        = RandomAccessFile(path, "r")
    private val header: PMHeader
    private val rootEntries: List<DirEntry>
    private val leafCache  = HashMap<Long, List<DirEntry>>()

    init {
        val hd = ByteArray(127).also { raf.seek(0); raf.readFully(it) }
        require(hd[0] == 'P'.code.toByte() && hd[1] == 'M'.code.toByte()) { "Bad PMTiles magic" }
        fun u64(o: Int) = ByteBuffer.wrap(hd, o, 8).order(ByteOrder.LITTLE_ENDIAN).long
        header = PMHeader(
            rootDirOffset  = u64(8),
            rootDirLength  = u64(16),
            leafDirsOffset = u64(40),
            tileDataOffset = u64(56),
            internalComp   = hd[97].toInt() and 0xFF
        )
        rootEntries = parseDir(readInternalBytes(header.rootDirOffset, header.rootDirLength.toInt()))
    }

    override fun close() = raf.close()

    // ── Public ────────────────────────────────────────────────────────────────
    @Synchronized
    fun tile(z: Int, x: Int, y: Int): ByteArray? {
        val id = tileId(z, x, y)
        return lookup(rootEntries, id)
    }

    // ── Private ───────────────────────────────────────────────────────────────
    private fun lookup(entries: List<DirEntry>, id: Long): ByteArray? {
        val e = bsearch(entries, id) ?: return null
        return if (e.runLength == 0) {
            // Leaf directory
            val leaf = leafCache.getOrPut(e.offset) {
                parseDir(readInternalBytes(header.leafDirsOffset + e.offset, e.length))
            }
            lookup(leaf, id)
        } else {
            readRawBytes(header.tileDataOffset + e.offset, e.length)
        }
    }

    private fun readRawBytes(offset: Long, length: Int): ByteArray =
        ByteArray(length).also { raf.seek(offset); raf.readFully(it) }

    private fun readInternalBytes(offset: Long, length: Int): ByteArray {
        val raw = ByteArray(length).also { raf.seek(offset); raf.readFully(it) }
        return if (header.internalComp == 2) gunzip(raw) ?: raw else raw
    }

    private fun bsearch(entries: List<DirEntry>, id: Long): DirEntry? {
        var lo = 0; var hi = entries.size - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            val e   = entries[mid]
            when {
                e.tileId == id -> return e
                e.tileId  < id -> lo = mid + 1
                else            -> hi = mid - 1
            }
        }
        if (lo > 0) {
            val prev = entries[lo - 1]
            if (prev.runLength == 0) return prev
            if (id < prev.tileId + prev.runLength) return prev
        }
        return null
    }

    // ── Directory parsing (LEB128 delta-encoded) ─────────────────────────────
    companion object {
        fun parseDir(data: ByteArray): List<DirEntry> {
            var pos = 0
            fun varint(): Long {
                var r = 0L; var s = 0
                while (pos < data.size) {
                    val b = data[pos++].toLong() and 0xFF
                    r = r or ((b and 0x7F) shl s)
                    if (b and 0x80 == 0L) break
                    s += 7
                }
                return r
            }
            val n     = varint().toInt()
            val ids   = LongArray(n); var last = 0L
            for (i in 0 until n) { ids[i] = last + varint(); last = ids[i] }
            val rls   = IntArray(n)  { varint().toInt() }
            val lens  = IntArray(n)  { varint().toInt() }
            val offs  = LongArray(n)
            for (i in 0 until n) {
                val tmp = varint()
                offs[i] = if (i > 0 && tmp == 0L) {
                    offs[i - 1] + lens[i - 1]
                } else if (tmp > 0) {
                    tmp - 1
                } else {
                    0
                }
            }
            return List(n) { DirEntry(ids[it], offs[it], lens[it], rls[it]) }
        }

        fun tileId(z: Int, x: Int, y: Int): Long {
            if (z == 0) return 0
            val base = ((1L shl (2 * z)) - 1) / 3
            val n    = 1 shl z
            var cx = x; var cy = y; var d = 0L; var s = n shr 1
            while (s > 0) {
                val rx = if ((cx and s) != 0) 1 else 0
                val ry = if ((cy and s) != 0) 1 else 0
                d += s.toLong() * s.toLong() * ((3 * rx) xor ry).toLong()
                if (ry == 0) {
                    if (rx == 1) { cx = s - 1 - cx; cy = s - 1 - cy }
                    val t = cx; cx = cy; cy = t
                }
                s = s shr 1
            }
            return base + d
        }

        fun gunzip(data: ByteArray): ByteArray? = try {
            val out = ByteArrayOutputStream()
            GZIPInputStream(data.inputStream()).use { it.copyTo(out) }
            out.toByteArray()
        } catch (e: Exception) { null }
    }
}
