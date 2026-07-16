package expo.modules.trailheadcarreports

import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.locks.ReentrantLock

internal object LockedFileAccess {
    private val processLocks = ConcurrentHashMap<String, ReentrantLock>()

    fun <T> withLock(lockFile: File, block: () -> T): T {
        lockFile.parentFile?.mkdirs()
        val path = lockFile.canonicalPath
        val processLock = processLocks.getOrPut(path) { ReentrantLock() }
        processLock.lock()
        try {
            RandomAccessFile(lockFile, "rw").use { randomAccessFile ->
                randomAccessFile.channel.use { channel ->
                    channel.lock().use { return block() }
                }
            }
        } finally {
            processLock.unlock()
        }
    }

    fun writeAtomically(target: File, contents: String) {
        target.parentFile?.mkdirs()
        val temporary = File(target.parentFile, "${target.name}.tmp")
        val backup = File(target.parentFile, "${target.name}.bak")
        FileOutputStream(temporary, false).use { output ->
            output.write(contents.toByteArray(Charsets.UTF_8))
            output.fd.sync()
        }
        if (backup.exists() && !backup.delete()) {
            temporary.delete()
            throw IllegalStateException("Unable to replace ${target.name}")
        }
        if (target.exists() && !target.renameTo(backup)) {
            temporary.delete()
            throw IllegalStateException("Unable to back up ${target.name}")
        }
        if (!temporary.renameTo(target)) {
            if (backup.exists()) backup.renameTo(target)
            temporary.delete()
            throw IllegalStateException("Unable to save ${target.name}")
        }
        backup.delete()
    }

    fun readTextRecovering(target: File): String? {
        val backup = File(target.parentFile, "${target.name}.bak")
        if (!target.exists() && backup.exists()) backup.renameTo(target)
        return if (target.exists()) target.readText(Charsets.UTF_8) else null
    }

    fun deleteArtifacts(target: File) {
        target.delete()
        File(target.parentFile, "${target.name}.bak").delete()
        File(target.parentFile, "${target.name}.tmp").delete()
    }
}
