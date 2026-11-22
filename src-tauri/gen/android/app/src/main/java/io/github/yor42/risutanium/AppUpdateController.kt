package io.github.yor42.risutanium

import java.net.URI
import java.util.concurrent.atomic.AtomicLong

enum class LaunchResult { LAUNCHED, PERMISSION_OFF, FAILED }

// What the controller needs from the platform edge. `onWorker` is one serial worker, so a queued
// deleteAll never races the writes of a running job. `launch` runs on the main thread and reports
// on every path: a missing launcher or an unexpected failure is FAILED, a failed permission
// re-check is PERMISSION_OFF.
interface AppUpdateEffects {
  fun onWorker(task: Runnable)
  fun postMain(task: Runnable)
  fun launch(gen: Long, name: String): LaunchResult
  fun revoke(name: String)
  fun deleteAll()
  fun markCancelled(gen: Long)
}

// Builds the adapters and facts of one job. Members may be called from the worker thread.
interface AppUpdateJobFactory {
  val debugBuild: Boolean

  // Already reduced through effectiveTestOrigin.
  val testOrigin: String?
  val sdkInt: Int
  fun opener(): HttpOpener
  fun sink(name: String): FileSink
  fun installedFacts(): InstalledFacts
  fun archiveFacts(): ArchiveFacts
  fun installedSummary(): InstalledSummary
  fun metered(): Boolean
  fun usableSpace(): Long
}

private class Delivery(
  val id: Int,
  val deliver: (String) -> Unit,
  val uri: URI,
  val size: Long,
  val versionCode: Long
)

// Executes the flow's actions inside the calling main-thread task. A Launch is executed
// synchronously and its result is fed straight back to the flow, so no other main-thread message,
// a Cancel included, can run between a Launch and its result. Every accepted install request is
// answered exactly once through its deliver callback.
class AppUpdateController(
  private val effects: AppUpdateEffects,
  private val factory: AppUpdateJobFactory,
  private val flow: AppUpdateFlow = AppUpdateFlow(),
  private val log: (String) -> Unit = {},
  private val clock: () -> Long = System::currentTimeMillis
) {
  private val deliveries = HashMap<Long, Delivery>()

  // Read by the worker; raised on the main thread when a generation is marked cancelled.
  private val cancelMirror = AtomicLong(0L)

  fun processStart() = execute(flow.processStart())

  fun newPage() = execute(flow.newPage())

  fun resumed() = execute(flow.resumed())

  fun paused() = execute(flow.paused())

  fun cancel() = execute(flow.cancel())

  fun installerReturned() = execute(flow.installerReturned())

  fun check(id: Int, deliver: (String) -> Unit) {
    execute(flow.newCheck())
    val testOrigin = factory.testOrigin
    effects.onWorker(Runnable {
      val result = try {
        runCheckJob(
          checkEnabled(factory.debugBuild, testOrigin),
          endpointFor(testOrigin),
          testOrigin,
          factory.opener(),
          factory::installedSummary,
          factory::metered
        )
      } catch (error: Exception) {
        CheckResult.Error(UpdateErrorCode.OTHER)
      }
      val reply = encodeCheckResult(id, result)
      effects.postMain(Runnable { deliver(reply) })
    })
  }

  fun install(id: Int, url: String, size: Long, versionCode: Long, deliver: (String) -> Unit) {
    val uri = acceptApkUrl(url, factory.testOrigin)
    if (uri == null || !acceptOfferedSize(size) || !acceptVersionCode(versionCode)) {
      deliver(encodeUpdateReply(id, "install", UpdateReply.Failure(UpdateErrorCode.BAD_REQUEST)))
      return
    }
    val actions = flow.accept()
    val start = actions.filterIsInstance<FlowAction.StartJob>().firstOrNull()
    if (start == null) {
      deliver(encodeUpdateReply(id, "install", UpdateReply.Failure(UpdateErrorCode.BUSY)))
      return
    }
    deliveries[start.gen] = Delivery(id, deliver, uri, size, versionCode)
    execute(actions)
  }

  private fun execute(actions: List<FlowAction>) {
    for (action in actions) {
      when (action) {
        is FlowAction.DeleteAll -> effects.onWorker(Runnable { effects.deleteAll() })
        is FlowAction.StartJob -> startJob(action.gen, action.name)
        is FlowAction.MarkCancelled -> {
          raiseMirror(action.gen)
          effects.markCancelled(action.gen)
        }
        is FlowAction.RevokeGrant -> effects.revoke(action.name)
        is FlowAction.Reply -> reply(action.gen, action.reply)
        is FlowAction.Launch -> launch(action.gen, action.name)
      }
    }
  }

  private fun launch(gen: Long, name: String) {
    val result = try {
      effects.launch(gen, name)
    } catch (error: Exception) {
      log(droppedMessageLog(error))
      LaunchResult.FAILED
    }
    when (result) {
      LaunchResult.LAUNCHED -> Unit
      LaunchResult.PERMISSION_OFF -> execute(flow.launchRefused(gen))
      LaunchResult.FAILED -> execute(flow.launchFailed(gen))
    }
  }

  private fun reply(gen: Long, reply: UpdateReply) {
    val delivery = deliveries.remove(gen) ?: return
    try {
      delivery.deliver(encodeUpdateReply(delivery.id, "install", reply))
    } catch (error: Exception) {
      log(droppedMessageLog(error))
    }
  }

  private fun raiseMirror(gen: Long) {
    cancelMirror.accumulateAndGet(gen) { current, next -> if (next > current) next else current }
  }

  private fun startJob(gen: Long, name: String) {
    val delivery = deliveries[gen] ?: return
    val probe = CancelProbe { gen <= cancelMirror.get() }
    effects.onWorker(Runnable {
      val result = try {
        val input = InstallJobInput(
          delivery.uri,
          delivery.size,
          delivery.versionCode,
          factory.testOrigin,
          factory.usableSpace(),
          signerSource(factory.sdkInt)
        )
        runInstallJob(
          input,
          factory.opener(),
          factory.sink(name),
          factory.installedFacts(),
          factory.archiveFacts(),
          probe,
          progressReporter(gen, delivery.size)
        )
      } catch (error: Exception) {
        log(droppedMessageLog(error))
        JobResult.Failed(UpdateErrorCode.OTHER)
      }
      effects.postMain(Runnable { execute(flow.jobFinished(gen, result)) })
    })
  }

  // Runs on the worker. Throttled events are posted to the main thread in order, ahead of the
  // job's result, so none follows the terminal reply.
  private fun progressReporter(gen: Long, total: Long): (Long) -> Unit {
    var lastMs = 0L
    var lastPercent = -1
    return { written ->
      val percent = (written * 100 / total).toInt()
      val now = clock()
      if (shouldEmitProgress(lastMs, now, lastPercent, percent, written == total)) {
        lastMs = now
        lastPercent = percent
        val event = encodeUpdateProgress(written, total)
        effects.postMain(Runnable { deliveries[gen]?.deliver?.invoke(event) })
      }
    }
  }

  private fun encodeCheckResult(id: Int, result: CheckResult): String = when (result) {
    is CheckResult.Disabled -> encodeUpdateReply(id, "check", UpdateReply.Disabled)
    is CheckResult.NotPublished -> encodeUpdateReply(id, "check", UpdateReply.NotPublished)
    is CheckResult.Error -> encodeUpdateReply(id, "check", UpdateReply.Failure(result.code))
    is CheckResult.Ok ->
      encodeCheckOk(id, result.json, result.installed.versionCode, result.installed.versionName, result.metered)
  }
}
