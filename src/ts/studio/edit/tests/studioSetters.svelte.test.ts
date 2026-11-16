// @vitest-environment jsdom
// The setter half of a Studio write, without the service: the guards in their fixed order, the live
// reader, the op builders and the functions handed to writeLive*. The marks and the history around
// them are tested through the service in ownerHistory.svelte.test.ts.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { resetStudioScreenForTests, studioScreen } from 'src/ts/studio/studioScreen.svelte'
import { characterOwnerKey, chatOwnerKey, moduleOwnerKey } from 'src/ts/studio/history/ownerPhase'
import { commitStep, createModelState, deriveRestoreWrites, emptyRecord, planReplay } from 'src/ts/studio/history/historyModel'
import { listFingerprintOf } from 'src/ts/studio/history/listFingerprint'
import type { Chat, character } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'
import { ASSET_FOLDER_KEY, ASSET_RETAINED_KEY } from 'src/ts/studio/assets/assetOwnerKeys'
import { stubModule, watchBodyKeys } from 'src/ts/studio/studioFixtures.test-helpers'
import {
    applyCharacterWrites,
    applyChatWrites,
    buildFieldEdit,
    buildGreetingAdd,
    buildGreetingDelete,
    buildGreetingEdit,
    buildWrittenModule,
    createLiveReader,
    createModuleLiveReader,
    isModuleTarget,
    isRestrictedChaId,
    resolveLiveTarget,
    uniqueChatById,
    writeLiveModule,
    type LiveTarget,
} from '../studioSetters'

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

interface LiveChat {
    id?: string
    note: string
    fmIndex?: number
}

interface LiveCharacter {
    chaId: string
    type?: string
    license?: string
    coldstorage?: string
    desc: string
    firstMessage?: string
    exampleMessage?: string
    hideChatIcon?: boolean
    alternateGreetings: string[]
    chats: LiveChat[]
    chatPage: number
}

function makeCharacter(chaId: string, overrides: Partial<LiveCharacter> = {}): LiveCharacter {
    return {
        chaId,
        desc: 'd0',
        alternateGreetings: ['g0', 'g1', 'g2'],
        chats: [{ id: 'c1', note: 'n0', fmIndex: 2 }],
        chatPage: 0,
        ...overrides,
    }
}

function put(...characters: LiveCharacter[]): void {
    DBState.db.characters = characters as unknown as typeof DBState.db.characters
}

const A = characterOwnerKey('A')

function targetOf(live: LiveCharacter, chat: LiveChat | null = null): LiveTarget {
    return { character: live as unknown as character, chat: chat as unknown as Chat | null }
}

beforeEach(() => {
    resetStudioScreenForTests()
    put(makeCharacter('A'))
    selIdState.selId = 0
    studioScreen.chaId = 'A'
})

afterEach(() => {
    resetStudioScreenForTests()
})

