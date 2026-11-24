package com.officialgl.commander

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectLinkTest {
    @Test fun normalizesAddresses() {
        assertEquals("https://edgame-api.officialgl.com", normalizeServerUrl("  edgame-api.officialgl.com/ "))
        assertEquals("http://192.168.0.10:8787", normalizeServerUrl("192.168.0.10:8787"))
        assertEquals("http://10.0.2.2:8801", normalizeServerUrl("10.0.2.2:8801"))
        assertEquals("http://localhost:8787", normalizeServerUrl("localhost:8787"))
        assertEquals("http://commander.local:8787", normalizeServerUrl("commander.local:8787"))
        assertEquals("https://172.40.0.1", normalizeServerUrl("172.40.0.1")) // 사설 대역 밖
        assertEquals("http://example.com", normalizeServerUrl("http://example.com///"))
        assertNull(normalizeServerUrl(""))
        assertNull(normalizeServerUrl("ftp://example.com"))
        assertNull(normalizeServerUrl("http://"))
    }

    @Test fun parsesConnectLink() {
        val link = ConnectLink.parse("commander://connect?url=http%3A%2F%2F192.168.0.5%3A8787&name=%EC%9A%B0%EB%A6%AC%20%EC%84%9C%EB%B2%84")
        assertEquals(ConnectLink("http://192.168.0.5:8787", "우리 서버"), link)
        assertEquals(ConnectLink("https://a.example", null), ConnectLink.parse("COMMANDER://connect?url=a.example&name=%20"))
        assertNull(ConnectLink.parse("https://connect?url=a.example"))
        assertNull(ConnectLink.parse("commander://other?url=a.example"))
        assertNull(ConnectLink.parse("commander://connect?name=x"))
        assertNull(ConnectLink.parse("commander://connect?url=ftp%3A%2F%2Fx"))
    }

    @Test fun readsTxtRecords() {
        val found = FoundServer.fromTxt(mapOf("name" to "거실", "ip" to "192.168.0.7,10.0.0.2", "port" to "8787", "ed" to "expert"), "x")
        assertEquals(FoundServer("거실", "http://192.168.0.7:8787", true), found)
        val plain = FoundServer.fromTxt(mapOf("ip" to "192.168.0.7", "port" to "8787"), "COMMANDER")!!
        assertEquals("COMMANDER", plain.name)
        assertFalse(plain.expert)
        assertNull(FoundServer.fromTxt(mapOf("ip" to "192.168.0.7", "port" to "0"), "x"))
        assertNull(FoundServer.fromTxt(mapOf("port" to "8787"), "x"))
    }

    @Test fun webViewVersion() {
        assertEquals(120, webViewMajor("120.0.6099.230"))
        assertNull(webViewMajor(null))
        assertTrue((webViewMajor("58.0.3029.125") ?: 0) < MIN_WEBVIEW_MAJOR)
    }
}
