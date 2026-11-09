package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ReplyNotifierPostTest {
  private class RecordingSink(private val failCancel: Boolean = false) : ReplyPostSink<String> {
    val calls = mutableListOf<String>()

    override fun cancel(tag: String, id: Int) {
      calls.add("cancel($tag,$id)")
      if (failCancel) throw IllegalStateException("cancel failed")
    }

    override fun notify(tag: String, id: Int, notification: String) {
      calls.add("notify($tag,$id,$notification)")
    }
  }

  @Test
  fun aSoundingPostCancelsTheOldRecordThenPostsAFreshOne() {
    val sink = RecordingSink()
    postReply(sink, "chat-a", 7422, false, "n")
    assertEquals(listOf("cancel(chat-a,7422)", "notify(chat-a,7422,n)"), sink.calls)
  }

  @Test
  fun aSilentPostOnlyUpdatesInPlace() {
    val sink = RecordingSink()
    postReply(sink, "chat-a", 7422, true, "n")
    assertEquals(listOf("notify(chat-a,7422,n)"), sink.calls)
  }

  @Test
  fun aFailedCancelStillPostsAndIsReported() {
    val sink = RecordingSink(failCancel = true)
    val reported = mutableListOf<Exception>()
    postReply(sink, "chat-a", 7422, false, "n") { reported.add(it) }
    assertEquals(listOf("cancel(chat-a,7422)", "notify(chat-a,7422,n)"), sink.calls)
    assertEquals(1, reported.size)
  }

  @Test
  fun onlyThePostedTagAndIdAreEverCancelled() {
    val sink = RecordingSink()
    postReply(sink, "chat-a", 7422, false, "n")
    postReply(sink, "chat-b", 7422, false, "n")
    val cancels = sink.calls.filter { it.startsWith("cancel(") }
    assertEquals(listOf("cancel(chat-a,7422)", "cancel(chat-b,7422)"), cancels)
    assertTrue(sink.calls.none { it.contains(",7421") })
  }
}