describe('resolveLiveTarget: the guards in their fixed order', () => {
    test('a clean selected character resolves; a chat owner resolves its chat by id', () => {
        expect(resolveLiveTarget(A)).toMatchObject({ ok: true, target: { chat: null } })
        const chat = resolveLiveTarget(chatOwnerKey('A', 'c1'))
        expect(chat.ok).toBe(true)
        expect(chat.ok && chat.target.chat?.note).toBe('n0')
    })

    test('each refusal wins over every later one', () => {
        // Not selected, duplicated, a group, private, archived, no chat: all at once.
        put(
            makeCharacter('A', { type: 'group', license: 'private', coldstorage: 'x', chats: [{ id: 'd', note: '' }, { id: 'd', note: '' }] }),
            makeCharacter('A'),
        )
        studioScreen.chaId = 'other'
        const chat = chatOwnerKey('A', 'd')
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'not-selected' })
        studioScreen.chaId = 'A'
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'duplicate-id' })
        put(makeCharacter('A', { type: 'group', license: 'private', coldstorage: 'x', chats: [{ id: 'd', note: '' }, { id: 'd', note: '' }] }))
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'group' })
        put(makeCharacter('A', { license: 'private', coldstorage: 'x', chats: [{ id: 'd', note: '' }, { id: 'd', note: '' }] }))
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'restricted' })
        put(makeCharacter('A', { coldstorage: 'x', chats: [{ id: 'd', note: '' }, { id: 'd', note: '' }] }))
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'gone' })
        put(makeCharacter('A', { chats: [{ id: 'd', note: '' }, { id: 'd', note: '' }] }))
        expect(resolveLiveTarget(chat)).toEqual({ ok: false, reason: 'no-unique-chat' })
    })

    test('T-SM4: a chaId held twice is refused, whichever holder is selected', () => {
        put(makeCharacter('A'), makeCharacter('A', { desc: 'the second holder' }))
        expect(resolveLiveTarget(A)).toEqual({ ok: false, reason: 'duplicate-id' })
        selIdState.selId = 1
        expect(resolveLiveTarget(A)).toEqual({ ok: false, reason: 'duplicate-id' })
    })

    test('an owner key that names no id, and a chat without an id, resolve to nothing', () => {
        expect(resolveLiveTarget(chatOwnerKey('A', ''))).toEqual({ ok: false, reason: 'gone' })
        put(makeCharacter('A', { chats: [{ note: 'no id' }] }))
        expect(resolveLiveTarget(chatOwnerKey('A', 'anything'))).toEqual({ ok: false, reason: 'no-unique-chat' })
    })

    test('isRestrictedChaId: private and group, never a missing character', () => {
        expect(isRestrictedChaId('A')).toBe(false)
        put(makeCharacter('A', { license: 'private' }))
        expect(isRestrictedChaId('A')).toBe(true)
        put(makeCharacter('A', { type: 'group' }))
        expect(isRestrictedChaId('A')).toBe(true)
        expect(isRestrictedChaId('missing')).toBe(false)
    })

    test('uniqueChatById needs one match and a non-empty id', () => {
        const chats = [{ id: 'a', note: '' }, { id: 'a', note: '' }, { id: 'b', note: '' }] as unknown as Chat[]
        expect(uniqueChatById(chats, 'a')).toBeNull()
        expect(uniqueChatById(chats, 'b')).toBe(chats[2])
        expect(uniqueChatById(chats, '')).toBeNull()
        expect(uniqueChatById(undefined, 'b')).toBeNull()
    })
})

describe('the live reader', () => {
    test('reads present and absent fields, the greeting list and a chat\'s fmIndex by unique id', () => {
        const live = makeCharacter('A', { chats: [{ id: 'one', note: 'n', fmIndex: 3 }, { id: 'dup', note: '' }, { id: 'dup', note: '' }] })
        const reader = createLiveReader(targetOf(live, live.chats[0]))
        expect(reader.field('desc')).toEqual({ had: true, value: 'd0' })
        expect(reader.field('hideChatIcon')).toEqual({ had: false })
        expect(reader.field('note')).toEqual({ had: true, value: 'n' })
        expect(reader.greetings()).toEqual(['g0', 'g1', 'g2'])
        expect(reader.fmIndex('one')).toEqual({ had: true, value: 3 })
        expect(reader.fmIndex('dup')).toBeNull()
        expect(reader.fmIndex('missing')).toBeNull()
    })

    test('the first message and the example message read as their own strings, absent as had false', () => {
        const live = makeCharacter('A', { firstMessage: 'hello', exampleMessage: 'ex', hideChatIcon: true })
        const reader = createLiveReader(targetOf(live))
        expect(reader.field('firstMessage')).toEqual({ had: true, value: 'hello' })
        expect(reader.field('exampleMessage')).toEqual({ had: true, value: 'ex' })
        expect(reader.field('hideChatIcon')).toEqual({ had: true, value: true })
        const bare = createLiveReader(targetOf(makeCharacter('A', { hideChatIcon: true })))
        expect(bare.field('firstMessage')).toEqual({ had: false })
        expect(bare.field('exampleMessage')).toEqual({ had: false })
    })

    test('a character without a greeting list reads as null', () => {
        const live = makeCharacter('A')
        delete (live as Partial<LiveCharacter>).alternateGreetings
        expect(createLiveReader(targetOf(live)).greetings()).toBeNull()
    })
})

