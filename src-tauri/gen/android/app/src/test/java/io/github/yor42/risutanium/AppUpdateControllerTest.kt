package io.github.yor42.risutanium

import java.io.ByteArrayInputStream
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// A queued worker and a synchronous main thread. With `workerInline` a worker task runs at once, so
// the log shows the order in which the controller executed its actions.
class FakeEffects(private val log: MutableList<String>) : AppUpdateEffects {
  val worker = ArrayDeque<Runnable>()
  var workerInline = false
  var launchResult = LaunchResult.LAUNCHED
  var launchThrows = false
  val launches = ArrayList<Pair<Long, String>>()
  var launchedOk = 0

  override fun onWorker(task: Runnable) {
    if (workerInline) task.run() else worker.addLast(task)
  }

  // The main thread runs one task at a time; a task posted from inside a main task waits for it to return.
  private val pending = ArrayDeque<Pair<Int, Runnable>>()
  private var mainRunning = false
  private var inWorker = false
  private var posted = 0
  var currentTask = 0
  var lastWorkerTask = 0
  var launchTask = -1

  override fun postMain(task: Runnable) {
    val id = ++posted
    if (inWorker) lastWorkerTask = id
    pending.addLast(id to task)
    if (mainRunning) return
    mainRunning = true
    try {
      while (pending.isNotEmpty()) {
        val (taskId, next) = pending.removeFirst()
        currentTask = taskId
        val onWorker = inWorker
        inWorker = false
        try {
          next.run()
        } finally {
          inWorker = onWorker
        }
      }
    } finally {
      mainRunning = false
    }
  }

  override fun launch(gen: Long, name: String): LaunchResult {
    log.add("launch")
    launchTask = currentTask
    launches.add(gen to name)
    if (launchThrows) throw IllegalArgumentException("SYNTH outside provider roots")
    if (launchResult == LaunchResult.LAUNCHED) launchedOk++
    return launchResult
  }

  override fun revoke(name: String) {
    log.add("revoke:$name")
  }

  override fun deleteAll() {
    log.add("deleteAll")
  }

  override fun markCancelled(gen: Long) {
    log.add("mark:$gen")
  }

  fun runWorker() {
    while (worker.isNotEmpty()) {
      inWorker = true
      try {
        worker.removeFirst().run()
      } finally {
        inWorker = false
      }
    }
  }
}

class FakeFactory(private val log: MutableList<String>) : AppUpdateJobFactory {
  override var debugBuild = false
  override var testOrigin: String? = null
  override var sdkInt = 34
  var openerSupplier: () -> HttpOpener = { ScriptedOpener() }
  var archive: PackageFacts? = null
  var installed = PackageFacts("io.github.yor42.risutanium", 1000L, setOf("aa"))
  var usable = Long.MAX_VALUE
  var meteredValue = false
  val sinkNames = ArrayList<String>()
  val sinks = ArrayList<FakeSink>()

  override fun opener(): HttpOpener {
    log.add("opener")
    return openerSupplier.invoke()
  }

  override fun sink(name: String): FileSink {
    sinkNames.add(name)
    return FakeSink(log).also { sinks.add(it) }
  }

  override fun installedFacts() = InstalledFacts { installed }

  override fun archiveFacts() = ArchiveFacts { _, _ -> archive }

  override fun installedSummary() = InstalledSummary(1000L, "0.1.0")

  override fun metered() = meteredValue

  override fun usableSpace() = usable
}

class AppUpdateControllerTest {
  private val apkUrl = "https://github.com/yor42/RisuTanium/releases/download/v0.2.0/app.apk"
  private val log = ArrayList<String>()
  private val effects = FakeEffects(log)
  private val factory = FakeFactory(log)
  private val counter = AtomicInteger()
  private val flow = AppUpdateFlow { "update-${counter.incrementAndGet()}.apk" }
  private val controller = AppUpdateController(effects, factory, flow)
  private val replies = ArrayList<String>()
  private val deliver: (String) -> Unit = { replies.add(it); log.add("deliver") }

