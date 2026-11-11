package io.github.yor42.risutanium

// The keep-alive notification's content and display rules (contract v2). Plain Kotlin with no android
// imports, like BridgeScope.kt and ReplyNotificationsPolicy.kt, so the parse, the display machine and
// the plan run in JVM tests; KeepAliveService only applies a plan to a notification builder.
//
// The page owns what the notice says and sends every title already localised, so native holds no
// strings of its own. Native owns exactly one thing: the Stopping state, which begins on the Stop tap
// itself (no round trip to the page) and ends when the page reports the stoppable work gone. While the
// app is in the foreground a timeout also ends it, so a Stop that did not take never leaves a user who
// can see the app without a control; in the background Stopping has no timeout. When native itself
// cancelled the chat's in-flight request on the Stop tap (MC-1435), Stopping shows Stopped at once with
// no button and no timeout (MC-1470); it clears when the page returns or the app reopens (MC-1471). Native also drops a Generating count line the page has not refreshed for a few seconds
// while the app is hidden (MC-1450).

const val KEEP_ALIVE_ACCENT_COLOR = 0xFF587BFF.toInt()

// How long the page may send no notice while the app is hidden before native drops the count line. A
// page hidden for about a minute is frozen and cannot clear the line itself (MC-1450). The page
// refreshes the count at most once a second, and only when it changed, so 5 s is five missed refreshes.
// This is a technical choice.
const val COUNT_STALE_MS = 5000L

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

// Where a Generating notice's count line comes from. The page's line is the only source today. A native
// count for known formats (MC-1452) would be a further case that replaces Dropped. The plan takes the
// line as a value and uses an exhaustive when, so a new source must be handled where the line is shown.
sealed class CountLine {
  object Page : CountLine()
  object Dropped : CountLine()
}

// What the Stop tap's delivery did. IGNORED: a stale tap, nothing sent. NO_PAGE: no live page could act
// on the stop. DELIVERED: the page was told and native cancelled nothing. CONFIRMED: the page was told
// and native then cancelled at least one of the chat's in-flight requests.
enum class StopDelivery { IGNORED, NO_PAGE, DELIVERED, CONFIRMED }

// The delivery of one Stop tap. The page is told first and native cancels the chat's requests after it,
// in the same main-thread turn, so the native cancel only ever follows a stop the page received. A
// failed page call cancels nothing. Only an entered tap on Generating work cancels natively: a stale
// tap, a v1 notice and speech never do.
fun deliverStopTap(
  tap: StopTap,
  display: KeepAliveDisplay,
  callPage: () -> Boolean,
  cancelChatStreams: () -> Int
): StopDelivery {
  if (tap == StopTap.STALE) return StopDelivery.IGNORED
  if (!callPage()) return StopDelivery.NO_PAGE
  if (tap != StopTap.ENTERED || !display.nativeCancelWanted()) return StopDelivery.DELIVERED
  return if (display.nativeCancelled(cancelChatStreams())) StopDelivery.CONFIRMED else StopDelivery.DELIVERED
}

// Whether a count line that is shown (null before any notification was built) no longer matches what the
// display wants, so the service must repost.
fun countLineRepostWanted(shownLine: CountLine?, display: KeepAliveDisplay): Boolean =
  shownLine != null && shownLine != display.countLine()

// The delay of the next count check. It is null when no check is wanted: the line is not applicable, or
// it is due and no notification shows its count (already shown dropped, or none built yet). A due line
// that is still shown with its count gets an immediate check, so a check never stalls between two
// clock readings and never repeats after the drop is shown.
fun countTimerDelayMs(shownLine: CountLine?, display: KeepAliveDisplay): Long? =
  display.countDelayMs()?.takeIf { it > 0L || shownLine == CountLine.Page }

