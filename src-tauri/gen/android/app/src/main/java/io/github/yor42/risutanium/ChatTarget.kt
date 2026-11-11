package io.github.yor42.risutanium

// The chat a notification tap opens. Plain Kotlin with no android imports, so the rules run in JVM
// tests; MainActivity and KeepAliveService apply them. MainActivity is exported, so an intent from
// another app can carry anything: only the OPEN_CHAT action with two short strings without control
// characters is a target, and the page checks the target again against its own characters and chats.

const val ACTION_OPEN_CHAT = "io.github.yor42.risutanium.OPEN_CHAT"
const val EXTRA_TARGET_CHA_ID = "chaId"
const val EXTRA_TARGET_CHAT_ID = "chatId"

// The longest id; the page applies the same limit.
const val CHAT_TARGET_MAX_LENGTH = 200

private const val TARGET_URI_PREFIX = "risutanium-notice://chat/"
private const val HEX = "0123456789ABCDEF"
private const val LOWER_HEX = "0123456789abcdef"

private fun idFits(value: String?): Boolean =
  value != null && value.length in 1..CHAT_TARGET_MAX_LENGTH && value.none { it.isISOControl() }

// The target of an intent's action and extras, or null when either is not what a notice sends.
fun chatTargetOf(action: String?, chaId: String?, chatId: String?): NoticeTarget? {
  if (action != ACTION_OPEN_CHAT) return null
  if (chaId == null || chatId == null || !idFits(chaId) || !idFits(chatId)) return null
  return NoticeTarget(chaId, chatId)
}

// An intent's extras are read from an unparcelled bundle, which throws for a value this app's classes
// cannot read. A read that throws is no target.
fun targetFromIntent(readAction: () -> String?, readExtra: (String) -> String?): NoticeTarget? {
  return try {
    chatTargetOf(readAction(), readExtra(EXTRA_TARGET_CHA_ID), readExtra(EXTRA_TARGET_CHAT_ID))
  } catch (error: Exception) {
    null
  }
}

// The data of the notification's intent. Intents with the same action, component and data are one
// PendingIntent, and its extras would be replaced by the latest, so every target needs a data of its
// own. Every byte outside the unreserved set is percent-encoded, so the two ids cannot run together.
fun targetDataUri(target: NoticeTarget): String =
  TARGET_URI_PREFIX + percentEncoded(target.chaId) + "/" + percentEncoded(target.chatId)

private fun percentEncoded(value: String): String {
  val out = StringBuilder()
  for (byte in value.toByteArray(Charsets.UTF_8)) {
    val code = byte.toInt() and 0xFF
    val char = code.toChar()
    if (char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char == '-' || char == '_' || char == '.' || char == '~') {
      out.append(char)
    } else {
      out.append('%').append(HEX[code shr 4]).append(HEX[code and 0x0F])
    }
  }
  return out.toString()
}

// The JavaScript literal the page's hook is called with: an object, or null for no target. Every
// character outside [A-Za-z0-9_-] is written as a \uXXXX escape, so no quote, bracket, line separator
// or backslash from an intent can end the string or inject script.
fun encodeChatTarget(target: NoticeTarget?): String {
  if (target == null) return "null"
  return "{\"chaId\":\"" + escaped(target.chaId) + "\",\"chatId\":\"" + escaped(target.chatId) + "\"}"
}

private fun escaped(value: String): String {
  val out = StringBuilder()
  for (char in value) {
    if (char in 'A'..'Z' || char in 'a'..'z' || char in '0'..'9' || char == '-' || char == '_') {
      out.append(char)
    } else {
      val code = char.code
      out.append("\\u")
      out.append(LOWER_HEX[(code shr 12) and 0x0F]).append(LOWER_HEX[(code shr 8) and 0x0F])
      out.append(LOWER_HEX[(code shr 4) and 0x0F]).append(LOWER_HEX[code and 0x0F])
    }
  }
  return out.toString()
}
