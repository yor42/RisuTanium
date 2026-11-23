import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// The update APK is verified in cache/app-update and then read by the system installer. The Android fs scope
// allows only the store directories under the data directory, and these denies stay as a second layer, so script
// in the page cannot rename or rewrite the verified file in between (MC-3609). The guarantee is layered: the
// capability grants no write command, the scope and these denies stop path-form fs commands, the fs gate refuses
// file:// URLs (tauri-plugin-fs alone skips the scope for them on Android), the native job seals the file read-only
// before verifying it, and the random file name is never sent to the page. Both path forms are denied because
// /data/user/0 is a link to /data/data, and the cache directory itself is denied so it cannot be renamed away with
// app-update inside it.

interface FsScopeEntry {
    identifier: string
    allow?: string[]
    deny?: string[]
}

interface CapabilityFile {
    platforms?: string[]
    permissions: (string | FsScopeEntry)[]
}

const directory = resolve(__dirname, '../../../src-tauri/capabilities')
const capabilities = readdirSync(directory)
    .filter((name) => name.endsWith('.json'))
    .map((name) => JSON.parse(readFileSync(resolve(directory, name), 'utf8')) as CapabilityFile)
    .filter((file) => !file.platforms || file.platforms.includes('android'))

const permissions = capabilities.flatMap((file) => file.permissions)
const permissionIds = permissions.map((entry) => typeof entry === 'string' ? entry : entry.identifier)
const scopes = permissions.filter((entry): entry is FsScopeEntry => typeof entry !== 'string' && entry.identifier === 'fs:scope')
const allowed = scopes.flatMap((scope) => scope.allow ?? [])
const denied = scopes.flatMap((scope) => scope.deny ?? [])

describe('the page fs scope keeps out of the update folder', () => {
    test('the fs scope allows the store directories and no wide data tree', () => {
        expect(allowed).toContain('$APPDATA/assets/**/*')
        for (const entry of allowed) {
            expect(entry, entry).not.toMatch(/^\/data/)
            expect(['$APPDATA', '$APPDATA/*', '$APPDATA/**/*'], entry).not.toContain(entry)
        }
    })

    test.each([
        '/data/user/*/io.github.yor42.risutanium/cache',
        '/data/user/*/io.github.yor42.risutanium/cache/app-update',
        '/data/user/*/io.github.yor42.risutanium/cache/app-update/**',
        '/data/data/io.github.yor42.risutanium/cache',
        '/data/data/io.github.yor42.risutanium/cache/app-update',
        '/data/data/io.github.yor42.risutanium/cache/app-update/**',
    ])('denies %s', (pattern) => {
        expect(denied).toContain(pattern)
    })

    // Without the fs gate, file:///proc/self/fd/<n> would reach the update file while it downloads, outside the scope
    // (MC-3611). As a further layer, the page has no command that writes through a held handle.
    test.each([
        'fs:allow-write', 'fs:allow-ftruncate', 'fs:write-all', 'fs:allow-truncate',
        'fs:allow-write-file', 'fs:allow-rename', 'fs:allow-remove', 'fs:allow-mkdir', 'fs:allow-create', 'fs:allow-copy-file',
        'fs:default', 'dialog:allow-open',
    ])('grants no write, change or open-anything permission %s', (permission) => {
        expect(permissionIds).not.toContain(permission)
    })

    test('the denied folder is the one the native side writes to', () => {
        const paths = readFileSync(resolve(__dirname, '../../../src-tauri/gen/android/app/src/main/res/xml/file_paths.xml'), 'utf8')
        expect(paths).toContain('<cache-path name="app_update" path="app-update/" />')
    })
})
