package com.officialgl.commander.server

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.drawable.Icon
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import java.io.File
import java.util.concurrent.Executors

/** 화면(ServerActivity)이 보는 서버 상태. 서비스가 바꾸고, 바뀌면 알린다. (메인 스레드) */
object ServerState {
    enum class Status { STOPPED, STARTING, RUNNING, FAILED }

    var status: Status = Status.STOPPED
        private set
    var error: String? = null
        private set
    var addresses: List<String> = emptyList()
        private set
    var name: String = ""
        private set
    var plugins: String? = null
        private set
    val log = ArrayDeque<String>()

    private val listeners = mutableSetOf<() -> Unit>()
    private val main = Handler(Looper.getMainLooper())

    fun observe(listener: () -> Unit) { listeners += listener }
    fun forget(listener: () -> Unit) { listeners -= listener }
    private fun changed() = main.post { listeners.toList().forEach { it() } }

    fun set(status: Status, error: String? = null, addresses: List<String> = this.addresses, name: String = this.name, plugins: String? = this.plugins) {
        this.status = status
        this.error = error
        this.addresses = addresses
        this.name = name
        this.plugins = plugins
        changed()
    }

    fun append(line: String) {
        android.util.Log.i("CommanderServer", line)
        main.post {
            log.addLast(line)
            while (log.size > 200) log.removeFirst()
            listeners.toList().forEach { it() }
        }
    }
}

/**
 * 서버를 켜 두는 포그라운드 서비스. 앱을 내려도(같은 폰에서 게임을 열어도) 서버가 계속 돈다.
 * 엔진(숨은 웹뷰) + 접속 서버(NanoHTTPD) + 같은 와이파이 알림(mDNS `_commander._tcp`).
 */
