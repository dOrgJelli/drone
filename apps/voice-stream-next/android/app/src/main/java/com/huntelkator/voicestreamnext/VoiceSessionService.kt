package com.huntelkator.voicestreamnext

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.os.PowerManager
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.TimeUnit
import kotlin.concurrent.thread

class VoiceSessionService : Service() {
    private lateinit var api: VoiceStreamApi
    private lateinit var streamer: AudioStreamer
    private val controlClient = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()
    private var wakeLock: PowerManager.WakeLock? = null
    @Volatile private var controlSocket: WebSocket? = null
    @Volatile private var lastStatus = "Off"
    @Volatile private var lastMode = Constants.MODE_OFF

    override fun onCreate() {
        super.onCreate()
        api = VoiceStreamApi(applicationContext)
        streamer = AudioStreamer(applicationContext, api)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            Constants.ACTION_STOP_VOICE -> stopVoice()
            Constants.ACTION_SLEEP -> enterSleep()
            Constants.ACTION_START_AWAKE -> startAwake()
            else -> startVoice(intent?.getStringExtra(Constants.EXTRA_STREAM_TARGET) ?: Constants.STREAM_TARGET_ASSISTANT)
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        streamer.stop()
        AssistantAudioPlayer.stopAll()
        closeControlChannel()
        releaseWakeLock()
        publishStatus("Off", Constants.MODE_OFF)
        super.onDestroy()
    }

    private fun startAwake() {
        publishStatus("Waking local detector", Constants.MODE_AWAKE)
        startForeground(NOTIFICATION_ID, notification("Waking local detector"))
        acquireWakeLock()
        connectControlChannel()
        streamer.startAwake { status ->
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(NOTIFICATION_ID, notification(status))
            publishStatus(status, modeFromStatus(status))
            if (status == "Off") stopVoice()
        }
    }

    private fun startVoice(target: String) {
        publishStatus("Voice stream starting", Constants.MODE_RECORDING)
        startForeground(NOTIFICATION_ID, notification("Voice stream starting"))
        acquireWakeLock()
        connectControlChannel()
        thread(name = "VoiceStreamNextServiceStart") {
            try {
                val deviceId = api.pairedDeviceId()
                if (deviceId.isBlank()) {
                    publishStatus("Pair this device before streaming.", Constants.MODE_ERROR)
                    stopVoice()
                    return@thread
                }
                val sessionId = api.createVoiceSession(deviceId, target)
                api.uploadLog("Android foreground voice service started")
                streamer.start(sessionId, target) { status ->
                    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    manager.notify(NOTIFICATION_ID, notification(status))
                    publishStatus(status, modeFromStatus(status))
                    if (status == "Off") stopVoice()
                }
            } catch (_: Exception) {
                publishStatus("Voice stream failed to start.", Constants.MODE_ERROR)
                stopVoice()
            }
        }
    }

    private fun stopVoice() {
        streamer.stop()
        AssistantAudioPlayer.stopAll()
        closeControlChannel()
        releaseWakeLock()
        publishStatus("Off", Constants.MODE_OFF)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun enterSleep() {
        if (!streamer.enterSleep()) {
            stopVoice()
        }
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val powerManager = getSystemService(PowerManager::class.java)
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "VoiceStreamNext:VoiceSession").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseWakeLock() {
        wakeLock?.let { lock ->
            runCatching {
                if (lock.isHeld) lock.release()
            }
        }
        wakeLock = null
    }

    private fun publishStatus(status: String, mode: String) {
        lastStatus = status
        lastMode = mode
        sendBroadcast(Intent(Constants.ACTION_STATUS).apply {
            setPackage(packageName)
            putExtra(Constants.EXTRA_STATUS, lastStatus)
            putExtra(Constants.EXTRA_MODE, lastMode)
        })
        if (!sendControlStatus(status, mode)) {
            thread(name = "VoiceStreamNextStatusUpload") {
                runCatching {
                    api.uploadClientStatus(
                        mode = mode,
                        status = status,
                        lastError = if (mode == Constants.MODE_ERROR) status else null,
                    )
                }
            }
        }
    }

    private fun connectControlChannel() {
        if (controlSocket != null) return
        val deviceId = api.pairedDeviceId()
        val token = api.pairedDeviceToken()
        if (deviceId.isBlank() || token.isBlank()) return
        val url = buildControlUrl(api.loadConfig().serverUrl, deviceId, token)
        controlSocket = controlClient.newWebSocket(
            Request.Builder().url(url).build(),
            object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    sendControlStatus(lastStatus, lastMode)
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    val message = runCatching { JSONObject(text) }.getOrNull() ?: return
                    if (message.optString("type") == "server_ping") {
                        webSocket.send(JSONObject().put("type", "client_ping").put("sentAt", java.time.Instant.now().toString()).toString())
                    }
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (controlSocket === webSocket) controlSocket = null
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (controlSocket === webSocket) controlSocket = null
                }
            }
        )
    }

    private fun closeControlChannel() {
        controlSocket?.close(1000, "service stopped")
        controlSocket = null
    }

    private fun sendControlStatus(status: String, mode: String): Boolean {
        val socket = controlSocket ?: return false
        return socket.send(
            JSONObject()
                .put("type", "client_status")
                .put("mode", mode)
                .put("status", status)
                .put("protocolVersion", 1)
                .put("appVersion", BuildConfig.VERSION_NAME)
                .put("lastError", if (mode == Constants.MODE_ERROR) status else JSONObject.NULL)
                .put("reportedAt", java.time.Instant.now().toString())
                .toString()
        )
    }

    private fun buildControlUrl(serverUrl: String, deviceId: String, token: String): String {
        val trimmed = serverUrl.trimEnd('/')
        val base = when {
            trimmed.startsWith("https://") -> "wss://${trimmed.removePrefix("https://")}"
            trimmed.startsWith("http://") -> "ws://${trimmed.removePrefix("http://")}"
            else -> trimmed
        }
        return "$base/api/devices/${encode(deviceId)}/control?token=${encode(token)}"
    }

    private fun encode(value: String): String = URLEncoder.encode(value, Charsets.UTF_8.name())

    private fun modeFromStatus(status: String): String {
        val lower = status.lowercase()
        return when {
            lower.contains("missing") || lower.contains("failed") || lower.contains("error") -> Constants.MODE_ERROR
            lower.contains("sleeping") || lower.startsWith("sleep") -> Constants.MODE_SLEEPING
            lower.contains("waiting") || lower.contains("waking") -> Constants.MODE_AWAKE
            lower.contains("closed") || lower == "off" -> Constants.MODE_OFF
            else -> Constants.MODE_RECORDING
        }
    }

    private fun notification(text: String): Notification {
        val stopIntent = Intent(this, VoiceSessionService::class.java).apply {
            action = Constants.ACTION_STOP_VOICE
        }
        val stopPendingIntent = PendingIntent.getService(
            this,
            2,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        return Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("VoiceStream")
            .setContentText(text)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_media_pause, "Stop", stopPendingIntent)
            .build()
    }

    private fun createNotificationChannel() {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL_ID, "VoiceStream", NotificationManager.IMPORTANCE_LOW))
    }

    private companion object {
        const val CHANNEL_ID = "voice_stream_next_capture"
        const val NOTIFICATION_ID = 821
    }
}