// The notice being shown and whether native is in Stopping. foreground is whether the app is visible to
// the user. clock is a monotonic millisecond clock for the count line's staleness. Every method runs on
// the main thread.
class KeepAliveDisplay(
  foreground: Boolean = true,
  private val clock: () -> Long = { System.nanoTime() / 1_000_000L }
) {
  private var shown: KeepAliveNotice? = null
  private var timerArmed = false
  private var lastPageNoticeAtMs = 0L

  // Native cancelled the chat's request on this Stopping: the display shows Stopped with no timer until
  // the page's outcome or a non-stoppable notice ends Stopping (MC-1470, MC-1471).
  var cancelConfirmed: Boolean = false
    private set

  var foreground: Boolean = foreground
    private set

  var stopping: Boolean = false
    private set

  // The app became visible or hidden. Whether that changes the timer is answered by takeTimerChange.
  fun appForeground(visible: Boolean) {
    foreground = visible
  }

  // The timer is wanted exactly while Stopping, in the foreground and not confirmed cancelled by native
  // (a confirmed cancel shows Stopped, which has nothing to time out). Returns the one step that brings
  // the service's timer in line with that, and records it, so a repeated event or a stale tap while a
  // timer is pending never restarts it.
  fun takeTimerChange(): TimerChange {
    val wanted = stopping && foreground && !cancelConfirmed
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
    cancelConfirmed = false
  }

  // A start or an update from the page. While Stopping, a stoppable notice only changes the data
  // (numbers, title text) and keeps a confirmed cancel; a notice without stoppable work ends Stopping,
  // in the background too. Only a page start or update refreshes the count line's clock (MC-1450).
  // Returns true when Stopping ended.
  fun pageNotice(notice: KeepAliveNotice): Boolean {
    shown = notice
    lastPageNoticeAtMs = clock()
    if (stopping && !notice.stoppable) {
      stopping = false
      cancelConfirmed = false
      return true
    }
    return false
  }

  fun stopTapped(): StopTap {
    val current = shown ?: return StopTap.PLAIN
    if (stopping) return StopTap.STALE
    if (!current.stoppable) return StopTap.PLAIN
    stopping = true
    cancelConfirmed = false
    return StopTap.ENTERED
  }

  // Native cancelling is wanted for an entered Stopping on Generating work that is not yet confirmed.
  // Speech and every other state have no native request to cancel.
  fun nativeCancelWanted(): Boolean = stopping && !cancelConfirmed && shown?.state == NoticeState.GENERATING

  // Records the count native's cancel returned. Only a positive count confirms: zero (nothing matched)
  // and a negative one (a failed call) leave Stopping as MC-1435 has it. Returns whether it confirmed.
  fun nativeCancelled(count: Int): Boolean {
    if (!stopping || count <= 0) return false
    cancelConfirmed = true
    return true
  }

  // The count line to show. It is dropped exactly while the app is hidden, the notice is Generating with
  // a count, and the page has sent no notice for COUNT_STALE_MS. It does not look at Stopping: a Stopping
  // plan shows no numbers either way.
  fun countLine(): CountLine {
    val current = shown ?: return CountLine.Page
    if (foreground || current.state != NoticeState.GENERATING || current.text.isEmpty()) return CountLine.Page
    return if (clock() - lastPageNoticeAtMs >= COUNT_STALE_MS) CountLine.Dropped else CountLine.Page
  }

  // Milliseconds until the count line drops; 0 once it is due. Null when no drop applies: in the
  // foreground, while Stopping, when the notice is not Generating or has no count. While not Stopping,
  // for one clock value it is 0 exactly when countLine is Dropped.
  fun countDelayMs(): Long? {
    val current = shown ?: return null
    if (foreground || stopping || current.state != NoticeState.GENERATING || current.text.isEmpty()) return null
    return maxOf(0L, COUNT_STALE_MS - (clock() - lastPageNoticeAtMs))
  }

  // The timeout restores the notice the page last sent, with its Stop action. Returns true when it
  // changed the display. The timer that fired is no longer pending. It never ends Stopping while the
  // app is in the background or while native's cancel is confirmed.
  fun stopTimeout(): Boolean {
    timerArmed = false
    if (!foreground || cancelConfirmed) return false
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
    cancelConfirmed = false
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
// expanded text after the state line, and the collapsed view keeps the state line only. A Stopping
// whose cancel native confirmed (stopped) shows the Stopped title instead, in the public version too,
// and is otherwise the same plan. countLine decides only whether the numbers line is shown: a dropped
// line turns the expanded text to null and changes nothing else.
fun noticePlan(
  notice: KeepAliveNotice,
  stopping: Boolean,
  sdk: Int,
  stopped: Boolean = false,
  countLine: CountLine = CountLine.Page
): NoticePlan {
  val confirmedStopped = stopping && stopped
  val stateTitle = when {
    confirmedStopped -> notice.stoppedTitle.ifEmpty { notice.stoppingTitle }
    stopping -> notice.stoppingTitle
    else -> notice.title
  }
  val numbers = if (!stopping && notice.state == NoticeState.GENERATING) {
    when (countLine) {
      CountLine.Page -> notice.text
      CountLine.Dropped -> ""
    }
  } else {
    ""
  }
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
    publicVersion = PublicPlan(
      if (confirmedStopped) stateTitle else notice.publicTitle,
      chronometer,
      whenMs,
      actionLabel,
      authRequired
    ),
    largeIconKey = if (named && identity != null) identity.key else null,
    target = if (replyState) notice.target else null,
    bigText = bigText
  )
}
