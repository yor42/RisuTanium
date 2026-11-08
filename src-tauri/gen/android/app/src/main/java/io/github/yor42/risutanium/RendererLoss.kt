package io.github.yor42.risutanium

import android.content.SharedPreferences
import android.graphics.Bitmap
import android.os.Build
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.RequiresApi

// The guard's state lives in its own app-private preferences file, never in the web store: at most
// RENDERER_LOSS_LIMIT elapsed-realtime values, comma separated.
const val RENDERER_LOSS_PREFS = "renderer_loss"
const val KEY_LOSS_TIMES = "lossTimes"
const val RENDERER_LOSS_WINDOW_MS = 60_000L
const val RENDERER_LOSS_LIMIT = 3

// Forwards exactly the overrides of wry's client to it and adds the one it lacks. Chromium aborts
// the process unless every WebView of the renderer handles its loss, so this client answers true
// for each view it wraps. The delegate is immutable because shouldInterceptRequest runs off the
// main thread. No override calls super: the delegate's result is the result.
@RequiresApi(Build.VERSION_CODES.O)
class RendererLossClient(
  private val wry: WebViewClient,
  private val onGone: (WebView?, Boolean) -> Boolean
) : WebViewClient() {
  override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? =
    wry.shouldInterceptRequest(view, request)

  override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean =
    wry.shouldOverrideUrlLoading(view, request)

  override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
    wry.onPageStarted(view, url, favicon)
  }

  override fun onPageFinished(view: WebView?, url: String?) {
    wry.onPageFinished(view, url)
  }

  override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
    wry.onReceivedError(view, request, error)
  }

  override fun onRenderProcessGone(view: WebView?, detail: RenderProcessGoneDetail?): Boolean =
    onGone(view, detail?.didCrash() ?: false)
}

enum class RendererLossAction { RELAUNCH, EXIT }

data class RendererLossDecision(val action: RendererLossAction, val storedAfter: String)

// Decodes the recorded loss times, drops the malformed ones, the ones after `now` (the clock
// restarts at boot) and the ones older than the window, then counts this loss. Reaching `limit`
// losses in the window gives up; otherwise a foreground loss relaunches and a background one exits.
fun decideRendererLoss(
  stored: String?,
  foreground: Boolean,
  now: Long,
  windowMs: Long = RENDERER_LOSS_WINDOW_MS,
  limit: Int = RENDERER_LOSS_LIMIT
): RendererLossDecision {
  val recent = (stored ?: "").split(',')
    .mapNotNull { it.trim().toLongOrNull() }
    .filter { it <= now && now - it <= windowMs }
  val history = (recent + now).takeLast(limit)
  val action = when {
    history.size >= limit -> RendererLossAction.EXIT
    foreground -> RendererLossAction.RELAUNCH
    else -> RendererLossAction.EXIT
  }
  return RendererLossDecision(action, history.joinToString(","))
}

// Writes synchronously and returns the platform's own result: the process is killed right after,
// and an asynchronous write would be lost with it.
fun persistLossTimes(prefs: SharedPreferences, value: String): Boolean =
  prefs.edit().putString(KEY_LOSS_TIMES, value).commit()

interface RendererLossEffects {
  fun foreground(): Boolean
  fun now(): Long
  fun load(): String?
  fun log(action: RendererLossAction?, didCrash: Boolean)
  fun logOutcome(durable: Boolean, ok: Boolean, relaunchCalled: Boolean)
  fun warn(step: String, error: Exception)
  fun persist(value: String): Boolean
  fun stopKeepAlive()
  fun relaunch()
  fun exitProcess()
}

// Runs on the main thread after a renderer loss. Every effect is best-effort and the process is
// always ended: a relaunch happens only when the new history is known to be durable and no earlier
// step failed, so a failing record can never give more relaunches than the guard allows. A
// non-live view has nothing to do here: the wrapper only had to answer true for it.
fun runRendererLoss(isLiveView: Boolean, didCrash: Boolean, fx: RendererLossEffects) {
  if (!isLiveView) return
  try {
    var ok = true
    fun step(name: String, block: () -> Unit) {
      try {
        block()
      } catch (error: Exception) {
        ok = false
        try {
          fx.warn(name, error)
        } catch (_: Exception) {
        }
      }
    }

    var decision: RendererLossDecision? = null
    step("decide") { decision = decideRendererLoss(fx.load(), fx.foreground(), fx.now()) }
    val chosen = decision
    step("log") { fx.log(chosen?.action, didCrash) }
    var durable = false
    if (chosen != null) {
      step("persist") { durable = fx.persist(chosen.storedAfter) }
    }
    step("stopKeepAlive") { fx.stopKeepAlive() }
    var relaunchCalled = false
    if (chosen?.action == RendererLossAction.RELAUNCH && durable && ok) {
      relaunchCalled = true
      step("relaunch") { fx.relaunch() }
    }
    step("outcome") { fx.logOutcome(durable, ok, relaunchCalled) }
  } finally {
    fx.exitProcess()
  }
}
