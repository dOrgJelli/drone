package com.example.voicestream

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONObject
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class VoiceSessionService : Service() {
    private val serviceActive = AtomicBoolean(false)
    private val streaming = AtomicBoolean(false)
    private val outgoingReady = AtomicBoolean(false)
    private val playbackQueue = LinkedBlockingQueue<ByteArray>(100)
    private val wakeController = WakeToggleController()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val preRollBuffer = PcmFrameBuffer(PRE_ROLL_FRAME_COUNT)
    private val pendingStreamBuffer = PcmFrameBuffer(MAX_PENDING_STREAM_FRAME_COUNT)
    private val cuePlayer = LocalCuePlayer()
    private val approvalCodeRecognizer = ApprovalCodeRecognizer()
    private lateinit var microphoneRouter: MicrophoneRouter
    private val approvalFinalizeRunnable = object : Runnable {
        override fun run() {
            handleApprovalUpdate(approvalCodeRecognizer.flush(SystemClock.elapsedRealtime()))
            if (approvalCodeRecognizer.isCollecting && serviceActive.get()) {
                mainHandler.postDelayed(this, approvalSettings.finalizeCheckIntervalMs)
            }
        }
    }
    private val logUploadRunnable = object : Runnable {
        override fun run() {
            if (serviceActive.get()) {
                uploadDiagnostics("periodic", force = false)
                mainHandler.postDelayed(this, LOG_UPLOAD_INTERVAL_MS)
            }
        }
    }
    private val reconnectControlWebSocketRunnable = Runnable {
        if (serviceActive.get() && controlWebSocket == null) {
            connectControlWebSocket()
        }
    }

    private val httpClient = OkHttpClient.Builder()
        .pingInterval(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private var serverUrl: String = Constants.DEFAULT_SERVER_URL
    private var webSocket: WebSocket? = null
    private var controlWebSocket: WebSocket? = null
    private var recorder: AudioRecord? = null
    private var player: AudioTrack? = null
    private var micThread: Thread? = null
    private var playbackThread: Thread? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wakeDetector: VoskWakeWordDetector? = null
    private var lastWakeToggleMs = 0L
    private var lastStatusCueMs = 0L
    @Volatile private var lastStatus = "Off"
    @Volatile private var lastMode = Constants.MODE_OFF
    @Volatile private var currentMicrophone = "Mic: phone"
    @Volatile private var lastApprovalStatus = ""
    @Volatile private var streamTarget = STREAM_TARGET_ASSISTANT
    @Volatile private var approvalSettings = ApprovalCodeSettings()

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        DroneLog.install(applicationContext)
        DroneLog.i("Service", "VoiceSessionService created")
        microphoneRouter = MicrophoneRouter(applicationContext)
        currentMicrophone = microphoneRouter.describeBestAvailable()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            Constants.ACTION_STOP,
            Constants.ACTION_STOP_LISTENING -> stopListeningMode()

            Constants.ACTION_START,
            Constants.ACTION_START_LISTENING -> {
                startListeningMode(resolveServerUrl(intent))
            }

            Constants.ACTION_START_STREAMING -> {
                startListeningMode(resolveServerUrl(intent))
                wakeController.manualStartStreaming()
                beginStreaming("Manual streaming")
            }

            Constants.ACTION_STOP_STREAMING -> {
                wakeController.manualStopStreaming(returnToListening = serviceActive.get())
                endStreaming(waitingStatus(), returnToListening = serviceActive.get())
            }

            Constants.ACTION_QUERY_STATUS -> {
                publishState(lastStatus, lastMode)
                if (!serviceActive.get()) {
                    stopSelf(startId)
                }
            }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopListeningMode()
        super.onDestroy()
    }

    private fun resolveServerUrl(intent: Intent?): String {
        val url = intent?.getStringExtra(Constants.EXTRA_SERVER_URL)
            ?: getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
                .getString(Constants.PREF_SERVER_URL, Constants.DEFAULT_SERVER_URL)
            ?: Constants.DEFAULT_SERVER_URL
        val token = intent?.getStringExtra(Constants.EXTRA_AUTH_TOKEN)
            ?: getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
                .getString(Constants.PREF_AUTH_TOKEN, "")
            ?: ""
        return withAuthToken(url, token)
    }

    private fun startListeningMode(url: String) {
        DroneLog.i("Service", "Starting listening mode")
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            wakeController.error()
            publishState("Error: missing microphone permission", Constants.MODE_ERROR)
            stopSelf()
            return
        }

        if (serverUrl != url) closeControlWebSocket("server URL changed")
        serverUrl = url
        if (!serviceActive.getAndSet(true)) {
            wakeController.startListening()
            startForeground(NOTIFICATION_ID, buildNotification("Waking local detector", Constants.MODE_LOADING))
            acquireWakeLock()
            ensureWakeDetector()
            startMicLoop()
            connectControlWebSocket()
            uploadDiagnostics("listening-start", force = true)
            mainHandler.postDelayed(logUploadRunnable, LOG_UPLOAD_INTERVAL_MS)
        } else {
            ensureControlWebSocketConnected()
        }

        if (!streaming.get()) {
            wakeController.startListening()
            publishState(waitingStatus(), waitingMode())
        }
    }

    private fun stopListeningMode() {
        DroneLog.i("Service", "Stopping listening mode")
        serviceActive.set(false)
        mainHandler.removeCallbacks(logUploadRunnable)
        mainHandler.removeCallbacks(approvalFinalizeRunnable)
        mainHandler.removeCallbacks(reconnectControlWebSocketRunnable)
        uploadDiagnostics("listening-stop", force = true)
        wakeController.stopAll()
        approvalCodeRecognizer.reset()
        endStreaming("Off", returnToListening = false)
        stopMicLoop()
        wakeDetector?.release()
        wakeDetector = null
        currentMicrophone = microphoneRouter.describeBestAvailable()
        wakeLock?.runCatching { if (isHeld) release() }
        wakeLock = null
        preRollBuffer.clear()
        pendingStreamBuffer.clear()
        lastApprovalStatus = ""
        publishState("Off", Constants.MODE_OFF)
        closeControlWebSocket("listening stopped")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    private fun beginStreaming(reason: String, target: String = STREAM_TARGET_ASSISTANT) {
        DroneLog.i("Streaming", "Begin streaming: $reason target=$target")
        if (streaming.getAndSet(true)) {
            publishState(if (streamTarget == STREAM_TARGET_PATCH) "Awake: patching into chat" else "Awake: streaming", Constants.MODE_STREAMING)
            return
        }

        streamTarget = target
        outgoingReady.set(false)
        seedPendingStreamFromPreRoll()
        playbackQueue.clear()
        startPlayback()
        connectWebSocket(serverUrl, target)
        publishState(if (target == STREAM_TARGET_PATCH) "Awake: patching into chat" else "Awake: connecting", Constants.MODE_STREAMING)
    }

    private fun endStreaming(status: String, returnToListening: Boolean) {
        DroneLog.i("Streaming", "End streaming: $status returnToListening=$returnToListening")
        if (!streaming.getAndSet(false)) {
            if (returnToListening) {
                publishState(status, waitingMode())
            }
            return
        }

        outgoingReady.set(false)
        streamTarget = STREAM_TARGET_ASSISTANT
        pendingStreamBuffer.clear()
        webSocket?.close(1000, "client stopped")
        webSocket = null

        playbackThread?.joinUnlessCurrent(500)
        playbackThread = null

        player?.let { localPlayer ->
            runCatching { localPlayer.stop() }
            runCatching { localPlayer.release() }
        }
        player = null
        playbackQueue.clear()
        wakeDetector?.reset()

        publishState(status, if (returnToListening && serviceActive.get()) waitingMode() else Constants.MODE_OFF)
    }

    private fun ensureWakeDetector() {
        if (wakeDetector != null) return
        wakeDetector = VoskWakeWordDetector(
            applicationContext,
            { status ->
            mainHandler.post {
                if (serviceActive.get()) {
                    if (streaming.get()) {
                        publishState("Awake: streaming", Constants.MODE_STREAMING)
                    } else if (wakeController.state == WakeState.LOCKED) {
                        publishState(lockedStatus(), Constants.MODE_LOCKED)
                    } else {
                        publishState(status, modeForWakeDetectorStatus(status))
                    }
                    }
                }
            },
            { text ->
                mainHandler.post {
                    handleLocalRecognizerText(text)
                }
            },
        ).also { it.prepare() }
    }

    private fun startMicLoop() {
        if (micThread?.isAlive == true) return

        val minBuffer = AudioRecord.getMinBufferSize(
            Constants.SAMPLE_RATE_HZ,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val bufferSize = maxOf(minBuffer, Constants.CHUNK_BYTES * 8)

        val localRecorder = AudioRecord(
            MediaRecorder.AudioSource.VOICE_RECOGNITION,
            Constants.SAMPLE_RATE_HZ,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            bufferSize
        )
        recorder = localRecorder

        if (localRecorder.state != AudioRecord.STATE_INITIALIZED) {
            publishState("Error: microphone failed to initialize", Constants.MODE_ERROR)
            runCatching { localRecorder.release() }
            recorder = null
            return
        }

        currentMicrophone = runCatching {
            microphoneRouter.routeForRecording(localRecorder).label
        }.onFailure { error ->
            DroneLog.w("MicRoute", "Falling back after microphone routing failure", error)
        }.getOrElse { "Mic: phone" }
        publishState(lastStatus, lastMode)

        micThread = Thread {
            val buffer = ByteArray(Constants.CHUNK_BYTES)
            try {
                localRecorder.startRecording()
                while (serviceActive.get()) {
                    val read = localRecorder.read(buffer, 0, buffer.size)
                    if (read <= 0) continue

                    val frame = if (read == buffer.size) buffer.copyOf() else buffer.copyOf(read)
                    val wasStreaming = streaming.get()
                    if (!wasStreaming) {
                        preRollBuffer.push(frame)
                    }

                    val phrase = wakeDetector?.acceptPcm(frame, frame.size)
                    if (phrase != null) {
                        mainHandler.post { handleWakeDetected(phrase) }
                    }

                    if (wasStreaming) {
                        if (outgoingReady.get()) {
                            flushPendingStreamFrames()
                            webSocket?.send(ByteString.of(*frame))
                        } else {
                            pendingStreamBuffer.push(frame)
                        }
                    }
                }
            } catch (error: Throwable) {
                DroneLog.e("MicLoop", "Microphone loop failed", error)
                if (serviceActive.get()) {
                    publishState(
                        "Error: microphone loop failed ${error.message ?: error.javaClass.simpleName}",
                        Constants.MODE_ERROR
                    )
                }
            }
        }.apply {
            name = "VoiceMicLoop"
            priority = Thread.MAX_PRIORITY
            DroneLog.i("MicLoop", "Starting microphone loop with $currentMicrophone")
            start()
        }
    }

    private fun stopMicLoop() {
        micThread?.joinUnlessCurrent(500)
        micThread = null

        recorder?.let { localRecorder ->
            runCatching { localRecorder.stop() }
            runCatching { localRecorder.release() }
        }
        recorder = null
        microphoneRouter.releaseRouting()
        currentMicrophone = microphoneRouter.describeBestAvailable()
        DroneLog.i("MicLoop", "Stopped microphone loop")
    }

    private fun handleWakeDetected(phrase: WakePhrase) {
        val action = wakeController.wakeDetected(phrase)
        if (action == WakeAction.NONE) return

        val now = SystemClock.elapsedRealtime()

        when (action) {
            WakeAction.START_STREAMING -> {
                if (now - lastWakeToggleMs < WAKE_DEBOUNCE_MS) return
                lastWakeToggleMs = now
                wakeDetector?.reset()
                DroneLog.i("Wake", "Wake word detected; starting stream")
                cuePlayer.play(LocalCue.WAKE)
                beginStreaming("Local wake word detected")
            }
            WakeAction.START_PATCH_STREAMING -> {
                if (now - lastWakeToggleMs < WAKE_DEBOUNCE_MS) return
                lastWakeToggleMs = now
                wakeDetector?.reset()
                DroneLog.i("Wake", "Patch phrase detected; starting patch stream")
                cuePlayer.play(LocalCue.WAKE)
                beginStreaming("Local patch phrase detected", STREAM_TARGET_PATCH)
            }
            WakeAction.PLAY_STATUS -> {
                if (now - lastStatusCueMs < STATUS_CUE_DEBOUNCE_MS) return
                lastStatusCueMs = now
                wakeDetector?.reset()
                DroneLog.i("Wake", "Status phrase detected")
                publishTemporaryStatus("Asleep: status OK")
                cuePlayer.play(LocalCue.STATUS)
            }
            WakeAction.STOP_STREAMING,
            WakeAction.NONE -> Unit
        }
    }

    private fun handleLocalRecognizerText(text: String) {
        if (!serviceActive.get()) return
        val update = approvalCodeRecognizer.accept(text, SystemClock.elapsedRealtime())
        handleApprovalUpdate(update)
        if (approvalCodeRecognizer.isCollecting) {
            mainHandler.removeCallbacks(approvalFinalizeRunnable)
            mainHandler.postDelayed(approvalFinalizeRunnable, approvalSettings.finalizeCheckIntervalMs)
        }
    }

    private fun handleApprovalUpdate(update: ApprovalCodeUpdate) {
        when (update) {
            ApprovalCodeUpdate.None -> Unit
            is ApprovalCodeUpdate.Collecting -> {
                if (update.partialCode.isBlank()) {
                    publishApprovalStatus(if (isLocked()) "Unlock code..." else "Approval code...")
                } else {
                    publishApprovalStatus(if (isLocked()) "Unlock: ${update.partialCode}" else "Approval: ${update.partialCode}")
                }
            }
            is ApprovalCodeUpdate.Completed -> {
                DroneLog.i("Approval", "Approval code detected length=${update.code.length}")
                handleCompletedApprovalCode(update.code)
            }
            ApprovalCodeUpdate.Cancelled -> {
                DroneLog.i("Approval", "Approval code capture cancelled")
                publishApprovalStatus("Approval cancelled")
            }
        }
    }

    private fun handleCompletedApprovalCode(code: String) {
        when {
            isLocked() && code == approvalSettings.unlockCode -> {
                wakeController.unlockToListening()
                cuePlayer.play(LocalCue.UNLOCK)
                publishApprovalStatus("Unlocked")
                publishState(waitingStatus(), waitingMode())
            }
            isLocked() && code == approvalSettings.lockedOffCode -> {
                DroneLog.i("Approval", "Locked off code detected; stopping listening mode")
                cuePlayer.play(LocalCue.LOCKED_OFF)
                publishApprovalStatus("Turning off")
                stopListeningMode()
            }
            isLocked() -> {
                DroneLog.i("Approval", "Ignored approval code while locked")
                lastApprovalStatus = ""
                broadcastState()
            }
            !isLocked() && code == approvalSettings.lockCode -> {
                wakeController.lockListening()
                cuePlayer.play(LocalCue.LOCK)
                publishApprovalStatus("Locked")
                if (streaming.get()) {
                    endStreaming(lockedStatus(), returnToListening = true)
                } else {
                    publishState(lockedStatus(), Constants.MODE_LOCKED)
                }
            }
            else -> {
                cuePlayer.play(LocalCue.STATUS)
                publishApprovalStatus("Approval sent: $code")
                uploadApprovalCode(code)
            }
        }
    }

    private fun uploadApprovalCode(code: String) {
        val prefs = getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        ApprovalCodeUploader.upload(
            applicationContext,
            serverUrl.ifBlank { prefs.getString(Constants.PREF_SERVER_URL, Constants.DEFAULT_SERVER_URL).orEmpty() },
            prefs.getString(Constants.PREF_AUTH_TOKEN, "").orEmpty(),
            code
        )
    }

    private fun ensureControlWebSocketConnected() {
        if (controlWebSocket != null) return
        connectControlWebSocket()
    }

    private fun closeControlWebSocket(reason: String) {
        mainHandler.removeCallbacks(reconnectControlWebSocketRunnable)
        controlWebSocket?.close(1000, reason)
        controlWebSocket = null
    }

    private fun scheduleControlWebSocketReconnect() {
        if (!serviceActive.get()) return
        mainHandler.removeCallbacks(reconnectControlWebSocketRunnable)
        mainHandler.postDelayed(reconnectControlWebSocketRunnable, RECONNECT_CONTROL_WEBSOCKET_MS)
    }

    private fun connectControlWebSocket() {
        if (controlWebSocket != null) return
        val url = controlUrlForAudioUrl(serverUrl)
        val request = Request.Builder().url(url).build()
        val socket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                DroneLog.i("ControlWebSocket", "Connected to $url")
                sendControlStatus(webSocket)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                if (!serviceActive.get()) return
                val data = bytes.toByteArray()
                if (isWavAudio(data)) {
                    ApprovalTtsPlayer.playWav(data)
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                if (!serviceActive.get()) return
                handleServerControlMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                DroneLog.i("ControlWebSocket", "Closed code=$code reason=$reason")
                if (this@VoiceSessionService.controlWebSocket === webSocket) {
                    this@VoiceSessionService.controlWebSocket = null
                }
                scheduleControlWebSocketReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                DroneLog.e("ControlWebSocket", "Control WebSocket failed response=${response?.code}", t)
                if (this@VoiceSessionService.controlWebSocket === webSocket) {
                    this@VoiceSessionService.controlWebSocket = null
                }
                scheduleControlWebSocketReconnect()
            }
        })
        controlWebSocket = socket
    }

    private fun controlUrlForAudioUrl(audioUrl: String): String {
        return Uri.parse(audioUrl).buildUpon().path("/control").build().toString()
    }

    private fun connectWebSocket(url: String, target: String) {
        val requestUrl = Uri.parse(url).buildUpon().appendQueryParameter("mode", target).build().toString()
        val request = Request.Builder().url(requestUrl).build()
        webSocket = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                DroneLog.i("WebSocket", "Connected to $requestUrl")
                if (!streaming.get()) {
                    webSocket.close(1000, "not streaming")
                    return
                }
                outgoingReady.set(true)
                flushPendingStreamFrames()
                publishState(if (streamTarget == STREAM_TARGET_PATCH) "Awake: patching into chat" else "Awake: streaming", Constants.MODE_STREAMING)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                if (!streaming.get()) return
                val data = bytes.toByteArray()
                if (isWavAudio(data)) {
                    ApprovalTtsPlayer.playWav(data)
                } else {
                    playbackQueue.offer(data)
                }
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleServerControlMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(code, reason)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                DroneLog.i("WebSocket", "Closed code=$code reason=$reason")
                if (this@VoiceSessionService.webSocket === webSocket) {
                    this@VoiceSessionService.webSocket = null
                }
                outgoingReady.set(false)
                if (streaming.get()) {
                    wakeController.manualStopStreaming(returnToListening = serviceActive.get())
                    endStreaming("${waitingStatus()}: server closed $code", returnToListening = serviceActive.get())
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                DroneLog.e("WebSocket", "WebSocket failed response=${response?.code}", t)
                if (this@VoiceSessionService.webSocket === webSocket) {
                    this@VoiceSessionService.webSocket = null
                }
                outgoingReady.set(false)
                if (streaming.get()) {
                    wakeController.manualStopStreaming(returnToListening = serviceActive.get())
                    endStreaming(
                        "${waitingStatus()}: WebSocket failed ${t.message ?: t.javaClass.simpleName}",
                        returnToListening = serviceActive.get()
                    )
                }
            }
        })
    }

    private fun handleServerControlMessage(text: String) {
        val parsed = runCatching { JSONObject(text) }.getOrNull() ?: return
        val type = parsed.optString("type")
        if (type == "approval_settings") {
            applyApprovalSettings(parsed.optJSONObject("settings"))
            return
        }
        if (type != "sleep" && type != "abort") return

        DroneLog.i("WebSocket", "Server $type command received")
        mainHandler.post {
            if (!streaming.get()) return@post
            wakeController.manualStopStreaming(returnToListening = serviceActive.get())
            cuePlayer.play(LocalCue.SLEEP)
            endStreaming(waitingStatus(), returnToListening = true)
        }
    }

    private fun applyApprovalSettings(raw: JSONObject?) {
        raw ?: return
        val next = ApprovalCodeSettings(
            triggerPhrase = raw.optString("triggerPhrase", approvalSettings.triggerPhrase).ifBlank { approvalSettings.triggerPhrase },
            unlockCode = raw.optString("unlockCode", approvalSettings.unlockCode).filter { it.isDigit() }.ifBlank { approvalSettings.unlockCode },
            lockCode = raw.optString("lockCode", approvalSettings.lockCode).filter { it.isDigit() }.ifBlank { approvalSettings.lockCode },
            lockedOffCode = raw.optString("lockedOffCode", approvalSettings.lockedOffCode).filter { it.isDigit() }.ifBlank { approvalSettings.lockedOffCode },
            minDigits = raw.optInt("minDigits", approvalSettings.minDigits).coerceIn(1, 8),
            maxDigits = raw.optInt("maxDigits", approvalSettings.maxDigits).coerceIn(1, 12),
            stableMs = raw.optLong("stableMs", approvalSettings.stableMs).coerceIn(250, 3_000),
            collectTimeoutMs = raw.optLong("collectTimeoutMs", approvalSettings.collectTimeoutMs).coerceIn(1_000, 15_000),
            duplicateCooldownMs = raw.optLong("duplicateCooldownMs", approvalSettings.duplicateCooldownMs).coerceIn(0, 15_000),
            finalizeCheckIntervalMs = raw.optLong("finalizeCheckIntervalMs", approvalSettings.finalizeCheckIntervalMs).coerceIn(100, 1_000),
        ).let { settings ->
            if (settings.maxDigits < settings.minDigits) settings.copy(maxDigits = settings.minDigits) else settings
        }
        approvalSettings = next
        approvalCodeRecognizer.configure(next)
        wakeDetector?.updateApprovalTriggerPhrase(next.triggerPhrase)
        if (wakeController.state == WakeState.LOCKED) {
            publishState(lockedStatus(), Constants.MODE_LOCKED)
        }
        DroneLog.i("Approval", "Applied approval settings trigger=${next.triggerPhrase} min=${next.minDigits} max=${next.maxDigits}")
    }

    private fun isWavAudio(data: ByteArray): Boolean {
        return data.size >= 12 &&
            data[0] == 'R'.code.toByte() &&
            data[1] == 'I'.code.toByte() &&
            data[2] == 'F'.code.toByte() &&
            data[3] == 'F'.code.toByte() &&
            data[8] == 'W'.code.toByte() &&
            data[9] == 'A'.code.toByte() &&
            data[10] == 'V'.code.toByte() &&
            data[11] == 'E'.code.toByte()
    }

    private fun startPlayback() {
        val minBuffer = AudioTrack.getMinBufferSize(
            Constants.SAMPLE_RATE_HZ,
            AudioFormat.CHANNEL_OUT_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        val bufferSize = maxOf(minBuffer, Constants.CHUNK_BYTES * 8)

        player = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setSampleRate(Constants.SAMPLE_RATE_HZ)
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()

        playbackThread = Thread {
            val localPlayer = player ?: return@Thread
            try {
                localPlayer.play()
                while (streaming.get()) {
                    val chunk = playbackQueue.poll(100, TimeUnit.MILLISECONDS) ?: continue
                    localPlayer.write(chunk, 0, chunk.size)
                }
            } catch (error: Throwable) {
                DroneLog.e("Playback", "Playback loop failed", error)
                if (streaming.get()) {
                    publishState(
                        "Awake: playback error ${error.message ?: error.javaClass.simpleName}",
                        Constants.MODE_STREAMING
                    )
                }
            }
        }.apply {
            name = "VoicePlayback"
            priority = Thread.MAX_PRIORITY
            start()
        }
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val powerManager = getSystemService(Context.POWER_SERVICE) as PowerManager
        wakeLock = powerManager.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "VoiceStream:VoskWake"
        ).apply {
            setReferenceCounted(false)
            acquire(TimeUnit.HOURS.toMillis(8))
        }
    }

    private fun seedPendingStreamFromPreRoll() {
        pendingStreamBuffer.clear()
        pendingStreamBuffer.pushAll(preRollBuffer.drain())
    }

    private fun flushPendingStreamFrames() {
        val localSocket = webSocket ?: return
        for (frame in pendingStreamBuffer.drain()) {
            localSocket.send(ByteString.of(*frame))
        }
    }

    private fun buildNotification(state: String, mode: String = modeFromStatus(state)): Notification {
        val stopIntent = Intent(this, VoiceSessionService::class.java).apply {
            action = Constants.ACTION_STOP_LISTENING
        }
        val pendingStop = PendingIntent.getService(
            this,
            1,
            stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val openIntent = PendingIntent.getActivity(
            this,
            2,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val builder = Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("Drone")
            .setContentText(notificationText(state, mode))
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentIntent(openIntent)
            .setOngoing(true)
            .setAutoCancel(false)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setLocalOnly(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .setPriority(Notification.PRIORITY_LOW)
            .addAction(android.R.drawable.ic_media_pause, "Stop", pendingStop)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
        }

        return builder.build().apply {
            flags = flags or Notification.FLAG_ONGOING_EVENT or Notification.FLAG_NO_CLEAR
        }
    }

    private fun publishState(status: String, mode: String = modeFromStatus(status)) {
        lastStatus = status
        lastMode = mode
        if (serviceActive.get()) {
            updateNotification(status, mode)
        }
        broadcastState()
    }

    private fun broadcastState() {
        sendBroadcast(Intent(Constants.ACTION_STATUS).apply {
            setPackage(packageName)
            putExtra(Constants.EXTRA_STATUS, lastStatus)
            putExtra(Constants.EXTRA_MODE, lastMode)
            putExtra(Constants.EXTRA_MICROPHONE, currentMicrophone)
            putExtra(Constants.EXTRA_APPROVAL_STATUS, lastApprovalStatus)
        })
        sendControlStatus()
    }

    private fun sendControlStatus(socket: WebSocket? = controlWebSocket) {
        val localSocket = socket ?: return
        val payload = JSONObject()
            .put("type", "android_status")
            .put("status", lastStatus)
            .put("mode", lastMode)
            .put("microphone", currentMicrophone)
            .put("approvalStatus", lastApprovalStatus)
            .put("reportedAt", System.currentTimeMillis())
            .toString()
        runCatching { localSocket.send(payload) }
    }

    private fun updateNotification(state: String, mode: String) {
        startForeground(NOTIFICATION_ID, buildNotification(state, mode))
    }

    private fun notificationText(status: String, mode: String): String {
        return when (mode) {
            Constants.MODE_LOADING -> "Waking local detector"
            Constants.MODE_LOCKED -> lockedStatus()
            Constants.MODE_LISTENING -> "Asleep: waiting for hey sebastian"
            Constants.MODE_STREAMING -> "Awake: streaming"
            Constants.MODE_ERROR -> status
            else -> "Running"
        }
    }

    private fun publishTemporaryStatus(status: String) {
        publishState(status, if (streaming.get()) Constants.MODE_STREAMING else Constants.MODE_LISTENING)
        mainHandler.postDelayed({
            if (serviceActive.get() && !streaming.get()) {
                publishState(waitingStatus(), waitingMode())
            } else if (serviceActive.get() && streaming.get()) {
                publishState("Awake: streaming", Constants.MODE_STREAMING)
            }
        }, TEMPORARY_STATUS_MS)
    }

    private fun publishApprovalStatus(status: String) {
        lastApprovalStatus = status
        broadcastState()
        mainHandler.postDelayed({
            if (lastApprovalStatus == status) {
                lastApprovalStatus = ""
                broadcastState()
            }
        }, APPROVAL_STATUS_MS)
    }

    private fun uploadDiagnostics(reason: String, force: Boolean) {
        val prefs = getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        DroneLogUploader.upload(
            applicationContext,
            serverUrl.ifBlank { prefs.getString(Constants.PREF_SERVER_URL, Constants.DEFAULT_SERVER_URL).orEmpty() },
            prefs.getString(Constants.PREF_AUTH_TOKEN, "").orEmpty(),
            reason,
            force
        )
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Voice session",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                setShowBadge(false)
            }
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.createNotificationChannel(channel)
        }
    }

    private fun Thread.joinUnlessCurrent(timeoutMs: Long) {
        if (Thread.currentThread() != this) {
            runCatching { join(timeoutMs) }
        }
    }

    private fun waitingStatus(): String {
        if (wakeController.state == WakeState.LOCKED) {
            return lockedStatus()
        }
        return if (wakeDetector?.available == true) {
            "Asleep: waiting for \"hey sebastian\""
        } else {
            "Waking local detector"
        }
    }

    private fun waitingMode(): String {
        if (wakeController.state == WakeState.LOCKED) {
            return Constants.MODE_LOCKED
        }
        return if (wakeDetector?.available == true) Constants.MODE_LISTENING else Constants.MODE_LOADING
    }

    private fun lockedStatus(): String {
        return if (wakeDetector?.available == true) {
            "Locked: ${approvalSettings.unlockCode} asleep, ${approvalSettings.lockedOffCode} off"
        } else {
            "Waking local detector"
        }
    }

    private fun modeForWakeDetectorStatus(status: String): String {
        return when {
            status.startsWith("Error:") -> Constants.MODE_ERROR
            wakeDetector?.available == true -> Constants.MODE_LISTENING
            else -> Constants.MODE_LOADING
        }
    }

    private fun modeFromStatus(status: String): String {
        return when {
            status == "Off" -> Constants.MODE_OFF
            status.startsWith("Error:") -> Constants.MODE_ERROR
            status.startsWith("Awake") -> Constants.MODE_STREAMING
            status.startsWith("Asleep") -> Constants.MODE_LISTENING
            status.startsWith("Locked") -> Constants.MODE_LOCKED
            status.startsWith("Waking") -> Constants.MODE_LOADING
            else -> Constants.MODE_LISTENING
        }
    }

    private fun isLocked(): Boolean = wakeController.state == WakeState.LOCKED

    private fun withAuthToken(url: String, token: String): String {
        if (token.isBlank()) return url
        val uri = Uri.parse(url)
        if (!uri.getQueryParameter("token").isNullOrBlank()) return url
        return uri.buildUpon()
            .appendQueryParameter("token", token)
            .build()
            .toString()
    }

    companion object {
        private const val CHANNEL_ID = "voice_stream_session"
        private const val NOTIFICATION_ID = 1001
        private const val WAKE_DEBOUNCE_MS = 1_500L
        private const val STATUS_CUE_DEBOUNCE_MS = 1_000L
        private const val TEMPORARY_STATUS_MS = 1_200L
        private const val APPROVAL_STATUS_MS = 2_500L
        private const val RECONNECT_CONTROL_WEBSOCKET_MS = 2_000L
        private const val STREAM_TARGET_ASSISTANT = "assistant"
        private const val STREAM_TARGET_PATCH = "patch"
        private const val PRE_ROLL_MS = 1_500
        private const val MAX_PENDING_STREAM_MS = 5_000
        private const val LOG_UPLOAD_INTERVAL_MS = 15_000L
        private const val PRE_ROLL_FRAME_COUNT = PRE_ROLL_MS / Constants.CHUNK_MS
        private const val MAX_PENDING_STREAM_FRAME_COUNT = MAX_PENDING_STREAM_MS / Constants.CHUNK_MS
    }
}
