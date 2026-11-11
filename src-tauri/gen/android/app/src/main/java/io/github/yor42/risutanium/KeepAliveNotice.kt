package io.github.yor42.risutanium

// The keep-alive notification's content and display rules (contract v2). Plain Kotlin with no android
// imports, like BridgeScope.kt and ReplyNotificationsPolicy.kt, so the parse, the display machine and
// the plan run in JVM tests; KeepAliveService only applies a plan to a notification builder.
//
// The page owns what the notice says and sends every title already localised, so native holds no
// strings of its own. Native owns exactly one thing: the Stopping state, which begins on the Stop tap
// itself (no round trip to the page) and ends when the page reports the stoppable work gone. While the
// app is in the foreground a timeout also ends it, so a Stop that did not take never leaves a user who
// can see the app without a control; in the background Stopping has no timeout.

const val KEEP_ALIVE_ACCENT_COLOR = 0xFF587BFF.toInt()

// How long Stopping waits, while the app is in the foreground, for the stoppable work to end before the
// Stop action returns.
const val STOPPING_TIMEOUT_MS = 10000L

// The first Android with an authenticated notification action (Android 12).
private const val AUTHENTICATED_ACTION_SDK = 31

private const val MAX_TITLE_LENGTH = 256
private const val MAX_TEXT_LENGTH = 512
private const val MAX_TARGET_ID_LENGTH = 200

enum class NoticeState(val wire: String) {
  GENERATING("generating"),
  SPEAKING("speaking"),
  IMAGE("image"),
  TRANSLATING("translating"),
  WORKING("working"),
  SAVE_PENDING("savePending"),
  FINISHING("finishing"),
  STOPPED("stopped"),
  FAILED("failed");

  companion object {
    fun of(wire: String): NoticeState? = values().firstOrNull { it.wire == wire }
  }
}

data class NoticeIdentity(val key: String, val name: String)

data class NoticeTarget(val chaId: String, val chatId: String)

// One notice from the page. startedAtMs is null when no chronometer is wanted. avatar is a thumbnail
// data URL the page sends once per identity key and service; the service decodes it and keeps the
// bitmap by key for the notices that follow.
data class KeepAliveNotice(
  val state: NoticeState,
  val title: String,
  val text: String,
  val startedAtMs: Long?,
  val stopLabel: String,
  val publicTitle: String,
  val stoppingTitle: String,
  val stoppedTitle: String,
  val identity: NoticeIdentity?,
  val avatar: String?,
  val target: NoticeTarget?
) {
  // The page sends a Stop label only for the two states with stoppable work; native also checks the
  // state, so a label on any other state never shows an action.
  val stoppable: Boolean
    get() = stopLabel.isNotEmpty() && (state == NoticeState.GENERATING || state == NoticeState.SPEAKING)
}

// Cuts at a character count without splitting a surrogate pair.
private fun capped(value: String, max: Int): String {
  if (value.length <= max) return value
  val end = if (Character.isHighSurrogate(value[max - 1])) max - 1 else max
  return value.substring(0, end)
}

private fun stringOf(value: Any?, max: Int): String = if (value is String) capped(value, max) else ""

private fun identityOf(value: Any?): NoticeIdentity? {
  if (value !is Map<*, *>) return null
  val key = value["key"] as? String ?: return null
  if (key.isEmpty()) return null
  return NoticeIdentity(capped(key, MAX_TITLE_LENGTH), stringOf(value["name"], MAX_TITLE_LENGTH))
}

private fun targetOf(value: Any?): NoticeTarget? {
  if (value !is Map<*, *>) return null
  val chaId = value["chaId"] as? String ?: return null
  val chatId = value["chatId"] as? String ?: return null
  if (chaId.isEmpty() || chatId.isEmpty()) return null
  if (chaId.length > MAX_TARGET_ID_LENGTH || chatId.length > MAX_TARGET_ID_LENGTH) return null
  return NoticeTarget(chaId, chatId)
}

