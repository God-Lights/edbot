package com.officialgl.commander.server

import java.io.File

/**
 * 데이터 폴더의 plugins/ (엑스퍼트 서버가 켤 때 읽는 콘텐츠 팩). 안드로이드는 앱 안 폴더라 앱 화면에서 넣고 뺀다.
 * - 켜진 팩: 이름.json   - 꺼진 팩: 이름.json.off (서버가 만든 예시 example-pack.json.sample 도 꺼진 것으로 본다)
 * 형식은 docs/PLUGINS.md. 내용 검사는 서버가 켤 때 한다(틀리면 팩 전체를 거절하고 기록에 이유가 나온다).
 */
class PluginStore(dataRoot: File) {
    val dir = File(dataRoot, "plugins")

    data class Entry(val file: File, val enabled: Boolean) {
        /** 켜고 끄기와 상관없는 이름 (예: example-pack) */
        val baseName: String get() = file.name.removeSuffix(".off").removeSuffix(".sample").removeSuffix(".json")
    }

    fun list(): List<Entry> = (dir.listFiles() ?: emptyArray())
        .filter { it.isFile }
        .mapNotNull { f ->
            when {
                f.name.endsWith(".json") -> Entry(f, true)
                f.name.endsWith(".json.off") || f.name.endsWith(".json.sample") -> Entry(f, false)
                else -> null
            }
        }
        .sortedBy { it.baseName }

    /** 팩을 넣는다 (같은 id 가 있으면 바꾼다). 켜진 상태로 넣고, 꺼져 있던 같은 이름은 지운다. */
    fun add(id: String, text: String): File {
        require(validId(id)) { "팩 id 는 영문 소문자·숫자·- 로 32자까지예요" }
        dir.mkdirs()
        File(dir, "$id.json.off").delete()
        val file = File(dir, "$id.json")
        val tmp = File(dir, "$id.json.tmp")
        tmp.writeText(text, Charsets.UTF_8)
        if (!tmp.renameTo(file)) { file.delete(); check(tmp.renameTo(file)) { "저장하지 못했어요" } }
        return file
    }

    fun has(id: String): Boolean = list().any { it.baseName == id }

    /** 켜고 끈다 (이름 끝의 .off 를 붙이고 뗀다) */
    fun setEnabled(entry: Entry, enabled: Boolean): Entry {
        if (entry.enabled == enabled) return entry
        val target = File(dir, entry.baseName + if (enabled) ".json" else ".json.off")
        if (target.exists()) target.delete()
        check(entry.file.renameTo(target)) { "이름을 바꾸지 못했어요" }
        return Entry(target, enabled)
    }

    fun remove(entry: Entry) {
        entry.file.delete()
    }

    companion object {
        fun validId(id: String): Boolean = Regex("^[a-z0-9-]{1,32}$").matches(id)
    }
}
