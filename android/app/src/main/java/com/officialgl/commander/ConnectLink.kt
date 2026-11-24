package com.officialgl.commander

import java.net.URI
import java.net.URLDecoder

/** 공식 서버 (iOS 앱의 기본 서버와 같다) */
const val OFFICIAL_SERVER = "https://edgame-api.officialgl.com"

/**
 * 사람이 적은 서버 주소를 http(s) 주소로 다듬는다. 다듬을 수 없으면 null.
 * - 앞뒤 공백과 끝의 / 를 지운다.
 * - 방식(http/https)이 없으면: 같은 와이파이 주소(사설 IP, localhost, .local)는 http, 나머지는 https.
 */
fun normalizeServerUrl(text: String): String? {
    var url = text.trim()
    if (url.isEmpty()) return null
    if (!url.contains("://")) url = (if (looksLocal(url)) "http://" else "https://") + url
    url = url.trimEnd('/')
    val uri = runCatching { URI(url) }.getOrNull() ?: return null
    val scheme = uri.scheme?.lowercase() ?: return null
    if (scheme != "http" && scheme != "https") return null
    if (uri.host.isNullOrEmpty()) return null
    return url
}

private fun looksLocal(address: String): Boolean {
    val host = address.substringBefore('/').substringBefore(':').lowercase()
    if (host == "localhost" || host.endsWith(".local")) return true
    val parts = host.split('.').mapNotNull { it.toIntOrNull() }
    if (parts.size != 4 || parts.any { it !in 0..255 }) return false
    return parts[0] == 10 || parts[0] == 127 || (parts[0] == 192 && parts[1] == 168) ||
        (parts[0] == 172 && parts[1] in 16..31) || (parts[0] == 169 && parts[1] == 254)
}

/** QR이나 링크로 받은 서버 정보: commander://connect?url=<서버 주소>&name=<서버 이름> */
data class ConnectLink(val serverUrl: String, val name: String?) {
    companion object {
        /** 우리 링크가 아니거나 주소가 http(s)가 아니면 null. */
        fun parse(link: String): ConnectLink? {
            val uri = runCatching { URI(link.trim()) }.getOrNull() ?: return null
            if (uri.scheme?.lowercase() != "commander" || uri.host?.lowercase() != "connect") return null
            val query = queryItems(uri.rawQuery ?: return null)
            val raw = query["url"] ?: return null
            val url = normalizeServerUrl(raw) ?: return null
            val name = query["name"]?.trim()?.takeIf { it.isNotEmpty() }
            return ConnectLink(url, name)
        }

        private fun queryItems(raw: String): Map<String, String> = raw.split('&').mapNotNull { pair ->
            if (pair.isEmpty()) return@mapNotNull null
            val key = pair.substringBefore('=')
            val value = if (pair.contains('=')) pair.substringAfter('=') else ""
            runCatching { URLDecoder.decode(key, "UTF-8") to URLDecoder.decode(value, "UTF-8") }.getOrNull()
        }.toMap()
    }
}

/** 같은 와이파이에서 찾은 서버 한 개 (mDNS `_commander._tcp` 의 TXT 레코드에서 읽는다) */
data class FoundServer(val name: String, val url: String, val expert: Boolean) {
    companion object {
        /** TXT: name, ip(쉼표로 여러 개), port, ed. 주소를 못 만들면 null. */
        fun fromTxt(txt: Map<String, String>, fallbackName: String): FoundServer? {
            val port = txt["port"]?.toIntOrNull()?.takeIf { it in 1..65535 } ?: return null
            val ip = txt["ip"]?.split(',')?.firstOrNull()?.trim()?.takeIf { it.isNotEmpty() } ?: return null
            val name = txt["name"]?.takeIf { it.isNotEmpty() } ?: fallbackName
            return FoundServer(name, "http://$ip:$port", txt["ed"] == "expert")
        }
    }
}

/** "120.0.6099.230" -> 120 */
fun webViewMajor(versionName: String?): Int? = versionName?.substringBefore('.')?.toIntOrNull()

/** 웹 화면이 쓰는 CSS(color-mix 등)가 제대로 그려지는 가장 낮은 WebView(크롬) 버전 */
const val MIN_WEBVIEW_MAJOR = 111
