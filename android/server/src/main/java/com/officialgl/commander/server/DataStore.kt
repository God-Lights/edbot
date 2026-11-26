package com.officialgl.commander.server

import java.io.File

/** 엔진(웹뷰)이 알려 주는 파일 변경. 엔진의 MemFs 와 같은 모양이다 (ios-server/engine/src/memfs.ts). */
sealed class FileOp {
    data class Write(val path: String, val text: String) : FileOp()
    data class Append(val path: String, val text: String) : FileOp()
    data class Rename(val from: String, val to: String) : FileOp()
    data class Remove(val path: String) : FileOp()
    data class Mkdir(val path: String) : FileOp()

    companion object {
        /** op 이름과 필드에서 만든다. 모양이 틀리면 null. */
        fun of(op: String?, fields: (String) -> String?): FileOp? = when (op) {
            "write" -> fields("path")?.let { p -> fields("text")?.let { Write(p, it) } }
            "append" -> fields("path")?.let { p -> fields("text")?.let { Append(p, it) } }
            "rename" -> fields("from")?.let { a -> fields("to")?.let { Rename(a, it) } }
            "rm" -> fields("path")?.let { Remove(it) }
            "mkdir" -> fields("path")?.let { Mkdir(it) }
            else -> null
        }
    }
}

/** 데이터 폴더(전적, 방, 플러그인). 엔진이 시작할 때 전부 읽어 가고, 바뀐 것은 순서대로 여기에 쓴다. */
class DataStore(root: File) {
    val root: File = root.canonicalFile.also { it.mkdirs() }

    /** 폴더 밖으로 나가거나 절대 경로면 null. */
    fun resolve(path: String): File? {
        if (path.startsWith("/") || path.contains('\u0000')) return null
        val parts = path.split('/').filter { it.isNotEmpty() }
        if (parts.isEmpty() || parts.contains("..")) return null
        val file = File(root, parts.joinToString(File.separator)).canonicalFile
        return if (file.path.startsWith(root.path + File.separator)) file else null
    }

    /** 모든 파일을 {상대 경로: 글자}로. 임시 파일은 건너뛴다. */
    fun loadAll(): Map<String, String> {
        val out = sortedMapOf<String, String>()
        root.walkTopDown().filter { it.isFile && !it.name.endsWith(".tmp") }.forEach { file ->
            val rel = file.relativeTo(root).invariantSeparatorsPath
            runCatching { file.readText(Charsets.UTF_8) }.onSuccess { out[rel] = it }
        }
        return out
    }

    /** 순서대로 적용한다. 실패한 것은 글로 돌려준다(나머지는 계속한다). */
    fun apply(ops: List<FileOp>): List<String> = ops.mapNotNull { op ->
        runCatching { apply(op) }.exceptionOrNull()?.let { "$op: ${it.message}" }
    }

    private fun apply(op: FileOp) {
        when (op) {
            is FileOp.Write -> {
                val file = resolve(op.path) ?: error("잘못된 경로")
                file.parentFile?.mkdirs()
                // 임시 파일에 쓰고 이름을 바꿔서, 쓰는 도중 꺼져도 깨지지 않게 한다
                val tmp = File(file.path + ".tmp")
                tmp.writeText(op.text, Charsets.UTF_8)
                if (!tmp.renameTo(file)) { file.delete(); if (!tmp.renameTo(file)) error("이름을 바꾸지 못했다") }
            }
            is FileOp.Append -> {
                val file = resolve(op.path) ?: error("잘못된 경로")
                file.parentFile?.mkdirs()
                file.appendText(op.text, Charsets.UTF_8)
            }
            is FileOp.Rename -> {
                val a = resolve(op.from) ?: error("잘못된 경로")
                val b = resolve(op.to) ?: error("잘못된 경로")
                b.parentFile?.mkdirs()
                if (b.exists()) b.deleteRecursively()
                if (!a.renameTo(b)) error("이름을 바꾸지 못했다")
            }
            is FileOp.Remove -> resolve(op.path)?.let { if (it.exists()) it.deleteRecursively() } ?: error("잘못된 경로")
            is FileOp.Mkdir -> (resolve(op.path) ?: error("잘못된 경로")).mkdirs()
        }
    }
}
