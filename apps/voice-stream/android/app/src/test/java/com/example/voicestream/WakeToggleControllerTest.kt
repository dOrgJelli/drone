package com.example.voicestream

import org.junit.Assert.assertEquals
import org.junit.Test

class WakeToggleControllerTest {
    @Test
    fun heySebastianStartsStreamingAndDoesNotStopIt() {
        val controller = WakeToggleController()

        assertEquals(WakeAction.NONE, controller.startListening())
        assertEquals(WakeState.WAITING_FOR_WAKE, controller.state)
        assertEquals(WakeAction.START_STREAMING, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.STREAMING, controller.state)

        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.STREAMING, controller.state)
    }

    @Test
    fun localStopPhraseDoesNotControlStreaming() {
        val controller = WakeToggleController()

        assertEquals(WakeAction.NONE, controller.startListening())
        controller.unlockToListening()
        assertEquals(null, WakePhraseMatcher.match("that's it"))
        assertEquals(WakeState.WAITING_FOR_WAKE, controller.state)

        assertEquals(WakeAction.START_STREAMING, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.STREAMING, controller.state)

        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.STREAMING, controller.state)
    }

    @Test
    fun statusPhraseOnlyPlaysWhileWaiting() {
        val controller = WakeToggleController()

        assertEquals(WakeAction.NONE, controller.startListening())
        controller.unlockToListening()
        assertEquals(WakeAction.PLAY_STATUS, controller.wakeDetected(WakePhrase.STATUS))
        assertEquals(WakeState.WAITING_FOR_WAKE, controller.state)

        assertEquals(WakeAction.START_STREAMING, controller.wakeDetected(WakePhrase.START))
        assertEquals(WakeState.STREAMING, controller.state)

        assertEquals(WakeAction.NONE, controller.wakeDetected(WakePhrase.STATUS))
        assertEquals(WakeState.STREAMING, controller.state)
    }

    @Test
    fun patchPhraseStartsPatchStreaming() {
        val controller = WakeToggleController()

        controller.startListening()
        controller.unlockToListening()

        assertEquals(WakeAction.START_PATCH_STREAMING, controller.wakeDetected(WakePhrase.PATCH))
        assertEquals(WakeState.STREAMING, controller.state)
    }

    @Test
    fun clipboardPhraseStartsClipboardStreaming() {
        val controller = WakeToggleController()

        controller.startListening()
        controller.unlockToListening()

        assertEquals(WakeAction.START_CLIPBOARD_STREAMING, controller.wakeDetected(WakePhrase.CLIPBOARD))
        assertEquals(WakeState.STREAMING, controller.state)
    }

    @Test
    fun stopAllStopsStreamingAndTurnsOff() {
        val controller = WakeToggleController()

        controller.startListening()
        controller.unlockToListening()
        controller.wakeDetected(WakePhrase.START)

        assertEquals(WakeAction.STOP_STREAMING, controller.stopAll())
        assertEquals(WakeState.OFF, controller.state)
    }

    @Test
    fun toggleAwakeSleepSwitchesBetweenListeningAndDormant() {
        val controller = WakeToggleController()

        controller.startListening()
        assertEquals(WakeState.WAITING_FOR_WAKE, controller.state)
        assertEquals(WakeAction.NONE, controller.toggleAwakeSleep())
        assertEquals(WakeState.DORMANT, controller.state)
        assertEquals(WakeAction.NONE, controller.toggleAwakeSleep())
        assertEquals(WakeState.WAITING_FOR_WAKE, controller.state)
    }

    @Test
    fun toggleAwakeSleepStopsStreaming() {
        val controller = WakeToggleController()

        controller.startListening()
        controller.wakeDetected(WakePhrase.START)
        assertEquals(WakeAction.STOP_STREAMING, controller.toggleAwakeSleep())
        assertEquals(WakeState.WAITING_FOR_WAKE, controller.state)
    }

    @Test
    fun lockListeningReturnsToLockedState() {
        val controller = WakeToggleController()

        controller.startListening()
        controller.unlockToListening()
        assertEquals(WakeState.WAITING_FOR_WAKE, controller.state)
        assertEquals(WakeAction.NONE, controller.lockListening())
        assertEquals(WakeState.LOCKED, controller.state)
    }

    @Test
    fun matcherRecognizesStartAndStopPhrases() {
        assertEquals(null, WakePhraseMatcher.match("hey"))
        assertEquals(null, WakePhraseMatcher.match("hay"))
        assertEquals(WakePhrase.START, WakePhraseMatcher.match("hey sebastian"))
        assertEquals(WakePhrase.START, WakePhraseMatcher.match("hay sebastian"))
        assertEquals(WakePhrase.PATCH, WakePhraseMatcher.match("patch me in"))
        assertEquals(WakePhrase.CLIPBOARD, WakePhraseMatcher.match("can you transcribe"))
        assertEquals(WakePhrase.CLIPBOARD, WakePhraseMatcher.match("transcribe"))
        assertEquals(null, WakePhraseMatcher.match("that's it"))
        assertEquals(null, WakePhraseMatcher.match("that is it"))
        assertEquals(null, WakePhraseMatcher.match("thats it"))
        assertEquals(WakePhrase.STATUS, WakePhraseMatcher.match("status"))
        assertEquals(WakePhrase.STATUS, WakePhraseMatcher.match("state us"))
        assertEquals(WakePhrase.STATUS, WakePhraseMatcher.match("state is"))
        assertEquals(WakePhrase.STATUS, WakePhraseMatcher.match("check status"))
        assertEquals(WakePhrase.START, WakePhraseMatcher.match("hey sebastian that's it"))
        assertEquals(null, WakePhraseMatcher.match("what is it"))
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
}
