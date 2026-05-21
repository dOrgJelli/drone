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
    val apkUrl: String? = null,
)

data class UpdateConfig(
    val versionCode: Long,
    val apkUrl: String? = null,
)

object PairingPayloadParser {
    fun parse(payload: String): Result<PairingConfig> = runCatching {
        val trimmed = payload.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("Pairing text is empty")

        when {
            trimmed.startsWith("voicestream://", ignoreCase = true) -> parseVoiceStreamPairing(trimmed)
            trimmed.startsWith("ws://", ignoreCase = true) || trimmed.startsWith("wss://", ignoreCase = true) ->
                parseWebSocketUrl(trimmed)
            else -> throw IllegalArgumentException("QR must be a VoiceStream pairing payload or ws:// server URL")
        }
    }

    fun isUpdatePayload(payload: String): Boolean = runCatching {
        val uri = URI(payload.trim())
        uri.scheme.equals("voicestream", ignoreCase = true) && uri.host.equals("update", ignoreCase = true)
    }.getOrDefault(false)

    fun parseUpdate(payload: String): Result<UpdateConfig> = runCatching {
        val trimmed = payload.trim()
        if (trimmed.isBlank()) throw IllegalArgumentException("Update QR is empty")

        val uri = URI(trimmed)
        if (!uri.scheme.equals("voicestream", ignoreCase = true) || !uri.host.equals("update", ignoreCase = true)) {
            throw IllegalArgumentException("QR does not contain VoiceStream update data")
        }

        val params = parseQuery(uri.rawQuery)
        val versionCode = params["versionCode"]?.toLongOrNull()
            ?: throw IllegalArgumentException("QR does not contain an app version")
        if (versionCode < 1) {
            throw IllegalArgumentException("QR contains an invalid app version")
        }

        UpdateConfig(versionCode, params["apk"]?.takeIf { it.isNotBlank() })
    }

    fun webSocketToHttpUrl(rawUrl: String): String {
        val uri = URI(rawUrl.trim())
        val scheme = when (uri.scheme?.lowercase()) {
            "wss" -> "https"
            "ws" -> "http"
            else -> throw IllegalArgumentException("Server URL must use ws:// or wss://")
        }
        if (uri.host.isNullOrBlank()) {
            throw IllegalArgumentException("Server URL is missing a host")
        }
        val portPart = if (uri.port > 0) ":${uri.port}" else ""
        return "$scheme://${uri.host}$portPart"
    }

    private fun parseVoiceStreamPairing(payload: String): PairingConfig {
        val uri = URI(payload)
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

        return PairingConfig(
            serverUrl = serverUrl,
            deviceId = deviceId,
            token = token,
            deviceName = params["displayName"]?.takeIf { it.isNotBlank() },
            deviceType = params["deviceType"]?.takeIf { it.isNotBlank() },
            minClientVersion = params["minClientVersion"]?.toLongOrNull(),
            expiresAt = params["expiresAt"]?.takeIf { it.isNotBlank() },
            pairingSessionId = params["pairingSessionId"]?.takeIf { it.isNotBlank() },
            apkUrl = params["apk"]?.takeIf { it.isNotBlank() },
        )
    }

    private fun parseWebSocketUrl(rawUrl: String): PairingConfig {
        val uri = URI(rawUrl)
        if (!uri.scheme.equals("ws", ignoreCase = true) && !uri.scheme.equals("wss", ignoreCase = true)) {
            throw IllegalArgumentException("Server URL must use ws:// or wss://")
        }
        if (uri.host.isNullOrBlank()) {
            throw IllegalArgumentException("Server URL is missing a host")
        }

        val params = parseQuery(uri.rawQuery)
        val token = params["token"]?.takeIf { it.isNotBlank() }
            ?: throw IllegalArgumentException("QR does not contain a pairing token")
        val deviceId = params["deviceId"]?.takeIf { it.isNotBlank() }.orEmpty()

        return PairingConfig(
            serverUrl = webSocketToHttpUrl(rawUrl),
            deviceId = deviceId,
            token = token,
            deviceName = params["displayName"]?.takeIf { it.isNotBlank() },
            deviceType = params["deviceType"]?.takeIf { it.isNotBlank() },
            minClientVersion = params["minClientVersion"]?.toLongOrNull()
                ?: params["minVersionCode"]?.toLongOrNull(),
            apkUrl = params["apk"]?.takeIf { it.isNotBlank() },
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
