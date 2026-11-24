import { describe, expect, test } from 'vitest'
import {
    CHARACTER_SET_PATHS,
    CHAT_SET_PATHS,
    parseOwnerRecord,
    type OwnerRecord,
    RESTORE_PATH_ORDER,
    TEXT_FIELD_PATHS,
    type RestorePoint,
    type Step,
    type TextFieldPath,
} from '../historyModel'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey, type StoredOwnerKey } from '../ownerPhase'
import { HISTORY_FORMAT_VERSION, asideMarkKey, entryKey, headerKey, stepPart, type StoredOwnerRecord } from '../studioHistoryStore'
import { PRESET_FORM_PATHS, PRESET_S4B_PATHS, PRESET_S4C_PATHS, PRESET_S4D_PATHS } from './presetPaths.test-helpers'
import { createMemoryStudioStore, seedOwner, storedRecord } from './studioStoreDoubles'

// ---------------------------------------------------------------- fixtures (built by the real writers)

const CHARACTER = characterOwnerKey('c1')

function setStep(id: string, path: TextFieldPath, before: string, after: string): Step {
    return {
        id,
        at: 1,
        label: { kind: 'field', field: path },
        ops: [{ op: 'set', path, before: { had: true, value: before }, after: { had: true, value: after } }],
    }
}

function recordOf(ownerKey: StoredOwnerKey, done: Step[], restore: RestorePoint | null = null): StoredOwnerRecord {
    return { ownerKey, touchedAt: 4, done, undone: [], deleted: [], restore }
}

function restoreOf(...paths: TextFieldPath[]): RestorePoint {
    const fields: RestorePoint['fields'] = {}
    for (const path of paths) {
        fields[path] = { before: { had: true, value: 'before' }, last: { had: true, value: 'last' } }
    }
    return { visitId: 'v1', at: 2, fields }
}

// The strict reader's view of a record written by the real serializer.
function readBack(record: StoredOwnerRecord): StoredOwnerRecord | null {
    const shared = new Map<string, string>()
    seedOwner(shared, record, 'w:1')
    return storedRecord(shared, record.ownerKey)?.record ?? null
}

describe('the character set paths', () => {
    test('the set paths, the text paths and the restore order are the closed lists', () => {
        const s1 = ['systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt.prompt', 'additionalData.creator', 'additionalData.character_version', 'nickname', 'defaultVariables', 'translatorNote']
        const s2a = ['creatorNotes', 'removedQuotes']
        const s2b = ['lowLevelAccess', 'utilityBot', 'escapeOutput']
        const s2c = ['bias']
        expect(CHARACTER_SET_PATHS).toEqual(['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', ...s1, ...s2a, ...s2b, ...s2c, 'lorePlus'])
        expect(TEXT_FIELD_PATHS).toEqual(['desc', 'firstMessage', 'exampleMessage', 'systemPrompt', 'replaceGlobalNote', 'additionalText', 'personality', 'scenario', 'depth_prompt.prompt', 'defaultVariables', 'translatorNote', 'backgroundEmbedding', 'creatorNotes'])
        expect(CHAT_SET_PATHS).toEqual(['note'])
        expect(RESTORE_PATH_ORDER).toEqual(['desc', 'firstMessage', 'exampleMessage', 'customModuleToggle', 'hideChatIcon', 'risutanium_render_when_complete', 'note', ...s1, 'moduleName', 'moduleDescription', 'moduleNamespace', 'moduleHideIcon', 'moduleLowLevelAccess', 'backgroundEmbedding', ...PRESET_FORM_PATHS, ...s2a, ...s2b, ...s2c, ...PRESET_S4B_PATHS, ...PRESET_S4C_PATHS, ...PRESET_S4D_PATHS, 'lorePlus', 'alternateGreetings'])
    })

    test('a character record keeps a first message set op, an example message set op, their labels and their restore keys', () => {
        const record = recordOf(
            CHARACTER,
            [setStep('p:1', 'firstMessage', 'a', 'b'), setStep('p:2', 'exampleMessage', 'c', 'd')],
            restoreOf('desc', 'firstMessage', 'exampleMessage'),
        )
        expect(readBack(record)).toEqual(record)
    })

    test('a character record keeps a render-when-complete set op, its label and its restore key', () => {
        const flag = 'risutanium_render_when_complete'
        const step: Step = {
            id: 'p:1',
            at: 1,
            label: { kind: 'field', field: flag },
            ops: [{ op: 'set', path: flag, before: { had: false }, after: { had: true, value: true } }],
        }
        const restore: RestorePoint = { visitId: 'v1', at: 2, fields: { [flag]: { before: { had: false }, last: { had: true, value: true } } } }
        const record = recordOf(CHARACTER, [step], restore)
        expect(readBack(record)).toEqual(record)
    })

    test('the render-when-complete path is boolean only: a string value is refused whole', () => {
        const flag = 'risutanium_render_when_complete'
        const step = (value: unknown): unknown => ({
            id: 'p:1',
            at: 1,
            label: { kind: 'field', field: flag },
            ops: [{ op: 'set', path: flag, before: { had: false }, after: { had: true, value } }],
        })
        const read = (value: unknown): OwnerRecord | null =>
            parseOwnerRecord({ ownerKey: CHARACTER, touchedAt: 4, done: [step(value)], undone: [], deleted: [], restore: null }, CHARACTER)
        expect(read(true)).not.toBeNull()
        expect(read('true')).toBeNull()
    })

    test('a chat record is refused whole for a first message set op, an example message set op or a restore key of either', () => {
        const chat = chatOwnerKey('c1', 'chat1')
        for (const path of ['firstMessage', 'exampleMessage'] as const) {
            expect(readBack(recordOf(chat, [setStep('p:1', path, 'a', 'b')])), `set ${path}`).toBeNull()
            expect(readBack(recordOf(chat, [], restoreOf(path))), `restore ${path}`).toBeNull()
        }
    })

    test('a module record is refused whole for a first message set op, an example message set op or a restore key of either', () => {
        const module = moduleOwnerKey('m1')
        for (const path of ['firstMessage', 'exampleMessage'] as const) {
            expect(readBack(recordOf(module, [setStep('p:1', path, 'a', 'b')])), `set ${path}`).toBeNull()
            expect(readBack(recordOf(module, [], restoreOf(path))), `restore ${path}`).toBeNull()
        }
    })

    test('a record with a first message restore entry and a revert that sets the example message reloads equal from the store', async () => {
        const revert: Step = {
            id: 'p:2',
            at: 2,
            label: { kind: 'revert', toStepId: 'p:1' },
            ops: [{ op: 'set', path: 'exampleMessage', before: { had: true, value: 'e1' }, after: { had: false } }],
        }
        const record = recordOf(CHARACTER, [setStep('p:1', 'firstMessage', 'f0', 'f1'), revert], restoreOf('firstMessage'))
        const store = createMemoryStudioStore()
        await store.load(CHARACTER)
        expect(await store.save(CHARACTER, record, new Set([CHARACTER]))).toMatchObject({ kind: 'ok' })
        const reopened = createMemoryStudioStore({ shared: store.shared })
        expect(await reopened.load(CHARACTER)).toEqual({ kind: 'ok', record })
    })
})

