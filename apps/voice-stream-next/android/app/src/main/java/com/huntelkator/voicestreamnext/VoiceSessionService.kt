package com.huntelkator.voicestreamnext

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import kotlin.concurrent.thread

class VoiceSessionService : Service() {
    private lateinit var api: VoiceStreamApi
    private lateinit var streamer: AudioStreamer

    override fun onCreate() {
        super.onCreate()
        api = VoiceStreamApi(applicationContext)
        streamer = AudioStreamer(applicationContext, api)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            Constants.ACTION_STOP_VOICE -> stopVoice()
            else -> startVoice()
        }
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        streamer.stop()
        super.onDestroy()
    }

    private fun startVoice() {
        startForeground(NOTIFICATION_ID, notification("Voice stream starting"))
        thread(name = "VoiceStreamNextServiceStart") {
            try {
                val deviceId = api.pairedDeviceId()
                if (deviceId.isBlank()) {
                    stopVoice()
                    return@thread
                }
                val sessionId = api.createVoiceSession(deviceId)
                api.uploadLog("Android foreground voice service started")
                streamer.start(sessionId) { status ->
                    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    manager.notify(NOTIFICATION_ID, notification(status))
                }
            } catch (_: Exception) {
                stopVoice()
            }
        }
    }

    private fun stopVoice() {
        streamer.stop()
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
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
