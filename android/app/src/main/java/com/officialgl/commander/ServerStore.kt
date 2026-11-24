package com.officialgl.commander

import android.content.Context

/** 최근에 들어간 서버 (최대 6개, 최근 것이 앞) */
class ServerStore(context: Context) {
    data class Entry(val url: String, val name: String?)

    private val prefs = context.getSharedPreferences("servers", Context.MODE_PRIVATE)

    fun recent(): List<Entry> = (prefs.getString(KEY, "") ?: "").lines().mapNotNull { line ->
        val url = line.substringBefore('\t').takeIf { it.isNotBlank() } ?: return@mapNotNull null
        Entry(url, line.substringAfter('\t', "").takeIf { it.isNotBlank() })
    }

    fun remember(url: String, name: String?) {
        val old = recent().filter { it.url != url }
        val keepName = name ?: recent().firstOrNull { it.url == url }?.name
        save(listOf(Entry(url, keepName)) + old)
    }

    fun forget(url: String) = save(recent().filter { it.url != url })

    private fun save(list: List<Entry>) {
        val text = list.take(6).joinToString("\n") { e -> e.url + "\t" + (e.name ?: "").replace('\t', ' ').replace('\n', ' ') }
        prefs.edit().putString(KEY, text).apply()
    }

    private companion object { const val KEY = "recent" }
}
