package com.huntelkator.voicestreamnext

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

class PairingPayloadParserTest {
    @Test
    fun parsesVoiceStreamPairingPayload() {
        val payload =
            "voicestream://pair?serverUrl=https%3A%2F%2Fexample.test&deviceId=device-1&token=abc123&displayName=Android&deviceType=android&minClientVersion=2&expiresAt=2099-01-01T00%3A00%3A00.000Z&pairingSessionId=session-1"

        val config = PairingPayloadParser.parse(payload).getOrThrow()

        assertEquals("https://example.test", config.serverUrl)
        assertEquals("device-1", config.deviceId)
        assertEquals("abc123", config.token)
        assertEquals("Android", config.deviceName)
        assertEquals(2L, config.minClientVersion)
    }

    @Test
    fun parsesDirectWebSocketUrlWithToken() {
        val config = PairingPayloadParser.parse("ws://192.168.1.20:3299/audio?token=abc123").getOrThrow()

        assertEquals("http://192.168.1.20:3299", config.serverUrl)
        assertEquals("abc123", config.token)
        assertEquals("", config.deviceId)
    }

    @Test
    fun parsesDirectWebSocketUrlWithDeviceId() {
        val config = PairingPayloadParser.parse("wss://example.test/audio?token=abc123&deviceId=device-9").getOrThrow()

        assertEquals("https://example.test", config.serverUrl)
        assertEquals("device-9", config.deviceId)
        assertEquals("abc123", config.token)
    }

    @Test
    fun convertsWebSocketUrlToHttpBase() {
        assertEquals("https://example.test:3299", PairingPayloadParser.webSocketToHttpUrl("wss://example.test:3299/audio?token=abc"))
        assertEquals("http://10.0.0.5:3299", PairingPayloadParser.webSocketToHttpUrl("ws://10.0.0.5:3299"))
    }

    @Test
    fun parsesUpdatePayload() {
        val apkUrl = "https://example.test/download/app-debug.apk"
        val payload = "voicestream://update?versionCode=28&apk=${encode(apkUrl)}"

        val config = PairingPayloadParser.parseUpdate(payload).getOrThrow()

        assertEquals(28L, config.versionCode)
        assertEquals(apkUrl, config.apkUrl)
        assertTrue(PairingPayloadParser.isUpdatePayload(payload))
    }

    @Test
    fun rejectsUpdatePayloadWithoutVersion() {
        val result = PairingPayloadParser.parseUpdate("voicestream://update?apk=https%3A%2F%2Fexample.test%2Fapp.apk")

        assertTrue(result.isFailure)
    }

    @Test
    fun rejectsPayloadWithoutToken() {
        val result = PairingPayloadParser.parse("wss://example.test/audio")

        assertTrue(result.isFailure)
    }

    @Test
    fun rejectsNonWebSocketPayload() {
        val result = PairingPayloadParser.parse("https://example.test/")

        assertTrue(result.isFailure)
    }

    private fun encode(value: String): String =
        URLEncoder.encode(value, StandardCharsets.UTF_8.name())
}
