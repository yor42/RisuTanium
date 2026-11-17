// The counts of a merge confirm over synthetic chats and characters: what counts as a mention, which characters a
// module is enabled for, archived chats and stubs counted and never opened, a job that cannot hand back a failure as a
// finished count, slicing on an injected clock, and abort. The fixtures are deep-frozen, so any write fails the job.
import { describe, expect, test, vi } from 'vitest'
import type { character, Chat, groupChat } from 'src/ts/storage/database.svelte'
import type { ShardEntry } from 'src/ts/storage/store2/format/types'
import { stubFromEntry } from 'src/ts/storage/store2/codec/stub'
import { coldStorageHeader } from 'src/ts/process/coldstorageData'
import { countChatMentions, countEnablingCharacters, type ChatCountResult, type EnablingCountResult, type EnablingInput } from './mergeCounts'

const loads = vi.hoisted(() => ({ preLoadChat: vi.fn(), readColdStorageItem: vi.fn(), getColdStorageItem: vi.fn() }))

vi.mock('src/ts/process/coldstorage.svelte', () => loads)

// Freezes the data properties; an accessor is left as it is, so a fixture's throwing getter is never run by freezing.
function deepFreeze<T>(value: T): T {
    if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
        Object.freeze(value)
        for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
            if ('value' in descriptor) {
                deepFreeze(descriptor.value)
            }
        }
    }
    return value
}

function chat(over: Partial<Chat> = {}): Chat {
    return { message: [{ role: 'char', data: 'plain' }], note: '', name: '', localLore: [], ...over }
}

function saying(...data: string[]): Chat['message'] {
    return data.map((text) => ({ role: 'user' as const, data: text }))
}

// A chat that is still a cold-storage pointer, and that fails on any read beyond its first message.
function coldChat(modules?: string[]): Chat {
    const pointer = chat({ message: [{ role: 'char', data: coldStorageHeader + 'unit-1' }], ...(modules === undefined ? {} : { modules }) })
    Object.defineProperty(pointer, 'note', { get: () => { throw new Error('a cold chat was opened: note') }, enumerable: true })
    Object.defineProperty(pointer, 'localLore', { get: () => { throw new Error('a cold chat was opened: localLore') }, enumerable: true })
    return pointer
}

const GRIN = { kind: 'asset' as const, names: ['grin'] }

describe('which chats count', () => {
    test('T30: messages, notes and local lore are read, archived chats are counted and never opened, and nothing is loaded or written', async () => {
        const resident = deepFreeze([
            chat({ message: saying('hello {{image::grin}} there') }),
            chat({ note: 'remember {{raw::GRIN}}' }),
            chat({ localLore: [{ key: 'k', content: '<img src="grin">' }] as Chat['localLore'] }),
            chat({ message: saying('no reference here, only the word grin') }),
            chat({ message: saying('{{asset_prompt::Grin}}') }),
            chat({ message: saying('{{raw::pre-{{getvar::x}}-grin}}') }),
        ])
        const chats = [...resident, coldChat(), coldChat()]
        const before = JSON.stringify(resident)

        const result = await countChatMentions(chats, GRIN)

        expect(result).toEqual({ state: 'done', chats: 4, archivedChats: 2 })
        expect(JSON.stringify(resident)).toBe(before)
        expect(loads.preLoadChat).not.toHaveBeenCalled()
        expect(loads.readColdStorageItem).not.toHaveBeenCalled()
        expect(loads.getColdStorageItem).not.toHaveBeenCalled()
    })

    test('an emotion count reads the emotion syntaxes only, and an asset count never counts them', async () => {
        const chats = [chat({ message: saying('{{emotion::happy}}') }), chat({ message: saying('{{image::happy}}') })]
        expect(await countChatMentions(chats, { kind: 'emotion', names: ['happy'] })).toEqual({ state: 'done', chats: 1, archivedChats: 0 })
        expect(await countChatMentions(chats, { kind: 'asset', names: ['happy'] })).toEqual({ state: 'done', chats: 1, archivedChats: 0 })
        expect(await countChatMentions([chats[0]], { kind: 'asset', names: ['happy'] })).toEqual({ state: 'done', chats: 0, archivedChats: 0 })
    })

    test('several removed names count a chat once and each of them counts', async () => {
        const chats = [chat({ message: saying('{{image::grin}} {{image::wave}}') }), chat({ message: saying('{{image::wave}}') }), chat({ message: saying('nothing') })]
        expect(await countChatMentions(chats, { kind: 'asset', names: ['grin', 'wave'] })).toEqual({ state: 'done', chats: 2, archivedChats: 0 })
    })

    test('a stored value that is not a string is no text', async () => {
        const odd = chat({ note: 5 as unknown as string, message: [{ role: 'user', data: null as unknown as string }], localLore: [null] as unknown as Chat['localLore'] })
        expect(await countChatMentions([odd], GRIN)).toEqual({ state: 'done', chats: 0, archivedChats: 0 })
    })

    test('a mention is found wherever it lies in a long text read in windows', async () => {
        const windowChars = 40
        for (let at = 0; at <= 160; at++) {
            const text = 'x'.repeat(at) + '{{image::grin}}' + 'y'.repeat(160 - at)
            const result = await countChatMentions([chat({ message: saying(text) })], GRIN, { windowChars })
            expect(result).toEqual({ state: 'done', chats: 1, archivedChats: 0 })
        }
        const none = await countChatMentions([chat({ message: saying('x'.repeat(300)) })], GRIN, { windowChars })
        expect(none).toEqual({ state: 'done', chats: 0, archivedChats: 0 })
    })
})

