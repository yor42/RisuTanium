/**
 * The shipped capability files grant nothing to remote origins, keep the process tools on desktop targets only,
 * let the http scope reach http and https on any port and nothing else, open external links only through the
 * opener's open_url scoped to http, https, mailto and tel (no shell open grant), and the tracked schema mirrors them.
 *
 * Reads the real capability files and the schema the build writes. Tests titled `guard:` pass with or without
 * the split and pin behaviour that must be preserved.
 */
import { describe, test, expect } from 'vitest'
import androidBoundary from '../../src-tauri/tests/fixtures/android-boundary.json'

type Permission = string | { identifier: string, allow?: unknown[], deny?: unknown[] }
type Capability = {
    identifier: string
    description?: string
    local?: boolean
    remote?: unknown
    windows?: string[]
    platforms?: string[]
    permissions: Permission[]
}

const sources = import.meta.glob('/src-tauri/capabilities/*.json', { eager: true, import: 'default' }) as Record<string, Capability>
const schemas = import.meta.glob('/src-tauri/gen/schemas/capabilities.json', { eager: true, import: 'default' }) as Record<string, Record<string, Capability>>

const capabilities = Object.values(sources)
const schema = Object.values(schemas)[0]

const PROCESS_TOOLS = ['shell:allow-spawn', 'shell:allow-kill', 'shell:allow-stdin-write']
const SPAWN_NAMES = ['node', 'npm', 'npx', 'docker', 'uvx']

const idOf = (permission: Permission) => typeof permission === 'string' ? permission : permission.identifier
const appliesToAndroid = (capability: Capability) => !capability.platforms || capability.platforms.includes('android')
const appliesTo = (platform: string) => (capability: Capability) => !capability.platforms || capability.platforms.includes(platform)

const PLATFORMS = ['android', 'windows', 'linux', 'macOS']

const ANDROID_PERMISSIONS = {
    fs: ['fs:allow-fstat', 'fs:allow-open', 'fs:allow-read', 'fs:allow-read-dir', 'fs:allow-seek'],
    dialog: ['dialog:allow-confirm', 'dialog:allow-message', 'dialog:allow-save'],
}
const DESKTOP_PERMISSIONS = {
    fs: [
        'fs:allow-exists', 'fs:allow-fstat', 'fs:allow-mkdir', 'fs:allow-open', 'fs:allow-read', 'fs:allow-read-dir',
        'fs:allow-read-file', 'fs:allow-remove', 'fs:allow-rename', 'fs:allow-seek', 'fs:allow-write-file', 'fs:deny-default',
    ],
    dialog: ['dialog:allow-confirm', 'dialog:allow-message', 'dialog:allow-open', 'dialog:allow-save'],
}
const ANDROID_DENIES = [
    '/data/user/*/io.github.yor42.risutanium/cache',
    '/data/user/*/io.github.yor42.risutanium/cache/app-update',
    '/data/user/*/io.github.yor42.risutanium/cache/app-update/**',
    '/data/data/io.github.yor42.risutanium/cache',
    '/data/data/io.github.yor42.risutanium/cache/app-update',
    '/data/data/io.github.yor42.risutanium/cache/app-update/**',
]

/** Permission identifiers with the prefix that apply to the platform, from every capability file, sorted and without scope entries. */
function effectivePermissions(platform: string, prefix: string): string[] {
    return capabilities.filter(appliesTo(platform))
        .flatMap((capability) => capability.permissions.map(idOf))
        .filter((id) => id.startsWith(prefix) && id !== 'fs:scope')
        .sort()
}

function effectiveScopeEntries(platform: string): { identifier: string, allow?: unknown[], deny?: unknown[] }[] {
    return capabilities.filter(appliesTo(platform))
        .flatMap((capability) => capability.permissions)
        .filter((permission): permission is Exclude<Permission, string> => typeof permission !== 'string' && permission.identifier === 'fs:scope')
}

function effectiveFsScope(platform: string): { allow: string[], deny: string[] } {
    const entries = effectiveScopeEntries(platform) as { allow?: string[], deny?: string[] }[]
    return {
        allow: entries.flatMap((entry) => entry.allow ?? []),
        deny: entries.flatMap((entry) => entry.deny ?? []),
    }
}

