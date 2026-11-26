package com.officialgl.commander.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.ServerSocket
import kotlin.concurrent.thread

class HostHttpTest {
    /** 요청 하나만 받는 작은 HTTP 서버 (안드로이드 단위 시험에는 com.sun.net.httpserver 가 없다) */
    private fun once(status: Int, reply: (method: String, headers: Map<String, String>, body: String) -> String): String {
        val socket = ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))
        thread(isDaemon = true) {
            socket.use { s ->
                s.accept().use { c ->
                    val input = c.getInputStream()
                    // 머리(빈 줄까지)를 바이트로 읽는다. 본문 길이(content-length)는 바이트 수다
                    val head = java.io.ByteArrayOutputStream()
                    while (!head.toString(Charsets.ISO_8859_1.name()).endsWith("\r\n\r\n")) {
                        val b = input.read()
                        if (b < 0) break
                        head.write(b)
                    }
                    val lines = head.toString(Charsets.ISO_8859_1.name()).split("\r\n")
                    val first = lines.first()
                    val headers = lines.drop(1).filter { ':' in it }.associate { it.substringBefore(':').trim().lowercase() to it.substringAfter(':').trim() }
                    val length = headers["content-length"]?.toIntOrNull() ?: 0
                    val bytes = ByteArray(length)
                    var read = 0
                    while (read < length) { val n = input.read(bytes, read, length - read); if (n < 0) break; read += n }
                    val body = String(bytes, 0, read, Charsets.UTF_8)
                    val out = reply(first.substringBefore(' '), headers, body).toByteArray()
                    c.getOutputStream().write("HTTP/1.1 $status X\r\ncontent-type: application/json\r\ncontent-length: ${out.size}\r\nconnection: close\r\n\r\n".toByteArray() + out)
                    c.getOutputStream().flush()
                }
            }
        }
        return "http://127.0.0.1:${socket.localPort}"
    }

    @Test fun postsJsonAndReadsReply() {
        val base = once(201) { method, headers, body -> "{\"method\":\"$method\",\"got\":$body,\"type\":\"${headers["content-type"]}\",\"host\":\"${headers["host"]}\"}" }
        val r = HostHttp.perform("$base/api/link/register", "POST", listOf("content-type" to "application/json", "Host" to "evil"), "{\"name\":\"폰\"}".toByteArray(), allowHttp = true)
        assertEquals(201, r.status)
        val text = r.body.decodeToString()
        assertTrue(text, text.contains("\"method\":\"POST\"") && text.contains("\"name\":\"폰\"") && text.contains("application/json"))
        assertTrue(text, !text.contains("evil")) // Host 는 넘기지 않는다
        assertTrue(r.headers.any { it.first.equals("content-type", true) })
    }

    @Test fun readsErrorBodies() {
        val base = once(403) { _, _, _ -> "{\"error\":\"unknown_server\"}" }
        val r = HostHttp.perform("$base/x", "POST", emptyList(), ByteArray(0), allowHttp = true)
        assertEquals(403, r.status)
        assertEquals("{\"error\":\"unknown_server\"}", r.body.decodeToString())
    }

    @Test fun refusesPlainHttpAndOddMethods() {
        assertTrue(runCatching { HostHttp.perform("http://example.com/", "GET", emptyList(), null) }.isFailure)
        assertTrue(runCatching { HostHttp.perform("https://example.com/", "TRACE", emptyList(), null) }.isFailure)
        assertTrue(runCatching { HostHttp.perform("file:///etc/passwd", "GET", emptyList(), null) }.isFailure)
    }
}
