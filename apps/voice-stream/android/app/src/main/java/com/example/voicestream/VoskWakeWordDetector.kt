package com.example.voicestream

import android.content.Context
import android.os.SystemClock
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
    private var lastLoggedText = ""
    private var lastLoggedAtMs = 0L
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
                    Recognizer(loadedModel, Constants.SAMPLE_RATE_HZ.toFloat(), WAKE_GRAMMAR)
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
                    onStatus("Asleep: waiting for \"hey sebastian\"")
                }
            },
            { error ->
                available = false
                loading.set(false)
                val detail = error.message ?: error.javaClass.simpleName
                onStatus("Error: local Vosk model failed to unpack from assets/$ASSET_MODEL_DIR ($detail)")
            }
        )
    }

    fun acceptPcm(frame: ByteArray, length: Int): WakePhrase? {
        val resultJson = synchronized(recognizerLock) {
            val localRecognizer = recognizer ?: return null
            val accepted = runCatching { localRecognizer.acceptWaveForm(frame, length) }.getOrDefault(false)
            if (accepted) {
                localRecognizer.result
            } else {
                localRecognizer.partialResult
            }
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
        logRecognizedText(text)
        if (text.isNotBlank()) {
            onText(text)
        }
        val phrase = WakePhraseMatcher.match(text)
        if (phrase != null) {
            val shouldSuppress = synchronized(recognizerLock) {
                val now = SystemClock.elapsedRealtime()
                if (phrase == lastDetectedPhrase && now - lastDetectedAtMs < PHRASE_COOLDOWN_MS) {
                    true
                } else {
                    lastDetectedPhrase = phrase
                    lastDetectedAtMs = now
                    false
                }
            }
            if (shouldSuppress) {
                return null
            }
            DroneLog.i("Vosk", "Matched local phrase=$phrase text=$text")
        }
        return phrase
    }

    private fun logRecognizedText(text: String) {
        if (text.isBlank()) return
        val now = SystemClock.elapsedRealtime()
        if (text != lastLoggedText || now - lastLoggedAtMs >= RECOGNIZER_LOG_INTERVAL_MS) {
            DroneLog.i("Vosk", "Local recognizer text=$text")
            lastLoggedText = text
            lastLoggedAtMs = now
        }
    }

    companion object {
        private const val ASSET_MODEL_DIR = "model-en-us"
        private const val TARGET_MODEL_DIR = "vosk-model-en-us"
        private const val RECOGNIZER_LOG_INTERVAL_MS = 1_500L
        private const val PHRASE_COOLDOWN_MS = 900L
        private const val WAKE_GRAMMAR = "[\"hey sebastian\", \"hay sebastian\", \"hey\", \"hay\", \"sebastian\", \"status\", \"state us\", \"state is\", \"status check\", \"check status\", \"approval\", \"code\", \"approval code\", \"zero\", \"oh\", \"one\", \"two\", \"three\", \"four\", \"five\", \"six\", \"seven\", \"eight\", \"nine\", \"[unk]\"]"
    }
}
