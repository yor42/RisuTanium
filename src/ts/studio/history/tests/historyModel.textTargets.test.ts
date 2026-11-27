// @vitest-environment jsdom
// Whole-value transient text writes: a `textEdit` on any rewritable registry target of a character or a module owner
// is planned on a working copy and lands as the whole value the plan computed, through the real live readers and the
// real owner bodies. Replays, reverts and restore points carry it. The model, the readers and the bodies are real;
// the owner is a plain object.
import fc from 'fast-check'
import { describe, expect, test, vi } from 'vitest'
import { enumerateClassifiedTargets, type TargetOwner } from '../../assets/referenceTargets'
import {
    applyCharacterWrites,
    buildFieldEdit,
    buildWrittenModule,
    createLiveReader,
    createModuleLiveReader,
    type AssetWriteExtras,
    type LiveTarget,
} from '../../edit/studioSetters'
import {
    applyReplayMove,
    assetStepWrites,
    commitStep,
    createModelState,
    deriveRestoreWrites,
    emptyRecord,
    parseOwnerRecord,
    planReplay,
    planRestorePoint,
    planRevert,
    textBeforeOf,
    type LiveReader,
    type ModelState,
    type Op,
    type StepPlan,
    type WriteOp,
} from '../historyModel'
import { characterOwnerKey, moduleOwnerKey, type OwnerKey } from '../ownerPhase'
import type { RisuModule } from 'src/ts/process/modules'
import type { character } from 'src/ts/storage/database.svelte'

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: { characters: [], modules: [] } },
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        clearCharEmotionCache: () => {},
    }
})

// ---------------------------------------------------------------- owners

type AssetRow = [string, ...string[]]

interface TriggerList {
    comment: string
    type: string
    conditions: object[]
    effect: object[]
}

interface TestCharacter {
    chaId: string
    desc: string
    firstMessage: string
    exampleMessage: string
    alternateGreetings: string[]
    systemPrompt: string
    replaceGlobalNote: string
    additionalText: string
    personality: string
    scenario: string
    backgroundHTML: string
    defaultVariables: string
    translatorNote: string
    creatorNotes: string
    depth_prompt: { depth: number; prompt: string }
    newGenData: { prompt: string; negative: string; instructions: string; emotionInstructions: string }
    globalLore: { key: string; content: string }[]
    customscript: { in: string; out: string; type: string }[]
    triggerscript: TriggerList[]
    additionalAssets: AssetRow[]
    emotionImages: AssetRow[]
}

interface TestModule {
    id: string
    name: string
    assets: AssetRow[]
    lorebook: { key: string; content: string }[]
    regex: { in: string; out: string; type: string }[]
    trigger: TriggerList[]
    backgroundEmbedding: string
    cjs: string
}

function setVarEffect(value: string, mode = 'value'): object {
    return { type: 'v2SetVar', var: 'v', varType: 'var', operator: '=', valueType: mode, value }
}

function makeCharacter(over: Partial<TestCharacter> = {}): TestCharacter {
    return {
        chaId: 'A',
        desc: 'desc smile2',
        firstMessage: 'first smile2 message',
        exampleMessage: 'example smile2',
        alternateGreetings: ['g0 smile2', 'g1'],
        systemPrompt: 'system smile2',
        replaceGlobalNote: 'note smile2',
        additionalText: 'additional smile2',
        personality: 'personality smile2',
        scenario: 'scenario smile2',
        backgroundHTML: '<p>smile2</p>',
        defaultVariables: 'v=smile2',
        translatorNote: 'translator smile2',
        creatorNotes: 'creator smile2',
        depth_prompt: { depth: 4, prompt: 'depth smile2' },
        newGenData: { prompt: 'p smile2', negative: 'n smile2', instructions: 'i smile2', emotionInstructions: 'e smile2' },
        globalLore: [{ key: 'k0', content: 'lore0 smile2' }, { key: 'k1', content: 'lore1 smile2' }],
        customscript: [{ in: 'smile2', out: 'out0 smile2', type: 'editoutput' }],
        triggerscript: [{ comment: 'event', type: 'manual', conditions: [{ type: 'var', var: 'x', operator: '=', value: 'cond smile2' }], effect: [setVarEffect('effect smile2')] }],
        additionalAssets: [['smile', 'assets/smile.png', 'png'], ['smile2', 'assets/smile.png', 'png']],
        emotionImages: [],
        ...over,
    }
}

