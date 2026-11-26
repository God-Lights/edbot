package com.officialgl.commander.server

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebView
import android.webkit.WebViewClient
import org.json.JSONArray
import org.json.JSONObject
import android.util.Base64
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/**
 * 숨은 웹뷰 안에서 서버 엔진(engine.js, iPad 서버 앱과 같은 묶음)을 돌린다.
 * - 요청을 넘기고(fetch), 엔진이 알려 주는 일(파일 저장, 소켓 보내기/닫기, 기록)을 Listener 로 받는다.
 * - 타이머는 앱이 돌린다(엔진의 timers 옵션): 숨은 웹뷰는 setTimeout 을 늦출 수 있어서 게임 단계 시간이 틀어진다.
 * 웹뷰는 메인 스레드에서만 만진다. fetch 는 다른 스레드(접속 스레드)에서 불러 기다린다.
 */
class Engine(private val context: Context, private val listener: Listener) {
    interface Listener {
        fun onFileOps(ops: List<FileOp>)
        fun onSocketSend(id: Int, data: String, binary: Boolean)
        fun onSocketClose(id: Int, code: Int, reason: String)
        fun onLog(level: String, text: String)
        /** 웹뷰 엔진이 죽었다 (메모리 부족 등) */
        fun onCrash()
    }

    data class BootInfo(val woken: Int, val plugins: JSONObject?)

    private val main = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private val calls = ConcurrentHashMap<Int, CompletableFuture<String>>()
    private val nextCall = AtomicInteger(1)
    private val timers = ConcurrentHashMap<Int, Runnable>()
    /** 엔진이 밖으로 보내는 HTTP 요청을 대신 보내는 스레드 (HostHttp) */
    private val net = Executors.newCachedThreadPool()
    @Volatile private var bootFiles: String = "{}"
    @Volatile private var onBooted: ((Result<BootInfo>) -> Unit)? = null

    /** 엔진을 켠다. (메인 스레드) files 는 데이터 폴더의 {경로: 글자}. */
    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    /** auth: 로그인 방식 {mode: open|linked, owner, guests} (없으면 open) */
    fun start(engineSource: String, files: Map<String, String>, name: String, edition: String, version: String, phaseScale: String?, auth: JSONObject?, done: (Result<BootInfo>) -> Unit) {
        bootFiles = JSONObject(files as Map<*, *>).toString()
        onBooted = done
        val web = WebView(context)
        web.settings.javaScriptEnabled = true
        // 화면에 안 보여도 렌더러가 중요한 일로 남게 한다 (메모리가 모자랄 때 먼저 죽지 않게)
        web.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        web.addJavascriptInterface(Host(), "AndroidHost")
        web.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String?) {
                if (onBooted == null) return
                view.evaluateJavascript(engineSource + "\n;0", null)
                view.evaluateJavascript(bootScript(name, edition, version, phaseScale, auth), null)
            }