describe('the op builders', () => {
    test('a field edit records the before and the after; an unchanged or mistyped value builds nothing', () => {
        const reader = createLiveReader(targetOf(makeCharacter('A')))
        const built = buildFieldEdit('desc', 'new', reader)
        expect(built).toMatchObject({
            ok: true,
            coalesceKey: 'desc',
            ops: [{ op: 'set', path: 'desc', before: { had: true, value: 'd0' }, after: { had: true, value: 'new' } }],
        })
        expect(buildFieldEdit('desc', 'd0', reader)).toEqual({ ok: false, reason: 'unchanged' })
        expect(buildFieldEdit('desc', true, reader)).toEqual({ ok: false, reason: 'precondition' })
        expect(buildFieldEdit('hideChatIcon', 'yes', reader)).toEqual({ ok: false, reason: 'precondition' })
        const absent = buildFieldEdit('hideChatIcon', false, reader)
        expect(absent).toMatchObject({ ok: true, ops: [{ before: { had: false }, after: { had: true, value: false } }] })
    })

    test('a first message edit builds exactly one set op and no list op', () => {
        const reader = createLiveReader(targetOf(makeCharacter('A', { firstMessage: 'hi' })))
        const built = buildFieldEdit('firstMessage', 'hello', reader)
        expect(built).toMatchObject({
            ok: true,
            label: { kind: 'field', field: 'firstMessage' },
            ops: [{ op: 'set', path: 'firstMessage', before: { had: true, value: 'hi' }, after: { had: true, value: 'hello' } }],
            writes: [{ op: 'set', path: 'firstMessage', value: { had: true, value: 'hello' } }],
        })
        if (built.ok === false) throw new Error('the edit must build')
        expect(built.ops).toHaveLength(1)
        expect(built.writes).toHaveLength(1)
        expect(built.ops.some((op) => op.op === 'listSet' || op.op === 'listInsert' || op.op === 'listRemove')).toBe(false)
        expect(buildFieldEdit('firstMessage', true, reader)).toEqual({ ok: false, reason: 'precondition' })
        expect(buildFieldEdit('exampleMessage', 'x', reader)).toEqual({ ok: false, reason: 'precondition' })
        const withExample = createLiveReader(targetOf(makeCharacter('A', { exampleMessage: 'e0' })))
        expect(buildFieldEdit('exampleMessage', 'x', withExample)).toMatchObject({ ok: true, ops: [{ before: { had: true, value: 'e0' } }] })
    })

    test('greeting add appends an empty one; edit keys its coalescing by index; both refuse out of range', () => {
        const reader = createLiveReader(targetOf(makeCharacter('A')))
        expect(buildGreetingAdd(reader)).toMatchObject({ ok: true, ops: [{ op: 'listInsert', index: 3, value: '' }], coalesceKey: null })
        expect(buildGreetingEdit(1, 'x', reader)).toMatchObject({ ok: true, coalesceKey: 'alternateGreetings:1' })
        expect(buildGreetingEdit(1, 'g1', reader)).toEqual({ ok: false, reason: 'unchanged' })
        expect(buildGreetingEdit(7, 'x', reader)).toEqual({ ok: false, reason: 'precondition' })
    })

    test('T56d a built greeting add commits a fingerprint, and its undo next to an equal neighbour applies', () => {
        const live = makeCharacter('A', { alternateGreetings: ['', 'g'] })
        const reader = createLiveReader(targetOf(live))
        const built = buildGreetingAdd(reader)
        if (built.ok === false) throw new Error('the add must build')
        const greetingsBefore = [...live.alternateGreetings]
        live.alternateGreetings.push('')
        const state = commitStep(createModelState(emptyRecord(characterOwnerKey('A'), 0)), {
            id: 'p:1',
            at: 1,
            visitId: 'v1',
            label: built.label,
            ops: built.ops,
            restoreWrites: deriveRestoreWrites(built.ops, greetingsBefore),
            coalesceKey: built.coalesceKey,
            replacesRestore: true,
        })
        expect(state.record.done[0].listFingerprint).toStrictEqual({
            before: listFingerprintOf(['', 'g']),
            after: listFingerprintOf(['', 'g', '']),
        })
        const plan = planReplay(state.record, 'undo', createLiveReader(targetOf(live)))
        expect(plan.ok).toBe(true)
    })

    test('a delete carries the fmIndex side op: by chat id when unique, by page index when not', () => {
        const live = makeCharacter('A')
        const unique = buildGreetingDelete(1, 'd1', targetOf(live), createLiveReader(targetOf(live)))
        expect(unique).toMatchObject({
            ok: true,
            pageFm: null,
            ops: [
                { op: 'listRemove', index: 1, value: 'g1', deletedId: 'd1' },
                { op: 'chatFm', chatId: 'c1', before: { had: true, value: 2 }, after: { had: true, value: -1 } },
            ],
            writes: [{ op: 'listRemove', index: 1 }, { op: 'chatFm', chatId: 'c1', value: { had: true, value: -1 } }],
        })

        const idless = makeCharacter('A', { chats: [{ note: '', fmIndex: 1 }] })
        const byIndex = buildGreetingDelete(0, 'd2', targetOf(idless), createLiveReader(targetOf(idless)))
        expect(byIndex).toMatchObject({ ok: true, pageFm: -1, ops: [{ op: 'listRemove' }, { op: 'chatFm', chatId: null }] })
        expect(byIndex.ok && byIndex.writes).toEqual([{ op: 'listRemove', index: 0 }])

        const chatless = makeCharacter('A', { chats: [] })
        const noChat = buildGreetingDelete(0, 'd3', targetOf(chatless), createLiveReader(targetOf(chatless)))
        expect(noChat).toMatchObject({ ok: true, pageFm: null, ops: [{ op: 'listRemove' }] })
        expect(buildGreetingDelete(9, 'd4', targetOf(live), createLiveReader(targetOf(live)))).toEqual({ ok: false, reason: 'precondition' })
    })
})

