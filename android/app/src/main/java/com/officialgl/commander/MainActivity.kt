package com.officialgl.commander

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.KeyEvent
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.inputmethod.EditorInfo
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import com.google.zxing.integration.android.IntentIntegrator
import com.officialgl.commander.common.AppUpdater
import com.officialgl.commander.common.Palette
import com.officialgl.commander.common.dp
import com.officialgl.commander.common.goldButton
import com.officialgl.commander.common.label
import com.officialgl.commander.common.padForSystemBars
import com.officialgl.commander.common.panelBackground
import com.officialgl.commander.common.plainButton
import com.officialgl.commander.common.rowButton
import com.officialgl.commander.common.screenBackground
import com.officialgl.commander.common.sectionTitle
import com.officialgl.commander.common.toast
import com.officialgl.commander.common.updateBanner

/**
 * 첫 화면: 서버 고르기. 공식 서버, 같은 와이파이에서 찾은 서버, 최근 서버, 주소 직접 적기, QR 찍기.
 * 서버를 고르면 GameActivity 가 그 서버의 웹 화면(게임 전체)을 연다.
 * commander://connect?url=... 링크(로컬 서버의 QR)로도 열린다.
 */
class MainActivity : Activity() {
    private lateinit var store: ServerStore
    private lateinit var discovery: ServerDiscovery
    private lateinit var foundList: LinearLayout
    private lateinit var recentList: LinearLayout
    private lateinit var recentTitle: android.widget.TextView
    private lateinit var input: EditText
    private lateinit var column: LinearLayout
    private lateinit var continueBox: LinearLayout
    private var updateShown = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = ServerStore(this)
        discovery = ServerDiscovery(this) { showFound(it) }
        setContentView(buildContent())
        if (savedInstanceState == null) handleIntent(intent)
        checkForUpdate()
    }

    /** GitHub 릴리스에 새 버전이 있으면 맨 위에 띠를 띄운다 (개발용·시험판은 확인하지 않는다) */
    private fun checkForUpdate() {
        val current = AppUpdater.currentVersion(this)
        Thread {
            val update = AppUpdater.check(current, "Commander-") ?: return@Thread
            runOnUiThread {
                if (isFinishing || updateShown) return@runOnUiThread
                updateShown = true
                lateinit var banner: View
                banner = updateBanner(update.version, current, onUpdate = { AppUpdater.install(this, update) }, onDismiss = { column.removeView(banner) })
                column.addView(banner, 0)
            }
        }.start()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    override fun onStart() {
        super.onStart()
        showRecent()
        discovery.start()
    }

    override fun onStop() {
        discovery.stop()
        super.onStop()
    }

    /** 링크(commander://connect) 또는 시험용 extra "url" */
    private fun handleIntent(intent: Intent?) {
        val data = intent?.data?.toString()
        if (data != null) {
            val link = ConnectLink.parse(data)
            if (link != null) open(link.serverUrl, link.name) else toast("알 수 없는 링크예요")
            return
        }
        val raw = intent?.getStringExtra(EXTRA_URL) ?: return
        val url = normalizeServerUrl(raw) ?: return
        // 시험용(CI 스크린샷): force 면 WebView 버전 안내 없이 바로 연다
        if (intent.getBooleanExtra(EXTRA_FORCE, false)) launchGame(url, null) else open(url, null)
    }

    private fun buildContent(): FrameLayout {
        column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(24))
        }
        column.addView(ImageView(this).apply {
            setImageResource(R.drawable.logo)
            adjustViewBounds = true
            contentDescription = "COMMANDER"
        }, LinearLayout.LayoutParams(dp(150), WRAP_CONTENT).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(4) })

        // 이어하기: 마지막으로 들어간 서버를 한 번에
        continueBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(continueBox)

        column.addView(sectionTitle("공식 서버"))
        column.addView(rowButton("COMMANDER 공식 서버", OFFICIAL_SERVER.removePrefix("https://")) { open(OFFICIAL_SERVER, "공식 서버") })

        column.addView(sectionTitle("같은 와이파이"))
        foundList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(foundList)
        showFound(emptyList())

        recentTitle = sectionTitle("최근 서버")
        column.addView(recentTitle)
        recentList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(recentList)

        column.addView(sectionTitle("직접 연결"))
        input = EditText(this).apply {
            hint = "서버 주소 (예: 192.168.0.10:8787)"
            setHintTextColor(Palette.dim)
            setTextColor(Palette.silver)
            textSize = 15f
            isSingleLine = true
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            imeOptions = EditorInfo.IME_ACTION_GO
            background = panelBackground()
            setPadding(dp(14), dp(12), dp(14), dp(12))
            setOnEditorActionListener { _, action, event ->
                val enter = event?.keyCode == KeyEvent.KEYCODE_ENTER && event.action == KeyEvent.ACTION_DOWN
                if (action == EditorInfo.IME_ACTION_GO || enter) { connectTyped(); true } else false
            }
        }
        column.addView(input, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        val buttons = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(0, dp(10), 0, 0)
            addView(goldButton("연결") { connectTyped() }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { marginEnd = dp(8) })
            addView(plainButton("QR 찍기") { scanQr() }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        }
        column.addView(buttons)

        val webView = runCatching { WebView.getCurrentWebViewPackage() }.getOrNull()
        val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: "?"
        column.addView(label("앱 $version · WebView ${webView?.versionName ?: "없음"}", 11.5f, Palette.dim).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(18), 0, 0)
        }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))

        // 넓은 화면(가로, 태블릿)에서는 가운데 560dp 너비로
        val holder = FrameLayout(this).apply {
            addView(column, FrameLayout.LayoutParams(minOf(dp(560), resources.displayMetrics.widthPixels), WRAP_CONTENT, Gravity.CENTER_HORIZONTAL))
        }
        val scroll = ScrollView(this).apply {
            isFillViewport = true
            addView(holder, FrameLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        }
        return FrameLayout(this).apply {
            background = screenBackground()
            addView(scroll, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            padForSystemBars()
        }
    }

    private fun showFound(servers: List<FoundServer>) {
        if (!::foundList.isInitialized) return
        foundList.removeAllViews()
        if (servers.isEmpty()) {
            foundList.addView(label("찾는 중… 같은 와이파이에서 로컬 서버를 켜면 여기에 나와요.", 13f, Palette.dim).apply { setPadding(dp(4), 0, dp(4), dp(4)) })
            return
        }
        for (s in servers) foundList.addView(rowButton(s.name, s.url.removePrefix("http://"), if (s.expert) "엑스퍼트" else null) { open(s.url, s.name) })
    }

    private fun showRecent() {
        continueBox.removeAllViews()
        store.recent().firstOrNull()?.let { last ->
            val title = last.name ?: last.url.substringAfter("://")
            continueBox.addView(goldButton("이어하기 · $title") { open(last.url, last.name) },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        }
        recentList.removeAllViews()
        val recent = store.recent().filter { it.url != OFFICIAL_SERVER }
        recentTitle.visibility = if (recent.isEmpty()) android.view.View.GONE else android.view.View.VISIBLE
        for (e in recent) {
            val row = rowButton(e.name ?: e.url.substringAfter("://"), if (e.name != null) e.url.substringAfter("://") else null) { open(e.url, e.name) }
            row.setOnLongClickListener {
                AlertDialog.Builder(this).setMessage("최근 목록에서 지울까요?\n${e.url}")
                    .setPositiveButton("지우기") { _, _ -> store.forget(e.url); showRecent() }
                    .setNegativeButton("취소", null).show()
                true
            }
            recentList.addView(row)
        }
    }

    private fun connectTyped() {
        val url = normalizeServerUrl(input.text.toString())
        if (url == null) { toast("서버 주소를 확인해 주세요"); return }
        open(url, null)
    }

    private fun scanQr() {
        IntentIntegrator(this)
            .setDesiredBarcodeFormats(IntentIntegrator.QR_CODE)
            .setPrompt("서버 화면의 QR을 비추세요")
            .setBeepEnabled(false)
            .setOrientationLocked(false)
            .initiateScan()
    }

    @Deprecated("Activity 결과 API (안드로이드 8에서도 되는 방식)")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        val scan = IntentIntegrator.parseActivityResult(requestCode, resultCode, data)
        if (scan == null) { super.onActivityResult(requestCode, resultCode, data); return }
        val text = scan.contents ?: return
        // 로컬 서버의 QR은 commander:// 링크. http(s) 주소만 담긴 QR도 받는다.
        val link = ConnectLink.parse(text)
        val plain = if (text.startsWith("http://") || text.startsWith("https://")) normalizeServerUrl(text) else null
        when {
            link != null -> open(link.serverUrl, link.name)
            plain != null -> open(plain, null)
            else -> toast("COMMANDER 서버 QR이 아니에요")
        }
    }

    /** 서버 열기. WebView 가 너무 오래됐으면 먼저 알린다. */
    private fun open(url: String, name: String?) {
        val pkg = runCatching { WebView.getCurrentWebViewPackage() }.getOrNull()
        val major = webViewMajor(pkg?.versionName)
        if (pkg == null || (major != null && major < MIN_WEBVIEW_MAJOR)) {
            val now = if (pkg == null) "WebView가 없어요" else "지금 WebView ${pkg.versionName}"
            AlertDialog.Builder(this)
                .setTitle("WebView 업데이트가 필요해요")
                .setMessage("게임 화면은 Android System WebView(또는 Chrome) $MIN_WEBVIEW_MAJOR 이상에서 제대로 보여요.\n$now\n\nPlay 스토어에서 업데이트한 뒤 다시 열어 주세요.")
                .setPositiveButton("업데이트") { _, _ -> openStore(pkg?.packageName ?: "com.google.android.webview") }
                .setNeutralButton("그래도 열기") { _, _ -> launchGame(url, name) }
                .setNegativeButton("취소", null)
                .show()
            return
        }
        launchGame(url, name)
    }

    private fun launchGame(url: String, name: String?) {
        store.remember(url, name)
        startActivity(Intent(this, GameActivity::class.java).putExtra(EXTRA_URL, url).putExtra(EXTRA_NAME, name))
        @Suppress("DEPRECATION") // 안드로이드 8에서도 되는 방식
        overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
    }

    private fun openStore(pkg: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")))
        } catch (_: ActivityNotFoundException) {
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg"))) }
        }
    }

    companion object {
        const val EXTRA_URL = "url"
        const val EXTRA_NAME = "name"
        const val EXTRA_FORCE = "force"
    }
}
