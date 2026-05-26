package com.huntelkator.voicestreamnext

import java.util.Locale

// Keep the status command implementation available, but do not detect it from local voice phrases.
internal const val STATUS_WAKE_COMMAND_ENABLED = false

object WakePhraseMatcher {
    fun match(text: String): WakePhrase? {
        val words = text.lowercase(Locale.US)
            .split(Regex("[^a-z]+"))
            .filter { it.isNotBlank() }

        val hasStart = words.windowed(2).any { pair ->
            (pair[0] == "hey" || pair[0] == "hay") && pair[1] == "sebastian"
        }
        val hasPatch = words.windowed(3).any { triple ->
            triple[0] == "patch" && triple[1] == "me" && triple[2] == "in"
        }
        val hasClipboard = words.windowed(3).any { triple ->
            triple[0] == "can" && triple[1] == "you" && triple[2] == "transcribe"
        } || words.any { it == "transcribe" }
        val hasSleep = words.windowed(3).any { triple ->
            triple[0] == "go" && triple[1] == "to" && triple[2] == "sleep"
        }
        val compact = words.joinToString("")
        val hasStatus = STATUS_WAKE_COMMAND_ENABLED && (
            words.any { it == "status" } ||
                compact == "stateus" ||
                compact == "stateis" ||
                compact == "statuse" ||
                compact == "statuscheck" ||
                compact == "checkstatus"
        )

        return when {
            hasSleep -> WakePhrase.SLEEP
            hasStart -> WakePhrase.START
            hasPatch -> WakePhrase.PATCH
            hasClipboard -> WakePhrase.CLIPBOARD
            hasStatus -> WakePhrase.STATUS
            else -> null
        }
    }
}

enum class WakePhrase {
    START,
    PATCH,
    CLIPBOARD,
    SLEEP,
    STATUS;

    val hasStart: Boolean get() = this == START
    val hasPatch: Boolean get() = this == PATCH
    val hasClipboard: Boolean get() = this == CLIPBOARD
    val hasSleep: Boolean get() = this == SLEEP
    val hasStatus: Boolean get() = this == STATUS
}
