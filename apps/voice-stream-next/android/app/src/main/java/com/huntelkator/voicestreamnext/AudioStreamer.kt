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
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.concurrent.thread

class AudioStreamer(private val context: Context, private val api: VoiceStreamApi) {
    private val active = AtomicBoolean(false)
    private val reconnecting = AtomicBoolean(false)
    private val microphoneRouter = MicrophoneRouter(context)
    private val client = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private var recorder: AudioRecord? = null
    private var socket: WebSocket? = null
    @Volatile private var currentSocketUrl = ""
    @Volatile private var currentOnStatus: ((String) -> Unit)? = null
    @Volatile private var reconnectAttempt = 0

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
        currentSocketUrl = socketUrl
        currentOnStatus = onStatus
        connectSocket(socketUrl, onStatus)

        thread(name = "VoiceStreamNextAudio") {
            runRecorder(onStatus)
        }
    }

    fun stop() {
        active.set(false)
        reconnecting.set(false)
        currentSocketUrl = ""
        currentOnStatus = null
        AssistantAudioPlayer.stopAll()
        val localSocket = socket
        socket = null
        localSocket?.send("""{"type":"end"}""")
        localSocket?.close(1000, "stopped")
        runCatching { recorder?.stop() }
    }

    private fun connectSocket(socketUrl: String, onStatus: (String) -> Unit) {
        if (!active.get()) return
        val newSocket = client.newWebSocket(
            Request.Builder().url(socketUrl).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    reconnectAttempt = 0
                    webSocket.send(JSONObject().put("type", "client_hello").put("protocolVersion", 1).put("client", "android").toString())
                    onStatus("Voice stream connected.")
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    if (!active.get()) return
                    val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                    when (message.optString("type")) {
                        "server_ping" -> webSocket.send(JSONObject().put("type", "client_ping").put("sentAt", java.time.Instant.now().toString()).toString())
                        "assistant_result" -> onStatus("Assistant replied.")
                        "assistant_error" -> onStatus(message.optString("error", "Voice runtime failed."))
                    }
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    if (!active.get()) return
                    val data = bytes.toByteArray()
                    if (data.isNotEmpty()) {
                        AssistantAudioPlayer.playWav(data)
                        onStatus("Assistant audio received.")
                    }
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(code, reason)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (socket === webSocket) socket = null
                    if (active.get()) {
                        onStatus("Voice stream disconnected.")
                        scheduleReconnect()
                    } else {
                        onStatus("Voice stream closed.")
                    }
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (socket === webSocket) socket = null
                    if (!active.get()) return
                    onStatus(t.message ?: "Voice stream failed.")
                    scheduleReconnect()
                }
            }
        )
        socket = newSocket
    }

    private fun scheduleReconnect() {
        if (!active.get() || currentSocketUrl.isBlank()) return
        if (!reconnecting.compareAndSet(false, true)) return
        val attempt = reconnectAttempt.coerceAtMost(MAX_RECONNECT_EXPONENT)
        reconnectAttempt += 1
        val delayMs = minOf(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * (1L shl attempt))
        currentOnStatus?.invoke("Reconnecting voice stream in ${delayLabel(delayMs)}.")
        thread(name = "VoiceStreamNextReconnect") {
            try {
                Thread.sleep(delayMs)
            } finally {
                reconnecting.set(false)
            }
            val onStatus = currentOnStatus ?: return@thread
            val socketUrl = currentSocketUrl
            if (active.get() && socketUrl.isNotBlank()) {
                connectSocket(socketUrl, onStatus)
            }
        }
    }

    private fun delayLabel(delayMs: Long): String {
        return if (delayMs < 1000L) "${delayMs}ms" else "${delayMs / 1000L}s"
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
            val microphone = microphoneRouter.routeForRecording(audioRecord)
            audioRecord.startRecording()
            onStatus("Streaming microphone frames. ${microphone.label}.")
            while (active.get()) {
                val read = audioRecord.read(buffer, 0, buffer.size)
                if (read > 0) {
                    socket?.send(buffer.copyOf(read).toByteString())
                }
            }
        } catch (error: Exception) {
            if (active.get()) {
                onStatus(error.message ?: "Audio capture failed.")
            }
        } finally {
            microphoneRouter.releaseRouting()
            runCatching { audioRecord.stop() }
            runCatching { audioRecord.release() }
            if (recorder === audioRecord) recorder = null
            active.set(false)
            reconnecting.set(false)
            val localSocket = socket
            socket = null
            localSocket?.close(1000, "recorder stopped")
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
        const val BASE_RECONNECT_DELAY_MS = 500L
        const val MAX_RECONNECT_DELAY_MS = 10_000L
        const val MAX_RECONNECT_EXPONENT = 4
    }
}
