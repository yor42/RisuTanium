/**
 * The shipped capability files grant nothing to remote origins, keep the process tools on desktop targets only,
 * and the tracked schema mirrors them.
 *
 * Reads the real capability files and the schema the build writes. Tests titled `guard:` pass with or without
 * the split and pin behaviour that must be preserved.
 */
import { describe, test, expect } from 'vitest'

type Permission = string | { identifier: string, allow?: unknown[] }
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

    test('guard: what applies to Android keeps shell open and the data folder scope', () => {
        const android = capabilities.filter(appliesToAndroid)
        const ids = android.flatMap((capability) => capability.permissions.map(idOf))
        expect(ids).toContain('shell:allow-open')
        const scopes = android.flatMap((capability) => capability.permissions)
            .filter((permission): permission is Exclude<Permission, string> => typeof permission !== 'string' && permission.identifier === 'fs:scope')
        const allowed = scopes.flatMap((scope) => (scope.allow ?? []).filter((entry): entry is string => typeof entry === 'string'))
        expect(allowed).toContain('/data/**/*')
    })

    test('guard: the tracked schema mirrors each source capability', () => {
        expect(Object.keys(schema).sort()).toEqual(capabilities.map((capability) => capability.identifier).sort())
        for (const capability of capabilities) {
            expect(schema[capability.identifier], capability.identifier).toEqual({ description: '', local: true, ...capability })
        }
    })
})
