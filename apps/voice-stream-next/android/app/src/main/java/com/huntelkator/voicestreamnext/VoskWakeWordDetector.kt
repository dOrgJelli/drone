package com.huntelkator.voicestreamnext

import android.content.Context
import android.os.SystemClock
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.StorageService
import java.io.IOException
import java.util.concurrent.atomic.AtomicBoolean

class VoskWakeWordDetector(
    private val context: Context,
    private val onStatus: (String) -> Unit,
    private val onText: (String) -> Unit = {},
) {
    private val loading = AtomicBoolean(false)
    private val recognizerLock = Any()
    @Volatile private var model: Model? = null
    @Volatile private var recognizer: Recognizer? = null
    @Volatile var available: Boolean = false
        private set
    private var lastDetectedPhrase: WakePhrase? = null
    private var lastDetectedAtMs = 0L

    fun prepare() {
        if (available || !loading.compareAndSet(false, true)) return

        onStatus("Waking local detector")
        StorageService.unpack(
            context,
            ASSET_MODEL_DIR,
            TARGET_MODEL_DIR,
            { loadedModel ->
                val loadedRecognizer = try {
                    Recognizer(loadedModel, SAMPLE_RATE_HZ.toFloat(), buildWakeGrammar())
                } catch (error: IOException) {
                    onStatus("Error: Vosk recognizer failed ${error.message ?: error.javaClass.simpleName}")
                    null
                }
                synchronized(recognizerLock) {
                    model = loadedModel
                    recognizer = loadedRecognizer
                    available = loadedRecognizer != null
                }
                loading.set(false)
                if (available) {
                    onStatus("Awake: waiting for \"hey sebastian\"")
                }
            },
            { error ->
                available = false
                loading.set(false)
                onStatus("Error: local Vosk model failed to unpack (${error.message ?: error.javaClass.simpleName})")
            },
        )
    }

    fun acceptPcm(frame: ByteArray, length: Int): WakePhrase? {
        val resultJson = synchronized(recognizerLock) {
            val localRecognizer = recognizer ?: return null
            val accepted = runCatching { localRecognizer.acceptWaveForm(frame, length) }.getOrDefault(false)
            if (accepted) localRecognizer.result else localRecognizer.partialResult
        }
        return detectWakePhrase(resultJson)
    }

    fun reset() {
        synchronized(recognizerLock) {
            recognizer?.runCatching { reset() }
            lastDetectedPhrase = null
            lastDetectedAtMs = 0L
        }
    }

    fun release() {
        synchronized(recognizerLock) {
            available = false
            recognizer?.runCatching { close() }
            model?.runCatching { close() }
            recognizer = null
            model = null
            lastDetectedPhrase = null
            lastDetectedAtMs = 0L
        }
        loading.set(false)
    }

    private fun detectWakePhrase(json: String?): WakePhrase? {
        if (json.isNullOrBlank()) return null
        val text = runCatching {
            val obj = JSONObject(json)
            obj.optString("partial").ifBlank { obj.optString("text") }
        }.getOrDefault("")
        if (text.isNotBlank()) {
            onText(text)
        }
        val phrase = WakePhraseMatcher.match(text) ?: return null
        val now = SystemClock.elapsedRealtime()
        val suppress = synchronized(recognizerLock) {
            phrase == lastDetectedPhrase && now - lastDetectedAtMs < PHRASE_COOLDOWN_MS
        }
        if (suppress) return null
        synchronized(recognizerLock) {
            lastDetectedPhrase = phrase
            lastDetectedAtMs = now
        }
        return phrase
    }

    private fun buildWakeGrammar(): String = JSONArray(WAKE_GRAMMAR).toString()

    private companion object {
        private const val ASSET_MODEL_DIR = "model-en-us"
        private const val TARGET_MODEL_DIR = "vosk-model-en-us"
        private const val SAMPLE_RATE_HZ = 16_000
        private const val PHRASE_COOLDOWN_MS = 900L
        private val BASE_WAKE_GRAMMAR = listOf(
            "hey sebastian",
            "hay sebastian",
            "hey",
            "hay",
            "sebastian",
            "patch me in",
            "can you transcribe",
            "transcribe",
            "go to sleep",
            "go",
            "to",
            "sleep",
            "approval",
            "code",
            "approval code",
            "zero",
            "oh",
            "one",
            "two",
            "three",
            "four",
            "five",
            "six",
            "seven",
            "eight",
            "nine",
            "[unk]",
        )
        private val STATUS_WAKE_GRAMMAR = listOf(
            "status",
            "state us",
            "state is",
            "status check",
            "check status",
        )
        private val WAKE_GRAMMAR =
            BASE_WAKE_GRAMMAR + (if (STATUS_WAKE_COMMAND_ENABLED) STATUS_WAKE_GRAMMAR else emptyList())
    }
}
