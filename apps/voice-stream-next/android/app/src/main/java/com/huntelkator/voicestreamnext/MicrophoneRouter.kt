package com.huntelkator.voicestreamnext

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.AudioRecord
import android.os.Build

class MicrophoneRouter(private val context: Context) {
    private val audioManager = context.getSystemService(AudioManager::class.java)
    private var originalMode: Int? = null
    private var bluetoothScoStarted = false
    private var communicationDeviceSet = false

    fun routeForRecording(recorder: AudioRecord): MicrophoneSelection {
        val selection = choosePreferredInput()
        runCatching {
            if (originalMode == null) {
                originalMode = audioManager.mode
            }
            audioManager.mode = AudioManager.MODE_IN_COMMUNICATION
        }

        if (selection.isBluetooth) {
            enableBluetoothRouting(selection.device)
        }

        selection.device?.let { device ->
            runCatching { recorder.preferredDevice = device }
        }

        return selection
    }

    fun releaseRouting() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && communicationDeviceSet) {
            runCatching { audioManager.clearCommunicationDevice() }
        }
        if (bluetoothScoStarted) {
            @Suppress("DEPRECATION")
            runCatching { audioManager.isBluetoothScoOn = false }
            @Suppress("DEPRECATION")
            runCatching { audioManager.stopBluetoothSco() }
        }
        originalMode?.let { mode ->
            runCatching { audioManager.mode = mode }
        }
        originalMode = null
        bluetoothScoStarted = false
        communicationDeviceSet = false
    }

    private fun choosePreferredInput(): MicrophoneSelection {
        val preferred = getInputDevices()
            .sortedWith(compareBy<AudioDeviceInfo> { priorityFor(it.type) }.thenBy { safeName(it) })
            .firstOrNull()

        return if (preferred == null) {
            MicrophoneSelection(null, "Mic: phone", isBluetooth = false)
        } else {
            MicrophoneSelection(preferred, labelFor(preferred), isBluetooth = preferred.isBluetoothInput())
        }
    }

    private fun getInputDevices(): List<AudioDeviceInfo> {
        return runCatching {
            audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
                .filter { it.isSource }
                .filter { device -> !device.isBluetoothInput() || hasBluetoothConnectPermission() }
        }.getOrDefault(emptyList())
    }

    @SuppressLint("MissingPermission")
    private fun enableBluetoothRouting(device: AudioDeviceInfo?) {
        if (!hasBluetoothConnectPermission()) return

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val communicationDevice = runCatching {
                audioManager.availableCommunicationDevices
                    .firstOrNull { it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || it.safeIsBleHeadset() }
                    ?: device
            }.getOrNull()
            if (communicationDevice != null) {
                communicationDeviceSet = runCatching {
                    audioManager.setCommunicationDevice(communicationDevice)
                }.getOrDefault(false)
            }
        } else {
            @Suppress("DEPRECATION")
            runCatching { audioManager.startBluetoothSco() }
            @Suppress("DEPRECATION")
            runCatching { audioManager.isBluetoothScoOn = true }
            bluetoothScoStarted = true
        }
    }

    private fun hasBluetoothConnectPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
    }

    private fun labelFor(device: AudioDeviceInfo): String {
        val name = safeName(device)
        val generic = when {
            device.isBluetoothInput() -> "Bluetooth headset"
            device.type == AudioDeviceInfo.TYPE_WIRED_HEADSET -> "wired headset"
            device.type == AudioDeviceInfo.TYPE_USB_HEADSET || device.type == AudioDeviceInfo.TYPE_USB_DEVICE -> "USB headset"
            device.type == AudioDeviceInfo.TYPE_BUILTIN_MIC -> "phone"
            else -> "external mic"
        }
        return if (name.isBlank() || name.equals(generic, ignoreCase = true)) {
            "Mic: $generic"
        } else {
            "Mic: $name"
        }
    }

    private fun priorityFor(type: Int): Int {
        return when {
            type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || type.safeIsBleHeadsetType() -> 0
            type == AudioDeviceInfo.TYPE_WIRED_HEADSET -> 1
            type == AudioDeviceInfo.TYPE_USB_HEADSET || type == AudioDeviceInfo.TYPE_USB_DEVICE -> 2
            type == AudioDeviceInfo.TYPE_BUILTIN_MIC -> 3
            else -> 4
        }
    }

    private fun safeName(device: AudioDeviceInfo): String {
        return runCatching { device.productName?.toString().orEmpty().trim() }.getOrDefault("")
    }

    private fun AudioDeviceInfo.isBluetoothInput(): Boolean {
        return type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO || safeIsBleHeadset()
    }

    private fun AudioDeviceInfo.safeIsBleHeadset(): Boolean {
        return type.safeIsBleHeadsetType()
    }

    private fun Int.safeIsBleHeadsetType(): Boolean {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && this == AudioDeviceInfo.TYPE_BLE_HEADSET
    }
}

data class MicrophoneSelection(
    val device: AudioDeviceInfo?,
    val label: String,
    val isBluetooth: Boolean,
)