  private fun serve(bytes: Int = 10, status: Int = 200) {
    factory.openerSupplier = {
      ScriptedOpener().on(apkUrl) { FakeHop(status, stream = ByteArrayInputStream(ByteArray(bytes))) }
    }
    factory.archive = PackageFacts("io.github.yor42.risutanium", 1001L, setOf("aa"))
  }

  private fun terminal() = replies.filter { !it.startsWith("{\"event\"") }

  private fun install() = controller.install(5, apkUrl, 10L, 1001L, deliver)

  // J-K1 and H6
  @Test
  fun okResultLaunchesBeforeTheResultTaskReturnsOnTheVerifiedName() {
    serve()
    controller.resumed()
    install()
    assertEquals(emptyList<Pair<Long, String>>(), effects.launches)
    effects.runWorker()
    assertEquals(1, effects.launches.size)
    assertEquals(effects.lastWorkerTask, effects.launchTask)
    assertEquals(factory.sinkNames.single(), effects.launches.single().second)
    assertEquals(FlowState.Installing(1L, factory.sinkNames.single()), flow.state)
    assertFalse(factory.sinks.single().deleted)
    assertEquals(0, terminal().size)
  }

  // J-K2
  @Test
  fun permissionRefusalDeletesAndRepliesOnceInTheSameCall() {
    serve()
    effects.launchResult = LaunchResult.PERMISSION_OFF
    controller.resumed()
    install()
    effects.runWorker()
    assertEquals(FlowState.Idle, flow.state)
    assertEquals(
      listOf("{\"id\":5,\"method\":\"appUpdate.install\",\"update\":\"error\",\"code\":\"permission\"}"),
      terminal()
    )
    assertTrue(log.contains("deleteAll"))
  }

  // J-K3
  @Test
  fun launchFailureRevokesThenDeletesThenReplies() {
    serve()
    effects.launchResult = LaunchResult.FAILED
    effects.workerInline = true
    controller.resumed()
    install()
    val name = factory.sinkNames.single()
    assertEquals(listOf("opener", "deliver", "sink.close", "sink.seal", "launch", "revoke:$name", "deleteAll", "deliver"), log)
    assertEquals(
      listOf("{\"id\":5,\"method\":\"appUpdate.install\",\"update\":\"ok\",\"outcome\":\"notInstalled\"}"),
      terminal()
    )
  }

  @Test
  fun aThrowingLaunchCountsAsFailedAndStillAnswers() {
    serve()
    effects.launchThrows = true
    controller.resumed()
    install()
    effects.runWorker()
    assertEquals(
      listOf("{\"id\":5,\"method\":\"appUpdate.install\",\"update\":\"ok\",\"outcome\":\"notInstalled\"}"),
      terminal()
    )
    assertEquals(FlowState.Idle, flow.state)
  }

  // J-K4
  @Test
  fun cancelInInstallingWaitsForTheInstallerAndRepliesOnce() {
    serve()
    effects.workerInline = true
    controller.resumed()
    install()
    val before = log.toList()
    controller.cancel()
    assertEquals(before, log)
    assertEquals(0, terminal().size)
    log.clear()
    controller.installerReturned()
    val name = factory.sinkNames.single()
    assertEquals(listOf("revoke:$name", "deleteAll", "deliver"), log)
    assertEquals(
      listOf("{\"id\":5,\"method\":\"appUpdate.install\",\"update\":\"ok\",\"outcome\":\"notInstalled\"}"),
      terminal()
    )
    controller.installerReturned()
    assertEquals(1, terminal().size)
  }

  // J-K5 (E2)
  @Test
  fun checkRunsNewChecksDeleteBeforeTheCheckJobAndDeliversThroughMain() {
    factory.openerSupplier = {
      ScriptedOpener().on(UPDATE_ENDPOINT) { FakeHop(200, stream = ByteArrayInputStream("{}".toByteArray())) }
    }
    factory.meteredValue = true
    controller.check(3, deliver)
    assertEquals(0, replies.size)
    effects.runWorker()
    assertEquals(listOf("deleteAll", "opener", "deliver"), log)
    assertEquals(
      listOf(
        "{\"id\":3,\"method\":\"appUpdate.check\",\"update\":\"ok\",\"json\":\"{}\"," +
          "\"installedVersionCode\":1000,\"installedVersionName\":\"0.1.0\",\"metered\":true}"
      ),
      replies
    )
  }