describe('a job never hands back a failure or an abort as a finished count', () => {
    test('E9: a read that throws resolves failed with what was reached, never done', async () => {
        const broken = chat()
        Object.defineProperty(broken, 'message', { get: () => { throw new Error('unreadable chat') }, enumerable: true })
        const chats = [chat({ message: saying('{{image::grin}}') }), broken, chat({ message: saying('{{image::grin}}') })]

        const result = await countChatMentions(chats, GRIN)

        expect(result).toEqual({ state: 'failed', chats: 1, archivedChats: 0 })
    })

    test('T57b: an abort during the job resolves aborted and no chat is read after it', async () => {
        const controller = new AbortController()
        let reads = 0
        let readsAtAbort = -1
        const chats = Array.from({ length: 50 }, (_, i) => {
            const subject = chat()
            Object.defineProperty(subject, 'note', {
                get: () => {
                    reads += 1
                    if (i === 4) {
                        controller.abort()
                        readsAtAbort = reads
                    }
                    return ''
                },
                enumerable: true,
            })
            return subject
        })

        const result = await countChatMentions(chats, GRIN, { signal: controller.signal })

        expect(result.state).toBe('aborted')
        expect(result.chats).toBe(0)
        expect(readsAtAbort).toBe(5)
        expect(reads).toBe(readsAtAbort)
    })

    test('a signal that is already aborted reads nothing', async () => {
        const controller = new AbortController()
        controller.abort()
        let reads = 0
        const subject = chat()
        Object.defineProperty(subject, 'note', { get: () => { reads += 1; return '' }, enumerable: true })
        expect((await countChatMentions([subject], GRIN, { signal: controller.signal })).state).toBe('aborted')
        expect(reads).toBe(0)
    })
})

describe('slices', () => {
    test('T30: no slice runs past the budget of the injected clock, and a long job yields to the loop', async () => {
        let ticks = 0
        let yields = 0
        let widest = 0
        let sinceYield = 0
        const chats = Array.from({ length: 200 }, () => chat({ message: saying('a', 'b', 'c') }))

        const result = await countChatMentions(chats, GRIN, {
            now: () => { ticks += 1; sinceYield += 1; return ticks },
            yieldToLoop: async () => { yields += 1; widest = Math.max(widest, sinceYield); sinceYield = 0 },
        })

        expect(result.state).toBe('done')
        expect(yields).toBeGreaterThan(10)
        // The injected clock moves one unit per reading and a slice ends at 8: each slice holds at most 8 checkpoints.
        expect(widest).toBeLessThanOrEqual(9)
    })
})

