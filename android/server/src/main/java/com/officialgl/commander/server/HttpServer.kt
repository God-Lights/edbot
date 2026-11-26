package com.officialgl.commander.server

import android.content.res.AssetManager
import android.util.Base64
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoHTTPD.IHTTPSession
import fi.iki.elonen.NanoHTTPD.Response
import fi.iki.elonen.NanoWSD
import fi.iki.elonen.NanoWSD.WebSocket
import fi.iki.elonen.NanoWSD.WebSocketFrame
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap

/**
 * 접속을 받는 서버 (NanoHTTPD). 웹 화면은 APK 에 담긴 파일(assets/web)에서, 나머지(API, WebSocket)는 엔진으로.
 * iPad 서버 앱의 LocalServer(ios-server/App/HTTPListener.swift)와 같은 일을 한다.
 */
class HttpServer(
    port: Int,
    private val engine: Engine,
    private val assets: AssetManager,
    private val log: (String) -> Unit,
) : NanoWSD(port) {

    /** 웹 화면과 API 를 가르는 경로 머리 */
    private val apiPrefixes = listOf("/api", "/ws", "/auth", "/health", "/sidestore")

    private val sockets = ConcurrentHashMap<Int, EngineSocket>()

    /** 팩 id -> 팩 폴더: 리소스(그림·소리)를 /packs/<id>/<경로> 로 내준다 (엑스퍼트) */
    @Volatile var packDirs: Map<String, java.io.File> = emptyMap()

    /** 소켓이 열리기 전에 엔진이 보낸 것(WebSocket 을 받자마자 보내는 첫 상태 등). 열리면 순서대로 보낸다. */
    private sealed class Outgoing {
        data class Frame(val data: String, val binary: Boolean) : Outgoing()
        data class Close(val code: Int, val reason: String) : Outgoing()
    }
    private val pending = ConcurrentHashMap<Int, MutableList<Outgoing>>()

    /** openWebSocket 에 엔진이 정한 연결 번호를 넘기려고 (같은 접속 스레드 안에서) */
    private val upgradeId = ThreadLocal<Int>()

    // ---- 엔진이 알리는 일 ----

    fun socketSend(id: Int, data: String, binary: Boolean) {
        val socket = sockets[id]
        if (socket == null) {
            synchronized(pending) { pending.getOrPut(id) { mutableListOf() }.add(Outgoing.Frame(data, binary)) }
            return
        }
        socket.sendSafely(data, binary)
    }

    fun socketClose(id: Int, code: Int, reason: String) {
        val socket = sockets.remove(id)
        if (socket == null) {
            synchronized(pending) { pending.getOrPut(id) { mutableListOf() }.add(Outgoing.Close(code, reason)) }
            return
        }
        socket.closeSafely(code, reason)
    }

    // ---- 요청 ----

    override fun serve(session: IHTTPSession): Response {
        val path = session.uri ?: "/"
        val method = session.method?.name ?: "GET"
        if (isWebsocketRequested(session)) {
            val res = engine.fetch(requestJson(session, null)) ?: return engineDown()
            val ws = res.optInt("ws", 0)
            if (res.optInt("status") == 101 && ws > 0) {
                upgradeId.set(ws)
                try {
                    return super.serve(session) // 핸드셰이크 응답을 만들고 openWebSocket 을 부른다
                } finally {
                    upgradeId.remove()
                }
            }
            return toResponse(res, method)
        }
        if ((method == "GET" || method == "HEAD") && path.startsWith("/packs/")) {
            return packFile(path) ?: NanoHTTPD.newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "없다")
        }
        if ((method == "GET" || method == "HEAD") && apiPrefixes.none { path.startsWith(it) }) {
            staticFile(path)?.let { return it }
        }
        val body = readBody(session)
        val res = engine.fetch(requestJson(session, body)) ?: return engineDown()
        return toResponse(res, method)
    }

    override fun openWebSocket(handshake: IHTTPSession): WebSocket = EngineSocket(handshake, upgradeId.get() ?: 0)

    private fun engineDown(): Response =
        NanoHTTPD.newFixedLengthResponse(Response.Status.SERVICE_UNAVAILABLE, "application/json", "{\"error\":\"engine_unavailable\"}")

    private fun requestJson(session: IHTTPSession, body: ByteArray?): JSONObject {
        val host = session.headers["host"] ?: "localhost"
        val query = session.queryParameterString?.takeIf { it.isNotEmpty() }?.let { "?$it" } ?: ""
        val headers = JSONArray()
        for ((k, v) in session.headers) {
            // NanoHTTPD 가 넣는 가짜 헤더는 빼고 넘긴다
            if (k == "remote-addr" || k == "http-client-ip") continue
            headers.put(JSONArray().put(k).put(v))
        }
        // 엔진이 IP 로 도배를 막을 수 있게 (문의 등)
        session.headers["remote-addr"]?.let { headers.put(JSONArray().put("x-forwarded-for").put(it)) }
        return JSONObject()
            .put("method", session.method?.name ?: "GET")
            .put("url", "http://$host${session.uri}$query")
            .put("headers", headers)
            .put("body", if (body == null || body.isEmpty()) JSONObject.NULL else Base64.encodeToString(body, Base64.NO_WRAP))
    }

    private fun readBody(session: IHTTPSession): ByteArray? {
        val length = session.headers["content-length"]?.toIntOrNull() ?: return null
        if (length <= 0) return null
        if (length > 2_000_000) return null
        val buf = ByteArray(length)
        var read = 0
        val input = session.inputStream
        while (read < length) {
            val n = input.read(buf, read, length - read)
            if (n < 0) break
            read += n
        }
        return if (read == length) buf else buf.copyOf(read)
    }

    private fun toResponse(res: JSONObject, method: String): Response {
        val status = res.optInt("status", 500)
        val bytes = res.optString("body").takeIf { it.isNotEmpty() }?.let { Base64.decode(it, Base64.DEFAULT) } ?: ByteArray(0)
        var mime = "application/octet-stream"
        val extra = mutableListOf<Pair<String, String>>()
        val headers = res.optJSONArray("headers") ?: JSONArray()
        for (i in 0 until headers.length()) {
            val pair = headers.optJSONArray(i) ?: continue
            val name = pair.optString(0)
            val value = pair.optString(1)
            when (name.lowercase()) {
                "content-type" -> mime = value
                "content-length", "transfer-encoding", "connection" -> {}
                else -> extra += name to value
            }
        }
        val body = if (method == "HEAD") ByteArray(0) else bytes
        val response = NanoHTTPD.newFixedLengthResponse(Code(status), mime, ByteArrayInputStream(body), body.size.toLong())
        for ((k, v) in extra) response.addHeader(k, v)
        return response
    }

    private fun staticFile(path: String): Response? {
        val clean = if (path == "/" || path.isEmpty()) "/index.html" else path
        if (clean.contains("..") || clean.contains('\u0000')) return null
        val asset = "web" + clean
        val bytes = runCatching { assets.open(asset).use { it.readBytes() } }.getOrNull() ?: return null
        val response = NanoHTTPD.newFixedLengthResponse(Response.Status.OK, mimeOf(clean), ByteArrayInputStream(bytes), bytes.size.toLong())
        response.addHeader("Cache-Control", "no-cache")
        return response
    }

    /** /packs/<id>/<경로>: 팩 폴더의 그림·소리만 (문서·스크립트는 내주지 않는다) */
    private fun packFile(path: String): Response? {
        val rest = path.removePrefix("/packs/")
        val id = rest.substringBefore('/', "")
        val sub = rest.substringAfter('/', "")
        val dir = packDirs[id] ?: return null
        val mime = PACK_MIME[sub.substringAfterLast('.', "").lowercase()] ?: return null
        if (sub.isEmpty() || sub.contains("..") || sub.contains('\u0000')) return null
        val file = java.io.File(dir, sub).canonicalFile
        if (!file.path.startsWith(dir.canonicalPath + java.io.File.separator) || !file.isFile) return null
        val bytes = runCatching { file.readBytes() }.getOrNull() ?: return null
        val response = NanoHTTPD.newFixedLengthResponse(Response.Status.OK, mime, ByteArrayInputStream(bytes), bytes.size.toLong())
        response.addHeader("Cache-Control", "public, max-age=3600")
        response.addHeader("X-Content-Type-Options", "nosniff")
        return response
    }

    /** 아무 상태 코드나 쓸 수 있게 (NanoHTTPD 의 목록에 없는 것도) */
    private class Code(private val code: Int) : Response.IStatus {
        override fun getRequestStatus(): Int = code
        override fun getDescription(): String = Response.Status.values().firstOrNull { it.requestStatus == code }?.description ?: "$code Status"
    }

    /** 엔진의 연결 번호 하나에 묶인 WebSocket */
    private inner class EngineSocket(handshake: IHTTPSession, private val id: Int) : WebSocket(handshake) {
        override fun onOpen() {
            if (id <= 0) { closeSafely(1011, "연결 번호 없음"); return }
            sockets[id] = this
            // 열리기 전에 쌓인 것을 순서대로 보낸다
            val queued = synchronized(pending) { pending.remove(id) } ?: return
            for (item in queued) {
                when (item) {
                    is Outgoing.Frame -> sendSafely(item.data, item.binary)
                    is Outgoing.Close -> { sockets.remove(id); closeSafely(item.code, item.reason); return }
                }
            }
        }

        override fun onClose(code: WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) {
            if (sockets.remove(id) != null || initiatedByRemote) engine.wsClose(id, code?.value ?: 1006, reason ?: "")
        }

        override fun onMessage(message: WebSocketFrame) {
            if (message.opCode == WebSocketFrame.OpCode.Binary) {
                engine.wsMessage(id, Base64.encodeToString(message.binaryPayload, Base64.NO_WRAP), true)
            } else {
                engine.wsMessage(id, message.textPayload ?: "", false)
            }
        }

        override fun onPong(pong: WebSocketFrame) {}

        override fun onException(exception: IOException) {
            log("[소켓 $id] ${exception.message}")
        }

        fun sendSafely(data: String, binary: Boolean) {
            try {
                if (binary) send(Base64.decode(data, Base64.DEFAULT)) else send(data)
            } catch (e: IOException) {
                log("[소켓 $id 보내기 실패] ${e.message}")
            }
        }

        fun closeSafely(code: Int, reason: String) {
            try {
                close(WebSocketFrame.CloseCode.find(code) ?: WebSocketFrame.CloseCode.NormalClosure, reason, false)
            } catch (e: IOException) {
                log("[소켓 $id 닫기 실패] ${e.message}")
            }
        }
    }

    companion object {
        private val MIME = mapOf(
            "html" to "text/html; charset=utf-8", "js" to "text/javascript; charset=utf-8", "css" to "text/css; charset=utf-8",
            "json" to "application/json", "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "svg" to "image/svg+xml",
            "webp" to "image/webp", "ico" to "image/x-icon", "mp3" to "audio/mpeg", "ogg" to "audio/ogg", "wav" to "audio/wav",
            "m4a" to "audio/mp4", "woff2" to "font/woff2", "txt" to "text/plain; charset=utf-8",
        )

        private val PACK_MIME = mapOf(
            "png" to "image/png", "jpg" to "image/jpeg", "jpeg" to "image/jpeg", "webp" to "image/webp", "gif" to "image/gif",
            "mp3" to "audio/mpeg", "ogg" to "audio/ogg", "m4a" to "audio/mp4", "wav" to "audio/wav",
        )

        fun mimeOf(path: String): String = MIME[path.substringAfterLast('.', "").lowercase()] ?: "application/octet-stream"
    }
}
