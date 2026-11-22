/**
 * The v1 `latest-android.json` parser. Installed builds enforce these bounds for good, so each rule has a row; the
 * accepted sample is an inline literal in the producer's key order, and the bounds are compared with the frozen
 * `contract.properties` fixture. Unknown keys are ignored, so a later producer may add fields.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
    ANDROID_RELEASE_APK_MAX_BYTES,
    ANDROID_RELEASE_ASSET,
    ANDROID_RELEASE_JSON_MAX_BYTES,
    ANDROID_RELEASE_URL_MAX,
    ANDROID_RELEASE_VERSION_CODE_MAX,
    ANDROID_RELEASE_VERSION_MAX_CHARS,
    formatDownloadSize,
    parseAndroidRelease,
} from './appUpdateRelease'

const URL_OK = 'https://github.com/yor42/RisuTanium/releases/download/v0.2.0/RisuTanium_0.2.0_android-universal.apk'
const SAMPLE = `{"version":"0.2.0","versionCode":2000,"notes":"Notes","url":"${URL_OK}","size":280000000}\n`

function sampleWith(change: Record<string, unknown>): string {
    return JSON.stringify({ ...JSON.parse(SAMPLE), ...change })
}

function without(key: string): string {
    const value = JSON.parse(SAMPLE) as Record<string, unknown>
    delete value[key]
    return JSON.stringify(value)
}

describe('parseAndroidRelease accepts a well-formed v1 file', () => {
    test('the producer-shaped literal parses to its five fields', () => {
        expect(parseAndroidRelease(SAMPLE)).toEqual({ version: '0.2.0', versionCode: 2000, notes: 'Notes', url: URL_OK, size: 280000000 })
    })

    test('absent notes read as an empty string', () => {
        expect(parseAndroidRelease(without('notes'))?.notes).toBe('')
    })

    test('unknown keys are ignored, a schema key included', () => {
        expect(parseAndroidRelease(sampleWith({ schema: 2, extra: { a: 1 } }))).toEqual(parseAndroidRelease(SAMPLE))
    })

    test('size exactly 2,000,000,000 and versionCode exactly 2,100,000,000 are accepted', () => {
        expect(parseAndroidRelease(sampleWith({ size: 2_000_000_000 }))?.size).toBe(2_000_000_000)
        expect(parseAndroidRelease(sampleWith({ versionCode: 2_100_000_000 }))?.versionCode).toBe(2_100_000_000)
        expect(parseAndroidRelease(sampleWith({ size: 1, versionCode: 1 }))).not.toBeNull()
    })

    test('a version of 64 characters and a url of 2048 characters are accepted', () => {
        expect(parseAndroidRelease(sampleWith({ version: 'v'.repeat(64) }))).not.toBeNull()
        expect(parseAndroidRelease(sampleWith({ url: 'u'.repeat(2048) }))).not.toBeNull()
    })
})

describe('parseAndroidRelease refuses anything else', () => {
    test.each([
        ['not JSON', 'nope'],
        ['an array', '[1]'],
        ['null', 'null'],
        ['a string', '"x"'],
        ['an empty object', '{}'],
    ])('%s', (_name, text) => {
        expect(parseAndroidRelease(text)).toBeNull()
    })

    test.each([
        ['a string versionCode', { versionCode: '2000' }],
        ['a float versionCode', { versionCode: 2000.5 }],
        ['a zero versionCode', { versionCode: 0 }],
        ['a negative versionCode', { versionCode: -1 }],
        ['a versionCode above the maximum', { versionCode: 2_100_000_001 }],
        ['a string size', { size: '280000000' }],
        ['a float size', { size: 1.5 }],
        ['a zero size', { size: 0 }],
        ['a size above 2,000,000,000', { size: 2_000_000_001 }],
        ['an empty version', { version: '' }],
        ['a 65-character version', { version: 'v'.repeat(65) }],
        ['a numeric version', { version: 2 }],
        ['numeric notes', { notes: 7 }],
        ['null notes', { notes: null }],
        ['a numeric url', { url: 5 }],
        ['an empty url', { url: '' }],
        ['a url over 2048 characters', { url: 'u'.repeat(2049) }],
    ])('%s', (_name, change) => {
        expect(parseAndroidRelease(sampleWith(change))).toBeNull()
    })

    test.each(['version', 'versionCode', 'url', 'size'])('a missing %s', (key) => {
        expect(parseAndroidRelease(without(key))).toBeNull()
    })

    test('text over 262144 bytes is refused even when it would otherwise parse', () => {
        const padded = sampleWith({ notes: 'n'.repeat(ANDROID_RELEASE_JSON_MAX_BYTES) })
        expect(parseAndroidRelease(padded)).toBeNull()
    })

    test('the size limit counts bytes, not characters', () => {
        // Three bytes per character: under the limit as characters, over it as bytes.
        const wide = sampleWith({ notes: '가'.repeat(90_000) })
        expect(wide.length).toBeLessThan(ANDROID_RELEASE_JSON_MAX_BYTES)
        expect(parseAndroidRelease(wide)).toBeNull()
    })
})

describe('the constants equal the frozen contract', () => {
    const entries = Object.fromEntries(
        readFileSync(resolve(__dirname, '../../../src-tauri/gen/android/app/src/test/resources/app-update-v1/contract.properties'), 'utf8')
            .split('\n')
            .map((line) => line.replace(/\r$/, ''))
            .filter((line) => line !== '' && !line.startsWith('#'))
            .map((line) => line.split('=') as [string, string]),
    )

    test('every bound matches contract.properties', () => {
        expect(ANDROID_RELEASE_JSON_MAX_BYTES).toBe(Number(entries.jsonMaxBytes))
        expect(ANDROID_RELEASE_APK_MAX_BYTES).toBe(Number(entries.apkMaxBytes))
        expect(ANDROID_RELEASE_VERSION_CODE_MAX).toBe(Number(entries.versionCodeMax))
        expect(ANDROID_RELEASE_URL_MAX).toBe(Number(entries.urlMax))
        expect(ANDROID_RELEASE_VERSION_MAX_CHARS).toBe(Number(entries.versionMaxChars))
        expect(entries.versionCodeMin).toBe('1')
    })

    test('the asset name is latest-android.json', () => {
        expect(ANDROID_RELEASE_ASSET).toBe('latest-android.json')
    })
})

describe('formatDownloadSize', () => {
    test.each([
        [0, '0 B'],
        [999, '999 B'],
        [1500, '1.5 kB'],
        [280_000_000, '280.0 MB'],
        [2_000_000_000, '2.0 GB'],
    ])('%d bytes reads %s', (bytes, text) => {
        expect(formatDownloadSize(bytes)).toBe(text)
    })
})
