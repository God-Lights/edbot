package com.officialgl.commander.server

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.file.Files
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class PluginStoreTest {
    private fun store() = PluginStore(Files.createTempDirectory("cmd").toFile())

    private fun zip(files: Map<String, ByteArray>): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z -> for ((k, v) in files) { z.putNextEntry(ZipEntry(k)); z.write(v); z.closeEntry() } }
        return out.toByteArray()
    }

    @Test fun addsListsTogglesAndRemoves() {
        val s = store()
        s.add("moon", "{\"apiVersion\":1,\"id\":\"moon\"}")
        // 서버가 처음 켤 때 만드는 예시와 설명서
        File(s.dir, "example-pack.json.sample").writeText("{}")
        File(s.dir, "README.txt").writeText("설명")
        var list = s.list()
        assertEquals(listOf("example-pack" to false, "moon" to true), list.map { it.baseName to it.enabled })

        // 예시 켜기 → example-pack.json
        val example = s.setEnabled(list[0], true)
        assertTrue(File(s.dir, "example-pack.json").exists())
        assertTrue(example.enabled)
        // 끄기 → .json.off
        s.setEnabled(s.list().first { it.baseName == "moon" }, false)
        assertTrue(File(s.dir, "moon.json.off").exists())
        assertFalse(File(s.dir, "moon.json").exists())

        // 같은 id 를 다시 넣으면 켜진 상태로 바뀐다
        s.add("moon", "{\"v\":2}")
        list = s.list()
        assertEquals(listOf("example-pack" to true, "moon" to true), list.map { it.baseName to it.enabled })
        assertEquals("{\"v\":2}", File(s.dir, "moon.json").readText())

        s.remove(list.first { it.baseName == "moon" })
        assertEquals(listOf("example-pack"), s.list().map { it.baseName })
        assertTrue(s.has("example-pack"))
        assertFalse(s.has("moon"))
    }

    @Test fun zipPacksBecomeFolders() {
        val s = store()
        val png = byteArrayOf(0x89.toByte(), 0x50, 0x4e, 0x47, 1, 2)
        // 폴더째 넣은 zip (night/pack.json) + 맥 숨김 파일
        val bytes = zip(mapOf("night/pack.json" to "{\"id\":\"night\"}".toByteArray(), "night/assets/logo.png" to png, "__MACOSX/night/._x" to byteArrayOf(1)))
        assertTrue(PluginStore.isZip(bytes))
        val files = PluginStore.readZipPack(bytes)
        assertEquals(setOf("pack.json", "assets/logo.png"), files.keys)
        s.addZip("night", files)
        assertArrayEquals(png, File(s.dir, "night/assets/logo.png").readBytes())
        var entry = s.list().single()
        assertTrue(entry.isFolder && entry.enabled)
        assertEquals("night", entry.baseName)
        assertEquals(File(s.dir, "night/pack.json"), entry.manifest)
        // 끄기 → night.off/, 켜기 → night/
        entry = s.setEnabled(entry, false)
        assertTrue(File(s.dir, "night.off/pack.json").exists())
        assertEquals(listOf("night" to false), s.list().map { it.baseName to it.enabled })
        // 같은 id 의 파일 팩을 넣으면 폴더 팩은 사라진다
        s.add("night", "{}")
        assertEquals(listOf(false), s.list().map { it.isFolder })
        assertFalse(File(s.dir, "night.off").exists())
    }

    @Test fun refusesBadZipsAndIds() {
        assertFalse(PluginStore.isZip("{\"id\":1}".toByteArray()))
        assertTrue(runCatching { PluginStore.readZipPack(zip(mapOf("a.png" to byteArrayOf(1)))) }.isFailure) // pack.json 없음
        assertTrue(PluginStore.validId("example-pack"))
        assertFalse(PluginStore.validId("../evil"))
        assertFalse(PluginStore.validId("Moon"))
        assertFalse(PluginStore.validId(""))
        assertFalse(PluginStore.validId("a".repeat(33)))
    }
}
