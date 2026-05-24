package com.huntelkator.voicestreamnext

import android.Manifest
import android.app.AlertDialog
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import java.net.URI
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    private lateinit var api: VoiceStreamApi
    private lateinit var browserAuth: BrowserAuthCoordinator
    private lateinit var serverInput: EditText
    private lateinit var deviceNameInput: EditText
    private lateinit var statusText: TextView
    private lateinit var approvalText: TextView
    private lateinit var microphoneText: TextView
    private lateinit var pairingMessageText: TextView
    private lateinit var primaryActionButton: Button
    private lateinit var offButton: Button
    private lateinit var signedOutPanel: View
    private lateinit var voicePanel: View
    private lateinit var settingsPanel: View
    private lateinit var settingsButton: Button
    private lateinit var signInButton: Button
    private lateinit var signOutButton: Button
    private lateinit var qrButton: ImageButton

    private val wakeController = WakeToggleController()
    private val approvalCodeRecognizer = ApprovalCodeRecognizer()
    @Volatile private var approvalSettings = VoiceApprovalSettings()
    private val cuePlayer = LocalCuePlayer()
    private var pendingStartAwake = false
    private var pendingStartTarget = Constants.STREAM_TARGET_ASSISTANT
    private var sessionMode = SessionMode.OFF

    private val statusReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            val status = intent?.getStringExtra(Constants.EXTRA_STATUS).orEmpty()
            val mode = intent?.getStringExtra(Constants.EXTRA_MODE).orEmpty()
            val microphone = intent?.getStringExtra(Constants.EXTRA_MICROPHONE).orEmpty()
            val approvalStatus = intent?.getStringExtra(Constants.EXTRA_APPROVAL_STATUS).orEmpty()
            if (status.isNotBlank()) {
                updateSessionUi(SessionMode.fromBroadcast(mode, status), status)
            }
            if (mode.isNotBlank()) {
                wakeController.applyServiceMode(mode)
            }
            if (microphone.isNotBlank()) {
                updateMicrophoneUi(microphone)
            }
            updateApprovalUi(approvalStatus)
        }
    }

    private val voicePermissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
        if (!grants.values.all { it }) {
            showStatus("Voice permissions denied.")
            return@registerForActivityResult
        }
        if (pendingStartAwake) {
            startAwakeService()
        } else {
            startVoiceSession(pendingStartTarget)
        }
    }

    private val qrScanLauncher = registerForActivityResult(ScanContract()) { result ->
        val text = result.contents
        if (text.isNullOrBlank()) {
            showPairingMessage("QR scan cancelled.")
        } else {
            applyPairingPayload(text)
        }
    }

    private val cameraPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
            launchQrScanner()
        } else {
            showPairingMessage("Camera permission denied. Paste the QR payload instead.")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        ClientLog.install(applicationContext)
        ClientLog.i("Activity", "MainActivity created")
        api = VoiceStreamApi(applicationContext)
        browserAuth = BrowserAuthCoordinator(api, browserAuthCallbacks())
        DiagnosticsUploader.upload(applicationContext, api, "activity-start", force = true)
        window.statusBarColor = COLOR_BACKGROUND
        window.navigationBarColor = COLOR_BACKGROUND
        buildUi()
        loadConfigIntoForm()
        updateSessionUi(SessionMode.OFF, "Ready")
        renderAuthState()
        if (api.pairedDeviceId().isNotBlank()) {
            refreshDashboard()
        }
    }

    override fun onStart() {
        super.onStart()
        ClientLog.i("Activity", "MainActivity started")
        ContextCompat.registerReceiver(
            this,
            statusReceiver,
            IntentFilter(Constants.ACTION_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        )
    }

    override fun onResume() {
        super.onResume()
        resyncServiceStatus()
    }

    override fun onStop() {
        runCatching { unregisterReceiver(statusReceiver) }
        super.onStop()
    }

    override fun onDestroy() {
        if (::browserAuth.isInitialized) browserAuth.stop()
        super.onDestroy()
    }

    private fun buildUi() {
        val screen = FrameLayout(this).apply {
            setBackgroundColor(COLOR_BACKGROUND)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(24.dp(), 48.dp(), 24.dp(), 196.dp())
        }
        screen.addView(root, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        ))

        root.addView(label("VoiceStream", 34f, COLOR_TEXT, true).apply { gravity = Gravity.CENTER })
        root.addView(label("Android client", 13f, COLOR_ACCENT, true).apply {
            gravity = Gravity.CENTER
            setPadding(0, 2.dp(), 0, 18.dp())
        })

        signedOutPanel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            background = rounded(COLOR_SURFACE, 18.dp(), COLOR_STROKE)
            setPadding(18.dp(), 18.dp(), 18.dp(), 18.dp())
            addView(label("Sign in to connect this phone", 20f, COLOR_TEXT, true).apply {
                gravity = Gravity.CENTER
            })
            addView(label("Use the web dashboard sign-in flow, including social login, then return here.", 13f, COLOR_MUTED, false).apply {
                gravity = Gravity.CENTER
                setPadding(0, 8.dp(), 0, 16.dp())
            })
            signInButton = button("Sign in") { signInWithBrowser() }
            addView(signInButton, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 52.dp()))
            addView(row(
                button("Scan QR") { startQrScan() },
                button("Open web") { openWebDashboard() },
            ))
            pairingMessageText = label("", 13f, COLOR_MUTED, false).apply {
                gravity = Gravity.CENTER
                setPadding(0, 14.dp(), 0, 0)
            }
            addView(pairingMessageText)
        }
        root.addView(signedOutPanel, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply {
            topMargin = 24.dp()
        })

        val hero = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        }
        voicePanel = hero
        primaryActionButton = Button(this).apply {
            setOnClickListener { togglePrimaryAction() }
            stylePrimaryButton(SessionMode.OFF)
        }
        hero.addView(primaryActionButton, LinearLayout.LayoutParams(166.dp(), 166.dp()))
        offButton = Button(this).apply {
            text = "Off"
            visibility = View.GONE
            styleSecondaryButton()
            setOnClickListener { turnOff() }
        }
        hero.addView(offButton, LinearLayout.LayoutParams(148.dp(), 48.dp()).apply { topMargin = 18.dp() })
        root.addView(hero)

        signOutButton = Button(this).apply {
            text = "Sign out"
            styleFloatingButton()
            setOnClickListener { signOut() }
        }
        screen.addView(signOutButton, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            54.dp(),
            Gravity.TOP or Gravity.END,
        ).apply {
            rightMargin = 18.dp()
            topMargin = 44.dp()
        })

        statusText = label("Ready", 15f, COLOR_MUTED, true).apply {
            gravity = Gravity.CENTER
            setPadding(18.dp(), 10.dp(), 18.dp(), 10.dp())
        }
        screen.addView(statusText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL,
        ).apply {
            leftMargin = 42.dp()
            rightMargin = 42.dp()
            bottomMargin = 132.dp()
        })

        approvalText = label("", 14f, COLOR_MUTED, true).apply {
            gravity = Gravity.CENTER
            visibility = View.GONE
            setPadding(18.dp(), 8.dp(), 18.dp(), 8.dp())
        }
        screen.addView(approvalText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL,
        ).apply {
            leftMargin = 42.dp()
            rightMargin = 42.dp()
            bottomMargin = 108.dp()
        })

        microphoneText = label("Mic: phone", 12f, COLOR_MUTED, true).apply {
            gravity = Gravity.CENTER
            setPadding(12.dp(), 8.dp(), 12.dp(), 8.dp())
            background = rounded(COLOR_FLOATING, 16.dp(), COLOR_STROKE)
        }
        screen.addView(microphoneText, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM or Gravity.END,
        ).apply {
            rightMargin = 18.dp()
            bottomMargin = 92.dp()
        })

        settingsPanel = ScrollView(this).apply {
            visibility = View.GONE
            setBackgroundColor(Color.TRANSPARENT)
            addView(buildSettingsContent())
        }
        screen.addView(settingsPanel, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM,
        ).apply {
            leftMargin = 16.dp()
            rightMargin = 16.dp()
            bottomMargin = 92.dp()
        })

        settingsButton = Button(this).apply {
            text = "Settings"
            styleFloatingButton()
            setOnClickListener { toggleSettings() }
        }
        screen.addView(settingsButton, FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.WRAP_CONTENT,
            54.dp(),
            Gravity.BOTTOM or Gravity.START,
        ).apply {
            leftMargin = 18.dp()
            bottomMargin = 22.dp()
        })

        qrButton = ImageButton(this).apply {
            contentDescription = "Scan VoiceStream QR"
            setImageResource(android.R.drawable.ic_menu_camera)
            scaleType = android.widget.ImageView.ScaleType.CENTER
            styleIconButton()
            setOnClickListener { startQrScan() }
        }
        screen.addView(qrButton, FrameLayout.LayoutParams(
            58.dp(),
            58.dp(),
            Gravity.BOTTOM or Gravity.END,
        ).apply {
            rightMargin = 18.dp()
            bottomMargin = 20.dp()
        })

        setContentView(screen)
    }

    private fun buildSettingsContent(): LinearLayout {
        serverInput = field("Server URL")
        deviceNameInput = field("Device name")

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = rounded(COLOR_SURFACE, 18.dp(), COLOR_STROKE)
            setPadding(16.dp(), 16.dp(), 16.dp(), 16.dp())

            addView(card("Connection").apply {
                addView(serverInput)
                addView(deviceNameInput)
                addView(row(
                    button("Save") { saveConfigFromForm() },
                    button("Sign in") { signInWithBrowser() },
                    button("Open web") { openWebDashboard() }
                ))
            })

            addView(card("Pairing").apply {
                addView(row(
                    button("Scan QR") { startQrScan() },
                    button("Refresh") { refreshDashboard() }
                ))
                addView(label("Scan a pairing or update QR from the web dashboard.", 12f, COLOR_MUTED, false).apply {
                    setPadding(0, 10.dp(), 0, 0)
                })
            })

            addView(label("Version: ${currentVersionLabel()}", 11f, COLOR_MUTED, false).apply {
                setPadding(0, 12.dp(), 0, 0)
            })
            addView(label("Diagnostics: ${ClientLog.path(this@MainActivity)}", 11f, COLOR_MUTED, false).apply {
                setPadding(0, 8.dp(), 0, 0)
            })
        }
    }

    private fun toggleSettings() {
        settingsPanel.visibility = if (settingsPanel.visibility == View.VISIBLE) View.GONE else View.VISIBLE
    }

    private fun togglePrimaryAction() {
        when (sessionMode) {
            SessionMode.OFF, SessionMode.ERROR -> ensureMicThenStartAwake()
            SessionMode.SLEEPING -> ensureMicThenStartAwake()
            SessionMode.AWAKE, SessionMode.LOADING, SessionMode.RECORDING -> enterSleep()
        }
    }

    private fun updateSessionUi(mode: SessionMode, status: String) {
        sessionMode = mode
        statusText.text = status
        statusText.setTextColor(if (mode == SessionMode.ERROR) COLOR_ACCENT else COLOR_MUTED)
        primaryActionButton.stylePrimaryButton(mode)
        offButton.visibility = if (mode == SessionMode.OFF || mode == SessionMode.ERROR) View.GONE else View.VISIBLE
    }

    private fun updateApprovalUi(approvalStatus: String) {
        if (approvalStatus.isBlank()) {
            approvalText.visibility = View.GONE
            approvalText.text = ""
        } else {
            approvalText.visibility = View.VISIBLE
            approvalText.text = approvalStatus
        }
    }

    private fun updateMicrophoneUi(microphone: String) {
        microphoneText.text = microphone
    }

    private fun loadConfigIntoForm() {
        val config = api.loadConfig()
        serverInput.setText(config.serverUrl)
        val prefs = getSharedPreferences(Constants.PREFS_NAME, MODE_PRIVATE)
        deviceNameInput.setText(prefs.getString(Constants.PREF_DEVICE_NAME, Constants.DEFAULT_DEVICE_NAME))
        updatePairingMessage()
    }

    private fun saveConfigFromForm() {
        val current = api.loadConfig()
        api.saveConfig(ApiConfig(
            serverUrl = serverInput.text.toString(),
            authMode = current.authMode.ifBlank { Constants.AUTH_DEV },
            bearerToken = current.bearerToken,
            devEmail = current.devEmail.ifBlank { Constants.DEFAULT_DEV_EMAIL },
            devName = current.devName.ifBlank { Constants.DEFAULT_DEV_NAME },
            devAdmin = current.devAdmin
        ))
        getSharedPreferences(Constants.PREFS_NAME, MODE_PRIVATE).edit()
            .putString(Constants.PREF_DEVICE_NAME, deviceNameInput.text.toString().ifBlank { Constants.DEFAULT_DEVICE_NAME })
            .apply()
        showStatus("Settings saved.")
    }

    private fun refreshDashboard() = runApi("Loading dashboard") {
        if (api.pairedDeviceId().isNotBlank() && api.pairedDeviceToken().isNotBlank()) {
            val displayName = api.pairedDeviceDisplayName().ifBlank { "this phone" }
            showStatus("Connected as $displayName.")
            return@runApi
        }
        val dashboard = api.dashboard()
        showStatus("Connected as ${dashboard.displayName}.")
    }

    private fun pairDevice() {
        saveConfigFromForm()
        val deviceName = deviceNameInput.text.toString().ifBlank { Constants.DEFAULT_DEVICE_NAME }
        runApi("Pairing Android device") {
            val pairing = api.pairDevice(deviceName)
            api.savePairing(pairing, deviceName)
            showStatus("Paired ${pairing.deviceId.take(14)}.")
            updatePairingMessage()
            runOnUiThread { renderAuthState() }
        }
    }

    private fun startQrScan() {
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            launchQrScanner()
        } else {
            cameraPermission.launch(Manifest.permission.CAMERA)
        }
    }

    private fun launchQrScanner() {
        runCatching {
            qrScanLauncher.launch(
                ScanOptions()
                    .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                    .setPrompt("Scan VoiceStream pairing or update QR")
                    .setBeepEnabled(false)
                    .setOrientationLocked(false)
            )
        }.onFailure { error ->
            showPairingMessage("Scanner unavailable: ${error.message}. Paste the QR payload instead.")
        }
    }

    private fun applyPairingPayload(payload: String) {
        if (isAndroidSetupUrl(payload)) {
            redeemAndroidSetup(payload)
            return
        }

        if (PairingPayloadParser.isUpdatePayload(payload)) {
            val config = PairingPayloadParser.parseUpdate(payload).getOrElse { error ->
                showPairingMessage("Update check failed: ${error.message}")
                return
            }
            handleUpdatePayload(config)
            return
        }

        val config = PairingPayloadParser.parse(payload).getOrElse { error ->
            showPairingMessage("Pairing failed: ${error.message}")
            return
        }

        val minClientVersion = config.minClientVersion ?: 1L
        if (BuildConfig.VERSION_CODE.toLong() < minClientVersion) {
            showUpdateRequired(config)
            return
        }
        config.expiresAt?.let { expiresAt ->
            runCatching { java.time.Instant.parse(expiresAt) }.getOrNull()?.let { expiry ->
                if (expiry.isBefore(java.time.Instant.now())) {
                    showPairingMessage("Pairing payload expired at $expiresAt.")
                    return
                }
            }
        }

        if (config.deviceId.isBlank()) {
            api.saveConfig(api.loadConfig().copy(serverUrl = config.serverUrl))
            loadConfigIntoForm()
            showPairingMessage("Server URL saved from QR. Pair this device to finish setup.")
            showStatus("Server URL saved from QR.")
            return
        }

        api.savePairing(config)
        loadConfigIntoForm()
        showPairingMessage("Paired ${config.deviceId.take(14)} from QR payload.")
        showStatus("Paired ${config.deviceId.take(14)} from QR payload.")
        renderAuthState()
    }

    private fun isAndroidSetupUrl(payload: String): Boolean = runCatching {
        val uri = URI(payload.trim())
        val scheme = uri.scheme?.lowercase()
        (scheme == "http" || scheme == "https") && uri.path.orEmpty().contains("/api/mobile/android/setup/")
    }.getOrDefault(false)

    private fun redeemAndroidSetup(payload: String) = runApi("Checking Android setup QR") {
        val result = api.redeemAndroidSetup(payload)
        if (result.updateAvailable) {
            val latestVersion = result.latestVersionCode ?: currentVersionCode() + 1
            runOnUiThread { showUpdateAvailable(UpdateConfig(latestVersion, result.apkUrl)) }
            return@runApi
        }

        val pairingPayload = result.pairingPayload
        if (pairingPayload.isNullOrBlank()) {
            showPairingMessage("Android setup QR did not return pairing data.")
            return@runApi
        }

        val config = PairingPayloadParser.parse(pairingPayload).getOrElse { error ->
            showPairingMessage("Pairing failed: ${error.message}")
            return@runApi
        }
        api.savePairing(config)
        runOnUiThread {
            loadConfigIntoForm()
            showPairingMessage("Paired ${config.deviceId.take(14)} from setup QR.")
            showStatus("Paired ${config.deviceId.take(14)} from setup QR.")
            renderAuthState()
        }
    }

    private fun handleUpdatePayload(config: UpdateConfig) {
        val currentVersionCode = currentVersionCode()
        if (currentVersionCode >= config.versionCode) {
            showPairingMessage("VoiceStream app is up to date.")
            return
        }
        showUpdateAvailable(config)
    }

    private fun showUpdateAvailable(config: UpdateConfig) {
        val message = "A newer VoiceStream build is available. Current versionCode is ${currentVersionCode()}; latest is ${config.versionCode}."
        showPairingMessage("Update available")
        AlertDialog.Builder(this)
            .setTitle("Update VoiceStream")
            .setMessage(message)
            .setPositiveButton("Download APK") { _, _ -> openUpdateUrl(config.apkUrl) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun showUpdateRequired(config: PairingConfig) {
        showPairingMessage("Update required")
        AlertDialog.Builder(this)
            .setTitle("Update VoiceStream")
            .setMessage("This server requires a newer app build before pairing. Download and install the latest APK, then scan again.")
            .setPositiveButton("Download APK") { _, _ -> openUpdateUrl(config.apkUrl) }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun openUpdateUrl(apkUrl: String?) {
        if (apkUrl.isNullOrBlank()) {
            Toast.makeText(this, "No APK download URL was included in the QR code", Toast.LENGTH_LONG).show()
            return
        }
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(apkUrl)))
        }.onFailure { error ->
            Toast.makeText(this, "Could not open APK URL: ${error.message}", Toast.LENGTH_LONG).show()
        }
    }

    private fun ensureMicThenStart(target: String = Constants.STREAM_TARGET_ASSISTANT, playCue: Boolean = true) {
        pendingStartAwake = false
        pendingStartTarget = target
        val missingPermissions = missingVoicePermissions()
        if (missingPermissions.isEmpty()) {
            startVoiceSession(target, playCue)
        } else {
            voicePermissions.launch(missingPermissions.toTypedArray())
        }
    }

    private fun ensureMicThenStartAwake() {
        pendingStartAwake = true
        pendingStartTarget = Constants.STREAM_TARGET_ASSISTANT
        val missingPermissions = missingVoicePermissions()
        if (missingPermissions.isEmpty()) {
            startAwakeService()
        } else {
            voicePermissions.launch(missingPermissions.toTypedArray())
        }
    }

    private fun missingVoicePermissions(): List<String> {
        return VoicePermissions.missingPermissions(Build.VERSION.SDK_INT) { permission ->
            checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED
        }
    }

    private fun resyncServiceStatus() {
        startService(Intent(this, VoiceSessionService::class.java).apply {
            action = Constants.ACTION_QUERY_STATUS
        })
    }

    private fun startVoiceSession(target: String = Constants.STREAM_TARGET_ASSISTANT, playCue: Boolean = true) {
        val deviceId = api.pairedDeviceId()
        if (deviceId.isBlank()) {
            showStatus("Pair this device first.")
            return
        }
        wakeController.manualStartRecording()
        if (playCue) cuePlayer.play(LocalCue.START_BUTTON)
        ContextCompat.startForegroundService(
            this,
            Intent(this, VoiceSessionService::class.java).apply {
                action = Constants.ACTION_START_VOICE
                putExtra(Constants.EXTRA_STREAM_TARGET, target)
            }
        )
        showStatus("Foreground voice service started.")
    }

    private fun refreshApprovalSettings() {
        val settings = runCatching { api.voiceApprovalSettings() }.getOrDefault(VoiceApprovalSettings())
        approvalSettings = settings
        approvalCodeRecognizer.configure(settings.toApprovalCodeSettings())
    }

    private fun startAwakeService() {
        val deviceId = api.pairedDeviceId()
        if (deviceId.isBlank()) {
            showStatus("Pair this device first.")
            return
        }
        refreshApprovalSettings()
        wakeController.startAwake()
        cuePlayer.play(LocalCue.WAKE)
        ContextCompat.startForegroundService(
            this,
            Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_START_AWAKE }
        )
        showStatus("Waking local detector.")
    }

    private fun stopVoiceSession(playCue: Boolean = true) {
        startService(Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_STOP_VOICE })
        wakeController.manualStopRecording(returnToAwake = true)
        if (playCue) cuePlayer.play(LocalCue.STOP_BUTTON)
        showStatus("Voice stream stopped.")
        updateSessionUi(SessionMode.AWAKE, "Voice stream stopped.")
    }

    private fun enterSleep() {
        startService(Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_SLEEP })
        wakeController.toggleAwakeSleep()
        showStatus("Sleeping.")
        updateSessionUi(SessionMode.SLEEPING, "Sleeping.")
    }

    private fun turnOff() {
        startService(Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_STOP_VOICE })
        wakeController.stopAll()
        cuePlayer.play(LocalCue.STOP_BUTTON)
        showStatus("Off.")
        updateSessionUi(SessionMode.OFF, "Off.")
    }

    private fun tryHandleApprovalText(text: String, finalizeNow: Boolean = false): Boolean {
        val now = SystemClock.elapsedRealtime()
        var update = approvalCodeRecognizer.accept(text, now)
        if (approvalCodeRecognizer.isCollecting && finalizeNow) {
            update = approvalCodeRecognizer.flush(now + approvalSettings.stableMs)
        }
        return when (update) {
            ApprovalCodeUpdate.None -> approvalCodeRecognizer.isCollecting
            is ApprovalCodeUpdate.Collecting -> {
                showCollectingStatus(update.partialCode)
                true
            }
            ApprovalCodeUpdate.Cancelled -> {
                showStatus("Approval cancelled")
                updateApprovalUi("Approval cancelled")
                true
            }
            is ApprovalCodeUpdate.Completed -> {
                processApprovalCode(update.code)
                true
            }
        }
    }

    private fun showCollectingStatus(partialCode: String) {
        val sleeping = wakeController.state == WakeState.SLEEPING
        val text = if (partialCode.isBlank()) {
            if (sleeping) "Unlock code..." else "Approval code..."
        } else if (sleeping) {
            "Unlock: $partialCode"
        } else {
            "Approval: $partialCode"
        }
        showStatus(text)
        updateApprovalUi(text)
    }

    private fun processApprovalCode(code: String) = runApi("Processing approval code") {
        val settings = approvalSettings
        when {
            wakeController.state == WakeState.SLEEPING && code == settings.unlockCode -> runOnUiThread {
                wakeController.startAwake()
                cuePlayer.play(LocalCue.UNLOCK)
                showStatus("Unlocked.")
                updateApprovalUi("")
            }
            code == settings.offCode -> runOnUiThread { turnOff() }
            wakeController.state != WakeState.SLEEPING && code == settings.lockCode -> runOnUiThread { enterSleep() }
            wakeController.state != WakeState.SLEEPING -> {
                api.uploadApprovalCode(code)
                cuePlayer.play(LocalCue.STATUS)
                runOnUiThread {
                    showStatus("Approval code uploaded.")
                    updateApprovalUi("Approval sent: $code")
                }
            }
            else -> showStatus("Sleeping.")
        }
    }

    private fun openWebDashboard() {
        saveConfigFromForm()
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(VoiceStreamWebUrls.dashboardUrl(serverInput.text.toString().ifBlank { Constants.DEFAULT_SERVER_URL }))))
    }

    private fun signInWithBrowser() {
        saveConfigFromForm()
        browserAuth.start(
            serverUrl = serverInput.text.toString().ifBlank { Constants.DEFAULT_SERVER_URL },
            deviceName = deviceNameInput.text.toString().ifBlank { Constants.DEFAULT_DEVICE_NAME },
        )
    }

    private fun signOut() {
        browserAuth.stop()
        turnOff()
        api.clearPairing()
        updatePairingMessage()
        renderAuthState()
        showStatus("Signed out.")
    }

    private fun browserAuthCallbacks(): BrowserAuthCoordinator.Callbacks {
        return object : BrowserAuthCoordinator.Callbacks {
            override fun onAuthStarting() {
                signInButton.isEnabled = false
                showStatus("Opening sign in.")
            }

            override fun openBrowser(uri: Uri) {
                startActivity(Intent(Intent.ACTION_VIEW, uri))
            }

            override fun onBrowserOpened() {
                showStatus("Finish sign in in your browser.")
                updatePairingMessage()
            }

            override fun onAuthWaiting() {
                showStatus("Waiting for browser sign in.")
            }

            override fun onAuthConnected() {
                signInButton.isEnabled = true
                loadConfigIntoForm()
                renderAuthState()
                showStatus("Signed in.")
            }

            override fun onAuthExpired() {
                signInButton.isEnabled = true
                showPairingMessage("Sign in expired. Try again.")
            }

            override fun onAuthError(message: String) {
                signInButton.isEnabled = true
                showPairingMessage(message)
            }
        }
    }

    private fun renderAuthState() {
        val connected = api.pairedDeviceId().isNotBlank() && api.pairedDeviceToken().isNotBlank()
        signedOutPanel.visibility = if (connected) View.GONE else View.VISIBLE
        voicePanel.visibility = if (connected) View.VISIBLE else View.GONE
        signOutButton.visibility = if (connected) View.VISIBLE else View.GONE
        qrButton.visibility = if (connected) View.GONE else View.VISIBLE
        settingsButton.visibility = View.VISIBLE
        if (!connected) {
            updateSessionUi(SessionMode.OFF, "Sign in to connect this phone.")
        } else if (sessionMode == SessionMode.OFF) {
            updateSessionUi(SessionMode.OFF, "Ready.")
        }
        updatePairingMessage()
    }

    private fun updatePairingMessage() {
        val deviceId = api.pairedDeviceId()
        pairingMessageText.text = if (deviceId.isBlank()) {
            if (browserAuth.isPending) "Waiting for browser sign in." else "Not signed in."
        } else {
            "Paired device ${deviceId.take(14)}"
        }
    }

    private fun currentVersionCode(): Long {
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            packageInfo.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            packageInfo.versionCode.toLong()
        }
    }

    private fun currentVersionLabel(): String {
        val packageInfo = packageManager.getPackageInfo(packageName, 0)
        val versionName = packageInfo.versionName?.takeIf { it.isNotBlank() } ?: "unknown"
        return "$versionName (versionCode ${currentVersionCode()})"
    }

    private fun runApi(workingStatus: String, block: () -> Unit) {
        showStatus(workingStatus)
        thread {
            try {
                block()
            } catch (error: Exception) {
                showStatus(error.message ?: "Request failed")
            }
        }
    }

    private fun showStatus(text: String) {
        runOnUiThread { statusText.text = text }
    }

    private fun showPairingMessage(message: String) {
        runOnUiThread {
            pairingMessageText.text = message
            Toast.makeText(this, message, Toast.LENGTH_LONG).show()
        }
    }

    private fun card(title: String): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        background = rounded(COLOR_SURFACE, 8.dp(), COLOR_STROKE)
        setPadding(16.dp(), 14.dp(), 16.dp(), 16.dp())
        val params = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
        params.setMargins(0, 0, 0, 14.dp())
        layoutParams = params
        addView(label(title, 18f, COLOR_TEXT, true))
    }

    private fun row(vararg views: View): LinearLayout = LinearLayout(this).apply {
        orientation = LinearLayout.HORIZONTAL
        gravity = Gravity.CENTER_VERTICAL
        setPadding(0, 8.dp(), 0, 0)
        views.forEach { view ->
            addView(view, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                rightMargin = 8.dp()
            })
        }
    }

    private fun field(hint: String): EditText = EditText(this).apply {
        setHint(hint)
        setSingleLine(true)
        textSize = 14f
        setTextColor(COLOR_TEXT)
        setHintTextColor(COLOR_MUTED)
        background = rounded(Color.WHITE, 6.dp(), COLOR_STROKE)
        setPadding(12.dp(), 0, 12.dp(), 0)
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 44.dp()).apply {
            topMargin = 10.dp()
        }
    }

    private fun button(textValue: String, onClick: () -> Unit): Button = Button(this).apply {
        text = textValue
        setTextColor(Color.WHITE)
        textSize = 13f
        typeface = Typeface.DEFAULT_BOLD
        background = rounded(COLOR_DARK, 6.dp(), COLOR_DARK)
        setOnClickListener { onClick() }
    }

    private fun label(textValue: String, size: Float, color: Int, bold: Boolean): TextView = TextView(this).apply {
        text = textValue
        textSize = size
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
        includeFontPadding = true
    }

    private fun Button.stylePrimaryButton(mode: SessionMode) {
        text = when (mode) {
            SessionMode.OFF, SessionMode.ERROR -> "Awake"
            SessionMode.SLEEPING -> "Awake"
            SessionMode.LOADING -> "Loading"
            SessionMode.AWAKE -> "Sleep"
            SessionMode.RECORDING -> "Sleep"
        }
        setTextColor(Color.WHITE)
        textSize = 18f
        typeface = Typeface.DEFAULT_BOLD
        background = rounded(
            when (mode) {
                SessionMode.OFF, SessionMode.ERROR -> COLOR_DARK
                SessionMode.SLEEPING -> COLOR_ACCENT
                SessionMode.LOADING -> COLOR_MUTED
                SessionMode.AWAKE, SessionMode.RECORDING -> COLOR_ACCENT
            },
            83.dp(),
            Color.TRANSPARENT,
        )
    }

    private fun Button.styleSecondaryButton() {
        setTextColor(COLOR_TEXT)
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        background = rounded(COLOR_FLOATING, 24.dp(), COLOR_STROKE)
    }

    private fun Button.styleFloatingButton() {
        setTextColor(COLOR_TEXT)
        textSize = 14f
        typeface = Typeface.DEFAULT_BOLD
        setPadding(18.dp(), 0, 18.dp(), 0)
        background = rounded(COLOR_FLOATING, 27.dp(), COLOR_STROKE)
    }

    private fun ImageButton.styleIconButton() {
        background = rounded(COLOR_FLOATING, 29.dp(), COLOR_STROKE)
        setColorFilter(COLOR_TEXT)
    }

    private fun rounded(fill: Int, radius: Int, stroke: Int): GradientDrawable = GradientDrawable().apply {
        setColor(fill)
        cornerRadius = radius.toFloat()
        setStroke(1.dp(), stroke)
    }

    private fun Int.dp(): Int = (this * resources.displayMetrics.density).toInt()

    private enum class SessionMode {
        OFF,
        LOADING,
        AWAKE,
        SLEEPING,
        RECORDING,
        ERROR;

        companion object {
            fun fromBroadcast(mode: String, status: String): SessionMode {
                return when (mode) {
                    Constants.MODE_AWAKE -> if (status.contains("Waking", ignoreCase = true)) LOADING else AWAKE
                    Constants.MODE_SLEEPING -> SLEEPING
                    Constants.MODE_RECORDING -> RECORDING
                    Constants.MODE_ERROR -> ERROR
                    else -> OFF
                }
            }
        }
    }

    private companion object {
        const val COLOR_BACKGROUND = 0xfff6f3eb.toInt()
        const val COLOR_SURFACE = 0xfffffcf4.toInt()
        const val COLOR_FLOATING = 0xfff0ebe0.toInt()
        const val COLOR_TEXT = 0xff1d211f.toInt()
        const val COLOR_MUTED = 0xff69716c.toInt()
        const val COLOR_ACCENT = 0xffc8644b.toInt()
        const val COLOR_STROKE = 0xffd8d2c4.toInt()
        const val COLOR_DARK = 0xff202724.toInt()
    }
}
