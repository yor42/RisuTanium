// @vitest-environment happy-dom

/**
 * Preset ids through the real `botpreset.svelte` and the real `database.svelte`: every creation site (the Add button,
 * `copyPreset`, the four import pushes, the `prompt.ts` conversion push, the default list and `makeDefaultPreset`) gives
 * the preset a fresh id and never an id, folder or slot a source carried; a page save and a switch keep the meta of the
 * entry they rebuild; a single-preset export carries none of it. Titles beginning "guard:" hold before and after the change.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import * as fflate from 'fflate'
import { encode as encodeMsgpack } from 'msgpackr/index-no-eval'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { botPreset, Database } from 'src/ts/storage/database.svelte'
import type { RisuEnvironmentLabel } from 'src/ts/platform'

//#region module mocks

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), async () => {
    const stub: Record<string, unknown> = {
        forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
        getFileSrc: vi.fn(async (loc: string) => `data:mock-image;loc=${loc}`),
        checkCharOrder: vi.fn(),
        requiresFullEncoderReload: { state: false },
        AppendableBuffer: class {}, VirtualWriter: class {}, LocalWriter: class {}, BlankWriter: class {},
        downloadFile: vi.fn(async () => true), saveAsset: vi.fn(), readImage: vi.fn(), toGetter: vi.fn((o: unknown) => o),
        aiWatermarkingLawApplies: vi.fn(() => false), aiLawApplies: vi.fn(() => false),
        hubURL: '',
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/globalApi.svelte')
})

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/storage/database.svelte'), async (importOriginal) => {
    const actual = await importOriginal()
    const { DBState } = await import('src/ts/stores.svelte')
    return { ...actual, getDatabase: vi.fn((_o?: { snapshot?: boolean }) => DBState.db) }
})

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false, isNodeServer: false, isIOS: () => false,
    getDetailedOSLabel: vi.fn(async () => 'test-os'), getFallbackOSLabel: vi.fn(() => 'test-os'),
    getRisuEnvironmentLabel: vi.fn((): RisuEnvironmentLabel => 'web'),
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(),
    remove: vi.fn(), readDir: vi.fn(async () => []), BaseDirectory: { AppData: 0 },
}))

vi.mock('src/ts/tokenizer', () => ({ tokenizeAccurate: vi.fn(async () => 0) }))

// The pack's byte map is fetched from the dev server; the identity pack keeps the export and import chains symmetric.
vi.mock('src/ts/rpack/rpack_js', () => ({
    encodeRPack: vi.fn(async (data: Uint8Array) => data),
    decodeRPack: vi.fn(async (data: Uint8Array) => data),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        MobileGUIStack: writable([]), CharEmotion: writable(new Map()),
        OpenRealmStore: writable({ isOpen: false }), MobileSearch: writable(''),
        alertStore: writable({ type: 'none', msg: '' }),
        selIdState: { state: -1 }, SettingsMenuIndex: writable(0), ShowRealmFrameStore: writable(false),
        settingsOpen: writable(false), botMakerMode: writable(false), DynamicGUI: writable(false),
        sideBarClosing: writable(false), sideBarStore: writable({ tab: 0 }), PlaygroundStore: writable({ open: false }),
        QuickSettings: writable([]), additionalHamburgerMenu: writable([]), CharConfigSubMenu: writable(0),
        MobileGUI: writable(false), hypaV3ModalOpen: writable(false), ReloadGUIPointer: writable(0),
        bookmarkListOpen: writable(false), alertGenerationInfoStore: writable(null),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characterCards'), () => ({
    openRealmUpload: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock('src/lib/Others/PromptDiffModal.svelte', () => ({ default: () => {} }))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import BotPreset from './botpreset.svelte'
import {
    changeToPreset, copyPreset, downloadPreset, importPreset, presetTemplate, saveCurrentPreset, setDatabase,
} from 'src/ts/storage/database.svelte'
import { takePresetIdsMinted } from 'src/ts/storage/presetMeta'
import { encryptBuffer } from 'src/ts/util'
import { encodeRPack } from 'src/ts/rpack/rpack_js'
import { promptConvertion } from 'src/ts/process/prompt'
import { makeDefaultPreset } from 'src/ts/storage/treeToBlockSet'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

/** Presets `P0..` carrying meta, with the live settings of the selected one. */
function installDb(count: number, selected = 0): void {
    DBState.db = {
        formatversion: 5,
        botPresets: Array.from({ length: count }, (_, n) => ({
            name: `P${n}`, aiModel: `m${n}`, id: `id-${n}`, folderId: n === 1 ? 'F1' : undefined, slot: n + 1,
        })),
        botPresetsId: selected,
        aiModel: `m${selected}`,
        presetFolders: [{ id: 'F1', name: 'One' }],
        NAIsettings: {},
        showPromptComparison: false,
    } as unknown as Database
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function mountPresets(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BotPreset, { target, props: { close: vi.fn() } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    takePresetIdsMinted()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    delete (presetTemplate as botPreset).id
    vi.restoreAllMocks()
})

/** A preset file as upstream `downloadPreset` writes it from a preset that carried meta, with meta kept. */
function foreignFile(): Record<string, unknown> {
    return { name: 'Foreign', temperature: 55, mainPrompt: 'm', jailbreak: 'j', formatingOrder: ['main'], aiModel: 'x', apiType: 'x', id: 'foreign-id', folderId: 'foreign-folder', slot: 3 }
}

describe('setDatabase', () => {
    test('A1 presets without meta get pairwise distinct string ids that a second call keeps', () => {
        const data = { botPresets: [{ name: 'a' }, { name: 'b' }, { name: 'c' }], botPresetsId: 0 } as unknown as Database
        setDatabase(data)
        const first = data.botPresets.map((p) => p.id)
        expect(first.every((id) => typeof id === 'string' && id !== '')).toBe(true)
        expect(new Set(first).size).toBe(3)
        expect(data.presetFolders).toEqual([])
        expect(takePresetIdsMinted()).toBe(true)
        setDatabase(data)
        expect(data.botPresets.map((p) => p.id)).toEqual(first)
        expect(takePresetIdsMinted()).toBe(false)
    })

    test('A13 a database without presets gets its own default preset, never the shared template', () => {
        const data = { botPresetsId: 0 } as unknown as Database
        setDatabase(data)
        expect(data.botPresets).toHaveLength(1)
        expect(data.botPresets[0]).not.toBe(presetTemplate)
        expect(data.botPresets[0].name).toBe('Default')
        expect(presetTemplate.name).toBe('New Preset')
        expect(typeof data.botPresets[0].id).toBe('string')
        expect(presetTemplate.id).toBeUndefined()
    })

    test('guard: ids a profile already holds are untouched and nothing is marked', () => {
        const data = { botPresets: [{ name: 'a', id: 'x' }, { name: 'b', id: 'y', slot: 2, folderId: 'F' }], botPresetsId: 0 } as unknown as Database
        setDatabase(data)
        expect(data.botPresets.map((p) => p.id)).toEqual(['x', 'y'])
        expect(data.botPresets[1]).toMatchObject({ slot: 2, folderId: 'F' })
        expect(takePresetIdsMinted()).toBe(false)
    })
})

describe('a page save and a switch', () => {
    test('A3 changeToPreset keeps the id, folder and slot of the entry it leaves', () => {
        installDb(3, 1)
        changeToPreset(0)
        expect(DBState.db.botPresets[1]).toMatchObject({ id: 'id-1', folderId: 'F1', slot: 2 })
        expect(DBState.db.botPresets[0]).toMatchObject({ id: 'id-0', slot: 1 })
        expect(DBState.db.botPresetsId).toBe(0)
    })

    test('A3 a save keeps the list order, the rebuilt settings and the id of the entry', () => {
        installDb(3, 2)
        DBState.db.temperature = 42
        saveCurrentPreset()
        expect(DBState.db.botPresets.map((p) => p.name)).toEqual(['P0', 'P1', 'P2'])
        expect(DBState.db.botPresets[2].temperature).toBe(42)
        expect(DBState.db.botPresets[2].id).toBe('id-2')
    })
})

describe('creation sites', () => {
    test('A5 a copy gets a new id and no slot, and keeps the folder', () => {
        installDb(3, 0)
        copyPreset(1)
        const copy = DBState.db.botPresets[3]
        expect(copy.name).toBe('P1 Copy')
        expect(typeof copy.id).toBe('string')
        expect(copy.id).not.toBe('id-1')
        expect(copy.slot).toBeUndefined()
        expect(copy.folderId).toBe('F1')
        expect(DBState.db.botPresets[1]).toMatchObject({ id: 'id-1', slot: 2, folderId: 'F1' })
    })

    test('A10 the Add button gives the new preset an id, and no slot or folder', async () => {
        installDb(2, 0)
        const target = mountPresets()
        const add = target.querySelector('div.flex.mt-2.items-center > button.mr-1') as HTMLElement
        add.click()
        await settle()
        const added = DBState.db.botPresets[2]
        expect(typeof added.id).toBe('string')
        expect(added.id).not.toMatch(/^id-/)
        expect(added.slot).toBeUndefined()
        expect(added.folderId).toBeUndefined()
    })

    test('A6 a json file that carries id, folder and slot is imported with fresh meta', async () => {
        installDb(1, 0)
        const data = new TextEncoder().encode(JSON.stringify(foreignFile(), null, 2))
        await importPreset({ name: 'foreign_preset.json', data })
        const imported = DBState.db.botPresets[1]
        expect(imported.name).toBe('Foreign')
        expect(imported.id).not.toBe('foreign-id')
        expect(typeof imported.id).toBe('string')
        expect(imported.folderId).toBeUndefined()
        expect(imported.slot).toBeUndefined()
    })

    test('A6 a .risup file that carries id, folder and slot is imported with fresh meta', async () => {
        installDb(1, 0)
        const body = fflate.compressSync(encodeMsgpack({
            presetVersion: 2,
            type: 'preset',
            preset: await encryptBuffer(encodeMsgpack(foreignFile()), 'risupreset'),
        }))
        const data = await encodeRPack(body)
        await importPreset({ name: 'foreign_preset.risup', data })
        const imported = DBState.db.botPresets[1]
        expect(imported.name).toBe('Foreign')
        expect(imported.id).not.toBe('foreign-id')
        expect(typeof imported.id).toBe('string')
        expect(imported.folderId).toBeUndefined()
        expect(imported.slot).toBeUndefined()
    })

    test('A6 a SillyTavern chat preset and a SillyTavern system prompt are imported with fresh meta', async () => {
        installDb(1, 0)
        const chat = {
            prompts: [{ identifier: 'main', name: 'Main', role: 'system', content: 'hello', system_prompt: true }],
            prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
        }
        await importPreset({ name: 'chat.json', data: new TextEncoder().encode(JSON.stringify(chat)) })
        await importPreset({ name: 'sys.json', data: new TextEncoder().encode(JSON.stringify({ name: 'Sys', content: 'be brief' })) })
        expect(DBState.db.botPresets).toHaveLength(3)
        for (const imported of DBState.db.botPresets.slice(1)) {
            expect(typeof imported.id).toBe('string')
            expect(imported.slot).toBeUndefined()
            expect(imported.folderId).toBeUndefined()
        }
        expect(DBState.db.botPresets[1].id).not.toBe(DBState.db.botPresets[2].id)
    })

    test('A15 with a poisoned template every template-derived site still gives a fresh id', async () => {
        installDb(1, 0)
        ;(presetTemplate as botPreset).id = 'poison'
        ;(presetTemplate as botPreset).slot = 9
        ;(presetTemplate as botPreset).folderId = 'poisonFolder'
        try {
            const data = { botPresetsId: 0 } as unknown as Database
            setDatabase(data)
            await importPreset({ name: 'sys.json', data: new TextEncoder().encode(JSON.stringify({ name: 'Sys', content: 'be brief' })) })
            await importPreset({ name: 'plain_preset.json', data: new TextEncoder().encode(JSON.stringify({ name: 'Plain', temperature: 3 })) })
            promptConvertion([{ name: 'conv.json', content: JSON.stringify({ name: 'Sys2', content: 'be short' }), type: 'STSYSPROMPT' }])
            const made = makeDefaultPreset()
            const sites = [data.botPresets[0], DBState.db.botPresets[1], DBState.db.botPresets[2], DBState.db.botPresets[3], made]
            // The default list's first preset takes slot 1 from the one-time slot migration; the
            // poisoned template slot never leaks to any site.
            expect(sites[0].slot).toBe(1)
            for (const [index, site] of sites.entries()) {
                expect(typeof site.id).toBe('string')
                expect(site.id).not.toBe('poison')
                if (index > 0) expect(site.slot).toBeUndefined()
                expect(site.folderId).toBeUndefined()
            }
            expect(new Set(sites.map((site) => site.id)).size).toBe(sites.length)
        } finally {
            delete (presetTemplate as botPreset).id
            delete (presetTemplate as botPreset).slot
            delete (presetTemplate as botPreset).folderId
        }
    })
})

describe('a plain-HTTP page without crypto.subtle', () => {
    const realCrypto = globalThis.crypto

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    function stubNoSubtle(): void {
        vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
        expect((globalThis.crypto as { subtle?: unknown }).subtle).toBeUndefined()
    }

    test('T6 a .risup exported without subtle imports again', async () => {
        installDb(2, 0)
        stubNoSubtle()
        const out = await downloadPreset(1, 'return')
        expect(out.buf).not.toBeNull()
        await importPreset({ name: 'P1_preset.risup', data: out.buf as Uint8Array })
        expect(DBState.db.botPresets).toHaveLength(3)
        expect(DBState.db.botPresets[2].name).toBe('P1')
    })

    test('T7 a .risup made by upstream WebCrypto imports without subtle', async () => {
        installDb(1, 0)
        // Upstream's exact producer, run before the stub is installed.
        const keyArray = await realCrypto.subtle.digest('SHA-256', new TextEncoder().encode('risupreset'))
        const key = await realCrypto.subtle.importKey('raw', keyArray, 'AES-GCM', false, ['encrypt', 'decrypt'])
        const sealed = new Uint8Array(await realCrypto.subtle.encrypt({ name: 'AES-GCM', iv: new Uint8Array(12) }, key, encodeMsgpack(foreignFile())))
        const body = fflate.compressSync(encodeMsgpack({ presetVersion: 2, type: 'preset', preset: sealed }))
        const data = await encodeRPack(body)
        stubNoSubtle()
        await importPreset({ name: 'foreign_preset.risup', data })
        expect(DBState.db.botPresets[1].name).toBe('Foreign')
    })
})

describe('a single-preset export', () => {
    test('A7 downloadPreset leaves out id, folder and slot, and the stored preset keeps them', async () => {
        installDb(2, 0)
        const out = await downloadPreset(1, 'return')
        expect(out.data).not.toHaveProperty('id')
        expect(out.data).not.toHaveProperty('folderId')
        expect(out.data).not.toHaveProperty('slot')
        expect(out.data.name).toBe('P1')
        expect(DBState.db.botPresets[1]).toMatchObject({ id: 'id-1', folderId: 'F1', slot: 2 })
    })
})