// A notice from the page's parsed JSON object. Null when the version is not 2 or the state is
// unknown: the caller then treats the payload as malformed. Strings are capped; a start time that is
// not a finite positive number hides the chronometer; an identity or target that does not fit is
// dropped without rejecting the rest.
fun parseKeepAliveNotice(map: Map<String, Any?>): KeepAliveNotice? {
  val version = (map["v"] as? Number)?.toDouble() ?: return null
  if (version != 2.0) return null
  val state = (map["state"] as? String)?.let { NoticeState.of(it) } ?: return null
  val startedAt = (map["startedAt"] as? Number)?.toDouble()
  return KeepAliveNotice(
    state = state,
    title = stringOf(map["title"], MAX_TITLE_LENGTH),
    text = stringOf(map["text"], MAX_TEXT_LENGTH),
    startedAtMs = if (startedAt != null && startedAt.isFinite() && startedAt > 0.0) startedAt.toLong() else null,
    stopLabel = stringOf(map["stopLabel"], MAX_TITLE_LENGTH),
    publicTitle = stringOf(map["publicTitle"], MAX_TITLE_LENGTH),
    stoppingTitle = stringOf(map["stoppingTitle"], MAX_TITLE_LENGTH),
    stoppedTitle = stringOf(map["stoppedTitle"], MAX_TITLE_LENGTH),
    identity = identityOf(map["identity"]),
    avatar = map["avatar"] as? String,
    target = targetOf(map["target"])
  )
}

// What a Stop tap did to the display.
enum class StopTap {
  // The display entered Stopping; the caller forwards the stop to the page. The timeout follows from
  // takeTimerChange.
  ENTERED,

  // Already Stopping: a stale tap, ignored.
  STALE,

  // No v2 stoppable notice is showing (a v1 notice, or no stoppable work): the stop is forwarded as
  // it always was.
  PLAIN
}

// What the service should do with its single Stopping timer.
enum class TimerChange { NONE, ARM, CANCEL }

// The notice being shown and whether native is in Stopping. foreground is whether the app is visible to
// the user. Every method runs on the main thread.
class KeepAliveDisplay(foreground: Boolean = true) {
  private var shown: KeepAliveNotice? = null
  private var timerArmed = false

  var foreground: Boolean = foreground
    private set

  var stopping: Boolean = false
    private set

  // The app became visible or hidden. Whether that changes the timer is answered by takeTimerChange.
  fun appForeground(visible: Boolean) {
    foreground = visible
  }

  // The timer is wanted exactly while Stopping and in the foreground. Returns the one step that brings
  // the service's timer in line with that, and records it, so a repeated event or a stale tap while a
  // timer is pending never restarts it.
  fun takeTimerChange(): TimerChange {
    val wanted = stopping && foreground
    if (wanted && !timerArmed) {
      timerArmed = true
      return TimerChange.ARM
    }
    if (!wanted && timerArmed) {
      timerArmed = false
      return TimerChange.CANCEL
    }
    return TimerChange.NONE
  }

  // The v2 notice to show, or null when the service shows a v1 notice or none.
  fun current(): KeepAliveNotice? = shown

  // A v1 notice replaced the v2 one, or a v2 start could not be read.
  fun reset() {
    shown = null
    stopping = false
  }

  // A start or an update from the page. While Stopping, a stoppable notice only changes the data
  // (numbers, title text); a notice without stoppable work ends Stopping, in the background too.
  // Returns true when Stopping ended.
  fun pageNotice(notice: KeepAliveNotice): Boolean {
    shown = notice
    if (stopping && !notice.stoppable) {
      stopping = false
      return true
    }
    return false
  }

  fun stopTapped(): StopTap {
    val current = shown ?: return StopTap.PLAIN
    if (stopping) return StopTap.STALE
    if (!current.stoppable) return StopTap.PLAIN
    stopping = true
    return StopTap.ENTERED
  }

  // The timeout restores the notice the page last sent, with its Stop action. Returns true when it
  // changed the display. The timer that fired is no longer pending. It never ends Stopping while the
  // app is in the background.
  fun stopTimeout(): Boolean {
    timerArmed = false
    if (!foreground) return false
    if (!stopping) return false
    stopping = false
    return true
  }

