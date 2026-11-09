package io.github.yor42.risutanium

// The two notification-manager calls the reply post needs, so the order of them can be tested
// without Android. N is the platform notification.
interface ReplyPostSink<N> {
  fun cancel(tag: String, id: Int)
  fun notify(tag: String, id: Int, notification: N)
}

// Posts one reply notification. A sounding post always replaces the chat's old notification with a
// fresh record: the old one is cancelled first, because some Android builds treat a repost over a
// live record as a silent update. A silent post updates in place. Only this tag and id are ever
// cancelled, and a failed cancel is reported to onCancelFailed but never stops the post.
fun <N> postReply(
  sink: ReplyPostSink<N>,
  tag: String,
  id: Int,
  silent: Boolean,
  notification: N,
  onCancelFailed: (Exception) -> Unit = {}
) {
  if (!silent) {
    try {
      sink.cancel(tag, id)
    } catch (error: Exception) {
      onCancelFailed(error)
    }
  }
  sink.notify(tag, id, notification)
}
