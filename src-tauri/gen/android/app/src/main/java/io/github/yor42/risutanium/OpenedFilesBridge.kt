package io.github.yor42.risutanium

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import android.util.Log
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject

// Reached by the page two ways. Legacy: exposed as window.__risuTaniumOpenedFilesHost, kept by
// name in proguard-rules.pro because the page calls take() by name, so minification must not
// rename or drop it; WebView calls take() on a bridge thread. Channel: the message listener calls
// takeHeld() on its worker thread and confirm() when the page acknowledges. The queue is
// process-wide: a file that arrives before the page exists, or before first setup is done, waits
// here until the page takes it (legacy) or confirms it (channel), so a batch the page never
// confirmed is offered again. The main thread only enqueues URIs; the display names are resolved
// in take() or takeHeld(), off the main thread, so a slow provider never blocks the UI. Nothing
// here filters by file name: the page decides what is importable.
class OpenedFilesBridge(private val resolver: ContentResolver) {
  // Returns every queued batch (one per intent that carried content URIs) as
  // [[{uri, name}]] and empties the queue; "[]" when nothing waits.
  @JavascriptInterface
  fun take(): String = batchesJson(queue.takeAll())

  // The message channel's take: the same JSON, but the batches stay queued until confirm. through
  // is the highest batch sequence the JSON includes; 0 when it is empty.
  class HeldTake(val json: String, val through: Long)

  fun takeHeld(): HeldTake {
    val snapshot = queue.snapshot()
    return HeldTake(batchesJson(snapshot.batches), snapshot.through)
  }

  // Removes every batch up to the sequence; repeating it is harmless.
  fun confirm(through: Long) {
    queue.confirm(through)
  }

  private fun batchesJson(batches: List<List<Uri>>): String {
    val result = JSONArray()
    for (batch in batches) {
      val entries = JSONArray()
      for (uri in batch) {
        entries.put(JSONObject().put("uri", uri.toString()).put("name", displayName(uri)))
      }
      result.put(entries)
    }
    return result.toString()
  }

  // The provider's display name; the URI's last path segment when it gives none, empty when
  // there is neither. A provider that fails the query costs only the name.
  private fun displayName(uri: Uri): String {
    try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (index >= 0) {
            val name = cursor.getString(index)
            if (!name.isNullOrEmpty()) return name
          }
        }
      }
    } catch (error: Exception) {
      Log.w("OpenedFilesBridge", "display name query failed", error)
    }
    return uri.lastPathSegment ?: ""
  }

  // The queue is shared by every bridge instance, so a recreated WebView finds what its
  // predecessor's page had not taken yet.
  companion object {
    // One entry per intent.
    private val queue = PendingBatches<List<Uri>>()

    // Called on the main thread. Only content URIs are kept: a file:// URI from another app
    // cannot be read, and any other scheme is not a file handed to the app.
    fun enqueue(intent: Intent?) {
      val uris = urisOf(intent)
      if (uris.isEmpty()) return
      queue.enqueue(uris)
    }

    private fun urisOf(intent: Intent?): List<Uri> {
      if (intent == null) return emptyList()
      val found = ArrayList<Uri>()
      when (intent.action) {
        Intent.ACTION_VIEW -> intent.data?.let { found.add(it) }
        Intent.ACTION_SEND -> {
          val stream = streamOf(intent)
          if (stream != null) found.add(stream)
          else addClipUris(intent, found)
        }
        Intent.ACTION_SEND_MULTIPLE -> {
          found.addAll(streamsOf(intent))
          if (found.isEmpty()) addClipUris(intent, found)
        }
      }
      return found.filter { it.scheme == ContentResolver.SCHEME_CONTENT }
    }

    private fun addClipUris(intent: Intent, into: MutableList<Uri>) {
      val clip = intent.clipData ?: return
      for (index in 0 until clip.itemCount) {
        clip.getItemAt(index).uri?.let { into.add(it) }
      }
    }

    @Suppress("DEPRECATION")
    private fun streamOf(intent: Intent): Uri? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        intent.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
      }

    @Suppress("DEPRECATION")
    private fun streamsOf(intent: Intent): List<Uri> =
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
      } else {
        intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM)
      }) ?: emptyList()
  }
}
