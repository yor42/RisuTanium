// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        loadedStore: writable(false),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
    isIOS: () => false,
}) as unknown as typeof import('src/ts/platform'))
vi.mock(import('src/ts/process/index.svelte'), async () => {
    const { writable } = await import('svelte/store')
    return { doingChat: writable(false) } as unknown as typeof import('src/ts/process/index.svelte')
})
vi.mock(import('src/ts/alert'), () => ({
    alertError: vi.fn(),
    alertConfirm: vi.fn(async () => true),
}) as unknown as typeof import('src/ts/alert'))
vi.mock(import('src/ts/storage/dbChangeEffects.svelte'), () => ({
    markIdentitySeen: vi.fn(),
}) as unknown as typeof import('src/ts/storage/dbChangeEffects.svelte'))
vi.mock(import('src/ts/characters'), () => ({
    characterFormatUpdate: vi.fn(),
}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: vi.fn(async () => ({
        read: async () => ({ bytes: null, version: null }),
        has: async () => false,
    })),
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { changeToPreset, presetFromWorkingSettings, setPreset, type botPreset, type Database } from 'src/ts/storage/database.svelte'
import { DBState } from 'src/ts/stores.svelte'
import { changeUserPersona } from 'src/ts/persona'
import { PERSONA_OPS } from 'src/ts/storage/store2/fastForward/records'
import type { JsonObject } from 'src/ts/storage/blockFrame'
import { setFastForwardHostForTest } from 'src/ts/storage/store2/fastForward'
import { bootB, ffSetup, ffTeardown, ffWorld, runLoopWorld, runSpyOf, signal, takenBy } from './ffFixtures'
import { until } from './lineFixtures'

/**
 * The preset record's selection change through the real save loop and the page's own `setPreset`,
 * `presetFromWorkingSettings` and `changeToPreset`: two clean switches from one base keep the last saved one and park
 * nothing, and a hand edit of the working settings on either side, saved into the slot a switch leaves, still asks.
 */

beforeEach(() => {
    ffSetup()
    setFastForwardHostForTest(null)
})

afterEach(() => {
    ffTeardown()
})

/** The page's own preset switch, as the preset picker does it: save the working fields into the slot left, then enter the new one. */
function switchPreset(db: Database, to: number): void {
    const from = db.botPresetsId
    const left = db.botPresets[from]
    db.botPresets[from] = presetFromWorkingSettings(db, left.name, left.image ?? '')
    setPreset(db, db.botPresets[to] as botPreset)
    db.botPresetsId = to
}

/** The preset chain of a send: `changeToPreset` over the page's own database. */
function chainSwitch(db: Database, to: number): void {
    const held = DBState.db
    DBState.db = db
    try {
        changeToPreset(to, true)
    } finally {
        DBState.db = held
    }
}

async function world() {
    const base = await ffWorld()
    await base.page.commitEdit((db) => { Reflect.set(db, 'NAIsettings', {}) })
    const b = await bootB(base.memory)
    return { ...base, b, loop: runLoopWorld(b.context, b.db) }
}

function markPresetDirty(loop: ReturnType<typeof runLoopWorld>): void {
    loop.tracker.botPreset = true
    loop.state.dirty = true
    loop.state.due = true
}

describe('two preset switches from one base', () => {
    test('R16 the last saved switch stays: this page keeps its choice, saves it, and the peer\'s next read follows', async () => {
        const { memory, page, b, loop } = await world()
        const run = runSpyOf(b)
        switchPreset(b.db, 2)
        markPresetDirty(loop)
        await page.commitEdit((db) => { switchPreset(db, 1) })
        signal(loop)
        await takenBy(b, memory)
        await until(() => loop.state.saved >= 1, 'the page to save over the peer\'s switch', 8000)
        expect(await run.mock.results[0].value).toEqual({ kind: 'applied' })
        expect(b.peer.asked).toEqual([])
        expect(b.peer.clean).toEqual([])
        expect(b.db.botPresetsId).toBe(2)
        await page.commitEdit((db) => { db.maxContext = 4321 })
        const next = await page.freeze()
        expect(next.db.botPresetsId).toBe(2)
        expect(next.db.maxContext).toBe(4321)
        expect(loop.crashed).toEqual([])
    })

    test('R16h a hand edit of the working settings on this page and a peer switch ask, and keep the hand edit', async () => {
        const { page, b, loop } = await world()
        b.db.temperature = 0.321
        markPresetDirty(loop)
        await page.commitEdit((db) => { switchPreset(db, 1) })
        await until(() => b.peer.asked.length >= 1, 'the question', 8000)
        expect(b.peer.asked[0]).toMatchObject({ reason: 'peer-commit', unsaved: true })
        expect(b.db.temperature).toBe(0.321)
    })

    test('R20 a peer that edited the working settings and then switched has saved the edit into the slot it left: this page\'s own switch asks, and the store keeps the peer\'s edited preset', async () => {
        const { page, b, loop } = await world()
        switchPreset(b.db, 2)
        markPresetDirty(loop)
        await page.commitEdit((db) => {
            db.temperature = 0.987
            switchPreset(db, 1)
        })
        await until(() => b.peer.asked.length >= 1, 'the question', 8000)
        expect(b.db.botPresetsId).toBe(2)
        const read = await page.freeze()
        expect(read.db.botPresets[0].temperature).toBe(0.987)
        expect(read.db.botPresetsId).toBe(1)
    })

    test('R20c the same through the preset chain of a send: a hand edit then a chained switch on one page, a chained switch on the other, asks', async () => {
        const { page, b, loop } = await world()
        chainSwitch(b.db, 2)
        markPresetDirty(loop)
        await page.commitEdit((db) => {
            db.temperature = 0.987
            chainSwitch(db, 1)
        })
        await until(() => b.peer.asked.length >= 1, 'the question', 8000)
        expect(b.db.botPresetsId).toBe(2)
        const read = await page.freeze()
        expect(read.db.botPresets[0].temperature).toBe(0.987)
    })
})

/** The page's own persona switch, through the real `changeUserPersona` over `db`. */
function switchPersona(db: Database, to: number): void {
    const held = DBState.db
    DBState.db = db
    try {
        changeUserPersona(to)
    } finally {
        DBState.db = held
    }
}

describe('two persona switches from one base', () => {
    test('R20p a peer that edited the working persona and then switched has saved the edit into the slot it left: this page\'s own switch asks', async () => {
        const { page, b, loop } = await world()
        switchPersona(b.db, 2)
        loop.tracker.botPreset = true
        loop.state.dirty = true
        loop.state.due = true
        await page.commitEdit((db) => {
            db.username = 'Edited by the peer'
            switchPersona(db, 1)
        })
        await until(() => b.peer.asked.length >= 1, 'the question', 8000)
        expect(b.db.selectedPersona).toBe(2)
        const read = await page.freeze()
        expect(read.db.personas[0].name).toBe('Edited by the peer')
        expect(read.db.selectedPersona).toBe(1)
    })

    test('G15 the persona operations of the fast-forward equal what the real changeUserPersona leaves, field for field', () => {
        const db = {
            personas: [0, 1, 2].map(index => ({ id: `p${index}`, name: `Persona ${index}`, icon: `icon-${index}`, personaPrompt: `prompt ${index}`, note: `note ${index}` })),
            selectedPersona: 0,
            username: 'Working name',
            userIcon: 'working-icon',
            personaPrompt: 'working prompt',
            userNote: 'working note',
        }
        const working: JsonObject = { username: db.username, userIcon: db.userIcon, personaPrompt: db.personaPrompt, userNote: db.userNote }
        const left = PERSONA_OPS.saveInto(working, db.personas[0])
        const entered = PERSONA_OPS.apply(working, db.personas[2])
        const held = DBState.db
        DBState.db = db as unknown as Database
        try {
            changeUserPersona(2)
        } finally {
            DBState.db = held
        }
        expect(db.personas[0]).toEqual(left)
        expect({ username: db.username, userIcon: db.userIcon, personaPrompt: db.personaPrompt, userNote: db.userNote }).toEqual(entered)
        expect(db.selectedPersona).toBe(2)
    })
})
