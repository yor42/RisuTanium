// @vitest-environment jsdom
// T1-TX and T1-CX: the one text-write router. A `textEdit` on one of the Advanced text fields is read, replayed,
// reverted and restored through the field (a `set`), exactly as `desc` is; the router's inverse and the writers that
// consume it agree. The model, the live reader and the character writer are real; the owner is a plain object.
import { describe, expect, test, vi } from 'vitest'
import { parseTargetPath } from '../../assets/referenceTargets'
import { applyCharacterWrites, createLiveReader } from '../../edit/studioSetters'
import { factsOf, isHeldBy, registryPaths } from '../fieldAccess'
import {
    assetStepWrites,
    deriveRestoreWrites,
    emptyRecord,
    planReplay,
    planRevert,
    textBeforeOf,
    textFieldOf,
    textWriteFor,
    TEXT_FIELD_PATHS,
    type Op,
    type OwnerRecord,
    type Step,
} from '../historyModel'
import { characterOwnerKey } from '../ownerPhase'
import type { character } from 'src/ts/storage/database.svelte'
import { createMemoryStudioStore, storedRecord } from './studioStoreDoubles'
import fixture from './fixtures/historyV2.b0.json'

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

const A = characterOwnerKey('A')

type Bag = Record<string, unknown>

function makeLive(over: Bag = {}): character {
    return {
        chaId: 'A',
        desc: 'd1',
        firstMessage: 'f0',
        exampleMessage: 'e0',
        alternateGreetings: [],
        systemPrompt: 'sys',
        replaceGlobalNote: 'note',
        additionalText: 'add',
        personality: 'pers',
        scenario: 'scen',
        defaultVariables: 'dv',
        translatorNote: 'tn',
        depth_prompt: { depth: 2, prompt: 'dp' },
        newGenData: { prompt: 'ng', negative: '', instructions: '', emotionInstructions: '' },
        backgroundHTML: 'bg',
        additionalAssets: [],
        emotionImages: [],
        globalLore: [],
        customscript: [],
        triggerscript: [],
        chats: [],
        chatPage: 0,
        ...over,
    } as unknown as character
}

const readerOf = (live: character) => createLiveReader({ character: live, chat: null })
const bag = (live: character): Bag => live as unknown as Bag
const textEdit = (target: string, offset: number, from: string, to: string): Op => ({ op: 'textEdit', target, offset, from, to })

function recordWith(done: Step[]): OwnerRecord {
    return { ...emptyRecord(A, 0), done }
}

const MERGE = { kind: 'assetMerge', from: 'a', to: 'b' } as const

describe('T1-TX (a)(b): the router membership', () => {
    test('(a) the text field paths are the literal list', () => {
        expect([...TEXT_FIELD_PATHS]).toEqual([
            'desc', 'firstMessage', 'exampleMessage', 'systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario',
            'depth_prompt.prompt', 'defaultVariables', 'translatorNote', 'backgroundEmbedding',
        ])
    })

    test('(b) a registered character text path is a text field path exactly when a registry target addresses it', () => {
        for (const path of registryPaths().filter((entry) => isHeldBy(entry, 'character'))) {
            const target = path.replace('.', '/')
            const addressed = parseTargetPath('character', target) !== null
            expect(TEXT_FIELD_PATHS.some((entry) => entry === path), path).toBe(addressed)
        }
    })
})

