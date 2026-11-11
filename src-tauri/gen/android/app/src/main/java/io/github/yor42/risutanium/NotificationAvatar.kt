package io.github.yor42.risutanium

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Log

// The avatar of a notification (the large icon). The page sends a thumbnail as a data URL of at most
// 400 000 characters; the rules that decide whether it is decoded at all and how it is scaled are plain
// Kotlin so they run in JVM tests, and NotificationAvatarDecoder only applies them with the Android
// decoders. A thumbnail that fails any rule or any decode step simply leaves the notification without a
// large icon.

// The whole data URL, header included.
const val AVATAR_MAX_DATA_CHARS = 400_000

// The longest side of the bitmap kept for a notification.
const val AVATAR_MAX_SIDE = 256

private val AVATAR_MIME_TYPES = setOf("image/png", "image/webp", "image/jpeg")

data class AvatarData(val mime: String, val base64: String)

private fun isBase64Alphabet(char: Char): Boolean =
  char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char == '+' || char == '/'

// The mime type and the base64 text of a data URL, or null when it is not `data:<mime>;base64,<text>`
// with a mime of png, webp or jpeg, a non-empty text of the base64 alphabet (padding only at the end,
// two characters at most), and a total length within the limit.
fun avatarDataOf(dataUrl: String): AvatarData? {
  if (dataUrl.length > AVATAR_MAX_DATA_CHARS) return null
  val prefix = "data:"
  if (!dataUrl.startsWith(prefix)) return null
  val comma = dataUrl.indexOf(',')
  if (comma < 0) return null
  val header = dataUrl.substring(prefix.length, comma)
  val suffix = ";base64"
  if (!header.endsWith(suffix)) return null
  val mime = header.substring(0, header.length - suffix.length)
  if (mime !in AVATAR_MIME_TYPES) return null
  val payload = dataUrl.substring(comma + 1)
  if (payload.isEmpty()) return null
  val padding = payload.length - payload.trimEnd('=').length
  if (padding > 2) return null
  val body = payload.substring(0, payload.length - padding)
  if (body.isEmpty() || !body.all { isBase64Alphabet(it) }) return null
  return AvatarData(mime, payload)
}

// The size to scale a width by height image to so its long side is at most maxSide; the short side keeps
// the aspect ratio and never goes below one pixel. An image already within the limit is unchanged (but
// a side below one is raised to one).
fun scaledDims(width: Int, height: Int, maxSide: Int): Pair<Int, Int> {
  val w = width.coerceAtLeast(1)
  val h = height.coerceAtLeast(1)
  val longSide = maxOf(w, h)
  if (longSide <= maxSide) return Pair(w, h)
  val scaledW = ((w.toLong() * maxSide + longSide / 2) / longSide).toInt().coerceAtLeast(1)
  val scaledH = ((h.toLong() * maxSide + longSide / 2) / longSide).toInt().coerceAtLeast(1)
  return Pair(scaledW, scaledH)
}

// The decoder's power-of-two subsampling: the largest one that still leaves the long side at or above
// maxSide, so the exact scaling afterwards only ever shrinks.
fun sampleSize(width: Int, height: Int, maxSide: Int): Int {
  val longSide = maxOf(width, height)
  var sample = 1
  while (longSide / (sample * 2) >= maxSide) {
    sample *= 2
  }
  return sample
}

object NotificationAvatarDecoder {
  private const val TAG = "NotificationAvatar"

  // The bitmap for a data URL, or null when the URL fails a rule or the image cannot be decoded.
  fun decode(dataUrl: String): Bitmap? {
    val data = avatarDataOf(dataUrl) ?: return null
    try {
      val bytes = Base64.decode(data.base64, Base64.DEFAULT)
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      val options = BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, AVATAR_MAX_SIDE)
      }
      val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options) ?: return null
      val (width, height) = scaledDims(decoded.width, decoded.height, AVATAR_MAX_SIDE)
      if (width == decoded.width && height == decoded.height) return decoded
      val scaled = Bitmap.createScaledBitmap(decoded, width, height, true)
      if (scaled !== decoded) decoded.recycle()
      return scaled
    } catch (error: Exception) {
      Log.w(TAG, "avatar could not be decoded", error)
      return null
    } catch (error: OutOfMemoryError) {
      Log.w(TAG, "avatar too large to decode", error)
      return null
    }
  }
}
