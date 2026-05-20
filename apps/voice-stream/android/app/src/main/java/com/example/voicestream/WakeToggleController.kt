package com.example.voicestream

class WakeToggleController {
    var state: WakeState = WakeState.OFF
        private set

    fun startListening(): WakeAction {
        state = WakeState.LOCKED
        return WakeAction.NONE
    }

    fun stopAll(): WakeAction {
        val action = if (state == WakeState.STREAMING) WakeAction.STOP_STREAMING else WakeAction.NONE
        state = WakeState.OFF
        return action
    }

    fun wakeDetected(phrase: WakePhrase): WakeAction {
        return when (state) {
            WakeState.WAITING_FOR_WAKE -> {
                if (phrase.hasStart) {
                    state = WakeState.STREAMING
                    WakeAction.START_STREAMING
                } else if (phrase.hasPatch) {
                    state = WakeState.STREAMING
                    WakeAction.START_PATCH_STREAMING
                } else if (phrase.hasStatus) {
                    WakeAction.PLAY_STATUS
                } else {
                    WakeAction.NONE
                }
            }
            WakeState.STREAMING -> {
                WakeAction.NONE
            }
            WakeState.LOCKED, WakeState.OFF, WakeState.ERROR -> WakeAction.NONE
        }
    }

    fun unlockToListening(): WakeAction {
        state = WakeState.WAITING_FOR_WAKE
        return WakeAction.NONE
    }

    fun lockListening(): WakeAction {
        val action = if (state == WakeState.STREAMING) WakeAction.STOP_STREAMING else WakeAction.NONE
        state = WakeState.LOCKED
        return action
    }

    fun manualStartStreaming(): WakeAction {
        state = WakeState.STREAMING
        return WakeAction.START_STREAMING
    }

    fun manualStopStreaming(returnToListening: Boolean): WakeAction {
        state = if (returnToListening) WakeState.WAITING_FOR_WAKE else WakeState.OFF
        return WakeAction.STOP_STREAMING
    }

    fun error(): WakeAction {
        val action = if (state == WakeState.STREAMING) WakeAction.STOP_STREAMING else WakeAction.NONE
        state = WakeState.ERROR
        return action
    }
}

enum class WakeState {
    OFF,
    LOCKED,
    WAITING_FOR_WAKE,
    STREAMING,
    ERROR,
}

enum class WakeAction {
    NONE,
    START_STREAMING,
    START_PATCH_STREAMING,
    STOP_STREAMING,
    PLAY_STATUS,
}
