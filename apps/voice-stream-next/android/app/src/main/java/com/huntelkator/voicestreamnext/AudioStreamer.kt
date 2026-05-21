package com.huntelkator.voicestreamnext

import android.annotation.SuppressLint
import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString.Companion.toByteString
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class AudioStreamer(private val context: Context, private val api: VoiceStreamApi) {
    private val active = AtomicBoolean(false)
    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .build()

    private var recorder: AudioRecord? = null
    private var socket: WebSocket? = null

    fun start(sessionId: String, onStatus: (String) -> Unit) {
        if (!active.compareAndSet(false, true)) return
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            active.set(false)
            onStatus("Microphone permission is missing.")
            return
        }

        val config = api.loadConfig()
        val deviceId = api.pairedDeviceId()
        val token = api.pairedDeviceToken()
        if (deviceId.isBlank() || token.isBlank()) {
            active.set(false)
            onStatus("Pair this device before streaming.")
            return
        }

        val socketUrl = buildSocketUrl(config.serverUrl, deviceId, token, sessionId)
        socket = client.newWebSocket(
            Request.Builder().url(socketUrl).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    onStatus("Voice stream connected.")
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    onStatus("Voice stream closed.")
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    onStatus(t.message ?: "Voice stream failed.")
                }
            }
        )

        thread(name = "VoiceStreamNextAudio") {
            runRecorder(onStatus)
        }
    }

    fun stop() {
        active.set(false)
        socket?.send("""{"type":"end"}""")
        recorder?.stop()
        recorder?.release()
        recorder = null
        socket?.close(1000, "stopped")
        socket = null
    }

    @SuppressLint("MissingPermission")
    private fun runRecorder(onStatus: (String) -> Unit) {
        val minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val bufferSize = maxOf(minBuffer, SAMPLE_RATE / 5)
        val audioRecord = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize
        )
        recorder = audioRecord
        val buffer = ByteArray(bufferSize)
        try {
            audioRecord.startRecording()
            onStatus("Streaming microphone frames.")
            while (active.get()) {
                val read = audioRecord.read(buffer, 0, buffer.size)
                if (read > 0) {
                    socket?.send(buffer.copyOf(read).toByteString())
                }
            }
        } catch (error: Exception) {
            onStatus(error.message ?: "Audio capture failed.")
        } finally {
            runCatching { audioRecord.stop() }
            audioRecord.release()
            if (recorder === audioRecord) recorder = null
            socket?.close(1000, "recorder stopped")
            socket = null
            active.set(false)
        }
    }

    private fun buildSocketUrl(serverUrl: String, deviceId: String, token: String, sessionId: String): String {
        val trimmed = serverUrl.trimEnd('/')
        val base = when {
            trimmed.startsWith("https://") -> "wss://${trimmed.removePrefix("https://")}"
            trimmed.startsWith("http://") -> "ws://${trimmed.removePrefix("http://")}"
            else -> trimmed
        }
        return "$base/api/voice/stream?deviceId=${encode(deviceId)}&token=${encode(token)}&sessionId=${encode(sessionId)}"
    }

    private fun encode(value: String): String {
        return URLEncoder.encode(value, Charsets.UTF_8.name())
    }

    private companion object {
        const val SAMPLE_RATE = 16_000
    }
}
