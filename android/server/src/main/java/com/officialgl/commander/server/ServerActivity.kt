package com.officialgl.commander.server

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.webkit.WebView
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * COMMANDER 서버 (안드로이드): 이 폰을 게임 서버로 켠다. 같은 와이파이의 기기가 주소·QR·서버 목록으로 접속한다.
 * 실제 일은 ServerService(포그라운드 서비스)가 하고, 이 화면은 설정과 상태를 보여 준다.
 */
class ServerActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var nameInput: EditText
    private lateinit var portInput: EditText
    private lateinit var editionRow: LinearLayout
    private lateinit var toggle: TextView
    private lateinit var addressBox: LinearLayout
    private lateinit var pluginsText: TextView
    private lateinit var logText: TextView
    private var edition = "vanilla"
    private val prefs by lazy { getSharedPreferences("server", Context.MODE_PRIVATE) }
    private val renderListener: () -> Unit = { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        edition = prefs.getString("edition", "vanilla") ?: "vanilla"
        setContentView(buildContent())
        // 시험용(CI): 바로 켜기
        if (savedInstanceState == null && intent.getBooleanExtra("autostart", false)) start(intent.getStringExtra("phaseScale"))
    }

    override fun onStart() {
        super.onStart()
        ServerState.observe(renderListener)
        render()
    }

    override fun onStop() {
        ServerState.forget(renderListener)
        super.onStop()
    }

    private fun buildContent(): View {
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(20), dp(16), dp(20), dp(24))
        }
        column.addView(LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(ImageView(context).apply { setImageResource(R.drawable.logo); adjustViewBounds = true }, LinearLayout.LayoutParams(dp(64), WRAP_CONTENT).apply { marginEnd = dp(12) })
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                addView(label("COMMANDER 서버", 22f, Palette.goldHi, bold = true))
                status = label("", 14f, Palette.dim)
                addView(status)
            })
        })

        column.addView(sectionTitle("설정"))
        nameInput = input("서버 이름", prefs.getString("name", "${Build.MODEL} 서버") ?: "내 안드로이드 서버", InputType.TYPE_CLASS_TEXT)
        column.addView(nameInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(8) })
        portInput = input("포트 (1024~65535)", prefs.getInt("port", ServerService.DEFAULT_PORT).toString(), InputType.TYPE_CLASS_NUMBER)
        column.addView(portInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(8) })
        editionRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        column.addView(editionRow)
        column.addView(label("엑스퍼트는 콘텐츠 팩(플러그인)을 읽는 서버예요. 처음이면 바닐라.", 12f, Palette.dim).apply { setPadding(dp(4), dp(6), dp(4), 0) })

        toggle = goldButton("서버 켜기") { if (ServerState.status == ServerState.Status.RUNNING) stop() else start(null) }
        column.addView(toggle, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(16) })

        addressBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(addressBox)
        pluginsText = label("", 13f, Palette.dim).apply { visibility = View.GONE; setPadding(dp(4), dp(8), dp(4), 0) }
        column.addView(pluginsText)

        column.addView(sectionTitle("안내"))
        column.addView(label(
            "• 접속하는 기기는 이 폰과 같은 와이파이(또는 이 폰의 핫스팟)에 있어야 해요.\n" +
                "• COMMANDER 앱은 서버 목록에 이 서버가 뜨고, QR 을 찍어도 돼요. 브라우저는 주소를 그대로 열어요.\n" +
                "• 앱을 내려도 서버는 켜져 있어요 (알림에서 끌 수 있어요). 오래 켜 둘 때는 배터리 최적화를 꺼 주세요.\n" +
                "• 전적은 이 폰에 남아요. 이름이 같으면 같은 사람으로 이어져요.", 13f, Palette.silver))
        column.addView(plainButton("배터리 최적화 설정 열기") {
            runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(10) })

        column.addView(sectionTitle("기록"))
        logText = label("", 11.5f, Palette.dim).apply {
            typeface = android.graphics.Typeface.MONOSPACE
            setTextIsSelectable(true)
        }
        column.addView(logText)

        val holder = FrameLayout(this).apply {
            addView(column, FrameLayout.LayoutParams(minOf(dp(640), resources.displayMetrics.widthPixels), WRAP_CONTENT, Gravity.CENTER_HORIZONTAL))
        }
        return FrameLayout(this).apply {
            background = screenBackground()
            addView(ScrollView(context).apply { isFillViewport = true; addView(holder) }, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            padForSystemBars()
        }
    }

    private fun input(hint: String, value: String, type: Int) = EditText(this).apply {
        this.hint = hint
        setText(value)
        setHintTextColor(Palette.dim)
        setTextColor(Palette.silver)
        textSize = 15f
        isSingleLine = true
        inputType = type
        background = panelBackground()
        setPadding(dp(14), dp(12), dp(14), dp(12))
    }

    private fun render() {
        val state = ServerState
        val running = state.status == ServerState.Status.RUNNING
        val busy = state.status == ServerState.Status.STARTING
        status.text = when (state.status) {
            ServerState.Status.STOPPED -> "꺼져 있어요"
            ServerState.Status.STARTING -> "켜는 중…"
            ServerState.Status.RUNNING -> "켜져 있어요 · ${state.name}"
            ServerState.Status.FAILED -> state.error ?: "켜지 못했어요"
        }
        status.setTextColor(when (state.status) {
            ServerState.Status.RUNNING -> Palette.mine
            ServerState.Status.FAILED -> Palette.warn
            else -> Palette.dim
        })
        toggle.text = if (running) "서버 끄기" else if (busy) "켜는 중…" else "서버 켜기"
        toggle.isEnabled = !busy
        toggle.alpha = if (busy) 0.5f else 1f
        for (v in listOf(nameInput, portInput)) { v.isEnabled = !running && !busy; v.alpha = if (running || busy) 0.6f else 1f }

        editionRow.removeAllViews()
        for ((key, title) in listOf("vanilla" to "바닐라", "expert" to "엑스퍼트")) {
            val selected = edition == key
            val button = if (selected) goldButton(title) {} else plainButton(title) { if (!running && !busy) { edition = key; render() } }
            button.isEnabled = !running && !busy
            editionRow.addView(button, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { if (key == "vanilla") marginEnd = dp(8) })
        }

        addressBox.removeAllViews()
        if (running) showAddresses(state.addresses, state.name)
        pluginsText.text = state.plugins ?: ""
        pluginsText.visibility = if (state.plugins.isNullOrEmpty()) View.GONE else View.VISIBLE
        logText.text = state.log.joinToString("\n").ifEmpty { "아직 기록이 없어요" }
    }

    private fun showAddresses(addresses: List<String>, name: String) {
        addressBox.addView(sectionTitle("접속 주소"))
        if (addresses.isEmpty()) {
            addressBox.addView(label("와이파이 주소를 찾지 못했어요. 와이파이에 연결하거나 핫스팟을 켜 주세요. (이 폰에서는 http://localhost:${portInput.text} 로 열려요)", 13f, Palette.warn))
        }
        addresses.firstOrNull()?.let { first ->
            // 앱으로 찍는 QR (로컬 서버와 같은 commander:// 링크)
            Qr.bitmap(NetworkInfo.connectLink(first, name), dp(220))?.let { bmp ->
                addressBox.addView(ImageView(this).apply { setImageBitmap(bmp); contentDescription = "접속 QR" },
                    LinearLayout.LayoutParams(dp(220), dp(220)).apply { gravity = Gravity.CENTER_HORIZONTAL; bottomMargin = dp(6) })
                addressBox.addView(label("COMMANDER 앱의 'QR 찍기' 또는 카메라로 찍으세요", 12f, Palette.dim).apply { gravity = Gravity.CENTER },
                    LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(10) })
            }
        }
        for (address in addresses) {
            addressBox.addView(rowButton(address, "눌러서 주소 복사") { copy(address) })
        }
        addressBox.addView(plainButton("이 폰에서 게임 열기") { openHere() }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(4) })
    }

    private fun copy(text: String) {
        (getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("COMMANDER 서버", text))
        toast("주소를 복사했어요")
    }

    /** 이 폰의 COMMANDER 앱으로 열고, 앱이 없으면 브라우저로 */
    private fun openHere() {
        val port = prefs.getInt("port", ServerService.DEFAULT_PORT)
        val local = "http://127.0.0.1:$port"
        val link = Uri.parse(NetworkInfo.connectLink(local, ServerState.name))
        try {
            startActivity(Intent(Intent.ACTION_VIEW, link))
        } catch (_: ActivityNotFoundException) {
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(local))) }
        }
    }

    private fun start(phaseScale: String?) {
        val port = portInput.text.toString().toIntOrNull()
        if (port == null || port !in 1024..65535) { toast("포트는 1024~65535 사이여야 해요"); return }
        // 엔진은 최신 웹 기능을 쓴다: 오래된 WebView 면 먼저 알린다
        val pkg = runCatching { WebView.getCurrentWebViewPackage() }.getOrNull()
        val major = pkg?.versionName?.substringBefore('.')?.toIntOrNull()
        if (pkg == null || (major != null && major < MIN_WEBVIEW_MAJOR)) {
            AlertDialog.Builder(this)
                .setTitle("WebView 업데이트가 필요해요")
                .setMessage("서버 엔진은 Android System WebView(또는 Chrome) $MIN_WEBVIEW_MAJOR 이상에서 돌아가요.\n지금: ${pkg?.versionName ?: "없음"}\n\nPlay 스토어에서 업데이트한 뒤 다시 켜 주세요.")
                .setPositiveButton("업데이트") { _, _ -> openStore(pkg?.packageName ?: "com.google.android.webview") }
                .setNegativeButton("닫기", null)
                .show()
            return
        }
        val name = nameInput.text.toString().trim().ifEmpty { "내 안드로이드 서버" }
        prefs.edit().putString("name", name).putInt("port", port).putString("edition", edition).apply()
        // 서버가 켜져 있다는 알림 (안드로이드 13+ 은 권한을 물어본다. 거절해도 서버는 돈다)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        val intent = Intent(this, ServerService::class.java).setAction(ServerService.ACTION_START)
            .putExtra(ServerService.EXTRA_NAME, name)
            .putExtra(ServerService.EXTRA_PORT, port)
            .putExtra(ServerService.EXTRA_EDITION, edition)
        if (phaseScale != null) intent.putExtra(ServerService.EXTRA_PHASE_SCALE, phaseScale)
        startForegroundService(intent)
    }

    private fun stop() {
        startService(Intent(this, ServerService::class.java).setAction(ServerService.ACTION_STOP))
    }

    private fun openStore(pkg: String) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")))
        } catch (_: ActivityNotFoundException) {
            runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg"))) }
        }
    }

    companion object {
        /** 엔진(engine.js)이 쓰는 문법(?. ?? 등)이 도는 WebView */
        const val MIN_WEBVIEW_MAJOR = 100
    }
}