class ServerService : Service(), Engine.Listener {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor() // 파일 쓰기는 순서대로
    private val worker = Executors.newSingleThreadExecutor() // 시작·끄기
    private var engine: Engine? = null
    private var http: HttpServer? = null
    private var store: DataStore? = null
    private var nsd: NsdManager? = null
    private var registration: NsdManager.RegistrationListener? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var multicastLock: WifiManager.MulticastLock? = null
    private var port = DEFAULT_PORT

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> stopServer()
            ACTION_START -> {
                if (ServerState.status == ServerState.Status.RUNNING || ServerState.status == ServerState.Status.STARTING) return START_NOT_STICKY
                val name = intent.getStringExtra(EXTRA_NAME)?.takeIf { it.isNotBlank() } ?: "내 안드로이드 서버"
                val edition = if (intent.getStringExtra(EXTRA_EDITION) == "expert") "expert" else "vanilla"
                port = intent.getIntExtra(EXTRA_PORT, DEFAULT_PORT)
                goForeground("켜는 중…")
                startServer(name, edition, intent.getStringExtra(EXTRA_PHASE_SCALE))
            }
        }
        return START_NOT_STICKY
    }

    // ---- 켜기 ----

    private fun startServer(name: String, edition: String, phaseScale: String?) {
        ServerState.set(ServerState.Status.STARTING, name = name, addresses = emptyList(), plugins = null)
        val data = DataStore(File(filesDir, "commander-data"))
        store = data
        worker.execute {
            val source = runCatching { assets.open("engine.js").bufferedReader().use { it.readText() } }.getOrNull()
            if (source == null) { fail("엔진 파일(engine.js)이 앱에 들어 있지 않다."); return@execute }
            val files = runCatching { data.loadAll() }.getOrElse { fail("데이터 폴더를 읽지 못했다: ${it.message}"); return@execute }
            val version = runCatching { packageManager.getPackageInfo(packageName, 0).versionName }.getOrNull() ?: "0.0.0"
            main.post {
                val e = Engine(this, this)
                engine = e
                e.start(source, files, name, edition, version, phaseScale) { result ->
                    result.onFailure { fail("엔진을 시작하지 못했다: ${it.message}") }
                    result.onSuccess { info -> worker.execute { openPort(name, edition, info) } }
                }
            }
        }
    }

    private fun openPort(name: String, edition: String, info: Engine.BootInfo) {
        val e = engine ?: return
        val server = HttpServer(port, e, assets) { ServerState.append(it) }
        try {
            server.start(0, false) // 0: 읽기 시간 제한 없음 (WebSocket 이 오래 열려 있다)
        } catch (ex: Exception) {
            fail("포트 $port 를 열지 못했다: ${ex.message}")
            return
        }
        // 팩 폴더(엔진이 알려 준 plugins/...): 그림·소리를 /packs/<id>/ 로 내준다
        val accepted = info.plugins?.optJSONArray("accepted")
        server.packDirs = (0 until (accepted?.length() ?: 0)).mapNotNull { i ->
            val p = accepted!!.optJSONObject(i) ?: return@mapNotNull null
            val dir = p.optString("dir").takeIf { it.isNotEmpty() } ?: return@mapNotNull null
            p.optString("id") to File(store?.root ?: return@mapNotNull null, dir.removePrefix("./"))
        }.toMap()
        http = server
        acquireLocks()
        val ips = NetworkInfo.ipv4Addresses()
        advertise(name, edition, ips)
        val addresses = ips.map { "http://$it:$port" }
        if (info.woken > 0) ServerState.append("이어서 진행하는 방 ${info.woken}개")
        val plugins = info.plugins?.let { p ->
            val accepted = p.optJSONArray("accepted")
            "플러그인 ${accepted?.length() ?: 0}개 적용"
        }
        ServerState.set(ServerState.Status.RUNNING, addresses = addresses, name = name, plugins = plugins)
        ServerState.append("서버를 켰다 (${if (edition == "expert") "엑스퍼트" else "바닐라"}, 포트 $port)")
        main.post { goForeground(addresses.firstOrNull() ?: "http://localhost:$port") }
    }

    /** 같은 와이파이의 앱이 찾을 수 있게 알린다. TXT 는 로컬 서버와 같다: name, ip, port, ed, proto */
    private fun advertise(name: String, edition: String, ips: List<String>) {
        val manager = getSystemService(Context.NSD_SERVICE) as NsdManager
        val service = NsdServiceInfo().apply {
            serviceName = name
            serviceType = "_commander._tcp"
            port = this@ServerService.port
            setAttribute("name", name)
            setAttribute("ip", ips.joinToString(","))
            setAttribute("port", this@ServerService.port.toString())
            setAttribute("ed", edition)
            setAttribute("proto", "1")
        }
        val listener = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) = ServerState.append("같은 와이파이에 알림: ${info.serviceName}")
            override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) = ServerState.append("[주의] 와이파이 알림 실패 ($code). 주소나 QR 로 접속하세요.")
            override fun onServiceUnregistered(info: NsdServiceInfo) {}
            override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) {}
        }
        runCatching { manager.registerService(service, NsdManager.PROTOCOL_DNS_SD, listener) }
            .onSuccess { nsd = manager; registration = listener }
            .onFailure { ServerState.append("[주의] 와이파이 알림 실패: ${it.message}") }
    }

    @Suppress("DEPRECATION") // WIFI_MODE_FULL_HIGH_PERF: 안드로이드 8에서도 되는 방식
    private fun acquireLocks() {
        runCatching {
            wakeLock = (getSystemService(Context.POWER_SERVICE) as PowerManager)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "commander:server").apply { setReferenceCounted(false); acquire() }
        }
        val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        runCatching { wifiLock = wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "commander:server").apply { setReferenceCounted(false); acquire() } }
        runCatching { multicastLock = wifi.createMulticastLock("commander:server").apply { setReferenceCounted(false); acquire() } }
    }

    private fun fail(message: String) {
        ServerState.append("[오류] $message")
        main.post {
            teardown()
            ServerState.set(ServerState.Status.FAILED, error = message, addresses = emptyList())
            stopForegroundCompat()
            stopSelf()
        }
    }

    // ---- 끄기 ----

    private fun stopServer() {
        if (ServerState.status == ServerState.Status.STOPPED) { stopSelf(); return }
        engine?.flush()
        // 엔진이 보낸 저장 변경이 전달될 시간을 잠깐 준다
        main.postDelayed({
            teardown()
            ServerState.set(ServerState.Status.STOPPED, addresses = emptyList())
            ServerState.append("서버를 껐다")
            stopForegroundCompat()
            stopSelf()
        }, 500)
    }

    private fun teardown() {
        registration?.let { r -> runCatching { nsd?.unregisterService(r) } }
        registration = null
        val server = http
        http = null
        if (server != null) worker.execute { runCatching { server.stop() } }
        engine?.destroy()
        engine = null
        runCatching { wakeLock?.release() }
        runCatching { wifiLock?.release() }
        runCatching { multicastLock?.release() }
        wakeLock = null; wifiLock = null; multicastLock = null
    }

    override fun onDestroy() {
        teardown()
        if (ServerState.status == ServerState.Status.RUNNING || ServerState.status == ServerState.Status.STARTING) {
            ServerState.set(ServerState.Status.STOPPED, addresses = emptyList())
        }
        super.onDestroy()
    }

    // ---- Engine.Listener ----

    override fun onFileOps(ops: List<FileOp>) {
        val s = store ?: return
        io.execute { for (error in s.apply(ops)) ServerState.append("[저장 오류] $error") }
    }

    override fun onSocketSend(id: Int, data: String, binary: Boolean) { http?.socketSend(id, data, binary) }
    override fun onSocketClose(id: Int, code: Int, reason: String) { http?.socketClose(id, code, reason) }
    override fun onLog(level: String, text: String) = ServerState.append(if (level == "log") text else "[$level] $text")
    override fun onCrash() = fail("엔진(웹뷰)이 멈췄어요. 다시 켜 주세요.")

    // ---- 알림 ----

    private fun goForeground(text: String) {
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(CHANNEL, "서버", NotificationManager.IMPORTANCE_LOW).apply {
            description = "COMMANDER 서버가 켜져 있는 동안 보여요"
        })
        val open = PendingIntent.getActivity(this, 0, Intent(this, ServerActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, ServerService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        val notification = Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_server)
            .setContentTitle("COMMANDER 서버")
            .setContentText(text)
            .setContentIntent(open)
            .setOngoing(true)
            .addAction(Notification.Action.Builder(Icon.createWithResource(this, R.drawable.ic_stat_server), "끄기", stop).build())
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun stopForegroundCompat() = stopForeground(STOP_FOREGROUND_REMOVE)

    companion object {
        const val ACTION_START = "com.officialgl.commander.server.START"
        const val ACTION_STOP = "com.officialgl.commander.server.STOP"
        const val EXTRA_NAME = "name"
        const val EXTRA_PORT = "port"
        const val EXTRA_EDITION = "edition"
        const val EXTRA_PHASE_SCALE = "phaseScale"
        const val DEFAULT_PORT = 8787
        private const val CHANNEL = "server"
        private const val NOTIFICATION_ID = 1
    }
}
