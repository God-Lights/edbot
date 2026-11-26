package com.officialgl.commander.server

import java.net.Inet4Address
import java.net.NetworkInterface

object NetworkInfo {
    /** 같은 와이파이(또는 핫스팟)에서 보이는 이 기기의 IPv4 주소들. 와이파이(wlan)를 맨 앞에 둔다. */
    fun ipv4Addresses(): List<String> {
        val found = mutableListOf<Pair<String, String>>()
        val interfaces = runCatching { NetworkInterface.getNetworkInterfaces()?.toList() }.getOrNull() ?: return emptyList()
        for (nif in interfaces) {
            if (!runCatching { nif.isUp && !nif.isLoopback }.getOrDefault(false)) continue
            // 모바일 데이터(rmnet 등)는 같은 와이파이의 기기가 닿지 않는다
            val name = nif.name ?: continue
            if (!(name.startsWith("wlan") || name.startsWith("ap") || name.startsWith("swlan") || name.startsWith("eth") || name.startsWith("rndis"))) continue
            for (addr in nif.inetAddresses.toList()) {
                if (addr is Inet4Address && !addr.isLoopbackAddress) found += name to (addr.hostAddress ?: continue)
            }
        }
        return found.sortedWith(compareBy({ if (it.first.startsWith("wlan")) 0 else 1 }, { it.first })).map { it.second }.distinct()
    }

    /** 앱이 여는 접속 링크 (로컬 서버 QR 과 같다): commander://connect?url=<주소>&name=<이름> */
    fun connectLink(url: String, name: String): String =
        "commander://connect?url=" + java.net.URLEncoder.encode(url, "UTF-8") + "&name=" + java.net.URLEncoder.encode(name, "UTF-8").replace("+", "%20")
}