function makeModule(over: Partial<TestModule> = {}): TestModule {
    return {
        id: 'M',
        name: 'M',
        assets: [['smile', 'assets/smile.png', 'png'], ['smile2', 'assets/smile.png', 'png']],
        lorebook: [{ key: 'k0', content: 'lore0 smile2' }, { key: 'k1', content: 'lore1 smile2' }],
        regex: [{ in: 'a', out: 'out0 smile2', type: 'editoutput' }],
        trigger: [{ comment: 'event', type: 'manual', conditions: [], effect: [setVarEffect('effect smile2')] }],
        backgroundEmbedding: 'embedding smile2',
        cjs: 'cjs smile2',
        ...over,
    }
}

const KEEP: AssetWriteExtras = { folder: { kind: 'keep' }, retained: null }

const asCharacter = (c: TestCharacter): character => c as unknown as character
const asModule = (m: TestModule): RisuModule => m as unknown as RisuModule

function targetOf(c: TestCharacter): LiveTarget {
    return { character: asCharacter(c), chat: null }
}

const charReader = (c: TestCharacter): LiveReader => createLiveReader(targetOf(c))

function edit(target: string, offset: number, from: string, to: string): Op {
    return { op: 'textEdit', target, offset, from, to }
}

const A = characterOwnerKey('A')
const M = moduleOwnerKey('M')

// ---------------------------------------------------------------- landing and replaying through the real bodies

interface Landed {
    state: ModelState
    writes: WriteOp[]
}

let stepCounter = 0

function commitOf(state: ModelState, ownerReader: LiveReader, ops: Op[]): ModelState {
    stepCounter += 1
    const greetings = ownerReader.greetings()
    return commitStep(state, {
        id: `s${stepCounter}`,
        at: stepCounter,
        visitId: 'v1',
        label: { kind: 'assetMerge', from: 'a', to: 'b' },
        ops,
        restoreWrites: deriveRestoreWrites(ops, greetings === null ? null : [...greetings], textBeforeOf((path) => ownerReader.field(path))),
        coalesceKey: null,
        replacesRestore: false,
    })
}

// Lands `ops` on the character as the history service does: the writes are planned against the live owner, then the
// one body assigns them.
function landCharacter(state: ModelState, c: TestCharacter, ops: Op[]): Landed {
    const reader = charReader(c)
    const writes = assetStepWrites(ops, reader)
    if (writes === null) {
        throw new Error('the step does not apply to the character')
    }
    const next = commitOf(state, reader, ops)
    applyCharacterWrites(asCharacter(c), writes, null)
    return { state: next, writes }
}

function replayCharacter(state: ModelState, c: TestCharacter, direction: 'undo' | 'redo'): { state: ModelState; plan: StepPlan } {
    const plan = planReplay(state.record, direction, charReader(c))
    if (plan.ok === false) {
        throw new Error(`replay refused: ${plan.reason}`)
    }
    applyCharacterWrites(asCharacter(c), plan.writes, null)
    return { state: applyReplayMove(state, direction, plan, 100, 'v1'), plan }
}

interface ModuleHolder {
    module: TestModule
}

function landModule(state: ModelState, holder: ModuleHolder, ops: Op[]): Landed {
    const reader = createModuleLiveReader(asModule(holder.module))
    const writes = assetStepWrites(ops, reader)
    if (writes === null) {
        throw new Error('the step does not apply to the module')
    }
    const next = commitOf(state, reader, ops)
    holder.module = buildWrittenModule(asModule(holder.module), writes, KEEP) as unknown as TestModule
    return { state: next, writes }
}

function replayModule(state: ModelState, holder: ModuleHolder, direction: 'undo' | 'redo'): { state: ModelState; plan: StepPlan } {
    const plan = planReplay(state.record, direction, createModuleLiveReader(asModule(holder.module)))
    if (plan.ok === false) {
        throw new Error(`replay refused: ${plan.reason}`)
    }
    holder.module = buildWrittenModule(asModule(holder.module), plan.writes, KEEP) as unknown as TestModule
    return { state: applyReplayMove(state, direction, plan, 100, 'v1'), plan }
}

function freshState(owner: OwnerKey): ModelState {
    return createModelState(emptyRecord(owner, 0))
}

// ---------------------------------------------------------------- a merged step is replayed from the landed state

