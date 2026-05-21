package com.huntelkator.voicestreamnext

import android.content.Context
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

data class ApiConfig(
    val serverUrl: String,
    val authMode: String,
    val bearerToken: String,
    val devEmail: String,
    val devName: String,
    val devAdmin: Boolean
)

data class DevicePairing(val deviceId: String, val token: String)
data class DashboardSummary(val displayName: String, val threadCount: Int, val deviceCount: Int, val logCount: Int, val logs: List<String>)
data class AssistantExchange(val userMessage: String, val assistantMessage: String)
data class VoiceApprovalSettings(
    val unlockCode: String = "1234",
    val lockCode: String = "4321",
    val offCode: String = "0000",
)

class VoiceStreamApi(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    fun loadConfig(): ApiConfig {
        val prefs = context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
        return ApiConfig(
            serverUrl = prefs.getString(Constants.PREF_SERVER_URL, Constants.DEFAULT_SERVER_URL).orEmpty().trimEnd('/'),
            authMode = prefs.getString(Constants.PREF_AUTH_MODE, Constants.AUTH_DEV).orEmpty(),
            bearerToken = prefs.getString(Constants.PREF_BEARER_TOKEN, "").orEmpty(),
            devEmail = prefs.getString(Constants.PREF_DEV_EMAIL, Constants.DEFAULT_DEV_EMAIL).orEmpty(),
            devName = prefs.getString(Constants.PREF_DEV_NAME, Constants.DEFAULT_DEV_NAME).orEmpty(),
            devAdmin = prefs.getBoolean(Constants.PREF_DEV_ADMIN, true)
        )
    }

    fun saveConfig(config: ApiConfig) {
        context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(Constants.PREF_SERVER_URL, config.serverUrl.trimEnd('/'))
            .putString(Constants.PREF_AUTH_MODE, config.authMode)
            .putString(Constants.PREF_BEARER_TOKEN, config.bearerToken)
            .putString(Constants.PREF_DEV_EMAIL, config.devEmail)
            .putString(Constants.PREF_DEV_NAME, config.devName)
            .putBoolean(Constants.PREF_DEV_ADMIN, config.devAdmin)
            .apply()
    }

    fun pairedDeviceId(): String {
        return context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(Constants.PREF_DEVICE_ID, "").orEmpty()
    }

    fun pairedDeviceToken(): String {
        return context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE)
            .getString(Constants.PREF_DEVICE_TOKEN, "").orEmpty()
    }

    fun savePairing(pairing: DevicePairing, deviceName: String) {
        context.getSharedPreferences(Constants.PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(Constants.PREF_DEVICE_ID, pairing.deviceId)
            .putString(Constants.PREF_DEVICE_TOKEN, pairing.token)
            .putString(Constants.PREF_DEVICE_NAME, deviceName)
            .apply()
    }

    fun dashboard(): DashboardSummary {
        val json = request("GET", "/api/dashboard")
        val user = json.getJSONObject("user")
        val stats = json.getJSONObject("stats")
        val logs = json.optJSONArray("logs").orEmptyList { item ->
            val log = item as JSONObject
            "${log.optString("level")}: ${log.optString("message")}"
        }
        return DashboardSummary(
            displayName = user.optString("displayName", "VoiceStream user"),
            threadCount = stats.optInt("threadCount"),
            deviceCount = stats.optInt("deviceCount"),
            logCount = stats.optInt("logCount"),
            logs = logs
        )
    }

    fun pairDevice(deviceName: String): DevicePairing {
        val json = request(
            "POST",
            "/api/devices",
            JSONObject()
                .put("deviceType", "android")
                .put("displayName", deviceName)
        )
        return DevicePairing(
            deviceId = json.getJSONObject("device").getString("id"),
            token = json.getString("token")
        )
    }

    fun createVoiceSession(deviceId: String, mode: String = Constants.STREAM_TARGET_ASSISTANT): String {
        return request("POST", "/api/voice/sessions", JSONObject().put("deviceId", deviceId).put("mode", mode))
            .getJSONObject("session")
            .getString("id")
    }

    fun voiceApprovalSettings(): VoiceApprovalSettings {
        val settings = request("GET", "/api/settings/voice-approval").getJSONObject("settings")
        return VoiceApprovalSettings(
            unlockCode = settings.optString("unlockCode", "1234").filter { it.isDigit() }.ifBlank { "1234" },
            lockCode = settings.optString("lockCode", "4321").filter { it.isDigit() }.ifBlank { "4321" },
            offCode = settings.optString("lockedOffCode", "0000").filter { it.isDigit() }.ifBlank { "0000" },
        )
    }

    fun sendAssistantMessage(content: String): AssistantExchange {
        val thread = request("POST", "/api/assistant/threads", JSONObject().put("title", "Android voice thread"))
            .getJSONObject("thread")
        val messages = request(
            "POST",
            "/api/assistant/threads/${thread.getString("id")}/messages",
            JSONObject().put("content", content)
        ).getJSONArray("messages")
        return AssistantExchange(
            userMessage = messages.getJSONObject(0).optString("content"),
            assistantMessage = messages.getJSONObject(1).optString("content")
        )
    }

    fun uploadLog(message: String) {
        request(
            "POST",
            "/api/logs",
            JSONObject()
                .put("source", "android")
                .put("level", "info")
                .put("message", message)
        )
    }

    fun uploadApprovalCode(code: String, voiceSessionId: String? = null) {
        val body = JSONObject()
            .put("source", "android")
            .put("code", code)
        if (!voiceSessionId.isNullOrBlank()) body.put("voiceSessionId", voiceSessionId)
        request("POST", "/api/voice/approval-codes", body)
    }

    private fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
        val config = loadConfig()
        val url = "${config.serverUrl.trimEnd('/')}$path"
        val builder = Request.Builder().url(url)
        applyAuth(builder, config)
        if (body == null) {
            builder.method(method, null)
        } else {
            builder.method(method, body.toString().toRequestBody(JSON))
        }
        client.newCall(builder.build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw IOException(JSONObject(text.ifBlank { "{}" }).optString("error", "HTTP ${response.code}"))
            }
            return JSONObject(text.ifBlank { "{}" })
        }
    }

    private fun applyAuth(builder: Request.Builder, config: ApiConfig) {
        builder.header("content-type", "application/json")
        if (config.authMode == Constants.AUTH_BEARER && config.bearerToken.isNotBlank()) {
            builder.header("authorization", "Bearer ${config.bearerToken}")
        } else {
            builder.header("x-voice-dev-user-email", config.devEmail)
            builder.header("x-voice-dev-user-name", config.devName)
            builder.header("x-voice-dev-admin", if (config.devAdmin) "1" else "0")
        }
    }

    private fun JSONArray?.orEmptyList(mapper: (Any) -> String): List<String> {
        if (this == null) return emptyList()
        val next = mutableListOf<String>()
        for (index in 0 until length()) {
            next += mapper(get(index))
        }
        return next
    }

    private companion object {
        val JSON = "application/json; charset=utf-8".toMediaType()
    }
}