describe('the write functions', () => {
    test('a field set to absent deletes the key; it never assigns false or undefined', () => {
        const live = makeCharacter('A', { hideChatIcon: true })
        applyCharacterWrites(live as unknown as character, [{ op: 'set', path: 'hideChatIcon', value: { had: false } }], null)
        expect('hideChatIcon' in live).toBe(false)
        applyCharacterWrites(live as unknown as character, [{ op: 'set', path: 'hideChatIcon', value: { had: true, value: false } }], null)
        expect(live.hideChatIcon).toBe(false)
    })

    test('the first message and the example message are assigned; absent is a no-op, as for the description', () => {
        const live = makeCharacter('A', { firstMessage: 'f0', exampleMessage: 'e0' })
        applyCharacterWrites(
            live as unknown as character,
            [
                { op: 'set', path: 'firstMessage', value: { had: true, value: 'f1' } },
                { op: 'set', path: 'exampleMessage', value: { had: true, value: 'e1' } },
            ],
            null,
        )
        expect(live.firstMessage).toBe('f1')
        expect(live.exampleMessage).toBe('e1')
        expect(live.hideChatIcon).toBeUndefined()
        applyCharacterWrites(
            live as unknown as character,
            [
                { op: 'set', path: 'firstMessage', value: { had: false } },
                { op: 'set', path: 'exampleMessage', value: { had: false } },
                { op: 'set', path: 'desc', value: { had: false } },
            ],
            null,
        )
        expect(live.firstMessage).toBe('f1')
        expect(live.exampleMessage).toBe('e1')
        expect(live.desc).toBe('d0')
    })

    test('list writes run in order; chatFm acts on the unique chat; pageFm acts on the context chat', () => {
        const live = makeCharacter('A', { chats: [{ id: 'c1', note: '', fmIndex: 4 }, { note: '', fmIndex: 1 }], chatPage: 1 })
        applyCharacterWrites(
            live as unknown as character,
            [
                { op: 'listRemove', index: 0 },
                { op: 'listInsert', index: 1, value: 'new' },
                { op: 'listSet', index: 0, value: 'g1!' },
                { op: 'chatFm', chatId: 'c1', value: { had: false } },
                { op: 'chatFm', chatId: 'gone', value: { had: true, value: 9 } },
            ],
            -1,
        )
        expect(live.alternateGreetings).toEqual(['g1!', 'new', 'g2'])
        expect('fmIndex' in live.chats[0]).toBe(false)
        expect(live.chats[1].fmIndex).toBe(-1)
    })

    test('a group is never written', () => {
        const group = { type: 'group', chaId: 'G', alternateGreetings: ['g'] }
        applyCharacterWrites(group as unknown as character, [{ op: 'listInsert', index: 0, value: 'x' }], null)
        expect(group.alternateGreetings).toEqual(['g'])
    })

    test('a chat write sets only note', () => {
        const chat: LiveChat = { id: 'c1', note: 'n0', fmIndex: 2 }
        applyChatWrites(chat as unknown as Chat, [
            { op: 'set', path: 'desc', value: { had: true, value: 'no' } },
            { op: 'set', path: 'note', value: { had: true, value: 'n1' } },
            { op: 'listInsert', index: 0, value: 'no' },
        ])
        expect(chat).toEqual({ id: 'c1', note: 'n1', fmIndex: 2 })
    })
})

