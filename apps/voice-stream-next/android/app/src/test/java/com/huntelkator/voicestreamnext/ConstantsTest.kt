package com.huntelkator.voicestreamnext

import org.junit.Assert.assertEquals
import org.junit.Test

class ConstantsTest {
    @Test
    fun defaultServerUrlTargetsAndroidEmulatorHost() {
        assertEquals("http://10.0.2.2:3299", Constants.DEFAULT_SERVER_URL)
    }
}
