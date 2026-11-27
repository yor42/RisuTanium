// @vitest-environment jsdom
// Class G (new-behaviour guard): the database side of update all over a real `$state` root, the real save marks and
// the real setters, with no write hook installed: every mark asserted here comes from the port's own writes. Fixtures
// follow the producers: stubs are minted by `moduleStubOf`, scripts carry the flag string the regex editor writes.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'

const h = vi.hoisted(() => ({ refresh: vi.fn(), bump: vi.fn(), marks: 0 }))

vi.mock('src/lang', () => ({ language: {} }))
vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => h.marks }))
vi.mock('src/ts/process/modules', () => ({ refreshModules: h.refresh }))
vi.mock('src/ts/process/moduleGuiBump', () => ({ bumpModuleGui: h.bump }))
vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        selectedCharID: writable(0),
        clearCharEmotionCache: vi.fn(),
    } as unknown as typeof import('src/ts/stores.svelte')
})
// The module list the owner model reads: the first holder of each referenced id, as the engine selects it.
vi.mock('src/ts/process/moduleRefList', async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    const { matchesModuleRef } = await import('src/ts/process/moduleRefs')
    return {
        moduleListOf: (ids: string[]) => {
            const wanted = new Set(ids)
            const seen = new Set<string>()
            return ((DBState.db as unknown as Database).modules ?? []).filter((row) => {
                if (!matchesModuleRef(row, wanted) || seen.has(row.id)) {
                    return false
                }
                seen.add(row.id)
                return true
            })
        },
    }
})

import { DBState, selIdState } from 'src/ts/stores.svelte'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import type { RisuModule } from 'src/ts/process/modules'
import { resetStudioHistoryAccessorForTests, primeStudioModuleSlots } from 'src/ts/studio/history/studioHistoryService.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { stubModule } from 'src/ts/studio/studioFixtures.test-helpers'
import { applyUpdate, checkUndo, planFromScan, restoreUpdate, scanReach, type Rename, type UpdatePlan } from 'src/ts/studio/toggleUpdateAll'
import type { ToggleTarget } from 'src/ts/studio/toggleBuilder.svelte'
import { createUpdateDbPort, readUpdateReach } from '../toggleUpdateAllDb'

const READ = '{{getglobalvar::toggle_a}}'
const BEFORE = (label: string) => `${label} ${READ}`
const AFTER = (label: string) => `${label} {{getglobalvar::toggle_b}}`

function character(chaId: string, extra: Record<string, unknown> = {}) {
    return {
        chaId,
        name: `name-${chaId}`,
        type: 'character',
        desc: BEFORE('desc'),
        firstMessage: BEFORE('first'),
        exampleMessage: '',
        alternateGreetings: [BEFORE('g0'), 'plain'],
        globalLore: [{ key: 'k', comment: 'c', content: BEFORE('lore'), mode: 'normal', insertorder: 1, alwaysActive: false, secondkey: '', selective: false }],
        customscript: [{ comment: 'r', in: BEFORE('in'), out: BEFORE('out'), type: 'editdisplay', flag: '<cbs>', ableFlag: true }],
        triggerscript: [{
            comment: 't', type: 'start', conditions: [],
            effect: [
                { type: 'v2SetVar', var: 'x', varType: 'var', operator: '=', value: BEFORE('v2'), valueType: 'value' },
                { type: 'triggerlua', code: 'getGlobal("toggle_a")' },
            ],
        }],
        customModuleToggle: '',
        chats: [{ id: 'chat1', note: '', name: 'chat', message: [], localLore: [] }],
        chatPage: 0,
        ...extra,
    }
}

function moduleRow(id: string, extra: Record<string, unknown> = {}): RisuModule {
    return {
        id,
        name: `Module ${id}`,
        description: '',
        lorebook: [{ key: 'k', comment: 'c', content: BEFORE(`m-${id}`), mode: 'normal', insertorder: 1, alwaysActive: false, secondkey: '', selective: false }],
        regex: [{ comment: 'r', in: BEFORE('min'), out: BEFORE('mout'), type: 'editdisplay', flag: '<cbs>', ableFlag: true }],
        trigger: [],
        cjs: 'toggle_a',
        customModuleToggle: '',
        ...extra,
    } as unknown as RisuModule
}

let tracker: toSaveType
let scheduled: (string | undefined)[]
let throwOnContent = 0

function seed(modules: RisuModule[], characters: unknown[] = [character('c1')], enabled = modules.map((row) => row.id)): void {
    DBState.db = { characters, modules, enabledModules: enabled, botPresets: [], botPresetsId: 0, personas: [], plugins: [], loadouts: [], moduleIntergration: '' } as unknown as Database
    selIdState.selId = 0
    studioScreen.chaId = 'c1'
}

