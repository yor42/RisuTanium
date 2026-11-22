package io.github.yor42.risutanium

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AppUpdateEndpointsTest {
  @Test
  fun aLoopbackOriginWithAPortIsAccepted() {
    assertTrue(AppUpdateEndpoints.accept("http://127.0.0.1:8765"))
    assertTrue(AppUpdateEndpoints.accept("http://127.0.0.1:80"))
    assertTrue(AppUpdateEndpoints.accept("http://127.0.0.1:65535"))
  }

  @Test
  fun anythingElseIsRefused() {
    assertFalse(AppUpdateEndpoints.accept("https://127.0.0.1:8765"))
    assertFalse(AppUpdateEndpoints.accept("http://localhost:8765"))
    assertFalse(AppUpdateEndpoints.accept("http://127.0.0.1:8765/x"))
    assertFalse(AppUpdateEndpoints.accept("http://127.0.0.1:8765/"))
    assertFalse(AppUpdateEndpoints.accept("http://10.0.2.2:8765"))
    assertFalse(AppUpdateEndpoints.accept("http://127.0.0.1"))
    assertFalse(AppUpdateEndpoints.accept("http://127.0.0.1:8"))
    assertFalse(AppUpdateEndpoints.accept("http://127.0.0.1:123456"))
    assertFalse(AppUpdateEndpoints.accept("http://127.0.0.1:8765@evil.example"))
    assertFalse(AppUpdateEndpoints.accept("http://127.0.0.10:8765"))
    assertFalse(AppUpdateEndpoints.accept("http://127x0y0z1:8765"))
    assertFalse(AppUpdateEndpoints.accept("http://user@127.0.0.1:8765"))
    assertFalse(AppUpdateEndpoints.accept("http://127.0.0.1:8765\n"))
    assertFalse(AppUpdateEndpoints.accept(""))
  }

  @Test
  fun aCompiledValueIsAUsableOriginOnlyWhenItIsAcceptedAndNotEmpty() {
    assertEquals("http://127.0.0.1:8765", AppUpdateEndpoints.configuredFrom("http://127.0.0.1:8765"))
    assertNull(AppUpdateEndpoints.configuredFrom(""))
    assertNull(AppUpdateEndpoints.configuredFrom("http://localhost:8765"))
    assertNull(AppUpdateEndpoints.configuredFrom("https://github.com"))
  }

  @Test
  fun theMarkerIsTheNameTheReleaseScanLooksFor() {
    assertEquals("risu-update-test-origin", AppUpdateEndpoints.MARKER)
  }
}
