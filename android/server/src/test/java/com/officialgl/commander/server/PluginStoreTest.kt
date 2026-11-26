package com.officialgl.commander.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class PluginStoreTest {
    private fun store() = PluginStore(Files.createTempDirectory("cmd").toFile())

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

    @Test fun refusesBadIds() {
        assertTrue(PluginStore.validId("example-pack"))
        assertFalse(PluginStore.validId("../evil"))
        assertFalse(PluginStore.validId("Moon"))
        assertFalse(PluginStore.validId(""))
        assertFalse(PluginStore.validId("a".repeat(33)))
    }
}
