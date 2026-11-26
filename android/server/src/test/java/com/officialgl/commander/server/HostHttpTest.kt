package com.officialgl.commander.server

import com.sun.net.httpserver.HttpServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetSocketAddress

class HostHttpTest {
    private fun server(handle: (method: String, body: String, contentType: String?) -> Pair<Int, String>): Pair<HttpServer, String> {
        val s = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        s.createContext("/") { ex ->
            val (status, text) = handle(ex.requestMethod, ex.requestBody.readBytes().decodeToString(), ex.requestHeaders.getFirst("content-type"))
            val bytes = text.toByteArray()
            ex.responseHeaders.add("content-type", "application/json")
            ex.sendResponseHeaders(status, if (bytes.isEmpty()) -1 else bytes.size.toLong())
            if (bytes.isNotEmpty()) ex.responseBody.use { it.write(bytes) } else ex.close()
        }
        s.start()
        return s to "http://127.0.0.1:${s.address.port}"
    }

    @Test fun postsJsonAndReadsReply() {
        val (s, base) = server { method, body, type -> 201 to "{\"method\":\"$method\",\"got\":$body,\"type\":\"$type\"}" }
        try {
            val r = HostHttp.perform("$base/api/link/register", "POST", listOf("content-type" to "application/json", "Host" to "evil"), "{\"name\":\"폰\"}".toByteArray(), allowHttp = true)
            assertEquals(201, r.status)
            val text = r.body.decodeToString()
            assertTrue(text, text.contains("\"method\":\"POST\"") && text.contains("\"name\":\"폰\"") && text.contains("application/json"))
            assertTrue(r.headers.any { it.first.equals("content-type", true) })
        } finally { s.stop(0) }
    }

    @Test fun readsErrorBodies() {
        val (s, base) = server { _, _, _ -> 403 to "{\"error\":\"unknown_server\"}" }
        try {
            val r = HostHttp.perform("$base/x", "POST", emptyList(), ByteArray(0), allowHttp = true)
            assertEquals(403, r.status)
            assertEquals("{\"error\":\"unknown_server\"}", r.body.decodeToString())
        } finally { s.stop(0) }
    }

    @Test fun refusesPlainHttpAndOddMethods() {
        assertTrue(runCatching { HostHttp.perform("http://example.com/", "GET", emptyList(), null) }.isFailure)
        assertTrue(runCatching { HostHttp.perform("https://example.com/", "TRACE", emptyList(), null) }.isFailure)
        assertTrue(runCatching { HostHttp.perform("file:///etc/passwd", "GET", emptyList(), null) }.isFailure)
    }
}