  // The closing notice that comes with the delayed stop; null when it could not be read. While
  // Stopping, the user's Stop decides what the work ended as: a stopped or failed notice shows as
  // sent, and a finishing one (or an unreadable one) shows Stopped, because the work ended after
  // the user's Stop. An image or a pending save that ended Stopping earlier falls back to its own
  // state instead, so this rule applies only when the stoppable work is the last to end. Outside
  // Stopping the notice shows as sent. Returns true when Stopping ended, in the background too.
  fun outcome(notice: KeepAliveNotice?): Boolean {
    val wasStopping = stopping
    if (wasStopping) {
      val base = notice ?: shown
      shown = when {
        notice != null && (notice.state == NoticeState.STOPPED || notice.state == NoticeState.FAILED) -> notice
        base != null -> stoppedFrom(base)
        else -> null
      }
      stopping = false
    } else if (notice != null) {
      shown = notice
    }
    return wasStopping
  }

  // Keeps the base notice's identity and target, so the converted notice names the same chat a
  // stopped notice from the page would.
  private fun stoppedFrom(base: KeepAliveNotice): KeepAliveNotice {
    val title = base.stoppedTitle.ifEmpty { base.stoppingTitle }
    return base.copy(
      state = NoticeState.STOPPED,
      title = title,
      text = "",
      startedAtMs = null,
      stopLabel = "",
      publicTitle = title
    )
  }
}

// The public version a locked screen shows: the state title only, with the chronometer and the Stop
// action kept, never a name, text, icon or target.
data class PublicPlan(
  val title: String,
  val chronometer: Boolean,
  val whenMs: Long,
  val actionLabel: String?,
  val authRequired: Boolean
)

data class NoticePlan(
  val title: String,
  val text: String,
  val chronometer: Boolean,
  val whenMs: Long,
  val actionLabel: String?,
  // The Stop action needs the device unlocked.
  val authRequired: Boolean,
  val publicVersion: PublicPlan,
  // The key of the character whose avatar is the large icon, when the notice names one.
  val largeIconKey: String?,
  val target: NoticeTarget?,
  // The expanded text: the state line, then the live numbers line. Null when there are no numbers.
  val bigText: String?
)

fun authRequiredFor(sdk: Int): Boolean = sdk >= AUTHENTICATED_ACTION_SDK

private val CHRONOMETER_STATES = setOf(
  NoticeState.GENERATING,
  NoticeState.SPEAKING,
  NoticeState.IMAGE,
  NoticeState.TRANSLATING,
  NoticeState.WORKING
)

private val REPLY_STATES = setOf(
  NoticeState.GENERATING,
  NoticeState.SPEAKING,
  NoticeState.STOPPED,
  NoticeState.FAILED
)

// What to show for a notice. Stopping shows the stopping title with no action and no chronometer. A
// reply state (and Stopping) that carries a named identity shows the name as the title and the state
// title as the text, the failed hint joined with " · ". The Stop action exists only for stoppable
// work and outside Stopping. The text of a generating notice is the live numbers line: it goes to the
// expanded text after the state line, and the collapsed view keeps the state line only.
fun noticePlan(notice: KeepAliveNotice, stopping: Boolean, sdk: Int): NoticePlan {
  val stateTitle = if (stopping) notice.stoppingTitle else notice.title
  val numbers = if (!stopping && notice.state == NoticeState.GENERATING) notice.text else ""
  val stateText = if (stopping || notice.state == NoticeState.GENERATING) "" else notice.text
  val identity = notice.identity
  val replyState = stopping || notice.state in REPLY_STATES
  val named = replyState && identity != null && identity.name.isNotEmpty()
  val title = if (named && identity != null) identity.name else stateTitle
  val text = if (!named) {
    stateText
  } else if (stateText.isEmpty()) {
    stateTitle
  } else {
    "$stateTitle · $stateText"
  }
  val chronometer = !stopping && notice.startedAtMs != null && notice.state in CHRONOMETER_STATES
  val whenMs = notice.startedAtMs ?: 0L
  val actionLabel = if (!stopping && notice.stoppable) notice.stopLabel else null
  val authRequired = authRequiredFor(sdk)
  val bigText = when {
    numbers.isEmpty() -> null
    named -> "$stateTitle\n$numbers"
    else -> numbers
  }
  return NoticePlan(
    title = title,
    text = text,
    chronometer = chronometer,
    whenMs = whenMs,
    actionLabel = actionLabel,
    authRequired = authRequired,
    publicVersion = PublicPlan(notice.publicTitle, chronometer, whenMs, actionLabel, authRequired),
    largeIconKey = if (named && identity != null) identity.key else null,
    target = if (replyState) notice.target else null,
    bigText = bigText
  )
}
