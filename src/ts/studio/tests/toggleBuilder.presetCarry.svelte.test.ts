// A toggle builder over a preset owner, with a fake text port, the real pending-record store, the real database port and
// the real carry reach over a real `$state` database. The preset's pending question never reaches device storage; a
// character port keeps storing its record; the active preset's own keys are named when an inactive preset renames them.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    downloadFile: vi.fn(),
    saveAsset: vi.fn(),
    readImage: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

import { DBState } from 'src/ts/stores.svelte'
import { characterOwnerKey } from '../history/ownerPhase'
import type { StudioResult } from '../history/ownerHistory.svelte'
import { createCarryDbPort, readCarryReach } from '../edit/toggleCarryDb'
import { presetOwnerKey } from '../edit/presetTarget'
import { presetNamed, seedPresetDb } from '../edit/tests/presetFixture.test-helpers'
import type { ToggleTextPort } from '../edit/toggleTextPort'
import { createToggleBuilder, type CarryDeps, type ToggleTarget } from '../toggleBuilder.svelte'
import { planCarryWrites } from '../toggleCarryApply'
import { PENDING_PREFIX, readPending, resetToggleCarrySessionForTests } from '../toggleCarryPending'
import { parseDefinition } from '../toggleDef'

afterEach(() => {
    localStorage.clear()
    resetToggleCarrySessionForTests()
})

type FakePort = ToggleTextPort & { text: string }

function portOf(owner: ToggleTextPort['owner'], initial: string, carryKept?: 'device' | 'session'): FakePort {
    const port: FakePort = {
        owner,
        text: initial,
        ...(carryKept === undefined ? {} : { carryKept }),
        begin() {},
        read() { return port.text },
        view() { return { editable: true, banner: null, restricted: false } },
        write(next): StudioResult | null {
            port.text = next
            return { ok: true }
        },
        closeOpenStep() {},
    }
    return port
}

function depsOf(target: ToggleTarget, extra: Partial<CarryDeps> = {}): CarryDeps {
    return {
        reach: () => readCarryReach(target),
        values: createCarryDbPort(),
        starSource: 'x',
        stars: { has: () => false, rename() {} },
        reachKind: 'loaded',
        ...extra,
    }
}

const first = (text: string) => parseDefinition(text).lines[0].id
let ids: string[]

beforeEach(() => {
    ids = seedPresetDb([presetNamed('P', 'a=Mode\n'), presetNamed('Q', 'a=Other\n')], 1, 'a=Other\n')
    DBState.db.globalChatVariables = { toggle_a: '1' }
    DBState.db.characters = [{ chaId: 'A', name: 'A', type: 'character', chats: [], customModuleToggle: 'ch=Char\n' }] as unknown as typeof DBState.db.characters
})

describe('T6 the carry of a preset is kept for this page only', () => {
    test('no stored record for the preset owner; the question is held in the session and says so when it first shows', () => {
        const target: ToggleTarget = { kind: 'preset', presetId: ids[0] }
        const port = portOf(presetOwnerKey(ids[0]), 'a=Mode\n', 'session')
        const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'p', appKeys: new Set(), carry: depsOf(target) })
        expect(builder.carryNotKept).toBe(false)
        expect(builder.setKey(first('a=Mode\n'), 'c').ok).toBe(true)
        builder.checkpoint()
        expect(builder.question).not.toBeNull()
        expect(builder.carryNotKept).toBe(true)
        expect(Object.keys(localStorage).filter((key) => key.startsWith(PENDING_PREFIX))).toEqual([])
        expect(readPending(port.owner)).toEqual({ status: 'ok', baseline: 'a=Mode\n', kept: 'session' })
    })

    test('a page that reloads has no pending carry for the preset, and the global values are as they were', async () => {
        const target: ToggleTarget = { kind: 'preset', presetId: ids[0] }
        const port = portOf(presetOwnerKey(ids[0]), 'a=Mode\n', 'session')
        const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'p', appKeys: new Set(), carry: depsOf(target) })
        builder.setKey(first('a=Mode\n'), 'c')
        builder.checkpoint()
        vi.resetModules()
        const fresh = await import('../toggleCarryPending')
        expect(fresh.readPending(port.owner)).toEqual({ status: 'absent' })
        expect(DBState.db.globalChatVariables).toEqual({ toggle_a: '1' })
    })
})