describe('progress: the figures reached so far, once per yield', () => {
    // Every checkpoint yields: `sliceMs: 0` spends the slice at once, so each unit of work ends in one yield and one report.
    const eachUnitYields = { sliceMs: 0, yieldToLoop: async () => {} }

    test('R-E1: a job that yields several times reports rising figures, never a finished state, and the end carries the full count', async () => {
        const chats = [chat({ message: saying('{{image::grin}}') }), chat(), chat({ message: saying('{{image::grin}}') }), chat({ message: saying('{{image::grin}}') })]
        const seen: ChatCountResult[] = []

        const result = await countChatMentions(chats, GRIN, { ...eachUnitYields, onProgress: (partial) => seen.push(partial) })

        expect(result).toEqual({ state: 'done', chats: 3, archivedChats: 0 })
        expect(seen.length).toBeGreaterThan(2)
        expect(seen.every((partial) => partial.state === 'running')).toBe(true)
        const figures = seen.map((partial) => partial.chats)
        expect(figures).toEqual([...figures].sort((a, b) => a - b))
        expect(figures[0]).toBeLessThan(3)
        expect(figures.at(-1)).toBeGreaterThan(figures[0])
        expect(Math.max(...figures)).toBeLessThanOrEqual(3)
    })

    test('R-E1b: reports follow yields, not items: a job that never yields reports nothing', async () => {
        const seen: ChatCountResult[] = []
        const chats = Array.from({ length: 20 }, () => chat({ message: saying('{{image::grin}}') }))

        const result = await countChatMentions(chats, GRIN, { sliceMs: 1e9, onProgress: (partial) => seen.push(partial) })

        expect(result.chats).toBe(20)
        expect(seen).toEqual([])
    })

    test('R-E1c: an aborted job reports nothing after the abort', async () => {
        const controller = new AbortController()
        const seen: ChatCountResult[] = []
        const chats = Array.from({ length: 10 }, () => chat({ message: saying('{{image::grin}}') }))
        let yields = 0

        const result = await countChatMentions(chats, GRIN, {
            sliceMs: 0,
            signal: controller.signal,
            yieldToLoop: async () => { yields += 1; if (yields === 3) controller.abort() },
            onProgress: (partial) => seen.push(partial),
        })

        // The abort lands inside the third yield, after its report; no yield after it runs.
        expect(result.state).toBe('aborted')
        expect(yields).toBe(3)
        expect(seen).toHaveLength(3)
    })

    test('R-E1e: a signal aborted while the slice is measured gets no report from the yield that follows', async () => {
        const controller = new AbortController()
        const seen: ChatCountResult[] = []
        const chats = Array.from({ length: 10 }, () => chat({ message: saying('{{image::grin}}') }))
        let reads = 0

        const result = await countChatMentions(chats, GRIN, {
            sliceMs: 0,
            signal: controller.signal,
            // The fourth reading is the second checkpoint's measure: the abort lands after the yield was decided.
            now: () => { reads += 1; if (reads === 4) controller.abort(); return reads },
            yieldToLoop: async () => {},
            onProgress: (partial) => seen.push(partial),
        })

        expect(result.state).toBe('aborted')
        expect(seen).toHaveLength(1)
    })

    test('R-E1d: the characters of a partial are copies, so a later hit never changes a figure already handed out', async () => {
        const seen: EnablingCountResult[] = []
        const characters = [char('a', { modules: ['mod'], chats: [chat({ message: saying('{{image::grin}}') }), chat({ message: saying('{{image::grin}}') })] }), char('b', { modules: ['mod'] })]

        const result = await countEnablingCharacters(input(characters), GRIN, { ...eachUnitYields, onProgress: (partial) => seen.push(partial) })

        expect(result.state).toBe('done')
        expect(result.characters.map((entry) => entry.chatHits)).toEqual([2, 0])
        expect(seen.length).toBeGreaterThan(1)
        expect(seen.every((partial) => partial.state === 'running')).toBe(true)
        const firstA = seen.find((partial) => partial.characters.length > 0)?.characters[0]
        expect(firstA?.chatHits).toBe(0)
        expect(seen.at(-1)?.characters[0]?.chatHits).toBeGreaterThan(0)
    })
})

// ---------------------------------------------------------------- the characters a module is enabled for

function char(chaId: string, over: Partial<character> = {}): character {
    return { chaId, name: chaId, desc: '', chats: [chat()], modules: [], additionalAssets: [], ...over } as unknown as character
}