  @Test
  fun checkInReleaseDisabledAndNotPublishedReplies() {
    factory.debugBuild = true
    controller.check(1, deliver)
    effects.runWorker()
    assertEquals("{\"id\":1,\"method\":\"appUpdate.check\",\"update\":\"disabled\"}", replies.single())
    replies.clear()
    factory.debugBuild = false
    factory.openerSupplier = { ScriptedOpener().on(UPDATE_ENDPOINT) { FakeHop(404) } }
    controller.check(2, deliver)
    effects.runWorker()
    assertEquals("{\"id\":2,\"method\":\"appUpdate.check\",\"update\":\"notPublished\"}", replies.single())
  }

  @Test
  fun aCheckThatTheFactoryBreaksRepliesOther() {
    factory.openerSupplier = { throw IllegalStateException("SYNTH") }
    controller.check(4, deliver)
    effects.runWorker()
    assertEquals("{\"id\":4,\"method\":\"appUpdate.check\",\"update\":\"error\",\"code\":\"other\"}", replies.single())
  }

  // J-K6 (E3)
  @Test
  fun newPageInInstallingRevokesBeforeDeleteAndTheOldInstallerReturnReachesNobody() {
    serve()
    effects.workerInline = true
    controller.resumed()
    install()
    val old = factory.sinkNames.single()
    log.clear()
    controller.newPage()
    assertEquals(listOf("revoke:$old", "deleteAll", "deliver"), log)
    assertEquals(
      listOf("{\"id\":5,\"method\":\"appUpdate.install\",\"update\":\"error\",\"code\":\"cancelled\"}"),
      terminal()
    )
    controller.installerReturned()
    assertEquals(1, terminal().size)

    install()
    assertTrue(factory.sinkNames.last() != old)
  }

  // J-K7 (E4)
  @Test
  fun cancelInIdleDoesNotCancelTheNextInstall() {
    serve()
    controller.resumed()
    controller.cancel()
    install()
    effects.runWorker()
    assertEquals(1, effects.launches.size)
    assertEquals(FlowState.Installing(1L, factory.sinkNames.single()), flow.state)
  }

  // J-K8
  @Test
  fun invalidInstallRequestsAreBadRequestsThatLeaveTheFlowUntouched() {
    serve()
    val bad = "{\"id\":5,\"method\":\"appUpdate.install\",\"update\":\"error\",\"code\":\"badRequest\"}"
    controller.install(5, "http://evil.example/a.apk", 10L, 1001L, deliver)
    controller.install(5, apkUrl, 0L, 1001L, deliver)
    controller.install(5, apkUrl, 10L, 0L, deliver)
    assertEquals(listOf(bad, bad, bad), replies)
    assertEquals(0L, flow.newestGen)
    assertEquals(FlowState.Idle, flow.state)
    assertEquals(0, effects.worker.size)
  }

  // J-K9
  @Test
  fun aSecondInstallWhileRunningIsBusyAndTheFirstIsUnaffected() {
    serve()
    controller.resumed()
    install()
    controller.install(6, apkUrl, 10L, 1001L, deliver)
    assertEquals(
      listOf("{\"id\":6,\"method\":\"appUpdate.install\",\"update\":\"error\",\"code\":\"busy\"}"),
      replies
    )
    effects.runWorker()
    controller.installerReturned()
    assertEquals(
      "{\"id\":5,\"method\":\"appUpdate.install\",\"update\":\"ok\",\"outcome\":\"notInstalled\"}",
      terminal().last()
    )
    assertEquals(2, terminal().size)
  }

  @Test
  fun progressEventsPrecedeTheTerminalReply() {
    serve()
    controller.resumed()
    install()
    effects.runWorker()
    controller.installerReturned()
    assertEquals("{\"event\":\"appUpdateProgress\",\"received\":10,\"total\":10}", replies.first())
    assertTrue(replies.last().contains("\"outcome\":\"notInstalled\""))
  }

