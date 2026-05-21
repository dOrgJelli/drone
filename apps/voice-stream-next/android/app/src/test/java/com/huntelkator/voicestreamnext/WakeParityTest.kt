package com.huntelkator.voicestreamnext

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WakeParityTest {
    @Test
    fun matchesLegacyWakePhrases() {
        assertEquals(WakePhrase.START, WakePhraseMatcher.match("hey sebastian"))
        assertEquals(WakePhrase.PATCH, WakePhraseMatcher.match("patch me in"))
        assertEquals(WakePhrase.CLIPBOARD, WakePhraseMatcher.match("can you transcribe this"))
        assertEquals(WakePhrase.SLEEP, WakePhraseMatcher.match("go to sleep"))
        assertEquals(WakePhrase.STATUS, WakePhraseMatcher.match("status check"))
        assertNull(WakePhraseMatcher.match("hello there"))
    }

    @Test
    fun approvalCodeRequiresPhraseAndStableDigits() {
        val recognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 3_000)

        assertEquals(ApprovalCodeUpdate.None, recognizer.accept("one one five nine", 0))
        assertEquals(ApprovalCodeUpdate.Collecting(""), recognizer.accept("approval code", 100))
        assertEquals(ApprovalCodeUpdate.Collecting("11"), recognizer.accept("approval code one one", 200))
        assertEquals(ApprovalCodeUpdate.Collecting("1159"), recognizer.accept("approval code one one five nine", 300))
        assertEquals(ApprovalCodeUpdate.None, recognizer.flush(700))
        assertEquals(ApprovalCodeUpdate.Completed("1159"), recognizer.flush(850))
    }

    @Test
    fun approvalCodeRecognizesModeTransitionCodes() {
        val unlockRecognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 3_000)
        unlockRecognizer.accept("approval code one two three four", 0)
        assertEquals(ApprovalCodeUpdate.Completed("1234"), unlockRecognizer.flush(600))

        val lockRecognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 3_000)
        lockRecognizer.accept("approval code four three two one", 0)
        assertEquals(ApprovalCodeUpdate.Completed("4321"), lockRecognizer.flush(600))

        val offRecognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 3_000)
        offRecognizer.accept("approval code zero zero zero zero", 0)
        assertEquals(ApprovalCodeUpdate.Completed("0000"), offRecognizer.flush(600))
    }

    @Test
    fun approvalCodeCancelsWhenTooShort() {
        val recognizer = ApprovalCodeRecognizer(stableMs = 500, collectTimeoutMs = 1_000)

        assertEquals(ApprovalCodeUpdate.Collecting(""), recognizer.accept("approval code", 0))
        assertEquals(ApprovalCodeUpdate.Collecting("12"), recognizer.accept("approval code one two", 100))
        assertEquals(ApprovalCodeUpdate.Cancelled, recognizer.flush(1_100))
    }

    @Test
    fun approvalCodeSuppressesImmediateDuplicateCompletion() {
        val recognizer = ApprovalCodeRecognizer(stableMs = 500, duplicateCooldownMs = 4_000)

        recognizer.accept("approval code one two three four five six", 0)
        assertEquals(ApprovalCodeUpdate.Completed("123456"), recognizer.flush(600))

        recognizer.accept("approval code one two three four five six", 1_000)
        assertEquals(ApprovalCodeUpdate.None, recognizer.flush(1_600))

        recognizer.accept("approval code one two three four five six", 5_000)
        assertEquals(ApprovalCodeUpdate.Completed("123456"), recognizer.flush(5_600))
    }

    @Test
    fun syncsWakeStateFromServiceMode() {
        val controller = WakeToggleController()
        controller.applyServiceMode(Constants.MODE_RECORDING)
        assertEquals(WakeState.RECORDING, controller.state)

        controller.applyServiceMode(Constants.MODE_SLEEPING)
        assertEquals(WakeState.SLEEPING, controller.state)

        controller.applyServiceMode(Constants.MODE_OFF)
        assertEquals(WakeState.OFF, controller.state)
    }

    @Test
    fun recordingIgnoresWakeCommands() {
        val controller = WakeToggleController()
        controller.startAwake()
        assertEquals(WakeAction.START_RECORDING, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.RECORDING, controller.state)

        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.SLEEP))
        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.STATUS))
        assertEquals(WakeState.RECORDING, controller.state)
    }
}
