package com.huntelkator.voicestreamnext

import java.net.URI
import java.net.URLDecoder
import java.nio.charset.StandardCharsets

data class PairingConfig(
    val serverUrl: String,
    val deviceId: String,
    val token: String,
    val deviceName: String? = null,
    val deviceType: String? = null,
    val minClientVersion: Long? = null,
    val expiresAt: String? = null,
    val pairingSessionId: String? = null,
)

object PairingPayloadParser {
    fun parse(payload: String): Result<PairingConfig> = runCatching {
        val trimmed = payload.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("Pairing text is empty")
        val uri = URI(trimmed)
        if (!uri.scheme.equals("voicestream", ignoreCase = true) || !uri.host.equals("pair", ignoreCase = true)) {
            throw IllegalArgumentException("QR does not contain VoiceStream pairing data")
        }

        val params = parseQuery(uri.rawQuery)
        val serverUrl = params["serverUrl"]?.trimEnd('/')
            ?: throw IllegalArgumentException("QR does not contain a server URL")
        val deviceId = params["deviceId"]?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("QR does not contain a device id")
        val token = params["token"]?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("QR does not contain a device token")

        PairingConfig(
            serverUrl = serverUrl,
            deviceId = deviceId,
            token = token,
            deviceName = params["displayName"]?.takeIf { it.isNotBlank() },
            deviceType = params["deviceType"]?.takeIf { it.isNotBlank() },
            minClientVersion = params["minClientVersion"]?.toLongOrNull(),
            expiresAt = params["expiresAt"]?.takeIf { it.isNotBlank() },
            pairingSessionId = params["pairingSessionId"]?.takeIf { it.isNotBlank() },
        )
    }

    private fun parseQuery(rawQuery: String?): Map<String, String> {
        if (rawQuery.isNullOrBlank()) return emptyMap()
        return rawQuery.split("&")
            .filter { it.isNotBlank() }
            .mapNotNull { pair ->
                val separator = pair.indexOf("=")
                if (separator < 0) decode(pair) to "" else decode(pair.substring(0, separator)) to decode(pair.substring(separator + 1))
            }
            .toMap()
    }

    private fun decode(value: String): String =
        URLDecoder.decode(value, StandardCharsets.UTF_8.name())
}
