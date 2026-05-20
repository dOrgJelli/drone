package com.example.voicestream

import java.util.Locale

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
        val compact = words.joinToString("")
        val hasStatus = words.any { it == "status" } ||
            compact == "stateus" ||
            compact == "stateis" ||
            compact == "statuse" ||
            compact == "statuscheck" ||
            compact == "checkstatus"

        return when {
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
    STATUS;

    val hasStart: Boolean
        get() = this == START

    val hasPatch: Boolean
        get() = this == PATCH

    val hasClipboard: Boolean
        get() = this == CLIPBOARD

    val hasStatus: Boolean
        get() = this == STATUS
}
