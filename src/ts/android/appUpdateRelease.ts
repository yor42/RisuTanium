/**
 * The Android release description, `latest-android.json` version 1. This file owns the definition; the release
 * producer must emit exactly this, and installed builds enforce it for good.
 *
 * The asset is a JSON object `{version, versionCode, notes, url, size}`, in that key order, ending in a newline:
 * - `version`: a string of 1..64 characters, shown to the person as text.
 * - `versionCode`: an integer in 1..2100000000. It is `major*1000000 + minor*1000 + patch`; an update is offered only
 *   when it is higher than the installed one.
 * - `notes`: a string of release notes, shown as text; absent means empty.
 * - `url`: a string of 1..2048 characters naming the APK, for example
 *   `https://github.com/yor42/RisuTanium/releases/download/v0.2.0/RisuTanium_0.2.0_android-universal.apk`. The native
 *   side is the authority on which URLs it accepts; the shared `urls.txt` fixture pins that rule.
 * - `size`: the APK's exact byte length, an integer in 1..2000000000.
 *
 * Unknown keys are ignored and the meaning of these fields never changes under this asset name. A new format gets a
 * new asset name. The bounds equal `contract.properties` of the `app-update-v1` fixtures, which only grow by new
 * directories.
 */

/** The release asset this schema describes. */
export const ANDROID_RELEASE_ASSET = 'latest-android.json'

export const ANDROID_RELEASE_JSON_MAX_BYTES = 262144
export const ANDROID_RELEASE_APK_MAX_BYTES = 2_000_000_000
export const ANDROID_RELEASE_VERSION_CODE_MAX = 2_100_000_000
export const ANDROID_RELEASE_URL_MAX = 2048
export const ANDROID_RELEASE_VERSION_MAX_CHARS = 64

export interface AndroidRelease {
    version: string
    versionCode: number
    notes: string
    url: string
    size: number
}

function isIntegerIn(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}

/** The release the text describes, or null when it is not a well-formed v1 description. Every field is untrusted. */
export function parseAndroidRelease(text: string): AndroidRelease | null {
    if (typeof text !== 'string' || new TextEncoder().encode(text).length > ANDROID_RELEASE_JSON_MAX_BYTES) {
        return null
    }
    let parsed: unknown
    try {
        parsed = JSON.parse(text)
    } catch {
        return null
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return null
    }
    const raw = parsed as Record<string, unknown>
    const { version, versionCode, notes, url, size } = raw
    if (typeof version !== 'string' || version.length < 1 || version.length > ANDROID_RELEASE_VERSION_MAX_CHARS) {
        return null
    }
    if (!isIntegerIn(versionCode, 1, ANDROID_RELEASE_VERSION_CODE_MAX)) {
        return null
    }
    if (!isIntegerIn(size, 1, ANDROID_RELEASE_APK_MAX_BYTES)) {
        return null
    }
    if (notes !== undefined && typeof notes !== 'string') {
        return null
    }
    if (typeof url !== 'string' || url.length < 1 || url.length > ANDROID_RELEASE_URL_MAX) {
        return null
    }
    return { version, versionCode, notes: notes ?? '', url, size }
}

/** A byte count for the person, in decimal units: `280.0 MB`. */
export function formatDownloadSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 0) {
        return '0 B'
    }
    if (bytes < 1000) {
        return `${Math.round(bytes)} B`
    }
    if (bytes < 1_000_000) {
        return `${(bytes / 1000).toFixed(1)} kB`
    }
    if (bytes < 1_000_000_000) {
        return `${(bytes / 1_000_000).toFixed(1)} MB`
    }
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`
}