function group(chaId: string): groupChat {
    return { type: 'group', chaId, name: chaId, chats: [chat({ message: saying('{{image::grin}}') })] } as unknown as groupChat
}

function stub(chaId: string): character {
    const entry = { type: 'character', name: chaId, chaId, creatorNotes: '', u: 'u-' + chaId, chats: [] } as unknown as ShardEntry
    return stubFromEntry(entry) as unknown as character
}

const MODULE = { id: 'mod', namespace: 'ns' }

function input(characters: (character | groupChat)[], over: Partial<EnablingInput> = {}): EnablingInput {
    return { module: MODULE, characters: deepFreeze(characters), enabledModules: [], moduleIntergration: '', ...over }
}

describe('T31: the characters a module is enabled for', () => {
    const mention = (): Chat => chat({ message: saying('see {{image::grin}}') })

    function world(): (character | groupChat)[] {
        return [
            char('byId', { modules: ['mod'], desc: 'a {{image::grin}} b', chats: [mention(), chat(), mention()] }),
            char('byNamespace', { modules: ['ns'], chats: [chat()] }),
            char('byChat', { chats: [chat({ modules: ['mod'], message: saying('{{image::grin}}') })] }),
            char('notEnabled', { chats: [mention()], desc: '{{image::grin}}' }),
            group('aGroup'),
            stub('aStub'),
            char('coldOnly', { chats: [coldChat(['mod'])] }),
        ]
    }

    test('per-character hits for an owner enabled by the character, its namespace and a resident chat; groups, stubs and cold chats are not read', async () => {
        const result = await countEnablingCharacters(input(world()), GRIN)

        expect(result).toEqual({
            state: 'done',
            characters: [
                { chaId: 'byId', textHits: 1, chatHits: 2, archivedChats: 0 },
                { chaId: 'byNamespace', textHits: 0, chatHits: 0, archivedChats: 0 },
                { chaId: 'byChat', textHits: 0, chatHits: 1, archivedChats: 0 },
            ],
            archivedCharacters: 1,
        })
        expect(loads.preLoadChat).not.toHaveBeenCalled()
    })

    test('an id in the enabled list, a namespace in it and a namespace in the integration list each enable the module for every character', async () => {
        for (const over of [{ enabledModules: ['mod'] }, { enabledModules: ['ns'] }, { moduleIntergration: 'other, ns' }]) {
            const result = await countEnablingCharacters(input(world(), over), GRIN)
            expect(result.state).toBe('done')
            expect(result.characters.map((entry) => entry.chaId)).toEqual(['byId', 'byNamespace', 'byChat', 'notEnabled', 'coldOnly'])
            expect(result.characters[3]).toEqual({ chaId: 'notEnabled', textHits: 1, chatHits: 1, archivedChats: 0 })
            expect(result.characters[4]).toEqual({ chaId: 'coldOnly', textHits: 0, chatHits: 0, archivedChats: 1 })
            expect(result.archivedCharacters).toBe(1)
        }
    })

    test('an empty namespace never enables the module', async () => {
        const result = await countEnablingCharacters(input(world(), { module: { id: 'mod', namespace: '' }, enabledModules: [''] }), GRIN)
        expect(result.characters.map((entry) => entry.chaId)).toEqual(['byId', 'byChat'])
    })

    test('M-fail: a character that cannot be read resolves failed with the characters reached, and an abort resolves aborted', async () => {
        const broken = char('broken', { modules: ['mod'] })
        Object.defineProperty(broken, 'desc', { get: () => { throw new Error('unreadable character') }, enumerable: true })
        const failed = await countEnablingCharacters(input([char('first', { modules: ['mod'] }), broken, char('third', { modules: ['mod'] })]), GRIN)
        expect(failed.state).toBe('failed')
        expect(failed.characters.map((entry) => entry.chaId)).toEqual(['first'])

        const controller = new AbortController()
        controller.abort()
        const aborted = await countEnablingCharacters(input(world()), GRIN, { signal: controller.signal })
        expect(aborted).toEqual({ state: 'aborted', characters: [], archivedCharacters: 0 })
    })
})