describe('a landed text step replays from the owner as it stands', () => {
    const ORIGINAL = 'first {{image::smile2}} message'
    const MERGED = 'first {{image::smile}} message'
    const EXTRA_ROW = ['smile2', 'assets/smile.png', 'png']
    const rowRemove: Op = { op: 'assetRowRemove', array: 'additionalAssets', index: 1, tuple: EXTRA_ROW, count: 1 }
    const firstMessageEdit = edit('firstMessage', 15, 'smile2', 'smile')

    // The record holds the step `commitStep` makes from the merge; the live owner already holds the merged state.
    function landedWith(withRow: boolean): { c: TestCharacter; state: ModelState } {
        const before = makeCharacter({ firstMessage: ORIGINAL })
        const ops: Op[] = withRow ? [rowRemove, firstMessageEdit] : [firstMessageEdit]
        const state = commitOf(freshState(A), charReader(before), ops)
        const landed = makeCharacter({ firstMessage: MERGED, additionalAssets: withRow ? [['smile', 'assets/smile.png', 'png']] : before.additionalAssets })
        return { c: landed, state }
    }

    test('a text-only step: undo restores the first message and redo puts the merged text back, nothing skipped', () => {
        const { c, state } = landedWith(false)
        const undone = replayCharacter(state, c, 'undo')
        expect(undone.plan.skipped).toBe(0)
        expect(undone.plan.writes).toEqual([{ op: 'set', path: 'firstMessage', value: { had: true, value: ORIGINAL } }])
        expect(c.firstMessage).toBe(ORIGINAL)
        const redone = replayCharacter(undone.state, c, 'redo')
        expect(redone.plan.skipped).toBe(0)
        expect(c.firstMessage).toBe(MERGED)
    })

    test('a step with a removed row and a text edit: undo puts the row and the first message back, nothing skipped', () => {
        const { c, state } = landedWith(true)
        const undone = replayCharacter(state, c, 'undo')
        expect(undone.plan.skipped).toBe(0)
        expect(c.firstMessage).toBe(ORIGINAL)
        expect(c.additionalAssets).toHaveLength(2)
        const redone = replayCharacter(undone.state, c, 'redo')
        expect(redone.plan.skipped).toBe(0)
        expect(c.firstMessage).toBe(MERGED)
        expect(c.additionalAssets).toHaveLength(1)
    })
})

// ---------------------------------------------------------------- the module body

describe('a module text step lands, undoes and redoes through the module body', () => {
    test('a background embedding and a trigger leaf change once per undo and redo, and the live module is never touched', () => {
        const holder: ModuleHolder = {
            module: makeModule({
                backgroundEmbedding: 'embedding {{image::smile2}}',
                trigger: [{ comment: 'event', type: 'manual', conditions: [], effect: [setVarEffect('effect {{image::smile2}}')] }],
            }),
        }
        const original = structuredClone(holder.module)
        const ops = [edit('backgroundEmbedding', 19, 'smile2', 'smile'), edit('trigger/0/effect/0/value', 16, 'smile2', 'smile')]
        const live = holder.module
        const landed = landModule(freshState(M), holder, ops)
        expect(live).toEqual(original)
        expect(holder.module.backgroundEmbedding).toBe('embedding {{image::smile}}')
        expect((holder.module.trigger[0].effect[0] as { value: string }).value).toBe('effect {{image::smile}}')
        const undone = replayModule(landed.state, holder, 'undo')
        expect(holder.module).toEqual(original)
        replayModule(undone.state, holder, 'redo')
        expect(holder.module.backgroundEmbedding).toBe('embedding {{image::smile}}')
        expect((holder.module.trigger[0].effect[0] as { value: string }).value).toBe('effect {{image::smile}}')
    })
})

// ---------------------------------------------------------------- the kind of write per target