describe('T5-TX: the module counterpart of T1-TX (b)', () => {
    test('a registered module text path is a text field path exactly when a module registry target addresses it', () => {
        for (const path of registryPaths().filter((entry) => isHeldBy(entry, 'module') && factsOf(entry).value === 'text')) {
            const target = path.replace('.', '/')
            const addressed = parseTargetPath('module', target) !== null
            expect(TEXT_FIELD_PATHS.some((entry) => entry === path), path).toBe(addressed)
        }
    })

    test('the module embedding is addressed by its own property name, so the path is the target', () => {
        expect(textFieldOf('backgroundEmbedding')).toBe('backgroundEmbedding')
        expect(parseTargetPath('module', 'backgroundEmbedding')).toEqual({ field: 'backgroundEmbedding' })
    })
})
describe('T1-TX (c): a revert across a form edit and a merge on one text field', () => {
    const desc: Step = { id: 'p:0', at: 0, label: { kind: 'field', field: 'desc' }, ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'd0' }, after: { had: true, value: 'd1' } }] }

    test('systemPrompt ends at its first value and the stored step nets the field', () => {
        const merged = 'b {{image::smile2}}'
        const done: Step[] = [
            desc,
            { id: 'p:1', at: 1, label: { kind: 'field', field: 'systemPrompt' }, ops: [{ op: 'set', path: 'systemPrompt', before: { had: true, value: 'a' }, after: { had: true, value: merged } }] },
            { id: 'p:2', at: 2, label: MERGE, ops: [textEdit('systemPrompt', 11, 'smile2', 'smile')] },
        ]
        const live = makeLive({ systemPrompt: 'b {{image::smile}}' })
        const plan = planRevert(recordWith(done), 'p:0', readerOf(live))
        if (plan.ok === false) {
            throw new Error(`revert refused: ${plan.reason}`)
        }
        applyCharacterWrites(live, plan.writes, null)
        expect(live.systemPrompt).toBe('a')
        const sets = plan.ops.filter((op) => op.op === 'set' && op.path === 'systemPrompt')
        expect(sets.length).toBeGreaterThan(0)
        expect(plan.ops.some((op) => op.op === 'textEdit')).toBe(false)
    })

    test('depth_prompt.prompt ends at its first value through the nested container', () => {
        const merged = 'b {{image::smile2}}'
        const done: Step[] = [
            desc,
            { id: 'p:1', at: 1, label: { kind: 'field', field: 'depth_prompt.prompt' }, ops: [{ op: 'set', path: 'depth_prompt.prompt', before: { had: true, value: 'a' }, after: { had: true, value: merged } }] },
            { id: 'p:2', at: 2, label: MERGE, ops: [textEdit('depth_prompt/prompt', 11, 'smile2', 'smile')] },
        ]
        const live = makeLive({ depth_prompt: { depth: 2, prompt: 'b {{image::smile}}' } })
        const plan = planRevert(recordWith(done), 'p:0', readerOf(live))
        if (plan.ok === false) {
            throw new Error(`revert refused: ${plan.reason}`)
        }
        applyCharacterWrites(live, plan.writes, null)
        expect(bag(live).depth_prompt).toStrictEqual({ depth: 2, prompt: 'a' })
        expect(plan.ops.some((op) => op.op === 'textEdit')).toBe(false)
    })
})

describe('T1-TX (d): the restore point learns a merged text field', () => {
    test('a textEdit on systemPrompt with its text before gives a restore write for the field', () => {
        const writes = deriveRestoreWrites([textEdit('systemPrompt', 13, 'smile2', 'smile')], null, { systemPrompt: 'sys {{image::smile2}}' })
        expect(writes).toEqual([{ path: 'systemPrompt', before: { had: true, value: 'sys {{image::smile2}}' }, after: { had: true, value: 'sys {{image::smile}}' } }])
    })

    test('the live reader feeds textBeforeOf for the new text fields', () => {
        const live = makeLive()
        const before = textBeforeOf((path) => readerOf(live).field(path))
        expect(before.systemPrompt).toBe('sys')
        expect(before['depth_prompt.prompt']).toBe('dp')
        expect(before.defaultVariables).toBe('dv')
    })
})

describe('T1-TX (e): notRestored names the registry target', () => {
    test('a stored set of depth_prompt.prompt that fails to undo beside a row op is named depth_prompt/prompt', () => {
        const tuple = ['smile', 'assets/smile.png', 'png']
        const step: Step = {
            id: 'p:1',
            at: 1,
            label: MERGE,
            ops: [
                { op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple, count: 1 },
                { op: 'set', path: 'depth_prompt.prompt', before: { had: true, value: 'a' }, after: { had: true, value: 'b' } },
            ],
        }
        const live = makeLive({ depth_prompt: { depth: 2, prompt: 'edited by hand' } })
        const plan = planReplay(recordWith([step]), 'undo', readerOf(live))
        expect(plan.ok).toBe(true)
        if (plan.ok) {
            expect(plan.notRestored).toEqual(['depth_prompt/prompt'])
        }
    })
})

describe('T1-TX (f): the character text writer skips what the router sends to a set', () => {
    test('a textSet on a text field path leaves the value, and one on a nested non-field text writes it', () => {
        const live = makeLive()
        applyCharacterWrites(
            live,
            [
                { op: 'textSet', target: 'systemPrompt', value: 'X' },
                { op: 'textSet', target: 'depth_prompt/prompt', value: 'Y' },
                { op: 'textSet', target: 'personality', value: 'Z' },
            ],
            null,
        )
        expect(live.systemPrompt).toBe('sys')
        expect(bag(live).depth_prompt).toStrictEqual({ depth: 2, prompt: 'dp' })
        expect(bag(live).personality).toBe('pers')
        applyCharacterWrites(live, [{ op: 'textSet', target: 'newGenData/prompt', value: 'N' }, { op: 'textSet', target: 'backgroundHTML', value: 'B' }], null)
        expect((bag(live).newGenData as Bag).prompt).toBe('N')
        expect(bag(live).backgroundHTML).toBe('B')
    })
})

