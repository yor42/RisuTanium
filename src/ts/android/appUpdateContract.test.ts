/**
 * Freeze pin of the Android update contract, `latest-android.json` v1.
 *
 * Installed builds enforce these bounds and this URL rule for good, so the fixtures never change in place: v1 only grows by new
 * directories, and a new format gets a new asset name and a new fixture directory. The hashes are taken over the LF bytes the
 * repository stores (`.gitattributes` keeps both files LF in every checkout); a changed byte or a CRLF checkout fails here.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const dir = resolve(__dirname, '../../../src-tauri/gen/android/app/src/test/resources/app-update-v1')

const sha256 = (name: string) => createHash('sha256').update(readFileSync(resolve(dir, name))).digest('hex')

describe('app-update-v1 freeze pin', () => {
    test('contract.properties is byte-for-byte the frozen v1 file', () => {
        expect(sha256('contract.properties')).toBe('aaa6ea0956d2866d3aaac66dee92b139952f85760cce7ce296ad57be56e38228')
    })

    test('urls.txt is byte-for-byte the frozen v1 file', () => {
        expect(sha256('urls.txt')).toBe('07d2c10192c60c2da86712492506943b0077f0e68f520445076873986a2b9336')
    })

    test('the fixtures hold LF line endings only', () => {
        for (const name of ['contract.properties', 'urls.txt']) {
            expect(readFileSync(resolve(dir, name)).includes(13)).toBe(false)
        }
    })

    test('contract.properties carries the v1 bounds the client enforces', () => {
        const entries = Object.fromEntries(
            readFileSync(resolve(dir, 'contract.properties'), 'utf8')
                .split('\n')
                .map((line) => line.replace(/\r$/, ''))
                .filter((line) => line !== '' && !line.startsWith('#'))
                .map((line) => line.split('=') as [string, string])
        )
        expect(entries).toEqual({
            jsonMaxBytes: '262144',
            apkMaxBytes: '2000000000',
            versionCodeMin: '1',
            versionCodeMax: '2100000000',
            urlMax: '2048',
            versionMaxChars: '64',
        })
    })
})
