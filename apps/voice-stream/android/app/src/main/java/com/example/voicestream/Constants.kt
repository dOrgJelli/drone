package com.example.voicestream

object Constants {
    const val PREFS_NAME = "voice_stream_prefs"
    const val PREF_SERVER_URL = "server_url"
    const val PREF_AUTH_TOKEN = "auth_token"
    const val DEFAULT_SERVER_URL = "ws://127.0.0.1:3000/audio"

    const val ACTION_START = "com.example.voicestream.action.START"
    const val ACTION_STOP = "com.example.voicestream.action.STOP"
    const val ACTION_START_LISTENING = "com.example.voicestream.action.START_LISTENING"
    const val ACTION_STOP_LISTENING = "com.example.voicestream.action.STOP_LISTENING"
    const val ACTION_START_STREAMING = "com.example.voicestream.action.START_STREAMING"
    const val ACTION_STOP_STREAMING = "com.example.voicestream.action.STOP_STREAMING"
    const val ACTION_QUERY_STATUS = "com.example.voicestream.action.QUERY_STATUS"
    const val ACTION_STATUS = "com.example.voicestream.action.STATUS"

    const val EXTRA_SERVER_URL = "server_url"
    const val EXTRA_AUTH_TOKEN = "auth_token"
    const val EXTRA_STATUS = "status"
    const val EXTRA_MODE = "mode"
    const val EXTRA_MICROPHONE = "microphone"
    const val EXTRA_APPROVAL_STATUS = "approval_status"

    const val MODE_OFF = "off"
    const val MODE_LOCKED = "locked"
    const val MODE_LOADING = "loading"
    const val MODE_LISTENING = "listening"
    const val MODE_STREAMING = "streaming"
    const val MODE_ERROR = "error"

    const val SAMPLE_RATE_HZ = 16_000
    const val CHANNEL_COUNT = 1
    const val BYTES_PER_SAMPLE = 2
    const val CHUNK_MS = 20
    const val CHUNK_BYTES = SAMPLE_RATE_HZ * CHANNEL_COUNT * BYTES_PER_SAMPLE * CHUNK_MS / 1000
}
