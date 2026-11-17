// @vitest-environment jsdom
// The module ack's routing in the real history service: a landed module write tells the ack of that module, once, with
// the count read before the write, and the write's mark is already counted by then (the real write hook and save marks
// over a `$state` root). Edits that land nowhere (refused, unchanged) and edits of other owners never reach it.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import type { RisuModule } from 'src/ts/process/modules'

const h = vi.hoisted(() => ({ marks: 0 }))

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [], modules: [] } as unknown as Database })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})

import { DBState } from 'src/ts/stores.svelte'
import { installDbWriteHook, uninstallDbWriteHook } from 'src/ts/storage/dbWriteHook'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { createOwnerHistoryService, type OwnerAck, type OwnerHistoryService } from '../ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from '../ownerPhase'
import { createFakeClock } from './historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from './studioStoreDoubles'

const M1 = moduleOwnerKey('M1')
const M2 = moduleOwnerKey('M2')

function moduleOf(id: string, text: string): RisuModule {
    return { id, name: id, description: '', customModuleToggle: text, assets: [] } as unknown as RisuModule
}

interface Recorder extends OwnerAck {
    calls: { id: string, before: number, countAtCall: number }[]
}

function recorder(): Recorder {
    const calls: Recorder['calls'] = []
    return {
        calls,
        noteEdit(id, before) {
            calls.push({ id, before, countAtCall: h.marks })
        },
    }
}

let service: OwnerHistoryService
let open: string | null
// Runs once, when the service reads the mark count just before the live write: after the target was accepted.
let beforeWrite: (() => void) | null

function modules(): RisuModule[] {
    return DBState.db.modules as RisuModule[]
}

beforeEach(async () => {
    h.marks = 0
    open = 'M1'
    beforeWrite = null
    resetStudioScreenForTests()
    DBState.db = {
        botPresetsId: 0,
        botPresets: [],
        modules: [moduleOf('M1', 'a=A'), moduleOf('M2', 'm2=2')],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: [{ chaId: 'c1', name: 'c1', desc: 'resident desc', customModuleToggle: 'c=C' }],
    } as unknown as Database
    const tracker: toSaveType = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    installCharacterSaveMarks({ tracker, schedule: () => { h.marks += 1 } })
    installDbWriteHook(DBState, { selectedChaId: () => undefined })
    service = createOwnerHistoryService({
        store: createMemoryStudioStore(),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        getMarkCount: () => {
            const run = beforeWrite
            beforeWrite = null
            run?.()
            return h.marks
        },
        registerLeaveFlush: () => () => {},
        openModuleId: () => open,
    })
    await service.whenReady(M1)
})

afterEach(() => {
    uninstallDbWriteHook()
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
})

describe('R2-ROUTE: a landed module write tells the ack of that module', () => {
    test('the ack of the written module is called once, with the count read before the write, after the mark is counted', () => {
        const ack = recorder()
        service.setModuleAck('M1', ack)
        expect(service.editText(M1, 'customModuleToggle', 'a=B', 'single')).toEqual({ ok: true })
        expect(ack.calls).toHaveLength(1)
        expect(ack.calls[0].id).toBe('M1')
        expect(ack.calls[0].before).toBe(0)
        expect(ack.calls[0].countAtCall).toBeGreaterThan(ack.calls[0].before)
        expect(modules()[0].customModuleToggle).toBe('a=B')
    })

    test('the ack is found by the written module id, not by the open owner or the first registered ack', () => {
        const first = recorder()
        const second = recorder()
        service.setModuleAck('M2', first)
        service.setModuleAck('M1', second)
        expect(service.editText(M1, 'customModuleToggle', 'a=B', 'single')).toEqual({ ok: true })
        expect(first.calls).toEqual([])
        expect(second.calls).toHaveLength(1)
        expect(second.calls[0].id).toBe('M1')
    })

    test('a character ack is not called for a module write, and a module ack is not called for a character write', async () => {
        const module = recorder()
        const character = recorder()
        service.setModuleAck('M1', module)
        service.setAck('c1', character)
        expect(service.editText(M1, 'customModuleToggle', 'a=B', 'single')).toEqual({ ok: true })
        expect(character.calls).toEqual([])
        const cha = characterOwnerKey('c1')
        studioScreen.chaId = 'c1'
        await service.whenReady(cha)
        expect(service.editField(cha, 'desc', 'a new desc')).toMatchObject({ ok: true })
        expect(character.calls).toHaveLength(1)
        expect(module.calls).toHaveLength(1)
    })

    test('an unregistered ack is not called, and a module with no ack is written without one', () => {
        const ack = recorder()
        service.setModuleAck('M1', ack)
        service.setModuleAck('M1', null)
        expect(service.editText(M1, 'customModuleToggle', 'a=B', 'single')).toEqual({ ok: true })
        expect(ack.calls).toEqual([])
    })

    test('an unchanged text calls no ack', () => {
        const ack = recorder()
        service.setModuleAck('M1', ack)
        expect(service.editText(M1, 'customModuleToggle', 'a=A', 'single')).toEqual({ ok: true, unchanged: true })
        expect(ack.calls).toEqual([])
    })

    test('a refused write (not selected, gone, a shared id) calls no ack', () => {
        const ack = recorder()
        const other = recorder()
        service.setModuleAck('M1', ack)
        service.setModuleAck('M2', other)
        // Not selected: the open module is M1.
        expect(service.editText(M2, 'customModuleToggle', 'x', 'single')).toMatchObject({ ok: false, reason: 'not-selected' })
        // Gone: the open module has no row.
        open = 'M9'
        expect(service.editText(moduleOwnerKey('M9'), 'customModuleToggle', 'x', 'single')).toMatchObject({ ok: false })
        // A shared id.
        open = 'M1'
        modules().push(moduleOf('M1', 'copy'))
        expect(service.editText(M1, 'customModuleToggle', 'a=B', 'single')).toMatchObject({ ok: false, reason: 'duplicate-module-id' })
        expect(ack.calls).toEqual([])
        expect(other.calls).toEqual([])
    })

    test('a write the live module refuses after the target was accepted is gone and calls no ack', () => {
        const ack = recorder()
        service.setModuleAck('M1', ack)
        // A second row with the module's id appears after the target was accepted and before the live write.
        beforeWrite = () => { modules().push(moduleOf('M1', 'copy')) }
        expect(service.editText(M1, 'customModuleToggle', 'a=B', 'single')).toMatchObject({ ok: false, reason: 'gone' })
        expect(beforeWrite).toBeNull()
        expect(ack.calls).toEqual([])
        expect(modules()[0].customModuleToggle).toBe('a=A')
    })
})
