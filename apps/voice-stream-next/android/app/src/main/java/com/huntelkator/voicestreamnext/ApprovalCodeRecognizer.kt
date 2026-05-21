package com.huntelkator.voicestreamnext

import java.util.Locale

class ApprovalCodeRecognizer {
    fun extract(text: String): String? {
        val words = text.lowercase(Locale.US)
            .split(Regex("[^a-z0-9]+"))
            .filter { it.isNotBlank() }
        val start = words.indexOfFirstIndexed { index, word -> word == "approval" && words.getOrNull(index + 1) == "code" }
        if (start < 0) return null
        val code = words.drop(start + 2).mapNotNull(::digitForWord).joinToString("").take(8)
        return if (code.length >= 4) code else null
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

    private inline fun <T> List<T>.indexOfFirstIndexed(predicate: (Int, T) -> Boolean): Int {
        for (index in indices) {
            if (predicate(index, this[index])) return index
        }
        return -1
    }
}
