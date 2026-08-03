package com.trailhead.app.car

import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.car.app.CarContext
import androidx.car.app.media.CarAudioRecord
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

internal enum class TrailheadCarCopilotStatus {
  IDLE,
  LISTENING,
  PROCESSING,
  RESPONSE,
  CONFIRMATION,
  ERROR,
}

internal data class TrailheadCarCopilotState(
  val status: TrailheadCarCopilotStatus = TrailheadCarCopilotStatus.IDLE,
  val message: String = "",
  val actionId: Long? = null,
  val actionType: String = "",
  val actionArgs: String = "",
)

internal class TrailheadCarCopilotAudio(
  private val carContext: CarContext,
  private val onCaptured: (ByteArray) -> Unit,
  private val onFailure: (String) -> Unit,
) {
  private val mainHandler = Handler(Looper.getMainLooper())
  private val executor = Executors.newSingleThreadExecutor()
  private val stopping = AtomicBoolean(false)
  private var recording: CarAudioRecord? = null
  private var audioFocusRequest: AudioFocusRequest? = null
  private val maxDuration = Runnable { stop(discard = false) }

  val active: Boolean
    get() = recording != null

  fun start(): Boolean {
    if (active) return false
    if (!requestAudioFocus()) {
      onFailure("Microphone is unavailable right now.")
      return false
    }
    val next = runCatching { CarAudioRecord.create(carContext) }.getOrElse {
      abandonAudioFocus()
      onFailure("When safe, use your phone to allow microphone access.")
      return false
    }
    recording = next
    stopping.set(false)
    executor.execute { capture(next) }
    mainHandler.postDelayed(maxDuration, MAX_RECORDING_MILLIS)
    return true
  }

  fun stop(discard: Boolean) {
    val current = recording ?: return
    if (!stopping.compareAndSet(false, true)) return
    mainHandler.removeCallbacks(maxDuration)
    if (discard) discardCapture.set(true)
    runCatching { current.stopRecording() }
  }

  fun release() {
    stop(discard = true)
    executor.shutdownNow()
    abandonAudioFocus()
  }

  private val discardCapture = AtomicBoolean(false)

  private fun capture(carAudioRecord: CarAudioRecord) {
    val output = ByteArrayOutputStream()
    try {
      discardCapture.set(false)
      carAudioRecord.startRecording()
      val buffer = ByteArray(CarAudioRecord.AUDIO_CONTENT_BUFFER_SIZE)
      while (!stopping.get()) {
        val count = carAudioRecord.read(buffer, 0, buffer.size)
        if (count < 0) break
        if (count > 0 && output.size() + count <= MAX_AUDIO_BYTES) {
          output.write(buffer, 0, count)
        }
        if (output.size() >= MAX_AUDIO_BYTES) break
      }
    } catch (_: IllegalStateException) {
      discardCapture.set(true)
    } finally {
      runCatching { carAudioRecord.stopRecording() }
      mainHandler.post {
        if (recording === carAudioRecord) recording = null
        stopping.set(false)
        abandonAudioFocus()
        val audio = output.toByteArray()
        when {
          discardCapture.getAndSet(false) -> Unit
          audio.size < MIN_AUDIO_BYTES -> onFailure("I did not catch that. Try again.")
          else -> onCaptured(audio)
        }
      }
    }
  }

  private fun requestAudioFocus(): Boolean {
    val manager = carContext.getSystemService(AudioManager::class.java)
    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(audioAttributes())
        .setOnAudioFocusChangeListener(
          { change ->
            if (
              change == AudioManager.AUDIOFOCUS_LOSS ||
              change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
            ) {
              mainHandler.post { stop(discard = true) }
            }
          },
          mainHandler,
        )
        .build()
        .also { audioFocusRequest = it }
      manager.requestAudioFocus(request)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(
        { change ->
          if (
            change == AudioManager.AUDIOFOCUS_LOSS ||
            change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
          ) {
            mainHandler.post { stop(discard = true) }
          }
        },
        AudioManager.STREAM_MUSIC,
        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE,
      )
    }
    return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
  }

  private fun abandonAudioFocus() {
    val manager = carContext.getSystemService(AudioManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioFocusRequest?.let(manager::abandonAudioFocusRequest)
      audioFocusRequest = null
    }
  }

  private fun audioAttributes(): AudioAttributes = AudioAttributes.Builder()
    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
    .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
    .build()

  private companion object {
    const val MAX_RECORDING_MILLIS = 12_000L
    const val MAX_AUDIO_BYTES = 16_000 * 2 * 15
    const val MIN_AUDIO_BYTES = 16_000 * 2 / 10
  }
}
