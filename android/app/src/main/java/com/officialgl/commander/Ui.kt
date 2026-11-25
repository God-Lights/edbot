package com.officialgl.commander

import android.app.Activity
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.widget.LinearLayout
import android.widget.TextView

/** 웹·iOS 와 같은 헥스텍 색 (web/style.css, ios/EdbotApp/Theme.swift) */
object Palette {
    val bgTop = Color.parseColor("#0E0C26")
    val bgBottom = Color.parseColor("#08071F")
    val panelTop = Color.parseColor("#172140")
    val panelBottom = Color.parseColor("#0E142B")
    val gold = Color.parseColor("#C8AA6E")
    val goldHi = Color.parseColor("#F0D9A0")
    val silver = Color.parseColor("#D1D1D6")
    val dim = Color.parseColor("#8E8EA0")
    val accent = Color.parseColor("#B040BE")
    val mine = Color.parseColor("#6BD98C")
    val warn = Color.parseColor("#FF7566")
}

fun Context.dp(value: Number): Int = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

fun Context.screenBackground() = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Palette.bgTop, Palette.bgBottom))

/** 금색 테두리 패널. primary 는 금색으로 채운 버튼 */
fun Context.panelBackground(primary: Boolean = false, radius: Int = 10): RippleDrawable {
    val shape = if (primary) {
        GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Palette.goldHi, Palette.gold))
    } else {
        GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(Palette.panelTop, Palette.panelBottom)).apply {
            setStroke(dp(1), Color.argb(115, Color.red(Palette.gold), Color.green(Palette.gold), Color.blue(Palette.gold)))
        }
    }
    shape.cornerRadius = dp(radius).toFloat()
    return RippleDrawable(ColorStateList.valueOf(Color.argb(60, 255, 255, 255)), shape, null)
}

fun Context.label(text: String, size: Float = 15f, color: Int = Palette.silver, bold: Boolean = false) = TextView(this).apply {
    this.text = text
    textSize = size
    setTextColor(color)
    if (bold) typeface = Typeface.DEFAULT_BOLD
}

fun Context.sectionTitle(text: String) = label(text, 13f, Palette.gold, bold = true).apply {
    letterSpacing = 0.08f
    setPadding(dp(4), dp(18), dp(4), dp(6))
}

/** 누를 수 있는 한 줄: 제목 + 작은 설명 */
fun Context.rowButton(title: String, subtitle: String?, badge: String? = null, onClick: () -> Unit) = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
    background = panelBackground()
    setPadding(dp(14), dp(12), dp(14), dp(12))
    isClickable = true
    isFocusable = true
    setOnClickListener { onClick() }
    val texts = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        addView(label(title, 16f, Palette.silver, bold = true))
        if (subtitle != null) addView(label(subtitle, 12.5f, Palette.dim))
    }
    addView(texts, LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f))
    if (badge != null) addView(label(badge, 12f, Palette.goldHi, bold = true).apply { setPadding(dp(8), 0, 0, 0) })
    addView(label("›", 22f, Palette.gold).apply { setPadding(dp(10), 0, 0, 0) })
    layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { bottomMargin = dp(8) }
}

fun Context.goldButton(text: String, onClick: () -> Unit) = TextView(this).apply {
    this.text = text
    textSize = 15f
    typeface = Typeface.DEFAULT_BOLD
    setTextColor(Color.parseColor("#1A1205"))
    gravity = Gravity.CENTER
    background = panelBackground(primary = true)
    setPadding(dp(18), dp(12), dp(18), dp(12))
    isClickable = true
    isFocusable = true
    setOnClickListener { onClick() }
}

fun Context.plainButton(text: String, onClick: () -> Unit) = goldButton(text, onClick).apply {
    setTextColor(Palette.silver)
    background = panelBackground()
}

/** 상태 표시줄·내비게이션 바·카메라 홈(노치)에 가리지 않게 안쪽 여백을 준다. (targetSdk 35 는 화면 끝까지 그린다) */
@Suppress("DEPRECATION")
fun View.padForSystemBars(extra: Int = 0) {
    setOnApplyWindowInsetsListener { v, insets ->
        var l = insets.systemWindowInsetLeft
        var t = insets.systemWindowInsetTop
        var r = insets.systemWindowInsetRight
        var b = insets.systemWindowInsetBottom
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            l = i.left; t = i.top; r = i.right; b = i.bottom
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            insets.displayCutout?.let { c ->
                l = maxOf(l, c.safeInsetLeft); t = maxOf(t, c.safeInsetTop); r = maxOf(r, c.safeInsetRight); b = maxOf(b, c.safeInsetBottom)
            }
        }
        v.setPadding(l + extra, t + extra, r + extra, b + extra)
        insets
    }
}

fun Activity.toast(text: String) = android.widget.Toast.makeText(this, text, android.widget.Toast.LENGTH_SHORT).show()