describe('the write kind follows the target', () => {
    test('a text field is a set, a first message entry a listSet, and every other registry text a textSet, with unequal lengths', () => {
        const c = makeCharacter({
            firstMessage: 'first {{image::smile2}} message',
            desc: '{{image::desc}} smile2',
            alternateGreetings: ['g0 {{image::smile2}}', 'g1'],
            globalLore: [{ key: 'k0', content: 'lore0' }, { key: 'k1', content: '{{image::lore1}} smile2' }],
            systemPrompt: '{{image::system}} smile2',
            backgroundHTML: '{{image::html}} smile2',
        })
        const reader = charReader(c)
        const writes = assetStepWrites(
            [
                edit('firstMessage', 15, 'smile2', 'smile'),
                edit('desc', 9, 'desc', 'a much longer description'),
                edit('alternateGreetings/0', 12, 'smile2', ''),
                edit('lore/1/content', 9, 'lore1', 'l'),
                edit('systemPrompt', 9, 'system', 'sys'),
                edit('backgroundHTML', 9, 'html', 'h'),
            ],
            reader,
        )
        expect(writes).toEqual([
            { op: 'set', path: 'firstMessage', value: { had: true, value: 'first {{image::smile}} message' } },
            { op: 'set', path: 'desc', value: { had: true, value: '{{image::a much longer description}} smile2' } },
            { op: 'listSet', index: 0, value: 'g0 {{image::}}' },
            { op: 'textSet', target: 'lore/1/content', value: '{{image::l}} smile2' },
            { op: 'set', path: 'systemPrompt', value: { had: true, value: '{{image::sys}} smile2' } },
            { op: 'set', path: 'backgroundHTML', value: { had: true, value: '{{image::h}} smile2' } },
        ])

        const module = makeModule({ lorebook: [{ key: 'k0', content: '{{image::lore0}} smile2' }, { key: 'k1', content: 'lore1 smile2' }] })
        const moduleWrites = assetStepWrites([edit('lore/0/content', 9, 'lore0', 'x')], createModuleLiveReader(asModule(module)))
        expect(moduleWrites).toEqual([{ op: 'textSet', target: 'lore/0/content', value: '{{image::x}} smile2' }])
    })

    test('an edit that no longer matches the live text refuses the step', () => {
        const c = makeCharacter()
        expect(assetStepWrites([edit('systemPrompt', 0, 'other', 'x')], charReader(c))).toBeNull()
    })

    test('two edits of one target in one step follow the running value', () => {
        const c = makeCharacter({ systemPrompt: '{{image::abc}} {{image::def}}' })
        const ops = [edit('systemPrompt', 24, 'def', 'DEFGH'), edit('systemPrompt', 9, 'abc', 'Z')]
        const landed = landCharacter(freshState(A), c, ops)
        expect(landed.writes).toEqual([
            { op: 'set', path: 'systemPrompt', value: { had: true, value: '{{image::abc}} {{image::DEFGH}}' } },
            { op: 'set', path: 'systemPrompt', value: { had: true, value: '{{image::Z}} {{image::DEFGH}}' } },
        ])
        expect(c.systemPrompt).toBe('{{image::Z}} {{image::DEFGH}}')
        const undone = replayCharacter(landed.state, c, 'undo')
        expect(c.systemPrompt).toBe('{{image::abc}} {{image::def}}')
        replayCharacter(undone.state, c, 'redo')
        expect(c.systemPrompt).toBe('{{image::Z}} {{image::DEFGH}}')
    })
})

// ---------------------------------------------------------------- the write kind of a replay

describe('a replay emits the write kind of its target', () => {
    function stepOf(owner: OwnerKey, ...ops: Op[]): ModelState {
        return {
            record: { ...emptyRecord(owner, 0), done: [{ id: 's1', at: 1, label: { kind: 'assetMerge', from: 'a', to: 'b' }, ops }] },
            open: null,
        }
    }

    test('a first message entry gives a listSet, a character lore a textSet and a module lore a textSet, with unequal lengths', () => {
        const c = makeCharacter({ alternateGreetings: ['g0', '{{image::x}} 1'], globalLore: [{ key: 'k', content: '{{image::l}} tail' }] })
        const greeting = planReplay(stepOf(A, edit('alternateGreetings/1', 9, 'orig', 'x')).record, 'undo', charReader(c))
        expect(greeting.ok && greeting.writes).toEqual([{ op: 'listSet', index: 1, value: '{{image::orig}} 1' }])
        const lore = planReplay(stepOf(A, edit('lore/0/content', 9, 'lore0', 'l')).record, 'undo', charReader(c))
        expect(lore.ok && lore.writes).toEqual([{ op: 'textSet', target: 'lore/0/content', value: '{{image::lore0}} tail' }])
        const m = makeModule({ lorebook: [{ key: 'k', content: '{{image::l}} tail' }] })
        const moduleLore = planReplay(stepOf(M, edit('lore/0/content', 9, 'lore0', 'l')).record, 'undo', createModuleLiveReader(asModule(m)))
        expect(moduleLore.ok && moduleLore.writes).toEqual([{ op: 'textSet', target: 'lore/0/content', value: '{{image::lore0}} tail' }])
    })

    test('a redo applies the edit itself: the splice uses the length of the text it replaces', () => {
        const c = makeCharacter({ systemPrompt: '{{image::abcdef}}' })
        const state = stepOf(A, edit('systemPrompt', 9, 'abcdef', 'X'))
        state.record = { ...state.record, undone: state.record.done, done: [] }
        const plan = planReplay(state.record, 'redo', charReader(c))
        expect(plan.ok && plan.writes).toEqual([{ op: 'set', path: 'systemPrompt', value: { had: true, value: '{{image::X}}' } }])
    })
})

// ---------------------------------------------------------------- replays of unreadable targets

