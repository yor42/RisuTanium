package io.github.yor42.risutanium

// The one check every result delivered through onActivityResult passes before a consumer sees it. Plain
// Kotlin with no android imports, so the rules run in JVM tests; MainActivity applies them. A refused
// answer is a cancel, and the rule equals `foreign_content_uri` in `fs_guard.rs`.

private const val RESULT_CANCELED = 0
private const val CONTENT_PREFIX = "content://"

private fun isAuthorityChar(c: Char): Boolean =
  c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '.' || c == '_' || c == '-'

internal fun isForeignContentUri(uri: String, own: String): Boolean {
  if (own.isEmpty() || !uri.startsWith(CONTENT_PREFIX)) return false
  val rest = uri.substring(CONTENT_PREFIX.length)
  var end = rest.length
  for (i in rest.indices) {
    val c = rest[i]
    if (c == '/' || c == '?' || c == '#') {
      end = i
      break
    }
  }
  val authority = rest.substring(0, end)
  val at = authority.indexOf('@')
  val host = if (at >= 0) {
    val user = authority.substring(0, at)
    if (user.isEmpty() || !user.all { it in '0'..'9' }) return false
    authority.substring(at + 1)
  } else {
    authority
  }
  if (host.isEmpty() || !host.all(::isAuthorityChar)) return false
  if (host.equals("localhost", ignoreCase = true)) return false
  if (host.equals(own, ignoreCase = true)) return false
  if (host.startsWith("$own.", ignoreCase = true)) return false
  return true
}

internal fun <T : Any> checkedActivityResult(
  resultCode: Int,
  data: T?,
  own: String,
  dataUri: (T) -> String?,
  clipCount: (T) -> Int?,
  clipUri: (T, Int) -> String?,
): Pair<Int, T?> {
  val cancelled: Pair<Int, T?> = Pair(RESULT_CANCELED, null)
  if (resultCode == RESULT_CANCELED) return cancelled
  if (data == null) return Pair(resultCode, null)
  try {
    val dataText = dataUri(data)
    val count = clipCount(data)
    if (dataText == null && count == null) return Pair(resultCode, data)
    if (dataText != null && !isForeignContentUri(dataText, own)) return cancelled
    if (count != null) {
      if (count == 0) return cancelled
      for (n in 0 until count) {
        val text = clipUri(data, n)
        if (text == null || !isForeignContentUri(text, own)) return cancelled
      }
    }
  } catch (e: Exception) {
    return cancelled
  }
  return Pair(resultCode, data)
}