            override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
                listener.onLog("error", "엔진(웹뷰)이 멈췄다 (crash=${detail.didCrash()})")
                destroy()
                listener.onCrash()
                return true
            }
        }
        webView = web
        // localhost 는 보안 컨텍스트라서 crypto 같은 기능이 막히지 않는다
        web.loadDataWithBaseURL("http://localhost/", "<!doctype html><meta charset=\"utf-8\"><title>engine</title>", "text/html", "utf-8", null)
    }

    private fun bootScript(name: String, edition: String, version: String, phaseScale: String?, auth: JSONObject?): String = """
        (function () {
          try {
            var options = {
              host: { post: function (m) { AndroidHost.post(JSON.stringify(m)); } },
              files: JSON.parse(AndroidHost.bootFiles()),
              name: ${JSONObject.quote(name)}, edition: ${JSONObject.quote(edition)}, version: ${JSONObject.quote(version)},
              timers: { schedule: function (id, ms) { AndroidHost.schedule(id, ms); }, cancel: function (id) { AndroidHost.cancel(id); } },
              // 밖으로 나가는 요청(공식 서버)은 앱이 보낸다: 숨은 웹뷰의 fetch 는 막힌다
              net: { request: function (id, req) { AndroidHost.httpRequest(id, req); } }
            };
            ${if (phaseScale != null) "options.phaseScale = ${JSONObject.quote(phaseScale)};" else ""}
            ${if (auth != null) "options.auth = $auth;" else ""}
            window.__engine = CommanderEngine.start(options);
            window.__fetch = function (id, req) {
              Promise.resolve().then(function () { return window.__engine.fetch(req); }).then(
                function (r) { AndroidHost.reply(id, JSON.stringify(r)); },
                function (e) { AndroidHost.reply(id, JSON.stringify({ status: 500, headers: [], body: "" })); });
            };
            AndroidHost.booted(JSON.stringify({ ok: true, woken: window.__engine.woken, plugins: window.__engine.plugins || null }));
          } catch (e) {
            AndroidHost.booted(JSON.stringify({ ok: false, error: String((e && e.stack) || e) }));
          }
        })();
    """.trimIndent()

    /**
     * 요청 하나를 엔진에 넘기고 응답을 기다린다. (메인 스레드가 아닌 곳에서) 시간이 넘거나 엔진이 없으면 null.
     * req: {method, url, headers: [[이름, 값]], body: base64 | null}
     */
    fun fetch(req: JSONObject, timeoutMs: Long = 30_000): JSONObject? {
        val id = nextCall.getAndIncrement()
        val future = CompletableFuture<String>()
        calls[id] = future
        main.post {
            val web = webView
            if (web == null) future.complete("") else web.evaluateJavascript("window.__fetch && window.__fetch($id, $req);", null)
        }
        return try {
            val text = future.get(timeoutMs, TimeUnit.MILLISECONDS)
            if (text.isEmpty()) null else JSONObject(text)
        } catch (e: Exception) {
            listener.onLog("error", "엔진 응답 없음: ${req.optString("method")} ${req.optString("url")}")
            null
        } finally {
            calls.remove(id)
        }
    }

    fun wsMessage(id: Int, data: String, binary: Boolean) = eval("window.__engine && window.__engine.wsMessage($id, ${JSONObject.quote(data)}, $binary);")

    fun wsClose(id: Int, code: Int, reason: String) = eval("window.__engine && window.__engine.wsClose($id, $code, ${JSONObject.quote(reason)});")

    /** 곧 멈출 때: 엔진이 모아 둔 저장을 지금 하게 한다. */
    fun flush() = eval("window.__engine && window.__engine.flush();")

    private fun eval(script: String) {
        main.post { webView?.evaluateJavascript(script, null) }
    }

    /** 엔진을 내린다. (어느 스레드에서나) */
    fun destroy() {
        main.post {
            for (r in timers.values) main.removeCallbacks(r)
            timers.clear()
            webView?.let {
                it.removeJavascriptInterface("AndroidHost")
                it.destroy()
            }
            webView = null
            for (f in calls.values) f.complete("")
        }
        net.shutdownNow()
    }

    /** 웹뷰의 JS 가 부르는 것들 (웹뷰의 다른 스레드에서 불린다) */
    private inner class Host {
        @JavascriptInterface
        fun bootFiles(): String = bootFiles.also { bootFiles = "{}" } // 한 번 넘기면 메모리에서 놓는다

        @JavascriptInterface
        fun booted(json: String) {
            val done = onBooted ?: return
            onBooted = null
            val obj = runCatching { JSONObject(json) }.getOrNull()
            val result = if (obj?.optBoolean("ok") == true) {
                Result.success(BootInfo(obj.optInt("woken"), obj.optJSONObject("plugins")))
            } else {
                Result.failure(IllegalStateException(obj?.optString("error") ?: "엔진을 시작하지 못했다"))
            }
            main.post { done(result) }
        }

        @JavascriptInterface
        fun reply(id: Int, json: String) {
            calls[id]?.complete(json)
        }

        /** 엔진의 밖으로 나가는 요청을 보내고, 답을 netReply 로 돌려준다 */
        @JavascriptInterface
        fun httpRequest(id: Int, json: String) {
            net.execute {
                val reply = try {
                    val req = JSONObject(json)
                    val headers = req.optJSONArray("headers") ?: JSONArray()
                    val pairs = (0 until headers.length()).mapNotNull { i -> headers.optJSONArray(i)?.let { it.optString(0) to it.optString(1) } }
                    val body = req.optString("body").takeIf { !req.isNull("body") && it.isNotEmpty() }?.let { Base64.decode(it, Base64.DEFAULT) }
                    val r = HostHttp.perform(req.getString("url"), req.optString("method", "GET"), pairs, body)
                    val outHeaders = JSONArray()
                    for ((k, v) in r.headers) outHeaders.put(JSONArray().put(k).put(v))
                    JSONObject().put("ok", true).put("status", r.status).put("headers", outHeaders).put("body", Base64.encodeToString(r.body, Base64.NO_WRAP))
                } catch (e: Exception) {
                    JSONObject().put("ok", false).put("error", "${e.javaClass.simpleName}: ${e.message ?: ""}")
                }
                eval("window.__engine && window.__engine.netReply($id, ${JSONObject.quote(reply.toString())});")
            }
        }

        @JavascriptInterface
        fun schedule(id: Int, ms: Double) {
            val run = Runnable {
                timers.remove(id)
                webView?.evaluateJavascript("window.__hostTimer && window.__hostTimer($id);", null)
            }
            timers.put(id, run)?.let { main.removeCallbacks(it) }
            main.postDelayed(run, ms.toLong().coerceAtLeast(0))
        }

        @JavascriptInterface
        fun cancel(id: Int) {
            timers.remove(id)?.let { main.removeCallbacks(it) }
        }

        @JavascriptInterface
        fun post(json: String) {
            val msg = runCatching { JSONObject(json) }.getOrNull() ?: return
            when (msg.optString("t")) {
                "fs" -> {
                    val arr = msg.optJSONArray("ops") ?: JSONArray()
                    val ops = (0 until arr.length()).mapNotNull { i ->
                        val o = arr.optJSONObject(i) ?: return@mapNotNull null
                        FileOp.of(o.optString("op")) { key -> if (o.has(key)) o.optString(key) else null }
                    }
                    if (ops.isNotEmpty()) listener.onFileOps(ops)
                }
                "ws-send" -> listener.onSocketSend(msg.optInt("id"), msg.optString("data"), msg.optBoolean("binary"))
                "ws-close" -> listener.onSocketClose(msg.optInt("id"), msg.optInt("code", 1000), msg.optString("reason"))
                "log" -> listener.onLog(msg.optString("level", "log"), msg.optString("text"))
            }
        }
    }
}