describe('capability files', () => {
    test('guard: the files are found and the schema is found', () => {
        expect(capabilities.length).toBeGreaterThan(0)
        expect(schema).toBeDefined()
    })

    test('guard: every capability is local to the main window and declares no remote origin', () => {
        for (const capability of capabilities) {
            expect(capability.local, capability.identifier).not.toBe(false)
            expect('remote' in capability, capability.identifier).toBe(false)
            expect('webviews' in capability, capability.identifier).toBe(false)
            expect(capability.windows, capability.identifier).toEqual(['main'])
        }
    })

    test('no capability that applies to Android grants spawn, kill or stdin-write', () => {
        const android = capabilities.filter(appliesToAndroid)
        expect(android.length).toBeGreaterThan(0)
        for (const capability of android) {
            const ids = capability.permissions.map(idOf)
            for (const tool of PROCESS_TOOLS) {
                expect(ids, `${capability.identifier} ${tool}`).not.toContain(tool)
            }
        }
    })

    test('the desktop capability grants all three with the same program list', () => {
        const desktop = capabilities.find((capability) => capability.identifier === 'desktop-capability')!
        expect(desktop.platforms).not.toContain('android')
        const ids = desktop.permissions.map(idOf)
        for (const tool of PROCESS_TOOLS) {
            expect(ids).toContain(tool)
        }
        const spawn = desktop.permissions.find((permission) => idOf(permission) === 'shell:allow-spawn') as Exclude<Permission, string>
        expect(spawn.allow!.map((entry) => (entry as { name?: unknown }).name)).toEqual(SPAWN_NAMES)
    })

    test('what applies to Android grants the opener open_url', () => {
        const android = capabilities.filter(appliesToAndroid)
        const ids = android.flatMap((capability) => capability.permissions.map(idOf))
        expect(ids).toContain('opener:allow-open-url')
    })

    test('the opener grant is exactly open_url scoped to http, https, mailto and tel', () => {
        const opener = capabilities.flatMap((capability) => capability.permissions.map((permission) => ({ capability, permission })))
            .filter(({ permission }) => idOf(permission).startsWith('opener:'))
        expect(opener).toHaveLength(1)
        const { capability, permission } = opener[0]
        expect(typeof permission).toBe('object')
        const entry = permission as Exclude<Permission, string>
        expect(Object.keys(entry).sort()).toEqual(['allow', 'identifier'])
        expect(entry.identifier).toBe('opener:allow-open-url')
        const allow = entry.allow as { url?: unknown }[]
        for (const item of allow) {
            expect(Object.keys(item)).toEqual(['url'])
        }
        expect(allow.map((item) => item.url).sort()).toEqual(['http://*', 'https://*', 'mailto:*', 'tel:*'])
        const platforms = capability.platforms
        expect(!platforms || ['android', 'windows', 'macOS', 'linux'].every((platform) => platforms.includes(platform))).toBe(true)
    })

    test('the only shell permissions are the desktop process tools', () => {
        // No opener permission can grant a command named `open`, and the shell's `open` is handled
        // in Rust, so neither Kotlin `open` is reachable from JS; this test keeps any shell open grant out.
        const shellIds = capabilities.flatMap((capability) => capability.permissions.map(idOf))
            .filter((id) => id.startsWith('shell:'))
        expect(shellIds.length).toBeGreaterThan(0)
        for (const id of shellIds) {
            expect(PROCESS_TOOLS, id).toContain(id)
        }
    })

    test('what applies to Android allows no wide data tree and no bare AppData', () => {
        const allowed = effectiveFsScope('android').allow
        expect(allowed.length).toBeGreaterThan(0)
        for (const entry of allowed) {
            expect(entry, entry).not.toMatch(/^\/data/)
            expect(['$APPDATA', '$APPDATA/*', '$APPDATA/**/*'], entry).not.toContain(entry)
        }
    })

    test.each(PLATFORMS)('the exact fs and dialog permission lists applying to %s', (platform) => {
        const expected = platform === 'android' ? ANDROID_PERMISSIONS : DESKTOP_PERMISSIONS
        expect(effectivePermissions(platform, 'fs:')).toEqual(expected.fs)
        expect(effectivePermissions(platform, 'dialog:')).toEqual(expected.dialog)
    })

    test('the Android fs scope is the store directories and the six update-folder denies, derived from the boundary fixture', () => {
        const scope = effectiveFsScope('android')
        expect([...scope.allow].sort()).toEqual(
            androidBoundary.directories.flatMap((directory) => [`$APPDATA/${directory}`, `$APPDATA/${directory}/**/*`]).sort(),
        )
        expect([...scope.deny].sort()).toEqual([...ANDROID_DENIES].sort())
        expect(effectiveScopeEntries('android')).toHaveLength(1)
    })

    test.each(['windows', 'linux', 'macOS'])('the %s fs scope is AppData and Downloads only', (platform) => {
        const scope = effectiveFsScope(platform)
        expect([...scope.allow].sort()).toEqual(['$APPDATA', '$APPDATA/*', '$APPDATA/**/*', '$DOWNLOAD/*'].sort())
        expect(effectiveScopeEntries(platform)).toHaveLength(1)
    })

    test('the Android capability is its own file for the android platform only, local to the main window', () => {
        const android = capabilities.find((capability) => capability.identifier === 'android-capability')
        expect(android).toBeDefined()
        expect(android!.platforms).toEqual(['android'])
        expect(android!.windows).toEqual(['main'])
        expect(android!.local).toBe(true)
    })

    test('the tracked schema carries the Android capability as its source reads', () => {
        expect(schema['android-capability']).toEqual({ description: '', local: true, ...capabilities.find((capability) => capability.identifier === 'android-capability') })
    })

    test('the http scope allows http and https on any port and no other scheme', () => {
        const urls = capabilities.flatMap((capability) => capability.permissions)
            .filter((permission): permission is Exclude<Permission, string> => typeof permission !== 'string' && permission.identifier === 'http:default')
            .flatMap((permission) => (permission.allow ?? []).map((entry) => (entry as { url: string }).url))
        expect(urls).toContain('http://*:**')
        expect(urls).toContain('https://*:**')
        for (const url of urls) {
            expect(url, url).toMatch(/^https?:\/\/\*[:/]/)
        }
    })

    test('guard: the tracked schema mirrors each source capability', () => {
        expect(Object.keys(schema).sort()).toEqual(capabilities.map((capability) => capability.identifier).sort())
        for (const capability of capabilities) {
            expect(schema[capability.identifier], capability.identifier).toEqual({ description: '', local: true, ...capability })
        }
    })
})
