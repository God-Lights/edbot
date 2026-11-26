package com.officialgl.commander.server

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

object Qr {
    /** 흰 바탕에 검은 점의 QR (가장자리 여백 포함) */
    fun bitmap(text: String, size: Int): Bitmap? = runCatching {
        val hints = mapOf(EncodeHintType.CHARACTER_SET to "UTF-8", EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2)
        val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, size, size, hints)
        val pixels = IntArray(matrix.width * matrix.height) { i -> if (matrix.get(i % matrix.width, i / matrix.width)) Color.BLACK else Color.WHITE }
        Bitmap.createBitmap(pixels, matrix.width, matrix.height, Bitmap.Config.ARGB_8888)
    }.getOrNull()
}
