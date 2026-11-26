package com.officialgl.commander.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionsTest {
    @Test fun comparesNumerically() {
        assertTrue(Versions.isNewer("0.1.10", "0.1.9"))
        assertTrue(Versions.isNewer("1.0", "0.9.9"))
        assertFalse(Versions.isNewer("0.1.0", "0.1.0"))
        assertFalse(Versions.isNewer("0.1.0", "0.1.0.0"))
        assertFalse(Versions.isNewer("0.0.9", "0.1.0"))
        assertFalse(Versions.isNewer("0.2.0", "0.0.0-test.4"))
    }

    @Test fun knowsReleaseBuilds() {
        assertTrue(Versions.isRelease("0.1.0"))
        assertFalse(Versions.isRelease("0.0.0"))
        assertFalse(Versions.isRelease("0.0.0-test.4"))
        assertFalse(Versions.isRelease(null))
    }

    @Test fun readsTags() {
        assertEquals("0.1.2", Versions.fromTag("android-v0.1.2"))
        assertNull(Versions.fromTag("ios-v0.5.10"))
        assertNull(Versions.fromTag("android-test-4"))
        assertNull(Versions.fromTag("android-vbeta"))
    }
}
