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
import org.json.JSONObject
import java.io.File
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
 * COMMANDER 서버 (안드로이드): 이 폰을 게임 서버로 켠다. 같은 와이파이의 기기가 주소·QR·서버 목록으로 접속한다.
 * 실제 일은 ServerService(포그라운드 서비스)가 하고, 이 화면은 설정과 상태를 보여 준다.
 */
class ServerActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var nameInput: EditText
    private lateinit var portInput: EditText
    private lateinit var editionRow: LinearLayout
    private lateinit var authRow: LinearLayout
    private lateinit var linkBox: LinearLayout
    private lateinit var ownerInput: EditText
    private lateinit var guestsButton: TextView
    private lateinit var toggle: TextView
    private lateinit var addressBox: LinearLayout
    private lateinit var pluginsText: TextView
    private lateinit var logText: TextView
    private var edition = "vanilla"
    /** 로그인 방식: open(이름만) | linked(GL 연결: 로그인은 GL 계정, 전적은 이 폰) */
    private var auth = "open"
    private var linkGuests = false
    private val prefs by lazy { getSharedPreferences("server", Context.MODE_PRIVATE) }
    private val renderListener: () -> Unit = { render() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        edition = prefs.getString("edition", "vanilla") ?: "vanilla"
        auth = if (prefs.getString("auth", "open") == "linked") "linked" else "open"
        linkGuests = prefs.getBoolean("linkGuests", false)
        setContentView(buildContent())
        checkForUpdate()
        // 시험용(CI): 바로 켜기
        if (savedInstanceState == null && intent.getBooleanExtra("autostart", false)) {
            // 시험용(CI): 로그인 방식도 정할 수 있다 (--es auth linked --es linkOwner 아이디)
            intent.getStringExtra("auth")?.let { auth = if (it == "linked") "linked" else "open" }
            intent.getStringExtra("linkOwner")?.let { ownerInput.setText(it) }
            render()
            start(intent.getStringExtra("phaseScale"))
        }
    }

    override fun onStart() {
        super.onStart()
        ServerState.observe(renderListener)
        render()
        showPlugins()
    }

    override fun onStop() {
        ServerState.forget(renderListener)
        super.onStop()
    }

    private lateinit var column: LinearLayout
    private lateinit var pluginBox: LinearLayout
    private lateinit var pluginNote: TextView
    private val plugins by lazy { PluginStore(File(filesDir, "commander-data")) }

    // ---- 플러그인 ----

    private fun showPlugins() {
        pluginBox.removeAllViews()
        val list = plugins.list()
        pluginNote.text = when {
            edition != "expert" -> "바닐라 서버는 팩을 읽지 않아요. 위에서 '엑스퍼트'를 고르고 켜면 켜진 팩이 적용돼요."
            list.isEmpty() -> "넣은 팩이 없어요. 엑스퍼트로 한 번 켜면 예시 팩(꺼진 상태)이 생겨요."
            else -> "켜진 팩은 서버를 켤 때 적용돼요. 바꾼 뒤에는 서버를 껐다 켜 주세요."
        }
        for (entry in list) {
            val info = runCatching { JSONObject(entry.manifest.readText()) }.getOrNull()
            val title = info?.optString("name")?.takeIf { it.isNotEmpty() } ?: entry.baseName
            val detail = listOfNotNull(
                KIND_NAME[packKind(info)],
                info?.optString("id")?.takeIf { it.isNotEmpty() },
                info?.optString("version")?.takeIf { it.isNotEmpty() }?.let { "v$it" },
                if (info == null) "읽을 수 없는 파일" else null,
            ).joinToString(" · ")
            val row = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                background = panelBackground()
                setPadding(dp(12), dp(8), dp(8), dp(8))
                addView(LinearLayout(context).apply {
                    orientation = LinearLayout.VERTICAL
                    addView(label(title, 15f, if (entry.enabled) Palette.silver else Palette.dim, bold = true))
                    addView(label(if (detail.isEmpty()) entry.file.name else detail, 12f, Palette.dim))
                }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
                val toggleButton = if (entry.enabled) goldButton("켜짐") { togglePack(entry) } else plainButton("꺼짐") { togglePack(entry) }
                addView(toggleButton.apply { setPadding(dp(12), dp(6), dp(12), dp(6)) }, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { marginEnd = dp(6) })
                addView(plainButton("삭제") { deletePack(entry, title) }.apply { setPadding(dp(12), dp(6), dp(12), dp(6)) })
            }
            pluginBox.addView(row, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(6) })
        }
    }

    private fun changedPacks(message: String) {
        showPlugins()
        toast(if (ServerState.status == ServerState.Status.RUNNING) "$message 서버를 껐다 켜면 적용돼요." else message)
    }

    private fun togglePack(entry: PluginStore.Entry) {
        runCatching { plugins.setEnabled(entry, !entry.enabled) }
            .onSuccess { changedPacks(if (it.enabled) "팩을 켰어요." else "팩을 껐어요.") }
            .onFailure { toast("바꾸지 못했어요: ${it.message}") }
    }

    private fun deletePack(entry: PluginStore.Entry, title: String) {
        AlertDialog.Builder(this)
            .setMessage("'$title' 팩을 지울까요?")
            .setPositiveButton("지우기") { _, _ -> plugins.remove(entry); changedPacks("팩을 지웠어요.") }
            .setNegativeButton("취소", null)
            .show()
    }

    /** 안드로이드 파일 고르기(내려받기·드라이브 등)로 팩 JSON 을 고른다 */
    private fun pickPack() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*")
            .putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("application/json", "text/plain", "application/zip", "application/x-zip-compressed", "application/octet-stream"))
        try {
            startActivityForResult(intent, PICK_PACK)
        } catch (_: ActivityNotFoundException) {
            toast("파일을 고를 수 있는 앱이 없어요")
        }
    }

    @Deprecated("Activity 결과 API (안드로이드 8에서도 되는 방식)")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != PICK_PACK || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        val bytes = runCatching {
            contentResolver.openInputStream(uri)?.use { input ->
                val all = input.readBytes()
                require(all.size <= PluginStore.MAX_ZIP_BYTES) { "파일이 너무 커요 (40MB 까지)" }
                all
            }
        }.getOrElse { toast("파일을 읽지 못했어요: ${it.message}"); return } ?: return
        // 그림·소리가 있는 팩은 .zip (안에 pack.json), 파일 하나짜리 팩은 .json
        val zipFiles = if (PluginStore.isZip(bytes)) runCatching { PluginStore.readZipPack(bytes) }.getOrElse { toast("zip 을 읽지 못했어요: ${it.message}"); return } else null
        val text = zipFiles?.get("pack.json")?.toString(Charsets.UTF_8) ?: String(bytes, Charsets.UTF_8)
        val pack = runCatching { JSONObject(text) }.getOrElse { toast(if (zipFiles != null) "zip 안의 pack.json 을 읽지 못했어요" else "JSON 파일이 아니에요"); return }
        val id = pack.optString("id")
        val save = { if (zipFiles != null) saveZip(id, zipFiles) else savePack(id, text) }
        when {
            pack.optInt("apiVersion", 0) != 1 -> toast("팩 형식이 아니에요 (apiVersion 1 이 필요해요)")
            !PluginStore.validId(id) -> toast("팩 id 가 올바르지 않아요 (영문 소문자·숫자·-)")
            plugins.has(id) -> AlertDialog.Builder(this)
                .setMessage("'$id' 팩이 이미 있어요. 새 파일로 바꿀까요?")
                .setPositiveButton("바꾸기") { _, _ -> save() }
                .setNegativeButton("취소", null)
                .show()
            else -> save()
        }
    }

    private fun saveZip(id: String, files: Map<String, ByteArray>) {
        runCatching { plugins.addZip(id, files) }
            .onSuccess { changedPacks("'$id' 팩을 넣었어요 (그림·소리 ${files.size - 1}개).") }
            .onFailure { toast("넣지 못했어요: ${it.message}") }
    }

    private fun savePack(id: String, text: String) {
        runCatching { plugins.add(id, text) }
            .onSuccess { changedPacks("'$id' 팩을 넣었어요.") }
            .onFailure { toast("넣지 못했어요: ${it.message}") }
    }

    /** GitHub 릴리스에 새 버전이 있으면 맨 위에 띠를 띄운다 */
    private fun checkForUpdate() {
        val current = AppUpdater.currentVersion(this)
        Thread {
            val update = AppUpdater.check(current, "CommanderServer-") ?: return@Thread
            runOnUiThread {
                if (isFinishing) return@runOnUiThread
                lateinit var banner: View
                banner = updateBanner(update.version, current, onUpdate = { AppUpdater.install(this, update) }, onDismiss = { column.removeView(banner) })
                column.addView(banner, 0)
            }
        }.start()
    }

    private fun buildContent(): View {
        column = LinearLayout(this).apply {
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

        // 로그인 방식
        column.addView(label("로그인", 13f, Palette.silver, bold = true).apply { setPadding(dp(4), dp(14), dp(4), dp(6)) })
        authRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        column.addView(authRow)
        linkBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(8), 0, 0) }
        ownerInput = input("주인 GL 아이디 (서버 관리용)", prefs.getString("linkOwner", "") ?: "", InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS)
        linkBox.addView(ownerInput, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(8) })
        guestsButton = plainButton("") { if (ServerState.status == ServerState.Status.STOPPED || ServerState.status == ServerState.Status.FAILED) { linkGuests = !linkGuests; render() } }
        linkBox.addView(guestsButton, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        linkBox.addView(label(
            "GL 연결: 로그인은 GL 계정으로 하고(공식 서버가 확인), 전적·랭킹은 이 폰에만 남아요. 로그인할 때 이 폰이 인터넷에 연결되어 있어야 해요.\n" +
                "주인 GL 아이디를 적으면 그 계정으로 브라우저에서 /server-admin.html 을 열어 사람을 막거나 랭킹을 처음부터 할 수 있어요.", 12f, Palette.dim).apply { setPadding(dp(4), dp(6), dp(4), 0) })
        column.addView(linkBox)

        toggle = goldButton("서버 켜기") { if (ServerState.status == ServerState.Status.RUNNING) stop() else start(null) }
        column.addView(toggle, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(16) })

        addressBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(addressBox)
        pluginsText = label("", 13f, Palette.dim).apply { visibility = View.GONE; setPadding(dp(4), dp(8), dp(4), 0) }
        column.addView(pluginsText)

        // 콘텐츠 팩(플러그인): 앱 안 폴더라 여기서 넣고 뺀다
        column.addView(sectionTitle("플러그인 (엑스퍼트)"))
        pluginNote = label("", 12.5f, Palette.dim).apply { setPadding(dp(4), 0, dp(4), dp(6)) }
        column.addView(pluginNote)
        pluginBox = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        column.addView(pluginBox)
        column.addView(plainButton("팩 추가 (.json 또는 .zip 고르기)") { pickPack() }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(4) })
        column.addView(label("팩 만드는 법: docs/PLUGINS.md (GitHub). 틀린 팩은 서버를 켤 때 거절되고 기록에 이유가 나와요.", 11.5f, Palette.dim).apply { setPadding(dp(4), dp(6), dp(4), 0) })

        column.addView(sectionTitle("안내"))
        column.addView(label(
            "• 접속하는 기기는 이 폰과 같은 와이파이(또는 이 폰의 핫스팟)에 있어야 해요.\n" +
                "• COMMANDER 앱은 서버 목록에 이 서버가 뜨고, QR 을 찍어도 돼요. 브라우저는 주소를 그대로 열어요.\n" +
                "• 앱을 내려도 서버는 켜져 있어요 (알림에서 끌 수 있어요). 오래 켜 둘 때는 배터리 최적화를 꺼 주세요.\n" +
                "• 전적은 이 폰에 남아요. '이름만'이면 이름이 같으면 같은 사람으로, 'GL 연결'이면 GL 계정으로 이어져요.", 13f, Palette.silver))
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

    private var lastStatus: ServerState.Status? = null

    private fun render() {
        val state = ServerState
        // 엑스퍼트로 처음 켜면 서버가 예시 팩을 만든다: 상태가 바뀔 때 팩 목록도 다시 읽는다
        if (lastStatus != state.status) { lastStatus = state.status; if (::pluginBox.isInitialized) showPlugins() }
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
        for (v in listOf(nameInput, portInput, ownerInput)) { v.isEnabled = !running && !busy; v.alpha = if (running || busy) 0.6f else 1f }

        authRow.removeAllViews()
        for ((key, title) in listOf("open" to "이름만", "linked" to "GL 연결")) {
            val button = if (auth == key) goldButton(title) {} else plainButton(title) { if (!running && !busy) { auth = key; render() } }
            button.isEnabled = !running && !busy
            authRow.addView(button, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { if (key == "open") marginEnd = dp(8) })
        }
        linkBox.visibility = if (auth == "linked") View.VISIBLE else View.GONE
        guestsButton.text = if (linkGuests) "GL 계정 없는 사람도 받기: 켬 (이름으로 놀고 전적 없음)" else "GL 계정 없는 사람도 받기: 끔"
        guestsButton.isEnabled = !running && !busy

        editionRow.removeAllViews()
        for ((key, title) in listOf("vanilla" to "바닐라", "expert" to "엑스퍼트")) {
            val selected = edition == key
            val button = if (selected) goldButton(title) {} else plainButton(title) { if (!running && !busy) { edition = key; render(); showPlugins() } }
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
        // GL 연결 서버의 주인 관리 페이지 (브라우저에서 주인 GL 계정으로)
        if (auth == "linked" && ownerInput.text.isNotBlank()) {
            val admin = "${addresses.firstOrNull() ?: "http://localhost:${portInput.text}"}/server-admin.html"
            addressBox.addView(rowButton("서버 관리: $admin", "주인 GL 계정으로 브라우저에서 열어요 · 눌러서 열기") {
                runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(admin))) }.onFailure { copy(admin) }
            }, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { topMargin = dp(8) })
        }
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
        val owner = ownerInput.text.toString().trim()
        prefs.edit().putString("name", name).putInt("port", port).putString("edition", edition)
            .putString("auth", auth).putString("linkOwner", owner).putBoolean("linkGuests", linkGuests).apply()
        // 서버가 켜져 있다는 알림 (안드로이드 13+ 은 권한을 물어본다. 거절해도 서버는 돈다)
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        val intent = Intent(this, ServerService::class.java).setAction(ServerService.ACTION_START)
            .putExtra(ServerService.EXTRA_NAME, name)
            .putExtra(ServerService.EXTRA_PORT, port)
            .putExtra(ServerService.EXTRA_EDITION, edition)
            .putExtra(ServerService.EXTRA_AUTH, auth)
            .putExtra(ServerService.EXTRA_LINK_OWNER, owner)
            .putExtra(ServerService.EXTRA_LINK_GUESTS, linkGuests)
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

    /** 팩 종류: kind 를 안 적었으면 내용으로 (서버와 같은 규칙) */
    private fun packKind(info: JSONObject?): String {
        if (info == null) return ""
        info.optString("kind").takeIf { it.isNotEmpty() }?.let { return it }
        val gameplay = listOf("units", "unitOverrides", "materials", "weapons", "fusions", "rules").any { info.has(it) }
        return if (info.has("resources")) (if (gameplay) "bundle" else "resource") else "plugin"
    }

    companion object {
        private val KIND_NAME = mapOf("bundle" to "종합", "resource" to "리소스", "plugin" to "플러그인")
        private const val PICK_PACK = 7
        /** 엔진(engine.js)이 쓰는 문법(?. ?? 등)이 도는 WebView */
        const val MIN_WEBVIEW_MAJOR = 100
    }
}
