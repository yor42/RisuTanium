import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// The update APK is verified in cache/app-update and then read by the system installer. The page's fs scope
// allows /data/**, so without these denies script in the page could rename or rewrite the verified file in
// between (MC-3609). Both path forms are denied because /data/data is a link to /data/user/0, and the cache
// directory itself is denied so it cannot be renamed away with app-update inside it.

interface FsScopeEntry {
    identifier: string
    allow?: string[]
    deny?: string[]
}

const capability = JSON.parse(readFileSync(resolve(__dirname, '../../../src-tauri/capabilities/migrated.json'), 'utf8')) as { permissions: (string | FsScopeEntry)[] }
const fsScope = capability.permissions.find((entry): entry is FsScopeEntry => typeof entry !== 'string' && entry.identifier === 'fs:scope')

describe('the page fs scope keeps out of the update folder', () => {
    test('the fs scope still allows the data tree the page uses', () => {
        expect(fsScope?.allow).toContain('/data/**/*')
    })

    test.each([
        '/data/user/*/io.github.yor42.risutanium/cache',
        '/data/user/*/io.github.yor42.risutanium/cache/app-update',
        '/data/user/*/io.github.yor42.risutanium/cache/app-update/**',
        '/data/data/io.github.yor42.risutanium/cache',
        '/data/data/io.github.yor42.risutanium/cache/app-update',
        '/data/data/io.github.yor42.risutanium/cache/app-update/**',
    ])('denies %s', (pattern) => {
        expect(fsScope?.deny).toContain(pattern)
    })

    test('the denied folder is the one the native side writes to', () => {
        const paths = readFileSync(resolve(__dirname, '../../../src-tauri/gen/android/app/src/main/res/xml/file_paths.xml'), 'utf8')
        expect(paths).toContain('<cache-path name="app_update" path="app-update/" />')
    })
})
