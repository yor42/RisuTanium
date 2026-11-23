package io.github.yor42.risutanium

import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Binder
import android.os.ParcelFileDescriptor
import android.os.Process
import androidx.core.content.FileProvider

// The app's own FileProvider serves other apps only. A call from this app's own process is refused in every
// override that serves or changes data, so page code and the file plugins cannot reach any of its roots
// through a content link. getType stays open: it returns a MIME type only.
class OwnFileProvider : FileProvider() {
  private fun requireOtherApp() {
    if (!ownProviderCallAllowed(Binder.getCallingUid(), Process.myUid())) {
      throw SecurityException("The app's own file provider does not serve this process")
    }
  }

  override fun query(
    uri: Uri,
    projection: Array<String>?,
    selection: String?,
    selectionArgs: Array<String>?,
    sortOrder: String?,
  ): Cursor {
    requireOtherApp()
    return super.query(uri, projection, selection, selectionArgs, sortOrder)
  }

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
    requireOtherApp()
    return super.openFile(uri, mode)
  }

  override fun insert(uri: Uri, values: ContentValues): Uri? {
    requireOtherApp()
    return super.insert(uri, values)
  }

  override fun update(
    uri: Uri,
    values: ContentValues,
    selection: String?,
    selectionArgs: Array<String>?,
  ): Int {
    requireOtherApp()
    return super.update(uri, values, selection, selectionArgs)
  }

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int {
    requireOtherApp()
    return super.delete(uri, selection, selectionArgs)
  }
}
