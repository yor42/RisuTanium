package io.github.yor42.risutanium

// How long a bar colour may wait for the WebView's content to be ready to draw before it is
// applied anyway. The normal wait is one to three frames; a value near 100 ms could fire before a
// slow first raster and bring back the lead the gate exists to remove.
const val BAR_COLOR_READY_TIMEOUT_MS = 250L

// Why a colour was applied: the WebView content of that moment is ready, the wait ran out, or
// there was no WebView to wait for.
enum class BarColorVia { READY, TIMEOUT, NO_VIEW }

// What the gate needs from the host. postVisualState asks the WebView to report when its content
// as of now is ready to draw, and answers false when there is no view or the post failed.
interface BarColorGateEffects {
  fun postVisualState(requestId: Long): Boolean
  fun postTimeout(episode: Long, delayMs: Long)
  fun cancelTimeout()
  fun apply(color: Int, via: BarColorVia)
}

// Orders the system bars with the WebView frame. A colour from the page is applied only when the
// WebView reports that the content of the moment it was requested is ready to draw (the visual
// state callback of the latest request), when the episode's timeout runs out, or at once when
// there is no WebView or the post fails. The applied colour is always the latest requested one:
// a callback of an older request only shows that older content is ready, so it never applies the
// newer colour. A timeout is fixed when an episode (the span from an idle request to its
// application) starts and is not extended by later requests, so constant requests cannot starve
// the bars.
//
// Main thread only: requests, callbacks, timeouts and dispose all run on the main looper.
//
// Paused or hidden path: WryActivity calls WebView.onPause and onResume, and a paused WebView is
// not composited, so its callback does not fire and the timeout applies the colour. The bars are
// then right on return, at the cost of up to the timeout of lateness for a visible but paused
// activity.
//
// Known limitation, fault path only: a callback lost while the WebView is drawn leaves the old
// colour up to 250 ms late. That is bounded by the timeout and preferred to bars stuck at the
// boot colour.
//
// After dispose nothing is posted or applied and no timeout stays queued. A callback still held
// by the long-lived WebView must reach the gate only through a weak reference.
class BarColorGate(
  private val fx: BarColorGateEffects,
  private val timeoutMs: Long = BAR_COLOR_READY_TIMEOUT_MS
) {
  private var nextId = 0L
  private var episode = 0L
  private var pendingId: Long? = null
  private var pendingColor = 0
  private var disposed = false

  fun request(color: Int) {
    if (disposed) return
    val idle = pendingId == null
    nextId += 1
    val id = nextId
    pendingId = id
    pendingColor = color
    if (idle) {
      episode += 1
      fx.postTimeout(episode, timeoutMs)
    }
    if (!fx.postVisualState(id)) {
      val latest = pendingColor
      pendingId = null
      fx.cancelTimeout()
      fx.apply(latest, BarColorVia.NO_VIEW)
    }
  }

  fun onReady(id: Long) {
    if (disposed || id != pendingId) return
    val color = pendingColor
    pendingId = null
    fx.cancelTimeout()
    fx.apply(color, BarColorVia.READY)
  }

  fun onTimeout(timedEpisode: Long) {
    if (disposed || pendingId == null || timedEpisode != episode) return
    val color = pendingColor
    pendingId = null
    fx.apply(color, BarColorVia.TIMEOUT)
  }

  fun dispose() {
    disposed = true
    pendingId = null
    fx.cancelTimeout()
  }
}
