package com.officialgl.commander.server

import java.io.ByteArrayInputStream
import java.io.File
import java.util.zip.ZipInputStream

/**
 * 데이터 폴더의 plugins/ (엑스퍼트 서버가 켤 때 읽는 콘텐츠 팩). 안드로이드는 앱 안 폴더라 앱 화면에서 넣고 뺀다.
 * - 파일 하나짜리 팩(플러그인): 켜짐 id.json / 꺼짐 id.json.off (서버가 만든 예시 example-pack.json.sample 도 꺼진 것)
 * - 그림·소리가 있는 팩(.zip): plugins/id/ 폴더로 풀어 둔다. 켜짐 id/ / 꺼짐 id.off/
 * 형식은 docs/PLUGINS.md. 내용 검사는 서버가 켤 때 한다(틀리면 팩 전체를 거절하고 기록에 이유가 나온다).
 */
class PluginStore(dataRoot: File) {
    val dir = File(dataRoot, "plugins")

    data class Entry(val file: File, val enabled: Boolean, val isFolder: Boolean) {
        /** 켜고 끄기와 상관없는 이름 (예: example-pack) */
        val baseName: String get() = file.name.removeSuffix(".off").removeSuffix(".sample").removeSuffix(".json")
        /** 팩 설명(pack.json) 파일 */
        val manifest: File get() = if (isFolder) File(file, "pack.json") else file
    }

    fun list(): List<Entry> = (dir.listFiles() ?: emptyArray())
        .mapNotNull { f ->
            when {
                f.isDirectory && File(f, "pack.json").isFile && !f.name.startsWith(".") -> Entry(f, !f.name.endsWith(".off"), true)
                !f.isFile -> null
                f.name.endsWith(".json") -> Entry(f, true, false)
                f.name.endsWith(".json.off") || f.name.endsWith(".json.sample") -> Entry(f, false, false)
                else -> null
            }
        }
        .sortedBy { it.baseName }

    /** 파일 하나짜리 팩을 넣는다 (같은 id 가 있으면 바꾼다). 켜진 상태로 넣는다. */
    fun add(id: String, text: String): File {
        require(validId(id)) { "팩 id 는 영문 소문자·숫자·- 로 32자까지예요" }
        removeAll(id)
        dir.mkdirs()
        val file = File(dir, "$id.json")
        val tmp = File(dir, "$id.json.tmp")
        tmp.writeText(text, Charsets.UTF_8)
        if (!tmp.renameTo(file)) { file.delete(); check(tmp.renameTo(file)) { "저장하지 못했어요" } }
        return file
    }

    /** zip 팩을 plugins/id/ 로 푼다 (같은 id 가 있으면 바꾼다). files: pack.json 기준 경로 -> 내용 (readZipPack 의 결과) */
    fun addZip(id: String, files: Map<String, ByteArray>): File {
        require(validId(id)) { "팩 id 는 영문 소문자·숫자·- 로 32자까지예요" }
        require(files.containsKey("pack.json")) { "zip 안에 pack.json 이 없어요" }
        dir.mkdirs()
        val staging = File(dir, ".$id.tmp").apply { deleteRecursively() }
        for ((path, body) in files) {
            val out = File(staging, path)
            check(out.canonicalPath.startsWith(staging.canonicalPath + File.separator)) { "위험한 경로: $path" }
            out.parentFile?.mkdirs()
            out.writeBytes(body)
        }
        removeAll(id)
        val target = File(dir, id)
        check(staging.renameTo(target)) { "저장하지 못했어요" }
        return target
    }

    /** 같은 id 의 팩(켜짐·꺼짐, 파일·폴더)을 모두 지운다 */
    private fun removeAll(id: String) {
        for (name in listOf("$id.json", "$id.json.off", id, "$id.off")) File(dir, name).deleteRecursively()
    }

    fun has(id: String): Boolean = list().any { it.baseName == id }

    /** 켜고 끈다 (이름 끝의 .off 를 붙이고 뗀다) */
    fun setEnabled(entry: Entry, enabled: Boolean): Entry {
        if (entry.enabled == enabled) return entry
        val name = if (entry.isFolder) entry.baseName + if (enabled) "" else ".off" else entry.baseName + if (enabled) ".json" else ".json.off"
        val target = File(dir, name)
        if (target.exists()) target.deleteRecursively()
        check(entry.file.renameTo(target)) { "이름을 바꾸지 못했어요" }
        return Entry(target, enabled, entry.isFolder)
    }

    fun remove(entry: Entry) {
        entry.file.deleteRecursively()
    }

    companion object {
        const val MAX_ZIP_BYTES = 40 * 1024 * 1024
        const val MAX_ZIP_ENTRIES = 600

        fun validId(id: String): Boolean = Regex("^[a-z0-9-]{1,32}$").matches(id)

        /** zip 파일인가 (PK 머리) */
        fun isZip(bytes: ByteArray): Boolean = bytes.size > 4 && bytes[0] == 0x50.toByte() && bytes[1] == 0x4b.toByte() && bytes[2] == 3.toByte() && bytes[3] == 4.toByte()

        /**
         * zip 을 읽어 pack.json 이 있는 폴더 기준으로 경로를 다시 붙인다 (폴더째 넣은 zip 도 된다).
         * 맥의 숨김 파일은 빼고, 밖으로 나가는 경로나 너무 큰 zip 은 오류.
         */
        fun readZipPack(bytes: ByteArray): Map<String, ByteArray> {
            val all = linkedMapOf<String, ByteArray>()
            var total = 0L
            ZipInputStream(ByteArrayInputStream(bytes)).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (entry.isDirectory) continue
                    val name = entry.name.replace('\\', '/')
                    require(!name.startsWith("/") && name.split('/').none { it == ".." || it.isEmpty() }) { "위험한 경로: $name" }
                    if (name.startsWith("__MACOSX/") || name.substringAfterLast('/').startsWith(".")) continue
                    require(all.size < MAX_ZIP_ENTRIES) { "파일이 너무 많아요 (${MAX_ZIP_ENTRIES}개까지)" }
                    val body = zip.readBytes()
                    total += body.size
                    require(total <= MAX_ZIP_BYTES) { "풀면 너무 커요 (40MB 까지)" }
                    all[name] = body
                }
            }
            val manifest = all.keys.filter { it == "pack.json" || it.endsWith("/pack.json") }.minByOrNull { it.length }
                ?: throw IllegalArgumentException("zip 안에 pack.json 이 없어요")
            val prefix = manifest.removeSuffix("pack.json")
            return all.filterKeys { it.startsWith(prefix) }.mapKeys { it.key.removePrefix(prefix) }
        }
    }
}
