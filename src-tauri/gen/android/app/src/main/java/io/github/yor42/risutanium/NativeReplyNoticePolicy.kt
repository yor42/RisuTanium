package io.github.yor42.risutanium

// The decisions behind the notice native posts when an owned reply ends while the app is hidden, as plain
// Kotlin with no android imports so they run in JVM tests; NativeReplyNotices applies them. The page arms
// a token with the notices to post (the same v2 fields its own "Replied" notice carries, MC-1463) and the
// text of the closing keep-alive card. Rust decides what the reply ended as and answers a poll with a
// code; this file turns that code into at most one post and one card change.

// The arm payload's version.
private const val NATIVE_ARM_VERSION = 1.0

private const val NATIVE_TITLE_MAX = 256
private const val NATIVE_TEXT_MAX = 512

// Consecutive polls that answer "armed, not yet bound" before the arm is given up: the request never
// started, so the page owns the outcome. At the 500 ms poll that is about 30 s.
const val UNBOUND_POLL_LIMIT = 60

// armReplyNotice flags: bit 0 says a notification may be posted. Without it the end is not announced and
// the page posts its own.
const val ARM_FLAG_NOTIFY = 1

// The closing keep-alive card's text, and the chat it belongs to. target is null when the ids do not fit,
// the same rule the card's own target follows, so a card and its arm compare equal.
data class NativeClosing(
  val target: NoticeTarget?,
  val finishingTitle: String,
  val failedTitle: String,
  val failedText: String
)

// What the page armed: the notice for a finished reply, the notice for a failed one, and the closing card.
data class NativeArm(val done: ReplyNotice, val failed: ReplyNotice, val closing: NativeClosing)

// A nested JSON object of the arm, with its keys as strings; null for anything else.
private fun stringKeyed(value: Any?): Map<String, Any?>? {
  if (value !is Map<*, *>) return null
  val copy = HashMap<String, Any?>()
  for ((key, entry) in value) {
    if (key is String) copy[key] = entry
  }
  return copy
}

// The arm from the page's parsed JSON object: {v:1, done, failed, closing:{chaId, chatId, finishingTitle,
// failedTitle, failedText}}. Null when the version is not 1 or either notice does not fit the v2 contract:
// the caller then arms nothing and the page posts as it always did. The closing text is capped and a
// missing string is empty, so a damaged closing card shows the app name only.
fun parseNativeArm(map: Map<String, Any?>): NativeArm? {
  val version = (map["v"] as? Number)?.toDouble() ?: return null
  if (version != NATIVE_ARM_VERSION) return null
  val done = parseReplyNotice(stringKeyed(map["done"]) ?: return null) ?: return null
  val failed = parseReplyNotice(stringKeyed(map["failed"]) ?: return null) ?: return null
  val closing = stringKeyed(map["closing"]) ?: return null
  return NativeArm(
    done = done,
    failed = failed,
    closing = NativeClosing(
      target = targetOf(closing),
      finishingTitle = stringOf(closing["finishingTitle"], NATIVE_TITLE_MAX),
      failedTitle = stringOf(closing["failedTitle"], NATIVE_TITLE_MAX),
      failedText = stringOf(closing["failedText"], NATIVE_TEXT_MAX)
    )
  )
}

// The flags armReplyNotice takes. A notification may be posted only for an opted-in user whose Android
// would show it and only when the arm carries a notice to post.
fun armFlags(optedIn: Boolean, enabled: Boolean, hasNotice: Boolean): Int =
  if (optedIn && enabled && hasNotice) ARM_FLAG_NOTIFY else 0

enum class NoticeKind { DONE, FAILED }

// A finished reply sounds only when the app is hidden at the post; one the user returned to meanwhile is
// silent, so the page's chime and this one never both play. A failure is always silent (D14).
fun postSilent(kind: NoticeKind, visibleNow: Boolean): Boolean =
  when (kind) {
    NoticeKind.DONE -> visibleNow
    NoticeKind.FAILED -> true
  }

// What one poll answer asks for.
enum class NoticeAction {
  // The reply is still running: poll again.
  KEEP,

  // Post the finished-reply notice and close the card.
  POST_DONE,

  // Post the failure notice and close the card.
  POST_FAILED,

  // The reply finished and was announced, but the user pressed Stop for this chat: no notice, no card
  // change (D17). The token is finished.
  SKIP_STOPPED,

  // Nothing is announced (the page posts), or the token is unknown: forget it.
  DROP,

  // The token stayed unbound for UNBOUND_POLL_LIMIT polls: give the arm up.
  DISARM
}

// The action for one poll answer, before the Stop mark. unboundPolls counts the consecutive "armed, not
// yet bound" answers including this one. An answer outside the contract drops the token, so a damaged
// library never posts.
fun pollStep(code: Int, unboundPolls: Int): NoticeAction =
  when (code) {
    1 -> NoticeAction.POST_DONE
    2 -> NoticeAction.POST_FAILED
    3, -1 -> NoticeAction.DROP
    4 -> if (unboundPolls >= UNBOUND_POLL_LIMIT) NoticeAction.DISARM else NoticeAction.KEEP
    0 -> NoticeAction.KEEP
    else -> NoticeAction.DROP
  }