describe('a record outside the closed union', () => {
    // One entry of a stored five-step record, edited as JSON text.
    function seededWithEditedEntry(part: string, from: string, to: string): Map<string, string> {
        const done = [1, 2, 3, 4, 5].map((n) => setStep(`p:${n}`, 'desc', `a${n}`, `b${n}`))
        const shared = new Map<string, string>()
        seedOwner(shared, recordOf(CHARACTER, done, restoreOf('desc')), 'w:1')
        const gen = storedRecord(shared, CHARACTER)?.header.gen as string
        const key = entryKey(CHARACTER, gen, part)
        const text = shared.get(key) as string
        expect(text).toContain(from)
        shared.set(key, text.replace(from, to))
        return shared
    }

    const edits = {
        'a set path outside the union in the third of five steps': () => seededWithEditedEntry(stepPart('p:3'), '"path":"desc"', '"path":"zzNeverRegistered"'),
        'a dotted set path outside the union in the third of five steps': () => seededWithEditedEntry(stepPart('p:3'), '"path":"desc"', '"path":"depth_prompt.zzNeverRegistered"'),
        'an unknown restore key': () => seededWithEditedEntry('r', '"desc":{', '"zzNeverRegistered":{'),
        'an unknown dotted restore key': () => seededWithEditedEntry('r', '"desc":{', '"depth_prompt.zzNeverRegistered":{'),
    }

    test.each(Object.keys(edits))('%s is refused whole: the owner reads unreadable, never with fewer steps', async (name) => {
        const shared = edits[name as keyof typeof edits]()
        expect(storedRecord(shared, CHARACTER)).toBeNull()
        expect(await createMemoryStudioStore({ shared }).load(CHARACTER)).toEqual({ kind: 'unreadable' })
    })

    test.each(Object.keys(edits))('after %s one save keeps the stored header aside and every original entry byte-equal, and the new generation reads', async (name) => {
        const shared = edits[name as keyof typeof edits]()
        const headerText = shared.get(headerKey(CHARACTER)) as string
        const originals = [...shared].filter(([key]) => key.startsWith('e:'))
        expect(originals.length).toBeGreaterThan(5)

        const store = createMemoryStudioStore({ shared })
        expect(await store.load(CHARACTER)).toEqual({ kind: 'unreadable' })
        const mine = recordOf(CHARACTER, [setStep('p:9', 'desc', 'x', 'y')], restoreOf('desc'))
        expect(await store.save(CHARACTER, mine, new Set([CHARACTER]))).toMatchObject({ kind: 'ok', asided: true })

        expect(shared.get(asideMarkKey(CHARACTER))).toBe(headerText)
        for (const [key, value] of originals) {
            expect(shared.get(key), key).toBe(value)
        }
        expect(await createMemoryStudioStore({ shared }).load(CHARACTER)).toEqual({ kind: 'ok', record: mine })
    })
})

describe('the format version', () => {
    test('widening the set paths keeps version 2 on the header, the index and every entry', async () => {
        expect(HISTORY_FORMAT_VERSION).toBe(2)
        const record = recordOf(CHARACTER, [setStep('p:1', 'firstMessage', 'a', 'b')], restoreOf('exampleMessage'))
        const store = createMemoryStudioStore()
        await store.load(CHARACTER)
        await store.save(CHARACTER, record, new Set([CHARACTER]))
        const versions = [...store.shared.values()].map((text) => (JSON.parse(text) as { v: number }).v)
        expect(versions.length).toBeGreaterThan(3)
        expect(new Set(versions)).toEqual(new Set([2]))
    })
})
