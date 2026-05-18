package com.example.voicestream

import java.util.Locale

class ApprovalCodeRecognizer(
    private val minDigits: Int = 4,
    private val maxDigits: Int = 8,
    private val stableMs: Long = 900,
    private val collectTimeoutMs: Long = 5_000,
    private val duplicateCooldownMs: Long = 4_000,
) {
    private var collecting = false
    private var startedAtMs = 0L
    private var lastUpdateAtMs = 0L
    private var bestCode = ""
    private var lastCompletedCode = ""
    private var lastCompletedAtMs = 0L

    val isCollecting: Boolean
        get() = collecting

    fun accept(text: String, nowMs: Long): ApprovalCodeUpdate {
        val words = words(text)
        if (words.isEmpty()) return flush(nowMs)

        val phraseEnd = approvalCodePhraseEnd(words)
        if (!collecting && phraseEnd == null) {
            return ApprovalCodeUpdate.None
        }

        var shouldReportCollecting = false
        if (!collecting) {
            collecting = true
            startedAtMs = nowMs
            lastUpdateAtMs = nowMs
            bestCode = ""
            shouldReportCollecting = true
        }

        val candidateWords = if (phraseEnd != null) {
            words.drop(phraseEnd)
        } else {
            words
        }
        val candidate = candidateWords.mapNotNull { digitForWord(it) }.joinToString("")
        if (candidate.length > bestCode.length) {
            bestCode = candidate.take(maxDigits)
            lastUpdateAtMs = nowMs
            shouldReportCollecting = true
        }

        if (bestCode.length >= maxDigits) {
            return complete(nowMs)
        }

        return flush(nowMs).let { update ->
            if (update == ApprovalCodeUpdate.None && shouldReportCollecting) {
                ApprovalCodeUpdate.Collecting(bestCode)
            } else {
                update
            }
        }
    }

    fun flush(nowMs: Long): ApprovalCodeUpdate {
        if (!collecting) {
            return ApprovalCodeUpdate.None
        }

        if (bestCode.length >= minDigits && nowMs - lastUpdateAtMs >= stableMs) {
            return complete(nowMs)
        }

        if (nowMs - startedAtMs >= collectTimeoutMs) {
            reset()
            return ApprovalCodeUpdate.Cancelled
        }

        return ApprovalCodeUpdate.None
    }

    fun reset() {
        collecting = false
        startedAtMs = 0L
        lastUpdateAtMs = 0L
        bestCode = ""
    }

    private fun complete(nowMs: Long): ApprovalCodeUpdate {
        val code = bestCode
        reset()
        if (code == lastCompletedCode && nowMs - lastCompletedAtMs < duplicateCooldownMs) {
            return ApprovalCodeUpdate.None
        }
        lastCompletedCode = code
        lastCompletedAtMs = nowMs
        return ApprovalCodeUpdate.Completed(code)
    }

    private fun words(text: String): List<String> {
        return text.lowercase(Locale.US)
            .split(Regex("[^a-z0-9]+"))
            .filter { it.isNotBlank() }
    }

    private fun approvalCodePhraseEnd(words: List<String>): Int? {
        for (index in 0 until words.lastIndex) {
            if (words[index] == "approval" && words[index + 1] == "code") {
                return index + 2
            }
        }
        return null
    }

    private fun digitForWord(word: String): String? {
        return when (word) {
            "0", "zero", "oh", "o" -> "0"
            "1", "one", "won" -> "1"
            "2", "two", "too", "to" -> "2"
            "3", "three", "tree" -> "3"
            "4", "four", "for" -> "4"
            "5", "five" -> "5"
            "6", "six" -> "6"
            "7", "seven" -> "7"
            "8", "eight", "ate" -> "8"
            "9", "nine", "niner" -> "9"
            else -> null
        }
    }
}

sealed class ApprovalCodeUpdate {
    data object None : ApprovalCodeUpdate()
    data class Collecting(val partialCode: String) : ApprovalCodeUpdate()
    data class Completed(val code: String) : ApprovalCodeUpdate()
    data object Cancelled : ApprovalCodeUpdate()
}