describe('resolveLiveTarget: the module branch', () => {
    const open = (id: string | null) => () => id
    const putModules = (...modules: unknown[]): void => {
        DBState.db.modules = modules as unknown as typeof DBState.db.modules
    }

    test('without a port a module owner is gone, as for a caller that has no module panel', () => {
        putModules({ id: 'M1' })
        expect(resolveLiveTarget(moduleOwnerKey('M1'))).toEqual({ ok: false, reason: 'gone' })
    })

    test('a module owner is selected only while the port returns its id', () => {
        putModules({ id: 'M1' })
        expect(resolveLiveTarget(moduleOwnerKey('M1'), open(null))).toEqual({ ok: false, reason: 'not-selected' })
        expect(resolveLiveTarget(moduleOwnerKey('M1'), open('M2'))).toEqual({ ok: false, reason: 'not-selected' })
        expect(resolveLiveTarget(moduleOwnerKey('M1'), open('M1'))).toMatchObject({ ok: true, target: { index: 0 } })
    })

    test('the slot is found by id, wherever the list has moved it, and a missing id is gone', () => {
        putModules({ id: 'M0' }, { id: 'M1' })
        const first = resolveLiveTarget(moduleOwnerKey('M1'), open('M1'))
        expect(first.ok && isModuleTarget(first.target) && first.target.index).toBe(1)
        putModules({ id: 'M1' }, { id: 'M0' })
        const moved = resolveLiveTarget(moduleOwnerKey('M1'), open('M1'))
        expect(moved.ok && isModuleTarget(moved.target) && moved.target.index).toBe(0)
        putModules({ id: 'M0' })
        expect(resolveLiveTarget(moduleOwnerKey('M1'), open('M1'))).toEqual({ ok: false, reason: 'gone' })
    })

    test('a shared id refuses even when one holder is a stub, and a lone stub is gone; no stub body key is read', () => {
        const reads: string[] = []
        putModules({ id: 'M1' }, watchBodyKeys(stubModule('M1'), reads))
        expect(resolveLiveTarget(moduleOwnerKey('M1'), open('M1'))).toEqual({ ok: false, reason: 'duplicate-module-id' })
        putModules({ id: 'M1' }, { id: 'M1' })
        expect(resolveLiveTarget(moduleOwnerKey('M1'), open('M1'))).toEqual({ ok: false, reason: 'duplicate-module-id' })
        putModules(watchBodyKeys(stubModule('M1'), reads))
        expect(resolveLiveTarget(moduleOwnerKey('M1'), open('M1'))).toEqual({ ok: false, reason: 'gone' })
        expect(reads).toEqual([])
    })
})

