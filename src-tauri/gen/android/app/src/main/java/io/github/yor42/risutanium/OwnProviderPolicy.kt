package io.github.yor42.risutanium

// The one rule OwnFileProvider applies to every call that serves or changes data: a call made from this
// app's own process (page loads, plugin-fs, plugin-path) is refused, while other apps are served (the package installer
// holding its read grant, a camera app writing a capture file). Plain Kotlin with no android imports, so the
// rule runs in JVM tests.

internal fun ownProviderCallAllowed(callingUid: Int, ownUid: Int): Boolean = callingUid != ownUid
