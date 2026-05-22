package com.huntelkator.voicestreamnext

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.SystemClock
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max

object AssistantAudioPlayer {
    private val generation = AtomicInteger(0)
    @Volatile private var activeTrack: AudioTrack? = null

    fun stopAll() {
        generation.incrementAndGet()
        releaseActiveTrack()
    }

    fun playWav(wav: ByteArray) {
        val playbackGeneration = generation.incrementAndGet()
        releaseActiveTrack()
        Thread {
            runCatching {
                if (playbackGeneration != generation.get()) return@runCatching
                val audio = WavPcm.parse(wav)
                val channelMask = if (audio.channels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
                val minBuffer = AudioTrack.getMinBufferSize(audio.sampleRateHz, channelMask, AudioFormat.ENCODING_PCM_16BIT)
                val track = AudioTrack.Builder()
                    .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
                    .setAudioFormat(AudioFormat.Builder().setSampleRate(audio.sampleRateHz).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(channelMask).build())
                    .setBufferSizeInBytes(max(minBuffer, audio.bytesPerFrame * audio.sampleRateHz / 4))
                    .setTransferMode(AudioTrack.MODE_STREAM)
                    .build()
                activeTrack = track
                try {
                    track.play()
                    var offset = 0
                    while (offset < audio.pcm.size) {
                        if (playbackGeneration != generation.get()) return@runCatching
                        val written = track.write(audio.pcm, offset, audio.pcm.size - offset, AudioTrack.WRITE_BLOCKING)
                        if (written <= 0) return@runCatching
                        offset += written
                    }
                    SystemClock.sleep(audio.durationMs + 180L)
                } finally {
                    if (activeTrack === track) activeTrack = null
                    runCatching { track.stop() }
                    runCatching { track.release() }
                }
            }
        }.apply {
            name = "VoiceStreamAssistantAudio"
            isDaemon = true
            start()
        }
    }

    private fun releaseActiveTrack() {
        activeTrack?.let { track ->
            runCatching { track.pause() }
            runCatching { track.stop() }
            runCatching { track.flush() }
            runCatching { track.release() }
        }
        activeTrack = null
    }

    private data class WavPcm(val pcm: ByteArray, val sampleRateHz: Int, val channels: Int, val bitsPerSample: Int) {
        val bytesPerFrame: Int = channels * bitsPerSample / 8
        val durationMs: Long = if (bytesPerFrame <= 0 || sampleRateHz <= 0) 0L else pcm.size.toLong() * 1000L / bytesPerFrame / sampleRateHz

        companion object {
            fun parse(wav: ByteArray): WavPcm {
                require(wav.size >= 12)
                require(ascii(wav, 0, 4) == "RIFF" && ascii(wav, 8, 4) == "WAVE")
                var offset = 12
                var channels = 0
                var sampleRateHz = 0
                var bitsPerSample = 0
                var format = 0
                var pcm: ByteArray? = null
                while (offset + 8 <= wav.size) {
                    val chunkId = ascii(wav, offset, 4)
                    val chunkSize = readUInt32Le(wav, offset + 4)
                    val dataStart = offset + 8
                    val dataEnd = dataStart + chunkSize
                    require(chunkSize >= 0 && dataEnd <= wav.size)
                    when (chunkId) {
                        "fmt " -> {
                            format = readUInt16Le(wav, dataStart)
                            channels = readUInt16Le(wav, dataStart + 2)
                            sampleRateHz = readUInt32Le(wav, dataStart + 4)
                            bitsPerSample = readUInt16Le(wav, dataStart + 14)
                        }
                        "data" -> pcm = wav.copyOfRange(dataStart, dataEnd)
                    }
                    offset = dataEnd + (chunkSize % 2)
                }
                require(format == 1 && (channels == 1 || channels == 2) && sampleRateHz > 0 && bitsPerSample == 16)
                return WavPcm(requireNotNull(pcm), sampleRateHz, channels, bitsPerSample)
            }

            private fun ascii(bytes: ByteArray, offset: Int, length: Int): String = String(bytes, offset, length, Charsets.US_ASCII)
            private fun readUInt16Le(bytes: ByteArray, offset: Int): Int = (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8)
            private fun readUInt32Le(bytes: ByteArray, offset: Int): Int = (bytes[offset].toInt() and 0xff) or ((bytes[offset + 1].toInt() and 0xff) shl 8) or ((bytes[offset + 2].toInt() and 0xff) shl 16) or ((bytes[offset + 3].toInt() and 0xff) shl 24)
        }
    }
}
