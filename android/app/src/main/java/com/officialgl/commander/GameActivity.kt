package com.officialgl.commander

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView

/**
 * 게임 화면: 고른 서버의 웹 화면을 그대로 연다. (웹 화면이 로비·준비·전투·도감까지 전부 그린다)
 * 서버가 화면을 함께 보내므로 앱을 다시 설치하지 않아도 서버와 화면 버전이 늘 맞는다.
 */
class GameActivity : Activity() {
    private lateinit var root: FrameLayout
    private var webView: WebView? = null
    private lateinit var loading: View
    private lateinit var error: LinearLayout
    private lateinit var errorText: TextView
    private lateinit var serverUrl: String
    private var serverName: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        serverUrl = intent.getStringExtra(MainActivity.EXTRA_URL)?.let { normalizeServerUrl(it) } ?: run { finish(); return }
        serverName = intent.getStringExtra(MainActivity.EXTRA_NAME)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        root = FrameLayout(this).apply { background = screenBackground() }
        loading = buildLoading()
        error = buildError()
        setContentView(root)
        root.padForSystemBars()
        createWebView(savedInstanceState)
        hideSystemBars()
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createWebView(state: Bundle?) {
        val web = WebView(this)
        web.setBackgroundColor(Palette.bgBottom)
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true // 이름·로그인 등 웹 화면의 localStorage
            mediaPlaybackRequiresUserGesture = false // 효과음
            textZoom = 100 // 시스템 글자 크기가 커도 판이 깨지지 않게
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            loadWithOverviewMode = true
            useWideViewPort = true
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: "0"
            userAgentString = "$userAgentString CommanderAndroid/$version"
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d("CommanderWeb", "${message.messageLevel()} ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }
        web.webViewClient = Client()
        root.addView(web, 0, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        webView = web
        if (state != null && web.restoreState(state) != null) {
            loading.visibility = View.GONE
        } else {
            web.loadUrl(serverUrl)
        }
    }

    private inner class Client : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val uri = request.url
            return when (uri.scheme?.lowercase()) {
                "commander" -> {
                    // 웹 화면 안의 접속 링크: 그 서버로 옮긴다.
                    ConnectLink.parse(uri.toString())?.let { link -> switchServer(link.serverUrl, link.name) }
                    true
                }
                "http", "https" -> if (keepInside(uri)) false else openOutside(uri)
                else -> openOutside(uri)
            }
        }

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            error.visibility = View.GONE
        }

        override fun onPageFinished(view: WebView, url: String?) {
            loading.visibility = View.GONE
            CookieManager.getInstance().flush()
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, err: WebResourceError) {
            if (!request.isForMainFrame) return
            loading.visibility = View.GONE
            errorText.text = "서버에 연결할 수 없어요\n$serverUrl\n(${err.description})"
            error.visibility = View.VISIBLE
        }

        override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
            // 웹 화면 엔진이 죽으면(메모리 부족 등) 새로 만든다.
            Log.w("CommanderWeb", "렌더러 종료 crash=${detail.didCrash()}")
            root.removeView(view)
            view.destroy()
            webView = null
            loading.visibility = View.VISIBLE
            createWebView(null)
            return true
        }
    }

    /** 서버 자신과 GL 계정 로그인 화면은 앱 안에서, 나머지 링크는 브라우저로 */
    private fun keepInside(uri: Uri): Boolean {
        val host = uri.host?.lowercase() ?: return false
        val server = Uri.parse(serverUrl).host?.lowercase()
        return host == server || host == "officialgl.com" || host.endsWith(".officialgl.com")
    }

    private fun openOutside(uri: Uri): Boolean {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }.onFailure { toast("열 수 없는 링크예요") }
        return true
    }

    private fun switchServer(url: String, name: String?) {
        AlertDialog.Builder(this)
            .setMessage("${name ?: url} 서버로 옮길까요?")
            .setPositiveButton("옮기기") { _, _ ->
                ServerStore(this).remember(url, name)
                serverUrl = url
                serverName = name
                webView?.loadUrl(url)
            }
            .setNegativeButton("취소", null)
            .show()
    }

    private fun buildLoading(): View {
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = screenBackground()
            addView(ImageView(context).apply { setImageResource(R.drawable.logo); adjustViewBounds = true }, LinearLayout.LayoutParams(dp(170), WRAP_CONTENT))
            addView(label("${serverName ?: serverUrl.substringAfter("://")} 에 연결하는 중…", 14f, Palette.dim).apply { setPadding(0, dp(12), 0, 0) })
        }
        root.addView(box, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        return box
    }

    private fun buildError(): LinearLayout {
        errorText = label("", 15f, Palette.silver).apply { gravity = Gravity.CENTER }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            background = screenBackground()
            visibility = View.GONE
            addView(errorText)
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, dp(16), 0, 0)
                addView(goldButton("다시 시도") { error.visibility = View.GONE; loading.visibility = View.VISIBLE; webView?.loadUrl(serverUrl) },
                    LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { marginEnd = dp(10) })
                addView(plainButton("서버 목록") { finish() })
            })
        }
        root.addView(box, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        return box
    }

    @Deprecated("안드로이드 8에서도 되는 뒤로 가기")
    override fun onBackPressed() {
        val web = webView
        if (web != null && web.canGoBack() && error.visibility != View.VISIBLE) { web.goBack(); return }
        AlertDialog.Builder(this)
            .setMessage("서버 목록으로 나갈까요?")
            .setPositiveButton("나가기") { _, _ -> finish() }
            .setNegativeButton("취소", null)
            .show()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    /** 전체 화면 (가장자리에서 밀면 잠깐 보인다) */
    @Suppress("DEPRECATION")
    private fun hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.insetsController?.let {
                it.hide(WindowInsets.Type.systemBars())
                it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        } else {
            window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or View.SYSTEM_UI_FLAG_FULLSCREEN or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView?.saveState(outState)
    }

    override fun onPause() {
        webView?.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
    }

    override fun onDestroy() {
        webView?.let { root.removeView(it); it.destroy() }
        webView = null
        super.onDestroy()
    }
}
