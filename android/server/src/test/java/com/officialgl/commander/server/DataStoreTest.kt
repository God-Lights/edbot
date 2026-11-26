package com.officialgl.commander.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class DataStoreTest {
    private fun store() = DataStore(Files.createTempDirectory("cmd").toFile())

    @Test fun appliesOpsInOrderAndLoadsBack() {
        val s = store()
        val errors = s.apply(listOf(
            FileOp.Mkdir("data"),
            FileOp.Write("data/players.json", "{\"a\":1}"),
            FileOp.Append("data/matches.jsonl", "line1\n"),
            FileOp.Append("data/matches.jsonl", "line2\n"),
            FileOp.Write("objects/Room/ABCD.json", "x"),
            FileOp.Rename("objects/Room/ABCD.json", "objects/Room/WXYZ.json"),
            FileOp.Write("tmp/gone.txt", "bye"),
            FileOp.Remove("tmp"),
        ))
        assertEquals(emptyList<String>(), errors)
        val all = s.loadAll()
        assertEquals("{\"a\":1}", all["data/players.json"])
        assertEquals("line1\nline2\n", all["data/matches.jsonl"])
        assertEquals("x", all["objects/Room/WXYZ.json"])
        assertNull(all["objects/Room/ABCD.json"])
        assertFalse(File(s.root, "tmp").exists())
    }

    @Test fun refusesPathsOutsideTheFolder() {
        val s = store()
        assertNull(s.resolve("../escape.txt"))
        assertNull(s.resolve("/etc/passwd"))
        assertNull(s.resolve("data/../../x"))
        assertNull(s.resolve(""))
        assertTrue(s.resolve("data/players.json")!!.path.startsWith(s.root.path))
        assertEquals(1, s.apply(listOf(FileOp.Write("../x", "no"))).size)
    }

    @Test fun parsesOps() {
        val fields = mapOf("path" to "a/b", "text" to "t", "from" to "a", "to" to "b")
        assertEquals(FileOp.Write("a/b", "t"), FileOp.of("write", fields::get))
        assertEquals(FileOp.Rename("a", "b"), FileOp.of("rename", fields::get))
        assertEquals(FileOp.Remove("a/b"), FileOp.of("rm", fields::get))
        assertNull(FileOp.of("write") { null })
        assertNull(FileOp.of("chmod", fields::get))
    }

    @Test fun connectLinkMatchesLocalServer() {
        assertEquals("commander://connect?url=http%3A%2F%2F192.168.0.5%3A8787&name=%EB%82%B4%20%ED%8F%B0", NetworkInfo.connectLink("http://192.168.0.5:8787", "내 폰"))
    }
}