describe('a replay never treats an unreadable target as in place', () => {
    function recordOf(owner: OwnerKey, ...ops: Op[]): ModelState {
        return {
            record: {
                ...emptyRecord(owner, 0),
                done: [{ id: 's1', at: 1, label: { kind: 'assetMerge', from: 'a', to: 'b' }, ops }],
            },
            open: null,
        }
    }

    test('a trigger leaf that is flag-only or excluded now, and an index beyond the list, fail the replay with nothing written', () => {
        const c = makeCharacter({
            triggerscript: [{
                comment: 'e',
                type: 'manual',
                conditions: [],
                effect: [{ type: 'triggerlua', code: 'print(x)' }, { type: 'extractRegex', regex: 'x', result: 'y', value: 'v', flags: 'g', inputVar: 'i' }],
            }],
        })
        const reader = charReader(c)
        const cases: Op[] = [
            // The text is already the step's result: an unreadable target must still not count as in place.
            edit('trigger/0/effect/0/code', 0, 'print(y)', 'print(x)'),
            edit('trigger/0/effect/1/regex', 0, 'y', 'x'),
            edit('lore/9/content', 0, 'a', 'b'),
            edit('alternateGreetings/01', 0, 'a', 'g'),
        ]
        for (const op of cases) {
            expect(planReplay(recordOf(A, op).record, 'undo', reader)).toEqual({ ok: false, reason: 'precondition' })
        }
    })

    test('a trigger leaf switched to var mode after the step fails the undo', () => {
        const c = makeCharacter({ triggerscript: [{ comment: 'event', type: 'manual', conditions: [], effect: [setVarEffect('effect {{image::smile2}}')] }] })
        const state = landCharacter(freshState(A), c, [edit('trigger/0/effect/0/value', 16, 'smile2', 'smile')]).state
        ;(c.triggerscript[0].effect[0] as { valueType: string }).valueType = 'var'
        expect(planReplay(state.record, 'undo', charReader(c))).toEqual({ ok: false, reason: 'precondition' })
        expect((c.triggerscript[0].effect[0] as { value: string }).value).toBe('effect {{image::smile}}')
    })

    test('a module owner never holds a text field or a first message entry', () => {
        const module = asModule(makeModule())
        const reader = createModuleLiveReader(module)
        for (const target of ['desc', 'firstMessage', 'alternateGreetings/0', 'cjs']) {
            expect(planReplay(recordOf(M, edit(target, 0, 'a', 'b')).record, 'undo', reader)).toEqual({ ok: false, reason: 'precondition' })
        }
    })
})

// ---------------------------------------------------------------- reverts and restore points

describe('a revert and a restore point carry the first message and the example message', () => {
    function typeDesc(state: ModelState, c: TestCharacter, value: string): ModelState {
        const reader = charReader(c)
        const built = buildFieldEdit('desc', value, reader)
        if (built.ok === false) {
            throw new Error('no edit')
        }
        stepCounter += 1
        const next = commitStep(state, {
            id: `s${stepCounter}`,
            at: stepCounter * 10_000,
            visitId: 'v1',
            label: built.label,
            ops: built.ops,
            restoreWrites: deriveRestoreWrites(built.ops, null),
            coalesceKey: null,
            replacesRestore: true,
        })
        applyCharacterWrites(asCharacter(c), built.writes, null)
        return next
    }

    test('a revert across a merge restores the first message, stores it as a set, and its undo re-applies the merge', () => {
        const c = makeCharacter({ firstMessage: 'first {{image::smile2}} message' })
        let state = typeDesc(freshState(A), c, 'desc one')
        const anchor = state.record.done[0].id
        state = landCharacter(state, c, [edit('firstMessage', 15, 'smile2', 'smile')]).state
        state = typeDesc(state, c, 'desc two')
        const plan = planRevert(state.record, anchor, charReader(c))
        if (plan.ok === false) {
            throw new Error(`revert refused: ${plan.reason}`)
        }
        expect(plan.ops).toEqual(
            expect.arrayContaining([
                { op: 'set', path: 'firstMessage', before: { had: true, value: 'first {{image::smile}} message' }, after: { had: true, value: 'first {{image::smile2}} message' } },
            ]),
        )
        applyCharacterWrites(asCharacter(c), plan.writes, null)
        expect(c.firstMessage).toBe('first {{image::smile2}} message')
        expect(c.desc).toBe('desc one')
        stepCounter += 1
        const reverted = commitStep(state, {
            id: `s${stepCounter}`,
            at: 99_999_999,
            visitId: 'v1',
            label: plan.label,
            ops: plan.ops,
            restoreWrites: plan.restoreWrites,
            coalesceKey: null,
            replacesRestore: false,
        })
        replayCharacter(reverted, c, 'undo')
        expect(c.firstMessage).toBe('first {{image::smile}} message')
        expect(c.desc).toBe('desc two')
    })

    test('a restore point learns both messages and the system prompt from a merge and restores them; a text that is no set path (a lore entry) contributes nothing', () => {
        const c = makeCharacter({
            firstMessage: 'first {{image::smile2}} message',
            exampleMessage: 'example {{image::smile2}}',
            systemPrompt: 'system {{image::smile2}}',
            backgroundHTML: 'html {{image::smile2}}',
            globalLore: [{ key: 'k0', content: 'lore {{image::smile2}}' }],
        })
        let state = typeDesc(freshState(A), c, 'desc one')
        state = landCharacter(state, c, [
            edit('firstMessage', 15, 'smile2', 'smile'),
            edit('exampleMessage', 17, 'smile2', 'smile'),
            edit('systemPrompt', 16, 'smile2', 'smile'),
            edit('backgroundHTML', 14, 'smile2', 'smile'),
            edit('lore/0/content', 14, 'smile2', 'smile'),
        ]).state
        const restore = state.record.restore
        expect(Object.keys(restore?.fields ?? {})).toEqual(expect.arrayContaining(['desc', 'firstMessage', 'exampleMessage', 'systemPrompt', 'backgroundHTML']))
        expect(Object.keys(restore?.fields ?? {})).not.toContain('lore/0/content')
        expect(restore?.fields.backgroundHTML?.before).toEqual({ had: true, value: 'html {{image::smile2}}' })
        expect(restore?.fields.systemPrompt?.before).toEqual({ had: true, value: 'system {{image::smile2}}' })
        const plan = planRestorePoint(restore, charReader(c), new Set())
        if (plan.ok === false) {
            throw new Error(`restore refused: ${plan.reason}`)
        }
        expect(plan.changedElsewhere).toEqual([])
        expect(plan.writes).toEqual(
            expect.arrayContaining([
                { op: 'set', path: 'firstMessage', value: { had: true, value: 'first {{image::smile2}} message' } },
                { op: 'set', path: 'exampleMessage', value: { had: true, value: 'example {{image::smile2}}' } },
                { op: 'set', path: 'systemPrompt', value: { had: true, value: 'system {{image::smile2}}' } },
            ]),
        )
    })
})