describe('T7 a character port still stores its pending record (compatibility guard; passes before and after)', () => {
    test('the record is stored on the device and the question does not say it is page-only', () => {
        const target: ToggleTarget = { kind: 'character', chaId: 'A' }
        const port = portOf(characterOwnerKey('A'), 'a=Mode\n')
        const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'x', appKeys: new Set(), carry: depsOf(target, { reachKind: 'own' }) })
        builder.setKey(first('a=Mode\n'), 'c')
        builder.checkpoint()
        expect(builder.carryNotKept).toBe(false)
        expect(localStorage.getItem(PENDING_PREFIX + characterOwnerKey('A'))).not.toBeNull()
        expect(readPending(port.owner)).toMatchObject({ status: 'ok', kept: 'stored' })
    })
})

describe('T13 the line that names the active preset', () => {
    test('an inactive preset that renames a key the active one defines names the active preset; Carry writes the new key only', () => {
        const target: ToggleTarget = { kind: 'preset', presetId: ids[0] }
        const port = portOf(presetOwnerKey(ids[0]), 'a=Mode\n', 'session')
        const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'p', appKeys: new Set(), carry: depsOf(target, { namesActiveKeeps: true }) })
        builder.setKey(first('a=Mode\n'), 'b')
        builder.checkpoint()
        expect(builder.question?.activeKeeps).toEqual([{ key: 'a', name: 'Q' }])
        expect(builder.carryValues().ok).toBe(true)
        expect(DBState.db.globalChatVariables).toEqual({ toggle_a: '1', toggle_b: '1' })
    })

    test('the first of several others is not the active preset', () => {
        ids = seedPresetDb([presetNamed('P', 'a=Mode\n'), presetNamed('R', 'a=Third\n'), presetNamed('Q', 'a=Other\n')], 2, 'a=Other\n')
        const target: ToggleTarget = { kind: 'preset', presetId: ids[0] }
        const port = portOf(presetOwnerKey(ids[0]), 'a=Mode\n', 'session')
        const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'p', appKeys: new Set(), carry: depsOf(target, { namesActiveKeeps: true }) })
        builder.setKey(first('a=Mode\n'), 'b')
        builder.checkpoint()
        expect(builder.question?.activeKeeps).toEqual([{ key: 'a', name: 'Q' }])
    })

    test('with the preset itself active, no line names another preset', () => {
        const target: ToggleTarget = { kind: 'preset', presetId: ids[1] }
        const port = portOf(presetOwnerKey(ids[1]), 'a=Other\n', 'session')
        const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'q', appKeys: new Set(), carry: depsOf(target, { namesActiveKeeps: true }) })
        builder.setKey(first('a=Other\n'), 'b')
        builder.checkpoint()
        expect(builder.question?.activeKeeps).toEqual([])
    })

    test('a key the active preset does not define is not named', () => {
        const target: ToggleTarget = { kind: 'preset', presetId: ids[0] }
        const port = portOf(presetOwnerKey(ids[0]), 'z=Mode\n', 'session')
        const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'p', appKeys: new Set(), carry: depsOf(target, { namesActiveKeeps: true }) })
        builder.setKey(first('z=Mode\n'), 'y')
        builder.checkpoint()
        expect(builder.question?.activeKeeps).toEqual([])
    })
})

describe('T14 a character rename of a key the active preset defines (compatibility guard; passes before and after)', () => {
    test('no line, and the plan signature is the one the planner gives', () => {
        const target: ToggleTarget = { kind: 'character', chaId: 'A' }
        const port = portOf(characterOwnerKey('A'), 'a=Mode\n')
        const builder = createToggleBuilder(port, { keyEditsLive: true, stem: 'x', appKeys: new Set(), carry: depsOf(target, { reachKind: 'own' }) })
        builder.setKey(first('a=Mode\n'), 'b')
        builder.checkpoint()
        const question = builder.question
        expect(question?.activeKeeps ?? []).toEqual([])
        const planned = planCarryWrites([{ kind: 'rename', from: 'a', to: 'b' }], readCarryReach(target))
        expect(question?.planned.signature).toBe(planned.signature)
    })
})