// The tokens the page armed and native still holds. Each carries a sticky "Stop was pressed" mark that is
// set by a Stop tap that entered Stopping for the token's chat and leaves only with the token: no display
// reset, the page's outcome, a return to the app or the service ending can clear it, because none of them
// can reach this table (D17). Main thread only.
class NoticeTokens {
  private class HeldToken(val arm: NativeArm) {
    var unboundPolls = 0
    var stopPressed = false
  }

  private val entries = LinkedHashMap<Int, HeldToken>()

  // Holds a token. False for one already held, which keeps its entry and its mark.
  fun add(token: Int, arm: NativeArm): Boolean {
    if (entries.containsKey(token)) return false
    entries[token] = HeldToken(arm)
    return true
  }

  fun armOf(token: Int): NativeArm? = entries[token]?.arm

  fun held(): Set<Int> = LinkedHashSet(entries.keys)

  // A Stop tap entered Stopping for the card of this chat: every held token that closes this chat is
  // marked, null equal to null. It adds nothing and clears nothing.
  fun stopPressed(target: NoticeTarget?) {
    for (entry in entries.values) {
      if (entry.arm.closing.target == target) entry.stopPressed = true
    }
  }

  // The poll's answer for a held token. An answer that ends the token (done, failed, quiet, absent)
  // removes it in the same call; KEEP and DISARM leave it and its mark unchanged. A marked token on a
  // done answer is skipped; a failure is not (D17 names only the finished-reply notice). A token that is
  // not held drops.
  fun onPoll(token: Int, code: Int): NoticeAction {
    val entry = entries[token] ?: return NoticeAction.DROP
    if (code == 4) entry.unboundPolls += 1 else entry.unboundPolls = 0
    val action = pollStep(code, entry.unboundPolls)
    if (action == NoticeAction.KEEP || action == NoticeAction.DISARM) return action
    entries.remove(token)
    return if (action == NoticeAction.POST_DONE && entry.stopPressed) NoticeAction.SKIP_STOPPED else action
  }

  // The answer to the disarm call. Only -1 (the hub never bound it) ends the token; any other answer
  // means it was bound meanwhile, so it stays with its mark and the next poll consumes its code.
  fun disarmAnswered(token: Int, answer: Int) {
    if (answer == -1) entries.remove(token)
  }
}

// The mark a tap leaves: the target of the card that was tapped.
data class StopMark(val target: NoticeTarget?)

// The mark an entered Stop tap leaves. It is read right after stopTapped, which leaves the shown card
// unchanged, so it names the card that was tapped. A stale tap or one without a stoppable card is no
// Stop for any chat.
fun stopMark(tap: StopTap, display: KeepAliveDisplay): StopMark? =
  if (tap == StopTap.ENTERED) StopMark(display.current()?.target) else null

// The whole Stop tap sequence in one function: the display enters Stopping, then every held token that
// closes the tapped chat is marked, in the same main-thread turn and before the page is told.
fun onStopTap(display: KeepAliveDisplay, tokens: NoticeTokens): StopTap =
  display.stopTapped().also { tap -> stopMark(tap, display)?.let { tokens.stopPressed(it.target) } }

// What one poll leaves to do: the action, the notice to post (its silent value already applied) and
// whether the keep-alive card changed, so the service reposts it.
data class PollEffect(val action: NoticeAction, val post: ReplyNotice?, val cardChanged: Boolean)

// Applies one poll answer. The skip reads only the token's own mark, never the display, so it holds
// after the display was reset or the service restarted (display null). A posted notice also closes the
// card of that chat, when one is shown and plain: Finishing without Stop after a finished reply, Failed
// after a failure (D16).
fun pollEffect(
  tokens: NoticeTokens,
  token: Int,
  code: Int,
  display: KeepAliveDisplay?,
  visibleNow: Boolean = false
): PollEffect {
  val arm = tokens.armOf(token)
  val action = tokens.onPoll(token, code)
  if (arm == null) return PollEffect(action, null, false)
  return when (action) {
    NoticeAction.POST_DONE -> PollEffect(
      action,
      arm.done.copy(silent = postSilent(NoticeKind.DONE, visibleNow)),
      display?.nativeOutcome(NoticeState.FINISHING, arm.closing.finishingTitle, "", arm.closing.target) ?: false
    )
    NoticeAction.POST_FAILED -> PollEffect(
      action,
      arm.failed.copy(silent = postSilent(NoticeKind.FAILED, visibleNow)),
      display?.nativeOutcome(NoticeState.FAILED, arm.closing.failedTitle, arm.closing.failedText, arm.closing.target) ?: false
    )
    else -> PollEffect(action, null, false)
  }
}