describe('the asset reader and the asset owner writes', () => {
    const rows = (): string[][] => [['smile', 'assets/smile.png', 'png'], ['grin', 'assets/grin.png', 'png']]

    test('the character reader serves its two lists and the folder document from extentions; the module reader serves assets', () => {
        const stored = { v: 1, additional: { order: [], of: [] } }
        const live = makeCharacter('A') as LiveCharacter & { additionalAssets: string[][]; emotionImages: string[][]; extentions: Record<string, unknown> }
        live.additionalAssets = rows()
        live.emotionImages = [['happy', 'assets/happy.png']]
        live.extentions = { [ASSET_FOLDER_KEY]: stored }
        const reader = createLiveReader(targetOf(live))
        expect(reader.assetRows?.('additionalAssets')).toEqual(rows())
        expect(reader.assetRows?.('emotionImages')).toEqual([['happy', 'assets/happy.png']])
        expect(reader.assetRows?.('assets')).toBeNull()
        expect(reader.folderValue?.()).toBe(stored)

        const module = { id: 'M', assets: rows(), [ASSET_FOLDER_KEY]: stored } as unknown as RisuModule
        const moduleReader = createModuleLiveReader(module)
        expect(moduleReader.assetRows?.('assets')).toEqual(rows())
        expect(moduleReader.assetRows?.('additionalAssets')).toBeNull()
        expect(moduleReader.folderValue?.()).toBe(stored)
        expect(moduleReader.greetings()).toBeNull()
    })

    test('a list or row that is not strings is read as unreadable, never edited', () => {
        const live = makeCharacter('A') as LiveCharacter & { additionalAssets: unknown }
        live.additionalAssets = [['smile', 3]]
        expect(createLiveReader(targetOf(live)).assetRows?.('additionalAssets')).toBeNull()
        live.additionalAssets = 'x'
        expect(createLiveReader(targetOf(live)).assetRows?.('additionalAssets')).toBeNull()
    })

    test('a character write applies rows, then the folder document, then text, and the field is set from the recompute', () => {
        const live = makeCharacter('A') as LiveCharacter & { additionalAssets: string[][]; emotionImages: string[][]; extentions?: Record<string, unknown>; globalLore: { content: string }[] }
        live.additionalAssets = rows()
        live.emotionImages = []
        live.globalLore = [{ content: 'see smile' }]
        const doc = { v: 1, additional: { order: ['F'], of: [] } }
        applyCharacterWrites(
            live as unknown as character,
            [
                { op: 'textSet', target: 'lore/0/content', value: 'see grin' },
                { op: 'assetRowRemove', array: 'additionalAssets', index: 0, tuple: ['smile', 'assets/smile.png', 'png'], count: 1 },
                { op: 'assetFolderOrder', before: [], after: ['F'] },
            ],
            null,
            { folder: { kind: 'set', doc }, retained: () => ({ kind: 'set', value: [['smile', 'assets/smile.png']] }) },
        )
        expect(live.additionalAssets).toEqual([['grin', 'assets/grin.png', 'png']])
        expect(live.extentions?.[ASSET_FOLDER_KEY]).toBe(doc)
        expect(live.globalLore[0].content).toBe('see grin')
        expect((live as unknown as Record<string, unknown>)[ASSET_RETAINED_KEY]).toEqual([['smile', 'assets/smile.png']])
    })

    test('a removed folder document deletes the key and keeps an empty extentions, and an absent extentions is created only to write one', () => {
        const live = makeCharacter('A') as LiveCharacter & { additionalAssets: string[][]; emotionImages: string[][]; extentions?: Record<string, unknown> }
        live.additionalAssets = rows()
        live.emotionImages = []
        live.extentions = { [ASSET_FOLDER_KEY]: { v: 1, additional: { order: ['F'], of: [] } } }
        const none = { retained: null }
        applyCharacterWrites(live as unknown as character, [], null, { folder: { kind: 'remove' }, ...none })
        expect(live.extentions).toEqual({})
        expect(Object.hasOwn(live.extentions ?? {}, ASSET_FOLDER_KEY)).toBe(false)

        const bare = makeCharacter('A') as LiveCharacter & { additionalAssets: string[][]; emotionImages: string[][]; extentions?: Record<string, unknown> }
        bare.additionalAssets = rows()
        bare.emotionImages = []
        applyCharacterWrites(bare as unknown as character, [], null, { folder: { kind: 'remove' }, ...none })
        expect('extentions' in bare).toBe(false)
        applyCharacterWrites(bare as unknown as character, [], null, { folder: { kind: 'set', doc: { v: 1 } }, ...none })
        expect(bare.extentions).toEqual({ [ASSET_FOLDER_KEY]: { v: 1 } })
    })

    test('the retained recompute reads the field as it is inside the write and a remove result deletes the key', () => {
        const live = makeCharacter('A') as LiveCharacter & { additionalAssets: string[][]; emotionImages: string[][] }
        live.additionalAssets = rows()
        live.emotionImages = []
        ;(live as unknown as Record<string, unknown>)[ASSET_RETAINED_KEY] = [['old', 'assets/old.png']]
        const seen: unknown[] = []
        applyCharacterWrites(live as unknown as character, [], null, {
            folder: { kind: 'keep' },
            retained: (existing) => {
                seen.push(existing)
                return { kind: 'remove' }
            },
        })
        expect(seen).toEqual([[['old', 'assets/old.png']]])
        expect(Object.hasOwn(live, ASSET_RETAINED_KEY)).toBe(false)
    })

    test('a module write returns a new object with new lists and leaves the live module untouched', () => {
        const live = {
            id: 'M',
            name: 'M',
            assets: rows(),
            lorebook: [{ key: 'k', content: 'see smile' }, { key: 'k2', content: 'other' }],
            regex: [{ in: 'a', out: 'smile', type: 'editoutput' }],
        } as unknown as RisuModule
        const lorebook = live.lorebook
        const next = buildWrittenModule(
            live,
            [
                { op: 'assetRowRemove', array: 'assets', index: 1, tuple: ['grin', 'assets/grin.png', 'png'], count: 1 },
                { op: 'textSet', target: 'lore/0/content', value: 'see beam' },
                { op: 'textSet', target: 'regex/0/out', value: 'beam' },
            ],
            { folder: { kind: 'set', doc: { v: 1 } }, retained: () => ({ kind: 'set', value: [['grin', 'assets/grin.png']] }) },
        )
        expect(next).not.toBe(live)
        expect(next.assets).toEqual([['smile', 'assets/smile.png', 'png']])
        expect(next.assets).not.toBe(live.assets)
        expect(live.assets).toEqual(rows())
        expect(next.lorebook?.[0].content).toBe('see beam')
        expect(next.lorebook?.[1]).toBe(lorebook?.[1])
        expect(live.lorebook).toBe(lorebook)
        expect(lorebook?.[0].content).toBe('see smile')
        expect(next.regex?.[0].out).toBe('beam')
        expect(next[ASSET_FOLDER_KEY]).toEqual({ v: 1 })
        expect(next[ASSET_RETAINED_KEY]).toEqual([['grin', 'assets/grin.png']])
        expect(Object.hasOwn(live, ASSET_FOLDER_KEY)).toBe(false)
    })

    test('a module folder removal omits the key; it is never present with the value undefined', () => {
        const live = { id: 'M', name: 'M', assets: rows(), [ASSET_FOLDER_KEY]: { v: 1 }, [ASSET_RETAINED_KEY]: [['a', 'b']] } as unknown as RisuModule
        const next = buildWrittenModule(live, [], { folder: { kind: 'remove' }, retained: () => ({ kind: 'remove' }) })
        expect(Object.hasOwn(next, ASSET_FOLDER_KEY)).toBe(false)
        expect(Object.hasOwn(next, ASSET_RETAINED_KEY)).toBe(false)
        expect(Object.hasOwn(live, ASSET_FOLDER_KEY)).toBe(true)
    })

    test('writeLiveModule assigns the slot once and refuses a stub or a shared id', () => {
        const live = { id: 'M', name: 'M', assets: rows() } as unknown as RisuModule
        DBState.db.modules = [live]
        const list = DBState.db.modules
        expect(writeLiveModule('M', (module) => ({ ...module, name: 'renamed' }))).toBe(true)
        expect(DBState.db.modules).toBe(list)
        expect(DBState.db.modules[0].name).toBe('renamed')
        expect(DBState.db.modules[0]).not.toBe(live)

        DBState.db.modules = [{ id: 'M', name: 'a' }, stubModule('M')] as unknown as typeof DBState.db.modules
        expect(writeLiveModule('M', (module) => ({ ...module, name: 'x' }))).toBe(false)
        DBState.db.modules = [stubModule('M')] as unknown as typeof DBState.db.modules
        expect(writeLiveModule('M', (module) => ({ ...module, name: 'x' }))).toBe(false)
        DBState.db.modules = [] as unknown as typeof DBState.db.modules
        expect(writeLiveModule('M', (module) => module)).toBe(false)
    })
})