const modulesOf = () => DBState.db.modules as RisuModule[]
const live = () => DBState.db.characters[0] as unknown as ReturnType<typeof character>
const A_TO_B: Rename[] = [{ from: 'a', to: 'b' }]

function planOf(target: ToggleTarget, renames: Rename[] = A_TO_B, optIn: string[] = []): UpdatePlan {
    const reach = readUpdateReach(target, 'c1')
    return planFromScan(reach, scanReach(reach, new Set(renames.map((rename) => rename.from))), renames, new Set(optIn))
}

const CHARACTER: ToggleTarget = { kind: 'character', chaId: 'c1' }

beforeEach(() => {
    h.refresh.mockClear()
    h.bump.mockClear()
    h.marks = 0
    throwOnContent = 0
    resetStudioScreenForTests()
    resetStudioHistoryAccessorForTests()
    tracker = { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
    scheduled = []
    installCharacterSaveMarks({
        tracker,
        schedule: (kind) => {
            scheduled.push(kind)
            if (kind === 'content' && throwOnContent > 0) {
                throwOnContent--
                throw new Error('mark failed')
            }
        },
    })
    seed([])
})

afterEach(() => {
    resetCharacterSaveMarksForTest()
    resetStudioScreenForTests()
    resetStudioHistoryAccessorForTests()
})

describe('the character write (DB1)', () => {
    test('every kind of rewritable field is written with the op its history replay uses, and the character is marked once', () => {
        const plan = planOf(CHARACTER)
        expect(plan.writes.map((write) => write.path)).toEqual([
            'desc', 'firstMessage', 'alternateGreetings/0', 'lore/0/content', 'regex/0/out', 'trigger/0/effect/0/value',
        ])
        const applied = applyUpdate(plan, createUpdateDbPort())
        expect(applied.ok).toBe(true)
        const written = live()
        expect(written.desc).toBe(AFTER('desc'))
        expect(written.firstMessage).toBe(AFTER('first'))
        expect(written.alternateGreetings).toEqual([AFTER('g0'), 'plain'])
        expect(written.globalLore[0].content).toBe(AFTER('lore'))
        expect(written.customscript[0].out).toBe(AFTER('out'))
        expect(written.customscript[0].in).toBe(BEFORE('in'))
        expect(written.triggerscript[0].effect[0]).toMatchObject({ value: AFTER('v2') })
        expect(written.triggerscript[0].effect[1]).toMatchObject({ code: 'getGlobal("toggle_a")' })
        expect(tracker.character).toEqual(['c1'])
        expect(scheduled).toEqual(['judged'])
    })

    test('every text field target is rewritten, the container keeps its other keys, the character is marked once, and undo puts every text back (DB1b)', () => {
        seed([], [character('c1', {
            systemPrompt: BEFORE('sys'),
            personality: BEFORE('pers'),
            depth_prompt: { depth: 2, prompt: BEFORE('depth') },
            defaultVariables: BEFORE('dv'),
        })])
        const plan = planOf(CHARACTER)
        const paths = plan.writes.map((write) => write.path)
        expect(paths).toEqual(expect.arrayContaining(['systemPrompt', 'personality', 'depth_prompt/prompt', 'defaultVariables']))
        const applied = applyUpdate(plan, createUpdateDbPort())
        expect(applied.ok).toBe(true)
        if (!applied.ok) {
            return
        }
        const written = live() as unknown as Record<string, unknown>
        expect(written.systemPrompt).toBe(AFTER('sys'))
        expect(written.personality).toBe(AFTER('pers'))
        expect(written.defaultVariables).toBe(AFTER('dv'))
        expect(written.depth_prompt).toEqual({ depth: 2, prompt: AFTER('depth') })
        expect(tracker.character).toEqual(['c1'])
        expect(checkUndo(applied.journal, createUpdateDbPort())).toEqual({ ok: true })
        expect(restoreUpdate(applied.journal, createUpdateDbPort())).toEqual({ ok: true })
        expect(written.systemPrompt).toBe(BEFORE('sys'))
        expect(written.personality).toBe(BEFORE('pers'))
        expect(written.defaultVariables).toBe(BEFORE('dv'))
        expect(written.depth_prompt).toEqual({ depth: 2, prompt: BEFORE('depth') })
    })

    test('the 배경 HTML is rewritten through its registry write, the character is marked once, and undo puts it back (T7; passes before and after the router change)', () => {
        seed([], [character('c1', { backgroundHTML: BEFORE('bg') })])
        const plan = planOf(CHARACTER)
        expect(plan.writes.map((write) => write.path)).toContain('backgroundHTML')
        const applied = applyUpdate(plan, createUpdateDbPort())
        expect(applied.ok).toBe(true)
        if (!applied.ok) {
            return
        }
        const written = live() as unknown as Record<string, unknown>
        expect(written.backgroundHTML).toBe(AFTER('bg'))
        expect(tracker.character).toEqual(['c1'])
        expect(restoreUpdate(applied.journal, createUpdateDbPort())).toEqual({ ok: true })
        expect(written.backgroundHTML).toBe(BEFORE('bg'))
    })

    test('the regex in pattern and the Lua code are listed and untouched', () => {
        const plan = planOf(CHARACTER)
        expect(plan.listed.map((use) => [use.path, use.reason])).toEqual([
            ['trigger/0/effect/1/code', 'code'], ['regex/0/in', 'regexPattern'],
        ])
    })
})

describe('the module write (DB2, DB2b)', () => {
    test('the slot holds a new object, the old object is unchanged, `modules` is marked, and cjs is not written', async () => {
        seed([moduleRow('M1')])
        const old = modulesOf()[0]
        const snapshot = JSON.parse(JSON.stringify(old))
        const plan = planOf({ kind: 'module', moduleId: 'M1' })
        expect(plan.writes.map((write) => write.owner)).toContain('module:M1')
        await primeStudioModuleSlots()
        const port = createUpdateDbPort()
        expect(applyUpdate(plan, port).ok).toBe(true)
        const next = modulesOf()[0]
        expect(next).not.toBe(old)
        expect(old).toEqual(snapshot)
        expect(next.lorebook?.[0].content).toBe(AFTER('m-M1'))
        expect(next.regex?.[0].out).toBe(AFTER('mout'))
        expect(next.regex?.[0].in).toBe(BEFORE('min'))
        expect(next.cjs).toBe('toggle_a')
        expect(tracker.modules).toBe(true)
        expect(scheduled.filter((kind) => kind === 'content')).toHaveLength(1)
        expect(h.refresh).toHaveBeenCalledTimes(1)
        expect(h.bump).toHaveBeenCalledTimes(1)
    })

    test('T5-ROUTE-UA: the background embedding is written as a text write of the module (no history step), over a string only, and Undo puts it back', async () => {
        seed([moduleRow('M1', { backgroundEmbedding: BEFORE('bg') }), moduleRow('M2', { backgroundEmbedding: 0 })])
        const plan = planOf({ kind: 'module', moduleId: 'M1' })
        expect(plan.writes.filter((write) => write.path === 'backgroundEmbedding').map((write) => write.owner)).toEqual(['module:M1'])
        await primeStudioModuleSlots()
        const applied = applyUpdate(plan, createUpdateDbPort())
        expect(applied.ok).toBe(true)
        if (!applied.ok) {
            return
        }
        expect((modulesOf()[0] as { backgroundEmbedding?: unknown }).backgroundEmbedding).toBe(AFTER('bg'))
        // A value that is not text is never rewritten.
        expect((modulesOf()[1] as { backgroundEmbedding?: unknown }).backgroundEmbedding).toBe(0)
        expect(restoreUpdate(applied.journal, createUpdateDbPort())).toEqual({ ok: true })
        expect((modulesOf()[0] as { backgroundEmbedding?: unknown }).backgroundEmbedding).toBe(BEFORE('bg'))
    })
    test('the reach alone loads the slot port, so settle resets the memo before it returns', async () => {
        seed([moduleRow('M1')])
        resetStudioHistoryAccessorForTests()
        const plan = planOf({ kind: 'module', moduleId: 'M1' })
        await vi.dynamicImportSettled()
        const port = createUpdateDbPort()
        expect(applyUpdate(plan, port).ok).toBe(true)
        expect(h.refresh).toHaveBeenCalledTimes(1)
    })
})

describe('the reach of a preset builder (T11)', () => {
    const PRESET: ToggleTarget = { kind: 'preset', presetId: 'P-1' }

    test('owners are the character and the active modules; no preset is an owner', () => {
        seed([moduleRow('M1'), moduleRow('M5')], [character('c1')], ['M1'])
        expect(readUpdateReach(PRESET, 'c1').owners.map((owner) => owner.key)).toEqual(['character:c1', 'module:M1'])
    })

    test('a private bound character is unreached, restricted, and the modules are still owners', () => {
        seed([moduleRow('M1')], [character('c1', { license: 'private' })])
        const reach = readUpdateReach(PRESET, 'c1')
        expect(reach.owners.map((owner) => owner.key)).toEqual(['module:M1'])
        expect(reach.unreached.map((entry) => [entry.name, entry.reason])).toEqual([['name-c1', 'restricted']])
    })
})

describe('the reach (DB3)', () => {
    const reasonsOf = (target: ToggleTarget = CHARACTER) => readUpdateReach(target, 'c1').unreached.map((entry) => [entry.name, entry.reason])
    const ownersOf = (target: ToggleTarget = CHARACTER) => readUpdateReach(target, 'c1').owners.map((owner) => owner.key)

    test('the character and the active resident modules are owners; off modules are absent', () => {
        seed([moduleRow('M1'), moduleRow('M5')], [character('c1')], ['M1'])
        expect(ownersOf()).toEqual(['character:c1', 'module:M1'])
        expect(reasonsOf()).toEqual([])
    })

    test('the toggle owner module comes first, once, even when it is also active', () => {
        seed([moduleRow('M1'), moduleRow('M2')])
        expect(ownersOf({ kind: 'module', moduleId: 'M2' })).toEqual(['character:c1', 'module:M2', 'module:M1'])
    })

    test('a stub is not loaded; a loaded module sharing its id with a stub or another module is a shared id; both are never read', () => {
        seed([moduleRow('M1'), stubModule('S1'), moduleRow('M3'), stubModule('M3'), moduleRow('M4'), moduleRow('M4')], [character('c1')], ['M1', 'S1', 'M3', 'M4'])
        const reach = readUpdateReach(CHARACTER, 'c1')
        expect(reach.owners.map((owner) => owner.key)).toEqual(['character:c1', 'module:M1'])
        expect(reasonsOf()).toEqual([['Module S1', 'notLoaded'], ['Module M3', 'sharedId'], ['Module M4', 'sharedId']])
        const port = createUpdateDbPort()
        expect(port.read({ kind: 'module', moduleId: 'M3' }, 'lore/0/content')).toBe('gone')
        expect(port.write({ kind: 'module', moduleId: 'M3' }, [{ path: 'lore/0/content', value: 'x' }])).toBe(false)
    })

    test('a private character is restricted and none of its text is read', () => {
        seed([], [character('c1', { license: 'private' })])
        expect(ownersOf()).toEqual([])
        expect(reasonsOf()).toEqual([['name-c1', 'restricted']])
    })

    test('a duplicate chaId is named, nothing of it is read, and the port gives gone and false', () => {
        seed([], [character('c1'), character('c1', { name: 'second' })])
        expect(ownersOf()).toEqual([])
        expect(reasonsOf()).toEqual([['name-c1', 'duplicateCharacter']])
        const port = createUpdateDbPort()
        expect(port.read({ kind: 'character', chaId: 'c1' }, 'desc')).toBe('gone')
        expect(port.write({ kind: 'character', chaId: 'c1' }, [{ path: 'desc', value: 'x' }])).toBe(false)
        expect(live().desc).toBe(BEFORE('desc'))
    })

    test('a character that is not the selected one has no reach at all', () => {
        seed([moduleRow('M1')])
        expect(readUpdateReach(CHARACTER, 'other')).toEqual({ owners: [], unreached: [{ name: 'other', reason: 'restricted' }] })
    })

    test('a toggle owner module that is a lone stub slot is not loaded, not a shared id, and is never read', () => {
        seed([stubModule('S1')], [character('c1')], ['S1'])
        const reach = readUpdateReach({ kind: 'module', moduleId: 'S1' }, 'c1')
        expect(reach.owners.map((owner) => owner.key)).toEqual(['character:c1'])
        expect(reach.unreached.map((entry) => entry.reason)).toEqual(['notLoaded'])
    })

    test('the reason of a stub toggle owner follows its own slots, not the enabled list: a lone stub is not loaded, a stub with another slot of its id is a shared id', () => {
        const own: ToggleTarget = { kind: 'module', moduleId: 'S1' }
        seed([stubModule('S1')], [character('c1')], [])
        expect(reasonsOf(own).map((entry) => entry[1])).toEqual(['notLoaded'])
        for (const slots of [[stubModule('S1'), moduleRow('S1')], [stubModule('S1'), stubModule('S1')], [moduleRow('S1'), stubModule('S1')]]) {
            seed(slots, [character('c1')], [])
            expect(reasonsOf(own).map((entry) => entry[1])).toEqual(['sharedId'])
            expect(ownersOf(own)).toEqual(['character:c1'])
        }
    })

    test('a module regex pattern that runs macros is listed and never written', () => {
        seed([moduleRow('M1')])
        const plan = planOf({ kind: 'module', moduleId: 'M1' })
        expect(plan.listed.filter((use) => use.owner === 'module:M1').map((use) => [use.path, use.reason])).toEqual([['cjs', 'code'], ['regex/0/in', 'regexPattern']])
        expect(plan.writes.filter((write) => write.owner === 'module:M1').map((write) => write.path)).not.toContain('regex/0/in')
    })
})

describe('the toggle text of an owner gates its own uses (DB3b, DD-117)', () => {
    test('a module that defines the renamed key is skipped without opt-in and written with it', () => {
        seed([moduleRow('M1', { customModuleToggle: 'a=A' })])
        const without = planOf(CHARACTER)
        expect(without.skipped).toEqual([{ owner: 'module:M1', key: 'a', count: 2 }])
        expect(without.writes.map((write) => write.owner)).not.toContain('module:M1')
        const opted = planOf(CHARACTER, A_TO_B, ['module:M1'])
        expect(opted.skipped).toEqual([])
        expect(opted.writes.map((write) => write.owner)).toContain('module:M1')
    })

    test('a character that defines the renamed key is skipped without opt-in and written with it', () => {
        seed([], [character('c1', { customModuleToggle: 'a=A' })])
        const without = planOf(CHARACTER)
        expect(without.skipped.map((entry) => [entry.owner, entry.key])).toEqual([['character:c1', 'a']])
        expect(without.writes).toEqual([])
        expect(planOf(CHARACTER, A_TO_B, ['character:c1']).writes.map((write) => write.owner)).toContain('character:c1')
    })
})

describe('real-port rollback (DB7)', () => {
    const module = { kind: 'module', moduleId: 'M1' } as const

    test('(e) a refused module write marks nothing and arms no settle', async () => {
        seed([moduleRow('M1')])
        await primeStudioModuleSlots()
        const port = createUpdateDbPort()
        DBState.db.modules = []
        expect(port.write({ kind: 'module', moduleId: 'M1' }, [{ path: 'lore/0/content', value: 'x' }])).toBe(false)
        expect(tracker.modules).toBe(false)
        expect(scheduled).toEqual([])
        port.settle()
        expect(h.refresh).not.toHaveBeenCalled()
    })

    test('(a) a module that left the list before the write refuses it: the character is put back and marked again', () => {
        seed([moduleRow('M1')])
        const plan = planOf(module)
        DBState.db.modules = []
        expect(applyUpdate(plan, createUpdateDbPort())).toEqual({ ok: false, reason: 'failed' })
        expect(live().desc).toBe(BEFORE('desc'))
        expect(live().globalLore[0].content).toBe(BEFORE('lore'))
        expect(scheduled.filter((kind) => kind === 'judged')).toHaveLength(2)
    })

    test('(b) a throwing module mark after the slot was assigned puts the slot back to a copy of before and settles once', async () => {
        seed([moduleRow('M1')])
        await primeStudioModuleSlots()
        const original = modulesOf()[0]
        const snapshot = JSON.parse(JSON.stringify(original))
        const plan = planOf(module)
        throwOnContent = 1
        expect(applyUpdate(plan, createUpdateDbPort())).toEqual({ ok: false, reason: 'failed' })
        expect(modulesOf()[0].lorebook?.[0].content).toBe(BEFORE('m-M1'))
        expect(modulesOf()[0].regex?.[0].out).toBe(BEFORE('mout'))
        expect(original).toEqual(snapshot)
        expect(live().desc).toBe(BEFORE('desc'))
        expect(h.refresh).toHaveBeenCalledTimes(1)
    })

    test('(c) an undo whose module left the list rolls the character back to what the update wrote', () => {
        seed([moduleRow('M1')])
        const applied = applyUpdate(planOf(module), createUpdateDbPort())
        if (!applied.ok) {
            throw new Error('apply failed')
        }
        DBState.db.modules = []
        expect(restoreUpdate(applied.journal, createUpdateDbPort())).toEqual({ ok: false, reason: 'failed' })
        expect(live().desc).toBe(AFTER('desc'))
    })

    test('(d) an undo with a throwing module mark puts the slot back to the update result', async () => {
        seed([moduleRow('M1')])
        await primeStudioModuleSlots()
        const applied = applyUpdate(planOf(module), createUpdateDbPort())
        if (!applied.ok) {
            throw new Error('apply failed')
        }
        throwOnContent = 1
        expect(restoreUpdate(applied.journal, createUpdateDbPort())).toEqual({ ok: false, reason: 'failed' })
        expect(modulesOf()[0].lorebook?.[0].content).toBe(AFTER('m-M1'))
        expect(live().desc).toBe(AFTER('desc'))
    })
})
