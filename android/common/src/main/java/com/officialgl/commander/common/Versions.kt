package com.officialgl.commander.common

/** 버전 비교 (안드로이드 없이 시험한다) */
object Versions {
    /** "0.1.10" -> [0, 1, 10]. 숫자.숫자.숫자 가 아니면 null (시험판 "0.0.0-test.4" 도 null) */
    fun parts(text: String?): List<Int>? {
        val t = text?.trim()?.removePrefix("v") ?: return null
        if (!Regex("""\d+(\.\d+)*""").matches(t)) return null
        return t.split('.').map { it.toInt() }
    }

    /** latest 가 current 보다 새것인가 (숫자로 비교) */
    fun isNewer(latest: String, current: String): Boolean {
        val a = parts(latest) ?: return false
        val b = parts(current) ?: return false
        for (i in 0 until maxOf(a.size, b.size)) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    /** 정식 릴리스 버전인가 (개발용 0.0.0, 시험판은 새 버전 안내를 하지 않는다) */
    fun isRelease(current: String?): Boolean = parts(current)?.let { it.any { n -> n > 0 } } ?: false

    /** 릴리스 태그(android-v0.1.2)에서 버전. 다른 태그면 null */
    fun fromTag(tag: String, prefix: String = "android-v"): String? =
        if (tag.startsWith(prefix)) tag.removePrefix(prefix).takeIf { parts(it) != null } else null
}
