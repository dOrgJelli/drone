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
    fun extractsApprovalCodes() {
        val recognizer = ApprovalCodeRecognizer()
        assertEquals("1234", recognizer.extract("approval code one two three four"))
        assertEquals("9087", recognizer.extract("approval code nine oh eight seven"))
        assertNull(recognizer.extract("approval code one two"))
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