describe('T1-TX (g)(h): textFieldOf is the exact inverse and textWriteFor is the one decision', () => {
    test('(g) a registry target maps to its field path and nothing else does', () => {
        expect(textFieldOf('depth_prompt/prompt')).toBe('depth_prompt.prompt')
        expect(textFieldOf('systemPrompt')).toBe('systemPrompt')
        for (const other of ['depth_prompt.prompt', 'depth_prompt/other', 'newGenData/prompt', 'backgroundHTML', 'nickname', 'additionalData/creator', 'lore/0/content', 'Desc']) {
            expect(textFieldOf(other), other).toBeNull()
        }
    })

    test('(h) the write for a nested field target is a set of its dotted path', () => {
        expect(textWriteFor('depth_prompt/prompt', 'v')).toEqual({ op: 'set', path: 'depth_prompt.prompt', value: { had: true, value: 'v' } })
        expect(textWriteFor('alternateGreetings/2', 'v')).toEqual({ op: 'listSet', index: 2, value: 'v' })
        expect(textWriteFor('newGenData/prompt', 'v')).toEqual({ op: 'textSet', target: 'newGenData/prompt', value: 'v' })
    })
})

describe('T1-CX: records written before the widening replay to the same landed text', () => {
    const stored = fixture as unknown as { ownerKey: string; record: OwnerRecord; entries: [string, string][] }

    test('old-record leg: the stored v2 record reads, and an undo against a live character is decided as before', () => {
        const shared = new Map<string, string>(stored.entries)
        const view = storedRecord(shared, characterOwnerKey('c1'))
        expect(view?.record).toEqual(stored.record)
        const live = makeLive({ chaId: 'c1', systemPrompt: 'be very' })
        const before = structuredClone(live)
        const plan = planReplay(stored.record, 'undo', readerOf(live))
        // The fixture's spans are not scanned references, so the replay is refused and nothing lands.
        expect(plan).toEqual({ ok: false, reason: 'precondition' })
        expect(live).toEqual(before)
    })

    test('old-record leg: a stored-shape systemPrompt textEdit on a scanned reference lands the independent splice', () => {
        const landed = makeLive({ systemPrompt: '{{image::smile}} tail' })
        const step2: Step = { id: 'p:1', at: 1, label: MERGE, ops: [textEdit('systemPrompt', 9, 'smile2', 'smile')] }
        const plan2 = planReplay(recordWith([step2]), 'undo', readerOf(landed))
        if (plan2.ok === false) {
            throw new Error(`undo refused: ${plan2.reason}`)
        }
        applyCharacterWrites(landed, plan2.writes, null)
        const text = '{{image::smile}} tail'
        expect(landed.systemPrompt).toBe(text.slice(0, 9) + 'smile2' + text.slice(9 + 'smile'.length))
    })

    test('new-producer leg: a merge on systemPrompt and depth_prompt/prompt lands and undoes to the pre-merge texts', () => {
        const live = makeLive({ systemPrompt: 'sys {{image::smile2}}', depth_prompt: { depth: 2, prompt: 'dp {{image::smile2}}' } })
        const ops: Op[] = [textEdit('systemPrompt', 13, 'smile2', 'smile'), textEdit('depth_prompt/prompt', 12, 'smile2', 'smile')]
        const writes = assetStepWrites(ops, readerOf(live))
        if (writes === null) {
            throw new Error('the merge does not apply')
        }
        expect(writes.every((write) => write.op === 'set')).toBe(true)
        applyCharacterWrites(live, writes, null)
        expect(live.systemPrompt).toBe('sys {{image::smile}}')
        expect(bag(live).depth_prompt).toStrictEqual({ depth: 2, prompt: 'dp {{image::smile}}' })
        const plan = planReplay(recordWith([{ id: 'p:1', at: 1, label: MERGE, ops }]), 'undo', readerOf(live))
        if (plan.ok === false) {
            throw new Error(`undo refused: ${plan.reason}`)
        }
        applyCharacterWrites(live, plan.writes, null)
        expect(live.systemPrompt).toBe('sys {{image::smile2}}')
        expect(bag(live).depth_prompt).toStrictEqual({ depth: 2, prompt: 'dp {{image::smile2}}' })
    })

    test('loading the fixture is ok and writes nothing', async () => {
        const shared = new Map<string, string>(stored.entries)
        const store = createMemoryStudioStore({ shared })
        expect(await store.load(characterOwnerKey('c1'))).toEqual({ kind: 'ok', record: stored.record })
        expect(store.writes).toEqual([])
    })
})
