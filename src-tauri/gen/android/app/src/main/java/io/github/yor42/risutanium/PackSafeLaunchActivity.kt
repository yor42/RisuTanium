package io.github.yor42.risutanium

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import android.util.Log

// The launcher shortcut's target. It shows nothing: it forwards to MainActivity with the pack-safe action
// and finishes. The forward joins the existing task and never clears it (packSafeForward), so a running
// MainActivity gets the intent in onNewIntent with its state intact.
class PackSafeLaunchActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    try {
      val forward = packSafeForward()
      startActivity(
        Intent(forward.action)
          .setComponent(ComponentName(this, MainActivity::class.java))
          .addFlags(forward.flags)
      )
    } catch (error: Exception) {
      Log.w("PackSafeLaunch", "shortcut forward failed", error)
    }
    finish()
  }
}
