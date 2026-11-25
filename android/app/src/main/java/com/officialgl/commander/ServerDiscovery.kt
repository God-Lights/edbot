package com.officialgl.commander

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Handler
import android.os.Looper
import android.util.Log

/**
 * 같은 와이파이의 COMMANDER 로컬 서버를 찾는다. (mDNS `_commander._tcp`, 서버가 TXT에 주소를 실어 보낸다)
 * 안드로이드 8의 NsdManager 는 한 번에 하나만 풀 수 있어서(resolve) 차례대로 푼다.
 */
class ServerDiscovery(context: Context, private val onChange: (List<FoundServer>) -> Unit) {
    private val app = context.applicationContext
    private val nsd = app.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val main = Handler(Looper.getMainLooper())
    private val found = LinkedHashMap<String, FoundServer>() // 서비스 이름 -> 서버
    private val queue = ArrayDeque<NsdServiceInfo>()
    private var resolving = false
    private var listener: NsdManager.DiscoveryListener? = null
    private var lock: WifiManager.MulticastLock? = null

    fun start() {
        if (listener != null) return
        runCatching {
            lock = (app.getSystemService(Context.WIFI_SERVICE) as WifiManager).createMulticastLock("commander-discovery").apply {
                setReferenceCounted(false)
                acquire()
            }
        }
        val l = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { Log.w(TAG, "찾기 시작 실패 $errorCode") }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onServiceFound(info: NsdServiceInfo) {
                main.post { enqueue(info) }
            }
            override fun onServiceLost(info: NsdServiceInfo) {
                main.post { if (found.remove(info.serviceName) != null) publish() }
            }
        }
        listener = l
        runCatching { nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, l) }.onFailure { Log.w(TAG, "찾기 실패", it); listener = null }
    }

    fun stop() {
        listener?.let { runCatching { nsd.stopServiceDiscovery(it) } }
        listener = null
        queue.clear()
        runCatching { lock?.release() }
        lock = null
    }

    private fun enqueue(info: NsdServiceInfo) {
        if (queue.none { it.serviceName == info.serviceName }) queue.addLast(info)
        resolveNext()
    }

    @Suppress("DEPRECATION") // resolveService: 안드로이드 14부터 새 API가 있지만 8에서도 돌아야 한다
    private fun resolveNext() {
        if (resolving || listener == null) return
        val next = queue.removeFirstOrNull() ?: return
        resolving = true
        nsd.resolveService(next, object : NsdManager.ResolveListener {
            override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                main.post {
                    resolving = false
                    resolveNext()
                }
            }

            override fun onServiceResolved(info: NsdServiceInfo) {
                main.post { resolved(info) }
            }
        })
    }

    @Suppress("DEPRECATION") // host: 안드로이드 14부터 hostAddresses
    private fun resolved(info: NsdServiceInfo) {
        resolving = false
        val txt = info.attributes.mapValues { (_, v) -> v?.toString(Charsets.UTF_8) ?: "" }
        val server = FoundServer.fromTxt(txt, info.serviceName)
            ?: info.host?.hostAddress?.let { host -> FoundServer(info.serviceName, "http://$host:${info.port}", false) }
        if (server != null) {
            found[info.serviceName] = server
            publish()
        }
        resolveNext()
    }

    private fun publish() = onChange(found.values.toList())

    private companion object {
        const val SERVICE_TYPE = "_commander._tcp."
        const val TAG = "ServerDiscovery"
    }
}
