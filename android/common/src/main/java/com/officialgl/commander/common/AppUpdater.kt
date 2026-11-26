package com.officialgl.commander.common

import android.app.Activity
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.Settings
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL

/**
 * 새 버전 안내 (안드로이드): GitHub 릴리스(android-v*)의 APK 중 이 앱 것(assetPrefix)의 최신 버전을 지금 버전과 비교한다.
 * 업데이트는 앱이 APK 를 내려받아 설치 창을 연다. (안 되면 브라우저로 APK 주소를 연다)
 */
object AppUpdater {
    data class Update(val version: String, val apkUrl: String, val pageUrl: String)

    private const val RELEASES = "https://api.github.com/repos/God-Lights/edbot/releases?per_page=30"
    private const val APK_MIME = "application/vnd.android.package-archive"

    /** 이 앱의 버전 이름 */
    fun currentVersion(context: Context): String =
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).versionName }.getOrNull() ?: "0.0.0"

    /**
     * 새 버전이 있으면 Update, 없거나 확인하지 못하면 null. 네트워크를 쓰므로 메인 스레드에서 부르지 않는다.
     * assetPrefix: 게임 앱 "Commander-", 서버 앱 "CommanderServer-"
     */
    fun check(current: String, assetPrefix: String): Update? {
        if (!Versions.isRelease(current)) return null
        val text = runCatching {
            val conn = URL(RELEASES).openConnection() as HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 8000
            conn.setRequestProperty("Accept", "application/vnd.github+json")
            conn.setRequestProperty("User-Agent", "COMMANDER-Android")
            try { conn.inputStream.bufferedReader().use { it.readText() } } finally { conn.disconnect() }
        }.getOrNull() ?: return null
        val releases = runCatching { JSONArray(text) }.getOrNull() ?: return null
        var best: Update? = null
        for (i in 0 until releases.length()) {
            val r = releases.optJSONObject(i) ?: continue
            if (r.optBoolean("draft") || r.optBoolean("prerelease")) continue
            val version = Versions.fromTag(r.optString("tag_name")) ?: continue
            val assets = r.optJSONArray("assets") ?: continue
            val apk = (0 until assets.length()).mapNotNull { assets.optJSONObject(it) }
                .firstOrNull { val n = it.optString("name"); n.startsWith(assetPrefix) && n.endsWith(".apk") } ?: continue
            if (best == null || Versions.isNewer(version, best.version)) {
                best = Update(version, apk.optString("browser_download_url"), r.optString("html_url"))
            }
        }
        return best?.takeIf { Versions.isNewer(it.version, current) }
    }

    /** 내려받아 설치 창을 연다. 설치 허용이 꺼져 있으면 먼저 설정으로 보낸다. */
    fun install(activity: Activity, update: Update) {
        if (!activity.packageManager.canRequestPackageInstalls()) {
            AlertDialog.Builder(activity)
                .setTitle("설치 허용이 필요해요")
                .setMessage("새 버전을 설치하려면 이 앱의 '출처를 알 수 없는 앱 설치'를 허용해 주세요. 허용한 뒤 돌아와서 다시 '업데이트'를 누르세요.")
                .setPositiveButton("설정 열기") { _, _ ->
                    runCatching { activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))) }
                        .onFailure { openInBrowser(activity, update) }
                }
                .setNegativeButton("브라우저로 받기") { _, _ -> openInBrowser(activity, update) }
                .show()
            return
        }
        try {
            val dm = activity.getSystemService(DownloadManager::class.java)
            val request = DownloadManager.Request(Uri.parse(update.apkUrl))
                .setTitle("COMMANDER ${update.version}")
                .setDescription("새 버전을 받는 중")
                .setMimeType(APK_MIME)
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(activity, Environment.DIRECTORY_DOWNLOADS, "${activity.packageName}-${update.version}.apk")
            val id = dm.enqueue(request)
            activity.toast("새 버전을 받는 중이에요. 다 받으면 설치 창이 열려요.")
            val app = activity.applicationContext
            val receiver = object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return
                    runCatching { app.unregisterReceiver(this) }
                    val uri = dm.getUriForDownloadedFile(id)
                    if (uri == null) { openInBrowser(activity, update); return }
                    runCatching {
                        app.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, APK_MIME)
                            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK))
                    }.onFailure { openInBrowser(activity, update) }
                }
            }
            val filter = IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE)
            // 받기 완료 알림은 다운로드 앱이 보낸다 (안드로이드 13+ 는 받는 쪽을 열어 둬야 한다)
            if (Build.VERSION.SDK_INT >= 33) app.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED) else app.registerReceiver(receiver, filter)
        } catch (e: Exception) {
            openInBrowser(activity, update)
        }
    }

    private fun openInBrowser(activity: Activity, update: Update) {
        runCatching { activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(update.apkUrl)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
}
