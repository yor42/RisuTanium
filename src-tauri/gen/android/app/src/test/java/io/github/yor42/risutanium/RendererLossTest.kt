package io.github.yor42.risutanium

import android.content.SharedPreferences
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.lang.reflect.Method
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class RendererLossTest {
  private val effectNames = setOf("persist", "stop", "relaunch", "exit")

  // ---- decideRendererLoss ----

  @Test
  fun aFirstForegroundLossRelaunchesAndABackgroundOneExits() {
    val foreground = decideRendererLoss(null, true, 5_000L)
    assertEquals(RendererLossAction.RELAUNCH, foreground.action)
    assertEquals("5000", foreground.storedAfter)
    val background = decideRendererLoss(null, false, 5_000L)
    assertEquals(RendererLossAction.EXIT, background.action)
    assertEquals("5000", background.storedAfter)
  }

  private fun chain(foreground: Boolean, vararg times: Long): List<RendererLossDecision> {
    var stored: String? = null
    return times.map { now ->
      decideRendererLoss(stored, foreground, now).also { stored = it.storedAfter }
    }
  }

  @Test
  fun theThirdLossWithinTheWindowGivesUp() {
    val actions = chain(true, 0L, 30_000L, 60_000L).map { it.action }
    assertEquals(
      listOf(RendererLossAction.RELAUNCH, RendererLossAction.RELAUNCH, RendererLossAction.EXIT),
      actions
    )
  }

  @Test
  fun aLossJustOutsideTheWindowIsForgotten() {
    val actions = chain(true, 0L, 30_000L, 60_001L).map { it.action }
    assertEquals(
      listOf(RendererLossAction.RELAUNCH, RendererLossAction.RELAUNCH, RendererLossAction.RELAUNCH),
      actions
    )
  }

  @Test
  fun twoLossesNeverGiveUp() {
    assertTrue(chain(true, 0L, 1L).none { it.action == RendererLossAction.EXIT })
  }

  @Test
  fun aBackgroundLossCountsTowardsGivingUp() {
    var stored: String? = null
    stored = decideRendererLoss(stored, false, 0L).storedAfter
    stored = decideRendererLoss(stored, true, 1_000L).storedAfter
    assertEquals(RendererLossAction.EXIT, decideRendererLoss(stored, true, 2_000L).action)
  }

  @Test
  fun aTimeAfterNowIsDroppedAndNotKept() {
    val decision = decideRendererLoss("500000", true, 1_000L)
    assertEquals(RendererLossAction.RELAUNCH, decision.action)
    assertEquals("1000", decision.storedAfter)
  }

  @Test
  fun malformedEntriesAreSkipped() {
    val decision = decideRendererLoss("x,5,", true, 10L)
    assertEquals("5,10", decision.storedAfter)
  }

  @Test
  fun atMostThreeEntriesAreKept() {
    val decision = decideRendererLoss("1,2,3,4,5", true, 10L)
    assertEquals(3, decision.storedAfter.split(',').size)
    assertEquals(RendererLossAction.EXIT, decision.action)
  }

  // ---- the client ----

  private fun overridesOf(type: Class<*>): Set<String> =
    type.declaredMethods.filter { isOverride(it) }.map { signature(it) }.toSet()

  private fun isOverride(method: Method): Boolean =
    !method.isSynthetic && !java.lang.reflect.Modifier.isPrivate(method.modifiers) && runCatching {
      WebViewClient::class.java.getMethod(method.name, *method.parameterTypes)
    }.isSuccess

  private fun signature(method: Method) =
    method.name + method.parameterTypes.joinToString(",", "(", ")") { it.name }

  @Test
  fun theClientDeclaresEveryOverrideOfWrysClient() {
    val wry = overridesOf(Class.forName("io.github.yor42.risutanium.RustWebViewClient"))
    assertEquals(5, wry.size)
    val ours = overridesOf(RendererLossClient::class.java)
    assertTrue("missing: ${wry - ours}", ours.containsAll(wry))
  }

  @Test
  fun wrysClientDeclaresNoRenderProcessGoneOverride() {
    val wry = Class.forName("io.github.yor42.risutanium.RustWebViewClient")
    assertTrue(wry.declaredMethods.none { it.name == "onRenderProcessGone" })
  }

  private class RecordingClient(
    private val response: WebResourceResponse?,
    private val overrideUrl: Boolean
  ) : WebViewClient() {
    val calls = mutableListOf<List<Any?>>()

    override fun shouldInterceptRequest(view: WebView?, request: WebResourceRequest?): WebResourceResponse? {
      calls.add(listOf("intercept", view, request))
      return response
    }

    override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
      calls.add(listOf("override", view, request))
      return overrideUrl
    }

    override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
      calls.add(listOf("started", view, url, favicon))
    }

    override fun onPageFinished(view: WebView?, url: String?) {
      calls.add(listOf("finished", view, url))
    }

    override fun onReceivedError(
      view: WebView?,
      request: WebResourceRequest?,
      error: android.webkit.WebResourceError?
    ) {
      calls.add(listOf("error", view, request, error))
    }
  }

  private val noRequest: WebResourceRequest? = null

  private fun detail(crashed: Boolean) = object : RenderProcessGoneDetail() {
    override fun didCrash() = crashed
    override fun rendererPriorityAtExit() = 0
  }

  @Test
  fun everyForwardReachesTheDelegateAndReturnsItsResult() {
    val response = WebResourceResponse("text/plain", "utf-8", java.io.ByteArrayInputStream(ByteArray(0)))
    val delegate = RecordingClient(response, true)
    val client = RendererLossClient(delegate) { _, _ -> true }
    assertSame(response, client.shouldInterceptRequest(null, noRequest))
    assertTrue(client.shouldOverrideUrlLoading(null, noRequest))
    client.onPageStarted(null, "http://tauri.localhost/", null)
    client.onPageFinished(null, "http://tauri.localhost/")
    client.onReceivedError(null, null, null)
    assertEquals(
      listOf("intercept", "override", "started", "finished", "error"),
      delegate.calls.map { it[0] }
    )
    assertEquals("http://tauri.localhost/", delegate.calls[2][2])
    assertEquals("http://tauri.localhost/", delegate.calls[3][2])
    val refusing = RendererLossClient(RecordingClient(null, false)) { _, _ -> true }
    assertFalse(refusing.shouldOverrideUrlLoading(null, noRequest))
  }

  @Test
  fun renderProcessGoneReturnsTheCallbackResultAndPassesDidCrash() {
    val seen = mutableListOf<Boolean>()
    val handled = RendererLossClient(RecordingClient(null, false)) { _, crashed -> seen.add(crashed); true }
    assertTrue(handled.onRenderProcessGone(null, detail(true)))
    assertTrue(handled.onRenderProcessGone(null, detail(false)))
    assertTrue(handled.onRenderProcessGone(null, null))
    assertEquals(listOf(true, false, false), seen)
    val refused = RendererLossClient(RecordingClient(null, false)) { _, _ -> false }
    assertFalse(refused.onRenderProcessGone(null, detail(true)))
  }

  // ---- runRendererLoss ----

  private class FakeEffects(
    var stored: String? = null,
    var foreground: Boolean = true,
    var now: Long = 100_000L,
    var persistResult: Boolean = true,
    val throwing: MutableMap<String, Throwable> = mutableMapOf()
  ) : RendererLossEffects {
    val events = mutableListOf<String>()
    val outcomes = mutableListOf<String>()
    val logged = mutableListOf<String>()

    private fun record(name: String) {
      events.add(name)
      throwing[name]?.let { throw it }
    }

    override fun foreground(): Boolean { record("foreground"); return foreground }
    override fun now(): Long { record("now"); return now }
    override fun load(): String? { record("load"); return stored }
    override fun log(action: RendererLossAction?, didCrash: Boolean) {
      record("log")
      logged.add("$action/$didCrash")
    }
    override fun logOutcome(durable: Boolean, ok: Boolean, relaunchCalled: Boolean) {
      record("outcome")
      outcomes.add("durable=$durable ok=$ok relaunch=$relaunchCalled")
    }
    override fun warn(step: String, error: Exception) { record("warn") }
    override fun persist(value: String): Boolean {
      record("persist")
      if (persistResult) stored = value
      return persistResult
    }
    override fun stopKeepAlive() { record("stop") }
    override fun relaunch() { record("relaunch") }
    override fun exitProcess() { record("exit") }
  }

  private fun FakeEffects.effects() = events.filter { it in effectNames }

  private val boom = RuntimeException("boom")

  @Test
  fun aNonLiveLossCallsNoEffect() {
    for (crashed in listOf(true, false)) {
      val fx = FakeEffects()
      runRendererLoss(false, crashed, fx)
      assertTrue(fx.events.isEmpty())
    }
  }

  @Test
  fun aLiveForegroundLossPersistsStopsRelaunchesAndExits() {
    for (crashed in listOf(true, false)) {
      val fx = FakeEffects()
      runRendererLoss(true, crashed, fx)
      assertEquals(listOf("persist", "stop", "relaunch", "exit"), fx.effects())
      assertEquals(listOf("durable=true ok=true relaunch=true"), fx.outcomes)
      assertEquals(listOf("RELAUNCH/$crashed"), fx.logged)
    }
  }

  @Test
  fun aBackgroundLossExitsWithoutRelaunch() {
    val fx = FakeEffects(foreground = false)
    runRendererLoss(true, true, fx)
    assertEquals(listOf("persist", "stop", "exit"), fx.effects())
  }

  @Test
  fun givingUpExitsWithoutRelaunch() {
    val fx = FakeEffects(stored = "90000,95000")
    runRendererLoss(true, true, fx)
    assertEquals(listOf("persist", "stop", "exit"), fx.effects())
  }

  @Test
  fun aFailedRecordNeverRelaunches() {
    val fx = FakeEffects(persistResult = false)
    runRendererLoss(true, true, fx)
    assertEquals(listOf("persist", "stop", "exit"), fx.effects())
    assertEquals(listOf("durable=false ok=true relaunch=false"), fx.outcomes)
  }

  @Test
  fun aRecordThatThrowsNeverRelaunches() {
    val fx = FakeEffects(throwing = mutableMapOf("persist" to boom))
    runRendererLoss(true, true, fx)
    assertEquals(listOf("persist", "stop", "exit"), fx.effects())
    assertEquals(listOf("durable=false ok=false relaunch=false"), fx.outcomes)
  }

  @Test
  fun aRecordAndItsWarningBothThrowingStillNeverRelaunches() {
    val fx = FakeEffects(throwing = mutableMapOf("persist" to boom, "warn" to boom))
    runRendererLoss(true, true, fx)
    assertEquals(listOf("persist", "stop", "exit"), fx.effects())
  }

  @Test
  fun aFailedStopBlocksTheRelaunch() {
    val fx = FakeEffects(throwing = mutableMapOf("stop" to boom))
    runRendererLoss(true, true, fx)
    assertEquals(listOf("persist", "stop", "exit"), fx.effects())
  }

  @Test
  fun aFailedLoadBlocksTheRecordAndTheRelaunch() {
    val fx = FakeEffects(throwing = mutableMapOf("load" to boom))
    runRendererLoss(true, true, fx)
    assertEquals(listOf("stop", "exit"), fx.effects())
  }

  @Test
  fun aFailedForegroundOrClockReadBlocksTheRecordAndTheRelaunch() {
    for (name in listOf("foreground", "now")) {
      val fx = FakeEffects(throwing = mutableMapOf(name to boom))
      runRendererLoss(true, true, fx)
      assertEquals(listOf("stop", "exit"), fx.effects())
    }
  }

  @Test
  fun aFailedLogBlocksTheRelaunchButNotTheRecord() {
    val fx = FakeEffects(throwing = mutableMapOf("log" to boom))
    runRendererLoss(true, true, fx)
    assertEquals(listOf("persist", "stop", "exit"), fx.effects())
    assertEquals(listOf("durable=true ok=false relaunch=false"), fx.outcomes)
  }

  @Test
  fun aFailedRelaunchStillExitsOnce() {
    val fx = FakeEffects(throwing = mutableMapOf("relaunch" to boom))
    runRendererLoss(true, true, fx)
    assertEquals(listOf("persist", "stop", "relaunch", "exit"), fx.effects())
  }

  @Test
  fun aFailedOutcomeLogStillExitsOnce() {
    val fx = FakeEffects(throwing = mutableMapOf("outcome" to boom))
    runRendererLoss(true, true, fx)
    assertEquals(listOf("persist", "stop", "relaunch", "exit"), fx.effects())
  }

  @Test
  fun aChainedStoreCountsLiveLossesOnly() {
    val fx = FakeEffects()
    runRendererLoss(true, true, fx)
    fx.now += 1_000L
    runRendererLoss(false, true, fx)
    fx.now += 1_000L
    runRendererLoss(true, true, fx)
    assertEquals(2, fx.stored!!.split(',').size)
    assertEquals(2, fx.effects().count { it == "relaunch" })
  }

  @Test
  fun theThirdLiveLossInTheWindowDoesNotRelaunch() {
    val fx = FakeEffects()
    repeat(3) {
      fx.events.clear()
      runRendererLoss(true, true, fx)
      fx.now += 10_000L
    }
    assertEquals(listOf("persist", "stop", "exit"), fx.effects())
  }

  @Test
  fun anErrorFromAStepPropagatesAfterTheExit() {
    val fx = FakeEffects(throwing = mutableMapOf("stop" to StackOverflowError()))
    assertThrows(StackOverflowError::class.java) { runRendererLoss(true, true, fx) }
    assertEquals(listOf("persist", "stop", "exit"), fx.effects())
  }

  // ---- persistLossTimes ----

  private class FakePrefs(private val commitResult: Boolean) : SharedPreferences {
    val written = mutableMapOf<String, String?>()
    var applyCalls = 0
    var commitCalls = 0

    val editor = object : SharedPreferences.Editor {
      override fun putString(key: String, value: String?): SharedPreferences.Editor { written[key] = value; return this }
      override fun putStringSet(key: String, values: MutableSet<String>?): SharedPreferences.Editor = this
      override fun putInt(key: String, value: Int): SharedPreferences.Editor = this
      override fun putLong(key: String, value: Long): SharedPreferences.Editor = this
      override fun putFloat(key: String, value: Float): SharedPreferences.Editor = this
      override fun putBoolean(key: String, value: Boolean): SharedPreferences.Editor = this
      override fun remove(key: String): SharedPreferences.Editor = this
      override fun clear(): SharedPreferences.Editor = this
      override fun commit(): Boolean { commitCalls++; return commitResult }
      override fun apply() { applyCalls++ }
    }

    override fun getAll(): MutableMap<String, *> = written
    override fun getString(key: String, defValue: String?): String? = written[key] ?: defValue
    override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? = defValues
    override fun getInt(key: String, defValue: Int) = defValue
    override fun getLong(key: String, defValue: Long) = defValue
    override fun getFloat(key: String, defValue: Float) = defValue
    override fun getBoolean(key: String, defValue: Boolean) = defValue
    override fun contains(key: String) = written.containsKey(key)
    override fun edit(): SharedPreferences.Editor = editor
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {}
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener) {}
  }

  @Test
  fun persistReturnsCommitsOwnResultAndNeverApplies() {
    val failing = FakePrefs(false)
    assertFalse(persistLossTimes(failing, "1,2"))
    assertEquals(0, failing.applyCalls)
    assertEquals(1, failing.commitCalls)
    val working = FakePrefs(true)
    assertTrue(persistLossTimes(working, "1,2"))
    assertEquals(0, working.applyCalls)
    assertEquals("1,2", working.written[KEY_LOSS_TIMES])
    assertNotNull(working.written[KEY_LOSS_TIMES])
  }
}
