package io.github.yor42.risutanium

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OwnProviderPolicyTest {
  @Test
  fun aCallFromTheOwnUidIsRefused() {
    assertFalse(ownProviderCallAllowed(10234, 10234))
  }

  @Test
  fun theOwnUidIsRefusedWhateverItsValue() {
    for (own in listOf(0, 1000, 10001, 10234, 19999)) {
      assertFalse("own uid $own", ownProviderCallAllowed(own, own))
    }
  }

  @Test
  fun aCallFromAnotherUidIsServed() {
    assertTrue(ownProviderCallAllowed(10235, 10234))
    assertTrue(ownProviderCallAllowed(10233, 10234))
  }

  @Test
  fun rootAndSystemAreServedWhenTheyAreNotTheOwnUid() {
    assertTrue(ownProviderCallAllowed(0, 10234))
    assertTrue(ownProviderCallAllowed(1000, 10234))
  }
}
