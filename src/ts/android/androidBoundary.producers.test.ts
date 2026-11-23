/**
 * The page keys the Android native side serves, against the shared boundary fixture. The capability file equals
 * the fixture, the real key producers give keys inside the set, and the measurement build's scratch key (seen on
 * the wire while the real bench function runs) is inside the set and under neither `assets/` nor `inlays/`.
 *
 * Tests titled `guard:` pass with or without the fix; the capability and bench-key tests fail without it.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import androidBoundary from '../../../src-tauri/tests/fixtures/android-boundary.json'
import { installTauriWire, keyInsideAndroidStore, type TauriWire } from 'src/ts/storage/tests/tauriWireFake'

let wire: TauriWire

beforeEach(() => {
    wire = installTauriWire({ os: 'android' })
})

afterEach(() => {
    wire.uninstall()
})

interface ScopeEntry {
    identifier: string
    allow?: string[]
    deny?: string[]
}

interface CapabilityFile {
    identifier: string
    platforms?: string[]
    permissions: (string | ScopeEntry)[]
}

function androidCapability(): CapabilityFile | undefined {
    return ['android.json']
        .map((name) => resolve(__dirname, '../../../src-tauri/capabilities', name))
        .map((path) => {
            try {
                return JSON.parse(readFileSync(path, 'utf8')) as CapabilityFile
            } catch {
                return undefined
            }
        })[0]
}

describe('the Android capability and the boundary fixture', () => {
    test('the Android capability is present and its fs scope allows exactly the fixture directories', () => {
        const capability = androidCapability()
        expect(capability, 'src-tauri/capabilities/android.json').toBeDefined()
        const scope = capability!.permissions.find((entry): entry is ScopeEntry => typeof entry !== 'string' && entry.identifier === 'fs:scope')
        expect(scope).toBeDefined()
        expect([...(scope!.allow ?? [])].sort()).toEqual(
            androidBoundary.directories.flatMap((directory) => [`$APPDATA/${directory}`, `$APPDATA/${directory}/**/*`]).sort(),
        )
    })

    test('the Android capability grants exactly the read-only fs commands the fixture lists', () => {
        const capability = androidCapability()
        expect(capability, 'src-tauri/capabilities/android.json').toBeDefined()
        const granted = capability!.permissions
            .filter((entry): entry is string => typeof entry === 'string' && entry.startsWith('fs:'))
            .map((id) => id.slice('fs:allow-'.length).replace(/-/g, '_'))
            .sort()
        expect(granted).toEqual(Object.keys(androidBoundary.androidFsCommands).sort())
    })
})

describe('the keys the fixture and the real producers give', () => {
    test('guard: every fixture key is inside the set and every outside first segment is not', () => {
        for (const group of Object.values(androidBoundary.keys)) {
            for (const key of group) {
                expect(keyInsideAndroidStore(key), key).toBe(true)
            }
        }
        for (const segment of androidBoundary.outsideStoreFirstSegments) {
            expect(keyInsideAndroidStore(segment), segment).toBe(false)
            expect(keyInsideAndroidStore(`${segment}/x`), `${segment}/x`).toBe(false)
        }
    })

    test('guard: the keys the real functions and constants produce lie inside the set', async () => {
        const blocks = await import('src/ts/storage/blockKeys')
        const store2 = await import('src/ts/storage/store2/format/keys')
        const inlays = await import('src/ts/process/files/inlayKeys')
        const owner = await import('src/ts/storage/store2/ownerStore')
        const age = await import('src/ts/storage/store2/gc/unitAge')
        const consent = await import('src/ts/network/privateNetworkConsent')
        const grants = await import('src/ts/process/mcp/toolGrants')
        const openrouter = await import('src/ts/model/modelData/openrouterData')
        const litellm = await import('src/ts/model/modelData/litellmData')
        const providers = await import('src/ts/model/modelData/providerListData')
        const cold = await import('src/ts/process/coldUnitLocation')

        const meta = inlays.inlayMetaKey('picture')
        const body = inlays.inlayBodyKey('picture', inlays.newBodyToken())
        expect(meta).not.toBeNull()
        expect(body).not.toBeNull()
        const stagingId = store2.newStagingId()
        const produced: [string, string][] = [
            ['blocks head', blocks.HEAD_KEY],
            ['blocks prefix', `${blocks.BLOCKS_PREFIX}0123456789abcdef/root`],
            ['legacy main file', blocks.LEGACY_MAIN_FILE_KEY],
            ['pre-blocks copy', blocks.PRE_BLOCKS_PREFIX],
            ['numbered backup', `${blocks.NUMBERED_BACKUP_PREFIX}3.bin`],
            ['store2 commit', store2.COMMIT_KEY],
            ['store2 sweep', store2.SWEEP_KEY],
            ['store2 fence', store2.FENCE_KEY],
            ['store2 owner', owner.OWNER_KEY],
            ['store2 gc age', age.GC_AGE_KEY],
            ['store2 manifest', store2.newManifestKey()],
            ['store2 shard', store2.newShardKey()],
            ['store2 unit', store2.newUnitKey()],
            ['store2 staged shard', store2.newStagedKey(stagingId, 's')],
            ['store2 staged unit', store2.newStagedKey(stagingId, 'u')],
            ['store2 staged manifest', store2.newStagedManifestKey(stagingId)],
            ['inlay meta', meta!],
            ['inlay body', body!],
            ['private network consent', consent.NATIVE_PRIVATE_NETWORK_KEY],
            ['workspace tool grants', grants.WORKSPACE_TOOL_GRANTS_KEY],
            ['openrouter data', openrouter.OPENROUTER_DATA_KEY],
            ['litellm data', litellm.LITELLM_DATA_KEY],
            ['provider lists', providers.PROVIDER_LISTS_KEY],
            ['cold unit', cold.coldUnitStoreKey('0123456789abcdef')],
        ]
        for (const [name, key] of produced) {
            expect(keyInsideAndroidStore(key), `${name}: ${key}`).toBe(true)
        }
    })
})

describe('the measurement build scratch key', () => {
    test('is inside the set and under neither assets nor inlays', async () => {
        const { installImportBench } = await import('src/ts/drive/importBench')
        const bench = installImportBench({})

        await bench.run(new File([], 'empty.bin'), { windows: [], smallReads: 0, ipcSizes: [16], ipcCalls: 1 })

        const keys = wire.calls.flatMap((call) => {
            const header = call.headers?.['x-risu-key']
            const named = (call.args as { key?: unknown } | undefined)?.key
            return [typeof header === 'string' ? decodeURIComponent(header) : undefined, typeof named === 'string' ? named : undefined]
        }).filter((key): key is string => key !== undefined)
        expect(keys.length, 'the bench sent no keyed command').toBeGreaterThan(0)
        for (const key of keys) {
            expect(keyInsideAndroidStore(key), `scratch key ${key}`).toBe(true)
            expect(key.startsWith('assets/') || key.startsWith('inlays/'), `scratch key ${key} lies under assets or inlays`).toBe(false)
        }
    })
})
