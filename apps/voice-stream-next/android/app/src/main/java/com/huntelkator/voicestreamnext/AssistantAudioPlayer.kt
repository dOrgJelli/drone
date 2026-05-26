package com.huntelkator.voicestreamnext

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.media.MediaPlayer
import android.os.SystemClock
import java.io.File
import java.util.ArrayDeque
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.max

object AssistantAudioPlayer {
    private val generation = AtomicInteger(0)
    private val lock = Any()
    private val queue = ArrayDeque<PlaybackRequest>()
    @Volatile private var activeTrack: AudioTrack? = null
    @Volatile private var activePlayer: MediaPlayer? = null
    @Volatile private var workerRunning = false

    fun stopAll() {
        generation.incrementAndGet()
        synchronized(lock) {
            queue.clear()
            workerRunning = false
        }
        releaseActivePlayback()
    }

    fun playWav(context: Context, wav: ByteArray, onStatus: ((String) -> Unit)? = null) {
        synchronized(lock) {
            queue.add(PlaybackRequest(context.applicationContext, wav, onStatus))
            if (workerRunning) return
            workerRunning = true
        }
        startWorker()
    }

    private fun startWorker() {
        Thread {
            val playbackGeneration = generation.get()
            try {
                while (playbackGeneration == generation.get()) {
                    val next = synchronized(lock) { queue.poll() } ?: break
                    runCatching {
                        val attributes = AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANT)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build()
                        try {
                            playPcmWav(next, attributes, playbackGeneration)
                        } catch (error: Exception) {
                            ClientLog.w("AssistantAudio", "PCM WAV playback unavailable signature=${signature(next.wav)} message=${error.message ?: error.javaClass.simpleName}; trying MediaPlayer", error)
                            playWithMediaPlayer(next, attributes, playbackGeneration)
                        }
                    }.onFailure { error ->
                        ClientLog.w("AssistantAudio", "Assistant audio playback failed", error)
                        next.onStatus?.invoke("Assistant audio failed: ${error.message ?: error.javaClass.simpleName}")
                    }
                }
            } finally {
                var restart = false
                synchronized(lock) {
                    if (playbackGeneration == generation.get()) {
                        workerRunning = false
                        if (queue.isNotEmpty()) {
                            workerRunning = true
                            restart = true
                        }
                    }
                }
                if (restart) startWorker()
            }
        }.apply {
            name = "VoiceStreamAssistantAudio"
            isDaemon = true
            start()
        }
    }

    private fun playPcmWav(next: PlaybackRequest, attributes: AudioAttributes, playbackGeneration: Int) {
        val audio = WavPcm.parse(next.wav)
        val channelMask = if (audio.channels == 1) AudioFormat.CHANNEL_OUT_MONO else AudioFormat.CHANNEL_OUT_STEREO
        val minBuffer = AudioTrack.getMinBufferSize(audio.sampleRateHz, channelMask, AudioFormat.ENCODING_PCM_16BIT)
        require(minBuffer > 0) { "AudioTrack does not support ${audio.sampleRateHz}Hz/${audio.channels}ch PCM16" }
        val focus = requestAudioFocus(next.context, attributes)
        val track = AudioTrack.Builder()
            .setAudioAttributes(attributes)
            .setAudioFormat(AudioFormat.Builder().setSampleRate(audio.sampleRateHz).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(channelMask).build())
            .setBufferSizeInBytes(max(minBuffer, audio.bytesPerFrame * audio.sampleRateHz / 4))
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        activeTrack = track
        try {
            ClientLog.i("AssistantAudio", "Playing assistant audio wavBytes=${next.wav.size} pcmBytes=${audio.pcm.size} sampleRate=${audio.sampleRateHz} channels=${audio.channels} durationMs=${audio.durationMs}")
            next.onStatus?.invoke("Playing assistant audio.")
            track.play()
            track.setVolume(AudioTrack.getMaxVolume())
            var offset = 0
            while (offset < audio.pcm.size) {
                if (playbackGeneration != generation.get()) return
                val written = track.write(audio.pcm, offset, audio.pcm.size - offset, AudioTrack.WRITE_BLOCKING)
                if (written <= 0) return
                offset += written
            }
            SystemClock.sleep(audio.durationMs + 180L)
            ClientLog.i("AssistantAudio", "Assistant audio played durationMs=${audio.durationMs}")
            next.onStatus?.invoke("Assistant audio played.")
        } finally {
            if (activeTrack === track) activeTrack = null
            runCatching { track.stop() }
            runCatching { track.release() }
            abandonAudioFocus(next.context, focus)
        }
    }

    private fun playWithMediaPlayer(next: PlaybackRequest, attributes: AudioAttributes, playbackGeneration: Int) {
        val file = File.createTempFile("assistant-audio-", audioExtension(next.wav), next.context.cacheDir)
        file.writeBytes(next.wav)
        val focus = requestAudioFocus(next.context, attributes)
        val player = MediaPlayer()
        val completed = CountDownLatch(1)
        var playbackError: String? = null
        activePlayer = player
        try {
            player.setAudioAttributes(attributes)
            player.setOnCompletionListener { completed.countDown() }
            player.setOnErrorListener { _, what, extra ->
                playbackError = "MediaPlayer error what=$what extra=$extra"
                completed.countDown()
                true
            }
            player.setDataSource(file.absolutePath)
            player.prepare()
            val durationMs = player.duration.takeIf { it > 0 }?.toLong() ?: 0L
            ClientLog.i("AssistantAudio", "Playing assistant audio with MediaPlayer bytes=${next.wav.size} signature=${signature(next.wav)} durationMs=$durationMs")
            next.onStatus?.invoke("Playing assistant audio.")
            player.start()
            while (playbackGeneration == generation.get()) {
                if (completed.await(200, TimeUnit.MILLISECONDS)) break
            }
            if (playbackGeneration != generation.get()) return
            playbackError?.let { error(it) }
            if (durationMs > 0L) SystemClock.sleep(180L)
            ClientLog.i("AssistantAudio", "Assistant audio played with MediaPlayer durationMs=$durationMs")
            next.onStatus?.invoke("Assistant audio played.")
        } finally {
            if (activePlayer === player) activePlayer = null
            runCatching { player.stop() }
            runCatching { player.release() }
            abandonAudioFocus(next.context, focus)
            runCatching { file.delete() }
        }
    }

    private fun audioExtension(bytes: ByteArray): String = when {
        bytes.size >= 12 && asciiOrEmpty(bytes, 0, 4) == "RIFF" && asciiOrEmpty(bytes, 8, 4) == "WAVE" -> ".wav"
        bytes.size >= 3 && asciiOrEmpty(bytes, 0, 3) == "ID3" -> ".mp3"
        bytes.size >= 2 && (bytes[0].toInt() and 0xff) == 0xff && (bytes[1].toInt() and 0xe0) == 0xe0 -> ".mp3"
        bytes.size >= 4 && asciiOrEmpty(bytes, 0, 4) == "OggS" -> ".ogg"
        bytes.size >= 12 && asciiOrEmpty(bytes, 4, 4) == "ftyp" -> ".m4a"
        else -> ".bin"
    }

    private fun signature(bytes: ByteArray): String {
        val prefix = bytes.take(12).joinToString(" ") { byte -> "%02x".format(byte) }
        val riff = if (bytes.size >= 12) "${asciiOrEmpty(bytes, 0, 4)}/${asciiOrEmpty(bytes, 8, 4)}" else "short"
        return "$riff bytes=${bytes.size} head=$prefix"
    }

    private fun asciiOrEmpty(bytes: ByteArray, offset: Int, length: Int): String {
        if (offset < 0 || length < 0 || offset + length > bytes.size) return ""
        return String(bytes, offset, length, Charsets.US_ASCII)
    }

    private fun releaseActivePlayback() {
        activeTrack?.let { track ->
            runCatching { track.pause() }
            runCatching { track.stop() }
            runCatching { track.flush() }
            runCatching { track.release() }
        }
        activeTrack = null
        activePlayer?.let { player ->
            runCatching { player.stop() }
            runCatching { player.release() }
        }
        activePlayer = null
    }

    private fun requestAudioFocus(context: Context, attributes: AudioAttributes): AudioFocusRequest? {
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return null
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            .setAcceptsDelayedFocusGain(false)
            .setOnAudioFocusChangeListener { }
            .build()
        val result = runCatching { audioManager.requestAudioFocus(request) }.getOrDefault(AudioManager.AUDIOFOCUS_REQUEST_FAILED)
        if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
            ClientLog.w("AssistantAudio", "Assistant audio focus not granted result=$result")
        }
        return request
    }

    private fun abandonAudioFocus(context: Context, request: AudioFocusRequest?) {
        if (request == null) return
        val audioManager = context.getSystemService(AudioManager::class.java) ?: return
        runCatching { audioManager.abandonAudioFocusRequest(request) }
    }

    private data class PlaybackRequest(
        val context: Context,
        val wav: ByteArray,
        val onStatus: ((String) -> Unit)?,
    )

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
