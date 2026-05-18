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
        val compact = words.joinToString("")
        val hasStatus = words.any { it == "status" } ||
            compact == "stateus" ||
            compact == "stateis" ||
            compact == "statuse" ||
            compact == "statuscheck" ||
            compact == "checkstatus"

        return when {
            hasStart -> WakePhrase.START
            hasStatus -> WakePhrase.STATUS
            else -> null
        }
    }
}

enum class WakePhrase {
    START,
    STATUS;

    val hasStart: Boolean
        get() = this == START

    val hasStatus: Boolean
        get() = this == STATUS
}
