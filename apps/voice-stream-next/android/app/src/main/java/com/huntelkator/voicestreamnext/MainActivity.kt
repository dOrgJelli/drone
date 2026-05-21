package com.huntelkator.voicestreamnext

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import com.clerk.api.Clerk
import com.clerk.api.network.serialization.ClerkResult
import com.clerk.api.session.GetTokenOptions
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlin.concurrent.thread

class MainActivity : ComponentActivity() {
    private lateinit var api: VoiceStreamApi
    private lateinit var serverInput: EditText
    private lateinit var authModeInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var devEmailInput: EditText
    private lateinit var devNameInput: EditText
    private lateinit var deviceNameInput: EditText
    private lateinit var clerkEmailInput: EditText
    private lateinit var clerkPasswordInput: EditText
    private lateinit var devAdminInput: CheckBox
    private lateinit var statusText: TextView
    private lateinit var summaryText: TextView
    private lateinit var assistantInput: EditText
    private lateinit var assistantOutput: TextView
    private val wakeController = WakeToggleController()
    private val approvalCodeRecognizer = ApprovalCodeRecognizer()

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startVoiceSession() else showStatus("Microphone permission denied.")
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        api = VoiceStreamApi(applicationContext)
        window.statusBarColor = COLOR_BACKGROUND
        window.navigationBarColor = COLOR_BACKGROUND
        buildUi()
        loadConfigIntoForm()
        refreshDashboard()
    }

    private fun buildUi() {
        val scroll = ScrollView(this).apply {
            setBackgroundColor(COLOR_BACKGROUND)
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(20.dp(), 28.dp(), 20.dp(), 28.dp())
        }
        scroll.addView(root)

        root.addView(label("VoiceStream", 34f, COLOR_TEXT, true))
        root.addView(label("Android client", 13f, COLOR_ACCENT, true).apply { setPadding(0, 2.dp(), 0, 18.dp()) })

        serverInput = field("Server URL")
        authModeInput = field("Auth mode: dev or bearer")
        tokenInput = field("Clerk session token")
        devEmailInput = field("Dev email")
        devNameInput = field("Dev display name")
        deviceNameInput = field("Device name")
        clerkEmailInput = field("Clerk email")
        clerkPasswordInput = field("Clerk password").apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        devAdminInput = CheckBox(this).apply {
            text = "Dev user is admin"
            setTextColor(COLOR_MUTED)
        }

        root.addView(card("Connection").apply {
            addView(serverInput)
            addView(authModeInput)
            addView(tokenInput)
            addView(devEmailInput)
            addView(devNameInput)
            addView(deviceNameInput)
            addView(devAdminInput)
            addView(row(
                button("Save") { saveConfigFromForm() },
                button("Clerk sign in") { signInWithClerk() },
                button("Open web login") { openWebDashboard() }
            ))
            addView(clerkEmailInput)
            addView(clerkPasswordInput)
        })

        statusText = label("Ready", 15f, COLOR_MUTED, true)
        summaryText = label("", 14f, COLOR_TEXT, false)
        root.addView(card("Device").apply {
            addView(statusText)
            addView(row(
                button("Pair") { pairDevice() },
                button("Start voice") { ensureMicThenStart() },
                button("Stop voice") { stopVoiceSession() },
                button("Refresh") { refreshDashboard() }
            ))
            addView(summaryText)
        })

        assistantInput = field("Assistant message")
        assistantOutput = label("No assistant response yet.", 14f, COLOR_MUTED, false).apply {
            setPadding(0, 10.dp(), 0, 0)
        }
        root.addView(card("Assistant").apply {
            addView(assistantInput)
            addView(button("Send") { sendAssistantMessage() })
            addView(assistantOutput)
        })

        root.addView(card("Wake And Approval").apply {
            addView(field("Wake phrase or approval phrase").also { wakePhraseInput = it })
            addView(row(
                button("Awake") { enterAwake() },
                button("Run phrase") { processWakePhrase() },
                button("Sleep") { enterSleep() },
                button("Off") { turnOff() }
            ))
        })

        val clerkNote = if (BuildConfig.CLERK_PUBLISHABLE_KEY.isBlank()) {
            "Clerk SDK is installed. Set VOICE_STREAM_NEXT_ANDROID_CLERK_PUBLISHABLE_KEY for native initialization, or paste a Clerk session token here."
        } else {
            "Clerk SDK initialized for this build. Paste a session token or use the web dashboard login while native sign-in views are fleshed out."
        }
        root.addView(label(clerkNote, 12f, COLOR_MUTED, false).apply { setPadding(2.dp(), 8.dp(), 2.dp(), 0) })

        setContentView(scroll)
    }

    private fun loadConfigIntoForm() {
        val config = api.loadConfig()
        serverInput.setText(config.serverUrl)
        authModeInput.setText(config.authMode)
        tokenInput.setText(config.bearerToken)
        devEmailInput.setText(config.devEmail)
        devNameInput.setText(config.devName)
        devAdminInput.isChecked = config.devAdmin
        val prefs = getSharedPreferences(Constants.PREFS_NAME, MODE_PRIVATE)
        deviceNameInput.setText(prefs.getString(Constants.PREF_DEVICE_NAME, Constants.DEFAULT_DEVICE_NAME))
    }

    private fun saveConfigFromForm() {
        api.saveConfig(ApiConfig(
            serverUrl = serverInput.text.toString(),
            authMode = authModeInput.text.toString().ifBlank { Constants.AUTH_DEV },
            bearerToken = tokenInput.text.toString(),
            devEmail = devEmailInput.text.toString().ifBlank { Constants.DEFAULT_DEV_EMAIL },
            devName = devNameInput.text.toString().ifBlank { Constants.DEFAULT_DEV_NAME },
            devAdmin = devAdminInput.isChecked
        ))
        showStatus("Settings saved.")
    }

    private fun refreshDashboard() = runApi("Loading dashboard") {
        val dashboard = api.dashboard()
        val logText = dashboard.logs.take(4).joinToString("\n")
        showSummary("${dashboard.displayName}\nThreads: ${dashboard.threadCount}  Devices: ${dashboard.deviceCount}  Logs: ${dashboard.logCount}\n$logText")
        showStatus("Connected.")
    }

    private fun pairDevice() {
        saveConfigFromForm()
        val deviceName = deviceNameInput.text.toString().ifBlank { Constants.DEFAULT_DEVICE_NAME }
        runApi("Pairing Android device") {
            val pairing = api.pairDevice(deviceName)
            api.savePairing(pairing, deviceName)
            showStatus("Paired ${pairing.deviceId.take(14)}.")
            val dashboard = api.dashboard()
            val logText = dashboard.logs.take(4).joinToString("\n")
            showSummary("${dashboard.displayName}\nThreads: ${dashboard.threadCount}  Devices: ${dashboard.deviceCount}  Logs: ${dashboard.logCount}\n$logText")
        }
    }

    private fun ensureMicThenStart() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            startVoiceSession()
        } else {
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    private fun startVoiceSession() {
        val deviceId = api.pairedDeviceId()
        if (deviceId.isBlank()) {
            showStatus("Pair this device first.")
            return
        }
        wakeController.manualStartRecording()
        ContextCompat.startForegroundService(
            this,
            Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_START_VOICE }
        )
        showStatus("Foreground voice service started.")
    }

    private fun stopVoiceSession() {
        startService(Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_STOP_VOICE })
        wakeController.manualStopRecording(returnToAwake = true)
        showStatus("Voice stream stopped.")
    }

    private lateinit var wakePhraseInput: EditText

    private fun enterAwake() {
        wakeController.startAwake()
        showStatus("Awake. Listening for wake phrases.")
    }

    private fun enterSleep() {
        if (wakeController.state == WakeState.RECORDING) stopVoiceSession()
        wakeController.toggleAwakeSleep()
        showStatus("Sleeping.")
    }

    private fun turnOff() {
        startService(Intent(this, VoiceSessionService::class.java).apply { action = Constants.ACTION_STOP_VOICE })
        wakeController.stopAll()
        showStatus("Off.")
    }

    private fun processWakePhrase() {
        val text = wakePhraseInput.text.toString()
        wakePhraseInput.setText("")
        approvalCodeRecognizer.extract(text)?.let { code ->
            runApi("Uploading approval code") {
                api.uploadApprovalCode(code)
                showStatus("Approval code uploaded.")
            }
            return
        }
        val phrase = WakePhraseMatcher.match(text)
        if (phrase == null) {
            showStatus("No wake phrase matched.")
            return
        }
        val action = wakeController.wakeDetected(phrase)
        when (action) {
            WakeAction.START_RECORDING,
            WakeAction.START_PATCH_RECORDING,
            WakeAction.START_CLIPBOARD_RECORDING -> ensureMicThenStart()
            WakeAction.STOP_RECORDING,
            WakeAction.ENTER_SLEEPING -> {
                stopVoiceSession()
                showStatus("Sleeping.")
            }
            WakeAction.PLAY_STATUS -> showStatus("Mode: ${wakeController.state}")
            WakeAction.NONE -> showStatus("Mode: ${wakeController.state}")
        }
    }

    private fun sendAssistantMessage() = runApi("Sending assistant message") {
        val content = assistantInput.text.toString().trim()
        if (content.isBlank()) {
            showStatus("Type a message first.")
            return@runApi
        }
        val exchange = api.sendAssistantMessage(content)
        runOnUiThread {
            assistantOutput.text = "You: ${exchange.userMessage}\n\nAssistant: ${exchange.assistantMessage}"
            assistantInput.setText("")
        }
        showStatus("Assistant replied.")
    }

    private fun openWebDashboard() {
        saveConfigFromForm()
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(serverInput.text.toString().ifBlank { Constants.DEFAULT_SERVER_URL })))
    }

    private fun signInWithClerk() {
        val email = clerkEmailInput.text.toString().trim()
        val password = clerkPasswordInput.text.toString()
        if (BuildConfig.CLERK_PUBLISHABLE_KEY.isBlank()) {
            showStatus("Set VOICE_STREAM_NEXT_ANDROID_CLERK_PUBLISHABLE_KEY before building.")
            return
        }
        if (email.isBlank() || password.isBlank()) {
            showStatus("Enter Clerk email and password.")
            return
        }
        showStatus("Signing in with Clerk.")
        CoroutineScope(Dispatchers.Main).launch {
            try {
                val signIn = Clerk.auth.signInWithPassword {
                    identifier = email
                    this.password = password
                }
                if (signIn is ClerkResult.Failure<*>) {
                    showStatus(signIn.throwable?.message ?: "Clerk sign in failed.")
                    return@launch
                }
                val sessionId = (signIn as ClerkResult.Success).value.createdSessionId
                if (!sessionId.isNullOrBlank()) {
                    Clerk.auth.setActive(sessionId)
                }
                val token = Clerk.auth.getToken(GetTokenOptions())
                if (token is ClerkResult.Success) {
                    val current = api.loadConfig()
                    api.saveConfig(current.copy(authMode = Constants.AUTH_BEARER, bearerToken = token.value))
                    loadConfigIntoForm()
                    showStatus("Signed in with Clerk.")
                    refreshDashboard()
                } else {
                    showStatus("Signed in, but no Clerk token was returned.")
                }
            } catch (error: Exception) {
                showStatus(error.message ?: "Clerk sign in failed.")
            }
        }
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

    private fun showSummary(text: String) {
        runOnUiThread { summaryText.text = text }
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

    private fun rounded(fill: Int, radius: Int, stroke: Int) = android.graphics.drawable.GradientDrawable().apply {
        setColor(fill)
        cornerRadius = radius.toFloat()
        setStroke(1.dp(), stroke)
    }

    private fun Int.dp(): Int = (this * resources.displayMetrics.density).toInt()

    private companion object {
        const val COLOR_BACKGROUND = 0xfff6f3eb.toInt()
        const val COLOR_SURFACE = 0xfffffcf4.toInt()
        const val COLOR_TEXT = 0xff1d211f.toInt()
        const val COLOR_MUTED = 0xff69716c.toInt()
        const val COLOR_ACCENT = 0xffc8644b.toInt()
        const val COLOR_STROKE = 0xffd8d2c4.toInt()
        const val COLOR_DARK = 0xff202724.toInt()
    }
}