describe('a record keeps the new fields to the owner that has them', () => {
    function serialized(owner: OwnerKey, over: Record<string, unknown>): unknown {
        return JSON.parse(JSON.stringify({ ownerKey: owner, touchedAt: 1, done: [], undone: [], deleted: [], restore: null, ...over }))
    }

    test('a character record holding a stored text edit of a non-legacy target reads, and a module record holds no set op but customModuleToggle', () => {
        const step = { id: 's1', at: 1, label: { kind: 'assetMerge', from: 'a', to: 'b' }, ops: [edit('systemPrompt', 0, 'a', 'b')] }
        expect(parseOwnerRecord(serialized(A, { done: [step] }), A)).not.toBeNull()
        const set = { id: 's2', at: 1, label: { kind: 'field', field: 'firstMessage' }, ops: [{ op: 'set', path: 'firstMessage', before: { had: false }, after: { had: true, value: 'x' } }] }
        expect(parseOwnerRecord(serialized(M, { done: [set] }), M)).toBeNull()
    })
})

// ---------------------------------------------------------------- every rewritable target, one step

function rngOf(seed: number): () => number {
    let state = seed >>> 0
    return () => {
        state = (state + 0x6d2b79f5) >>> 0
        let t = state
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

interface PlannedEdit {
    target: string
    offset: number
    from: string
    to: string
}

// Names of the rewritten references: never empty, so each reference is one the scanner reads.
const REPLACEMENTS = ['Q', 'a longer replacement', 'zz', 'x y', 'longer name 2']

interface ShapedTarget {
    path: string
    text: string
    edits: PlannedEdit[]
}

// A text of one to three asset references and one name edit per reference, highest offset first, so each edit's offset
// is valid on the text the earlier edits left. A `textEdit` applies only to a whole scanned reference name, so every
// generated target holds references and not arbitrary text.
function shapedTarget(path: string, rng: () => number): ShapedTarget {
    const count = 1 + Math.floor(rng() * 3)
    let text = ''
    const edits: PlannedEdit[] = []
    for (let i = 0; i < count; i++) {
        text += `${i === 0 ? '' : ' '}{{image::`
        const name = `n${i}${Math.floor(rng() * 100)}`
        edits.push({ target: path, offset: text.length, from: name, to: REPLACEMENTS[Math.floor(rng() * REPLACEMENTS.length)] })
        text += `${name}}}`
    }
    return { path, text, edits: edits.reverse() }
}

function applyEdits(text: string, edits: readonly PlannedEdit[]): string {
    let result = text
    for (const e of edits) {
        result = result.slice(0, e.offset) + e.to + result.slice(e.offset + e.from.length)
    }
    return result
}

// The independent oracle of where a path's text lives, by owner kind.
function holderOf(kind: 'character' | 'module', owner: object, path: string): { holder: Record<string, unknown>; key: string } {
    const parts = path.split('/')
    const root = owner as Record<string, unknown>
    const at = (value: unknown, key: string | number): Record<string, unknown> => (value as Record<string, Record<string, unknown>>)[key]
    if (parts[0] === 'alternateGreetings') {
        return { holder: root.alternateGreetings as unknown as Record<string, unknown>, key: parts[1] }
    }
    if (parts[0] === 'lore' || parts[0] === 'regex') {
        const list = kind === 'character' ? (parts[0] === 'lore' ? root.globalLore : root.customscript) : parts[0] === 'lore' ? root.lorebook : root.regex
        return { holder: at(list, Number(parts[1])), key: parts[2] }
    }
    if (parts[0] === 'trigger') {
        const list = kind === 'character' ? root.triggerscript : root.trigger
        const entry = at(list, Number(parts[1]))
        return { holder: at(entry[parts[2]], Number(parts[3])), key: parts[4] }
    }
    if (parts.length === 2) {
        return { holder: root[parts[0]] as Record<string, unknown>, key: parts[1] }
    }
    return { holder: root, key: parts[0] }
}

function expectedKind(path: string): 'set' | 'listSet' | 'textSet' {
    const SET_TARGETS = ['desc', 'firstMessage', 'exampleMessage', 'systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt/prompt', 'defaultVariables', 'translatorNote', 'creatorNotes', 'newGenData/prompt', 'newGenData/negative', 'newGenData/instructions', 'newGenData/emotionInstructions', 'backgroundHTML']
    if (SET_TARGETS.includes(path)) {
        return 'set'
    }
    return path.startsWith('alternateGreetings/') ? 'listSet' : 'textSet'
}

const text = fc.string({ maxLength: 14 })
const word = fc.constantFrom('', 'a', 'smile', 'x y', 'hello world', 'lo')

const effectArb = fc.oneof(
    fc.record({ type: fc.constant('v2SetVar'), var: word, varType: fc.constant('var'), operator: fc.constant('='), valueType: fc.constantFrom('value', 'var'), value: text }),
    fc.record({ type: fc.constant('setvar'), var: word, operator: fc.constant('='), value: text }),
    fc.record({ type: fc.constant('triggerlua'), code: text }),
    fc.record({ type: fc.constant('extractRegex'), regex: text, result: text, flags: word, value: text, inputVar: word }),
    fc.record({ type: fc.constant('v2ExtractRegex'), regex: text, regexType: fc.constantFrom('value', 'var'), result: word, value: text, valueType: fc.constantFrom('value', 'var') }),
)

const conditionArb = fc.oneof(
    fc.record({ type: fc.constant('var'), var: word, operator: fc.constant('='), value: text }),
    fc.record({ type: fc.constant('value'), var: text, operator: fc.constant('='), value: text }),
    fc.record({ type: fc.constant('exists'), type2: fc.constantFrom('strict', 'loose', 'regex'), value: text, depth: fc.nat(5) }),
)

const triggerArb = fc.record({
    comment: word,
    type: fc.constant('manual'),
    conditions: fc.array(conditionArb, { maxLength: 2 }),
    effect: fc.array(effectArb, { maxLength: 3 }),
})

const characterArb: fc.Arbitrary<TestCharacter> = fc.record({
    chaId: fc.constant('A'),
    desc: text,
    firstMessage: text,
    exampleMessage: text,
    alternateGreetings: fc.array(text, { maxLength: 3 }),
    systemPrompt: text,
    replaceGlobalNote: text,
    additionalText: text,
    personality: text,
    scenario: text,
    backgroundHTML: text,
    defaultVariables: text,
    translatorNote: text,
    creatorNotes: text,
    depth_prompt: fc.record({ depth: fc.nat(10), prompt: text }),
    newGenData: fc.record({ prompt: text, negative: text, instructions: text, emotionInstructions: text }),
    globalLore: fc.array(fc.record({ key: word, content: text }), { maxLength: 3 }),
    customscript: fc.array(fc.record({ in: word, out: text, type: fc.constant('editoutput') }), { maxLength: 3 }),
    triggerscript: fc.array(triggerArb, { maxLength: 2 }),
    additionalAssets: fc.constant([]),
    emotionImages: fc.constant([]),
})

const moduleArb: fc.Arbitrary<TestModule> = fc.record({
    id: fc.constant('M'),
    name: fc.constant('M'),
    assets: fc.constant([]),
    lorebook: fc.array(fc.record({ key: word, content: text }), { maxLength: 3 }),
    regex: fc.array(fc.record({ in: word, out: text, type: fc.constant('editoutput') }), { maxLength: 3 }),
    trigger: fc.array(triggerArb, { maxLength: 2 }),
    backgroundEmbedding: text,
    cjs: text,
})

// Plans edits of every given rewritable target, forcing one edit of the step to change the text's length.
function planStep(targets: readonly ShapedTarget[]): { ops: Op[]; finals: Map<string, string> } {
    const all = targets.flatMap((entry) => entry.edits)
    if (all.length > 0 && all.every((e) => e.from.length === e.to.length)) {
        all[all.length - 1].to += '!'
    }
    const finals = new Map<string, string>()
    for (const target of targets) {
        finals.set(target.path, applyEdits(target.text, target.edits))
    }
    return { ops: all.map((e) => edit(e.target, e.offset, e.from, e.to)), finals }
}

function roundTrip(kind: 'character' | 'module', owner: TestCharacter | TestModule, paths: readonly { path: string; text: string }[], rng: () => number): void {
    const targets = paths.map((entry) => shapedTarget(entry.path, rng))
    for (const target of targets) {
        const slot = holderOf(kind, owner, target.path)
        slot.holder[slot.key] = target.text
    }
    const original = structuredClone(owner)
    const expected = structuredClone(owner)
    const { ops, finals } = planStep(targets)
    if (ops.length === 0) {
        return
    }
    for (const [path, value] of finals) {
        const slot = holderOf(kind, expected, path)
        slot.holder[slot.key] = value
    }
    if (kind === 'character') {
        const c = owner as TestCharacter
        const landed = landCharacter(freshState(A), c, ops)
        expect(landed.writes.map((write) => write.op)).toEqual(ops.map((op) => (op.op === 'textEdit' ? expectedKind(op.target) : op.op)))
        expect(c).toEqual(expected)
        const undone = replayCharacter(landed.state, c, 'undo')
        expect(c).toEqual(original)
        replayCharacter(undone.state, c, 'redo')
        expect(c).toEqual(expected)
    } else {
        const holder: ModuleHolder = { module: owner as TestModule }
        const live = holder.module
        const landed = landModule(freshState(M), holder, ops)
        expect(live).toEqual(original)
        expect(holder.module).toEqual(expected)
        const undone = replayModule(landed.state, holder, 'undo')
        expect(holder.module).toEqual(original)
        replayModule(undone.state, holder, 'redo')
        expect(holder.module).toEqual(expected)
    }
}

describe('every rewritable target of an owner round-trips as whole-value writes', () => {
    function rewritables(kind: 'character' | 'module', owner: TestCharacter | TestModule): { path: string; text: string }[] {
        const target: TargetOwner = kind === 'character' ? { kind: 'character', source: owner as TestCharacter } : { kind: 'module', source: owner as TestModule }
        return enumerateClassifiedTargets(target)
            .filter((entry) => entry.cls === 'rewritable')
            .map(({ path, text: value }) => ({ path, text: value }))
    }

    test('a character: all targets in one step, then each target alone, with edits that change the length', () => {
        fc.assert(
            fc.property(characterArb, fc.integer(), (generated, seed) => {
                const targets = rewritables('character', generated)
                roundTrip('character', structuredClone(generated), targets, rngOf(seed))
                for (const single of targets) {
                    roundTrip('character', structuredClone(generated), [single], rngOf(seed))
                }
            }),
            { numRuns: 40 },
        )
    })

    test('a module: all targets in one step, several lore and regex entries included, then each target alone', () => {
        fc.assert(
            fc.property(moduleArb, fc.integer(), (generated, seed) => {
                const targets = rewritables('module', generated)
                roundTrip('module', structuredClone(generated), targets, rngOf(seed))
                for (const single of targets) {
                    roundTrip('module', structuredClone(generated), [single], rngOf(seed))
                }
            }),
            { numRuns: 40 },
        )
    })

    test('the imported-looking character and module with every registry target land in one step', () => {
        const c = makeCharacter()
        const m = makeModule({ lorebook: [{ key: 'a', content: 'one smile2' }, { key: 'b', content: 'two smile2' }, { key: 'c', content: 'three smile2' }] })
        roundTrip('character', c, rewritables('character', c), rngOf(7))
        roundTrip('module', m, rewritables('module', m), rngOf(11))
    })
})
