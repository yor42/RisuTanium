package io.github.yor42.risutanium

// Debug source set only. The test origin the update check may use instead of the GitHub endpoint,
// compiled in by the debug buildConfigField UPDATE_TEST_ORIGIN (Gradle property risuUpdateTestOrigin).
// Nothing in the release source set refers to it, so no release build can carry a test origin.
object AppUpdateEndpoints {
  const val MARKER = "risu-update-test-origin"

  private val LOOPBACK = Regex("^http://127\\.0\\.0\\.1:[0-9]{2,5}$")

  // Only a loopback origin with a port is accepted: no other host, scheme, path or trailing slash.
  fun accept(origin: String): Boolean = LOOPBACK.matches(origin)

  // An empty or refused value is no test origin, so a debug build without one skips the check.
  fun configuredFrom(value: String): String? = if (value.isNotEmpty() && accept(value)) value else null

  fun configured(): String? = configuredFrom(BuildConfig.UPDATE_TEST_ORIGIN)
}
