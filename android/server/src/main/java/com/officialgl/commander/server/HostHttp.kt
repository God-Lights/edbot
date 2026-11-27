package com.officialgl.commander.server

import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL

/**
 * 엔진(숨은 웹뷰)이 밖으로 보내는 HTTP 요청을 앱이 대신 보낸다. (엔진의 net 옵션)
 * 숨은 웹뷰의 fetch 는 공식 서버로 가는 요청이 막혀서("Failed to fetch") GL 연결 서버 로그인이 안 됐다.
 * https 만 보낸다. 안드로이드에 기대지 않아서 JVM 에서 시험할 수 있다.
 */
object HostHttp {
    const val MAX_BODY = 1_000_000
    const val TIMEOUT_MS = 15_000

    data class Reply(val status: Int, val headers: List<Pair<String, String>>, val body: ByteArray)

    /** 보내지 못하면(주소가 틀림, 인터넷 없음, 시간 초과) 예외. allowHttp 는 시험용 */
    fun perform(url: String, method: String, headers: List<Pair<String, String>>, body: ByteArray?, allowHttp: Boolean = false): Reply {
        val target = URL(url)
        require(target.protocol == "https" || (allowHttp && target.protocol == "http")) { "https 주소만 보낼 수 있어요: $url" }
        require(method in setOf("GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH")) { "보낼 수 없는 방식: $method" }
        val conn = target.openConnection() as HttpURLConnection
        try {
            conn.connectTimeout = TIMEOUT_MS
            conn.readTimeout = TIMEOUT_MS
            conn.instanceFollowRedirects = false
            conn.useCaches = false
            conn.requestMethod = if (method == "PATCH") "POST" else method
            for ((name, value) in headers) {
                // 연결이 정하는 헤더는 넘기지 않는다
                if (name.lowercase() in setOf("host", "content-length", "connection", "transfer-encoding", "accept-encoding")) continue
                conn.setRequestProperty(name, value)
            }
            if (body != null && method != "GET" && method != "HEAD") {
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(body.size)
                conn.outputStream.use { it.write(body) }
            }
            val status = conn.responseCode
            val stream: InputStream? = if (status >= 400) conn.errorStream else runCatching { conn.inputStream }.getOrNull()
            val bytes = stream?.use { readLimited(it) } ?: ByteArray(0)
            val out = mutableListOf<Pair<String, String>>()
            for ((name, values) in conn.headerFields) {
                if (name == null) continue // 상태 줄
                if (name.lowercase() in setOf("content-length", "transfer-encoding", "connection", "content-encoding")) continue
                for (v in values) out += name to v
            }
            return Reply(status, out, bytes)
        } finally {
            conn.disconnect()
        }
    }

    private fun readLimited(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buf = ByteArray(16 * 1024)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            require(out.size() <= MAX_BODY) { "응답이 너무 커요" }
        }
        return out.toByteArray()
    }
}