  @Test
  fun aCancelBeforeTheWorkerStartsMeansNothingIsDownloaded() {
    serve()
    controller.resumed()
    install()
    controller.cancel()
    effects.runWorker()
    assertEquals(
      listOf("{\"id\":5,\"method\":\"appUpdate.install\",\"update\":\"error\",\"code\":\"cancelled\"}"),
      terminal()
    )
    assertEquals(0, effects.launches.size)
    assertTrue(factory.sinks.single().deleted)
    assertFalse(factory.sinks.single().outputOpened)
  }

  @Test
  fun processStartSweepsOnceOnTheWorker() {
    controller.processStart()
    controller.processStart()
    assertEquals(1, effects.worker.size)
    effects.runWorker()
    assertEquals(listOf("deleteAll"), log)
  }

  @Test
  fun aJobThatTheFactoryBreaksRepliesOtherAndDeletes() {
    factory.openerSupplier = { throw IllegalStateException("SYNTH") }
    controller.resumed()
    install()
    effects.runWorker()
    assertEquals(
      listOf("{\"id\":5,\"method\":\"appUpdate.install\",\"update\":\"error\",\"code\":\"other\"}"),
      terminal()
    )
  }

  @Test
  fun pausedJobWaitsForResumeBeforeLaunching() {
    serve()
    controller.resumed()
    controller.paused()
    install()
    effects.runWorker()
    assertEquals(0, effects.launches.size)
    controller.resumed()
    assertEquals(1, effects.launches.size)
  }

  // J-K10
  private enum class Ev { CANCEL, PAUSED, RESUMED, RUN_WORKER, RETURN, NEW_PAGE }

  private fun runSequence(events: List<Ev>, launchResult: LaunchResult, jobOk: Boolean) {
    val sequenceLog = ArrayList<String>()
    val sequenceEffects = FakeEffects(sequenceLog)
    sequenceEffects.launchResult = launchResult
    val sequenceFactory = FakeFactory(sequenceLog)
    sequenceFactory.openerSupplier = {
      ScriptedOpener().on(apkUrl) { FakeHop(if (jobOk) 200 else 404, stream = ByteArrayInputStream(ByteArray(10))) }
    }
    sequenceFactory.archive = PackageFacts("io.github.yor42.risutanium", 1001L, setOf("aa"))
    val names = AtomicInteger()
    val sequenceController = AppUpdateController(
      sequenceEffects, sequenceFactory, AppUpdateFlow { "update-${names.incrementAndGet()}.apk" }
    )
    var answers = 0
    var returned = 0
    val sequenceDeliver: (String) -> Unit = { if (!it.startsWith("{\"event\"")) answers++ }
    sequenceController.resumed()
    sequenceController.install(9, apkUrl, 10L, 1001L, sequenceDeliver)
    fun installerReturn() {
      if (sequenceEffects.launchedOk > returned) {
        returned++
        sequenceController.installerReturned()
      }
    }
    for (event in events) {
      when (event) {
        Ev.CANCEL -> sequenceController.cancel()
        Ev.PAUSED -> sequenceController.paused()
        Ev.RESUMED -> sequenceController.resumed()
        Ev.RUN_WORKER -> sequenceEffects.runWorker()
        Ev.RETURN -> installerReturn()
        Ev.NEW_PAGE -> sequenceController.newPage()
      }
    }
    sequenceEffects.runWorker()
    sequenceController.resumed()
    sequenceEffects.runWorker()
    installerReturn()
    assertEquals("sequence $events launch=$launchResult jobOk=$jobOk", 1, answers)
  }

  @Test
  fun everyFeasibleInterleavingAnswersTheInstallRequestExactlyOnce() {
    var sequences = 0
    fun walk(prefix: List<Ev>, launchResult: LaunchResult, jobOk: Boolean) {
      runSequence(prefix, launchResult, jobOk)
      sequences++
      if (prefix.size == 6) return
      for (event in Ev.values()) walk(prefix + event, launchResult, jobOk)
    }
    for (launchResult in LaunchResult.values()) {
      for (jobOk in listOf(true, false)) walk(emptyList(), launchResult, jobOk)
    }
    assertEquals(3 * 2 * (1 + 6 + 36 + 216 + 1296 + 7776 + 46656), sequences)
  }
}
