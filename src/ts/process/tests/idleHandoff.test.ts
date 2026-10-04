/**
 * What an idle reload hands to the next page (`../memory/idleHandoff`): the
 * record's storage, the selection part's expiry, the drafts part's put-back
 * rules and the rate-limit history. The draft stores are the real ones.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    HANDOFF_FILE_PATH,
    applyHandoff,
    buildSelectionPart,
    createFileMedium,
    createStorageMedium,
    draftsVersions,
    parseDraftsPart,
    parseSelectionPart,
    putBackDrafts,
    readHandoff,
    readReloadHistory,
    takeDraftsPart,
    writeHandoff,
    writeHandoffSync,
    writeReloadHistory,
    type DraftsPart,
    type HandoffFiles,
    type SelectionPart,
} from '../memory/idleHandoff'
import { MIN_RELOAD_INTERVAL_MS } from '../memory/idleGate'
import { peek, resetComposerDraftsForTests, write } from '../composerDrafts.svelte'
import { draftContentOrphanGate } from '../../draftContentOrphanGate'
import { createDraftContentStore, type MessageIdentity } from '../../draftContents'
import { COMPOSER_DRAFT_KIND, HYPA_DRAFT_KIND, hasDraftOfKind, registerDraft, resetLocalDraftsForTest } from '../../localDrafts'

class MemoryStorage {
    private items = new Map<string, string>()
    failWrites = false
    dropWrites = false
    getItem(key: string): string | null { return this.items.get(key) ?? null }
    setItem(key: string, value: string): void {
        if (this.failWrites) {
            throw new DOMException('full', 'QuotaExceededError')
        }
        if (!this.dropWrites) {
            this.items.set(key, value)
        }
    }
    removeItem(key: string): void { this.items.delete(key) }
}

function asStorage(memory: MemoryStorage): Storage {
    return memory as unknown as Storage
}

const NOW = 1_700_000_000_000

function identity(chatKey: string, chatId: string): MessageIdentity {
    return { kind: 'msg', chatKey, chatId, index: 0 }
}

beforeEach(() => {
    resetComposerDraftsForTests()
    draftContentOrphanGate.clear()
    resetLocalDraftsForTest()
})

afterEach(() => {
    vi.restoreAllMocks()
})

function commitCallbacks() {
    const pending: (() => void)[] = []
    return {
        register: (callback: () => void) => { pending.push(callback) },
        commit: () => { for (const callback of pending.splice(0)) { callback() } },
    }
}

function composerKey(chaId: string, chatId: string) {
    return { chaId, chatId }
}

describe('the storage medium', () => {
    test('reads back what it wrote and removes a part', () => {
        const medium = createStorageMedium(asStorage(new MemoryStorage()))
        expect(medium.read('selection')).toBeNull()
        expect(medium.write('selection', 'abc')).toBe(true)
        expect(medium.read('selection')).toBe('abc')
        medium.remove('selection')
        expect(medium.read('selection')).toBeNull()
    })

    test('reports a write that the storage accepted but did not keep', () => {
        const memory = new MemoryStorage()
        memory.dropWrites = true
        expect(createStorageMedium(asStorage(memory)).write('drafts', 'abc')).toBe(false)
    })

    test('lets a failing write throw to its caller', () => {
        const memory = new MemoryStorage()
        memory.failWrites = true
        expect(() => createStorageMedium(asStorage(memory)).write('drafts', 'abc')).toThrow()
    })
})

describe('the selection part', () => {
    const part = buildSelectionPart({ chaId: 'a', members: ['m1', 'a', 'm2'], now: NOW })

    test('keeps the selected character and its group members once each', () => {
        expect(part).toEqual({ v: 1, reason: 'idle', at: NOW, chaId: 'a', keepInline: ['a', 'm1', 'm2'] })
    })

    test('with nothing selected keeps only the members and names no character', () => {
        expect(buildSelectionPart({ chaId: null, members: [], now: NOW })).toEqual({ v: 1, reason: 'idle', at: NOW, chaId: null, keepInline: [] })
    })

    test('is read back while fresh', () => {
        const read = parseSelectionPart(JSON.stringify(part), NOW + MIN_RELOAD_INTERVAL_MS - 1)
        expect(read).toEqual({ status: 'fresh', part })
    })

    test('is stale once the interval has passed, and when it is dated in the future', () => {
        expect(parseSelectionPart(JSON.stringify(part), NOW + MIN_RELOAD_INTERVAL_MS)).toEqual({ status: 'stale' })
        expect(parseSelectionPart(JSON.stringify(part), NOW - 1)).toEqual({ status: 'stale' })
    })

    test.each([
        ['not JSON', 'nope'],
        ['a wrong version', JSON.stringify({ ...part, v: 2 })],
        ['a missing keep-inline list', JSON.stringify({ ...part, keepInline: undefined })],
        ['a keep-inline list of numbers', JSON.stringify({ ...part, keepInline: [1] })],
        ['a character id that is a number', JSON.stringify({ ...part, chaId: 5 })],
    ])('is unreadable for %s', (_title, text) => {
        expect(parseSelectionPart(text, NOW)).toEqual({ status: 'unreadable' })
    })
})

describe('reading the record at boot', () => {
    test('deletes a stale selection part and a part that cannot be read, and returns no selection', async () => {
        const medium = createStorageMedium(asStorage(new MemoryStorage()))
        const stale: SelectionPart = buildSelectionPart({ chaId: 'a', members: [], now: NOW - MIN_RELOAD_INTERVAL_MS })
        medium.write('selection', JSON.stringify(stale))
        expect((await readHandoff(medium, NOW)).selection).toBeNull()
        expect(medium.read('selection')).toBeNull()

        medium.write('selection', '{broken')
        expect((await readHandoff(medium, NOW)).selection).toBeNull()
        expect(medium.read('selection')).toBeNull()
    })

    test('returns a fresh selection and leaves its part until it is applied', async () => {
        const medium = createStorageMedium(asStorage(new MemoryStorage()))
        const part = buildSelectionPart({ chaId: 'a', members: [], now: NOW - 1000 })
        medium.write('selection', JSON.stringify(part))
        expect((await readHandoff(medium, NOW)).selection).toEqual(part)
        expect(medium.read('selection')).not.toBeNull()
    })

    test('leaves an unreadable drafts part in place and reports it', async () => {
        const medium = createStorageMedium(asStorage(new MemoryStorage()))
        const errors = vi.spyOn(console, 'error').mockImplementation(() => { })
        medium.write('drafts', '{"v":1,"at":')
        expect((await readHandoff(medium, NOW)).drafts).toBeNull()
        expect(medium.read('drafts')).toBe('{"v":1,"at":')
        expect(errors).toHaveBeenCalled()
    })

    test('returns a drafts part of any age', async () => {
        const medium = createStorageMedium(asStorage(new MemoryStorage()))
        const drafts: DraftsPart = { v: 1, at: NOW - 30 * MIN_RELOAD_INTERVAL_MS, composer: [], durable: [] }
        medium.write('drafts', JSON.stringify(drafts))
        expect((await readHandoff(medium, NOW)).drafts).toEqual(drafts)
    })
})

describe('putting the drafts back', () => {
    test('a boot that read the record but never applied it leaves the drafts for the next boot, which puts them back', async () => {
        const medium = createStorageMedium(asStorage(new MemoryStorage()))
        write(composerKey('a', 'chat1'), (record) => { record.messageInput = 'unsent' })
        const drafts = takeDraftsPart(NOW)
        resetComposerDraftsForTests()
        medium.write('drafts', JSON.stringify(drafts))

        const failedBoot = await readHandoff(medium, NOW + 1000)
        expect(failedBoot.drafts).not.toBeNull()
        expect(medium.read('drafts')).not.toBeNull()
        expect(peek(composerKey('a', 'chat1')).messageInput).toBe('')

        const nextBoot = await readHandoff(medium, NOW + 2000)
        const commits = commitCallbacks()
        await applyHandoff(nextBoot, medium, async () => true, commits.register)
        expect(peek(composerKey('a', 'chat1')).messageInput).toBe('unsent')
        expect(medium.read('drafts')).not.toBeNull()
        commits.commit()
        expect(medium.read('drafts')).toBeNull()
    })

    test('keeps the drafts part until the first save commits, and a boot that dies before then puts the same drafts back without doubling them', async () => {
        const memory = new MemoryStorage()
        const medium = createStorageMedium(asStorage(memory))
        write(composerKey('a', 'chat1'), (record) => { record.messageInput = 'unsent' })
        const drafts = takeDraftsPart(NOW)
        resetComposerDraftsForTests()
        medium.write('drafts', JSON.stringify(drafts))
        const commits = commitCallbacks()
        await applyHandoff({ selection: null, drafts }, medium, async () => true, commits.register)
        expect(peek(composerKey('a', 'chat1')).messageInput).toBe('unsent')
        expect(medium.read('drafts')).not.toBeNull()

        const nextBoot = await readHandoff(medium, NOW + 1)
        await applyHandoff(nextBoot, medium, async () => true, commits.register)
        expect(peek(composerKey('a', 'chat1')).messageInput).toBe('unsent')

        commits.commit()
        expect(medium.read('drafts')).toBeNull()
    })

    test('a second put-back leaves text typed since and a newer durable draft alone', async () => {
        const medium = createStorageMedium(asStorage(new MemoryStorage()))
        write(composerKey('a', 'chat1'), (record) => { record.messageInput = 'unsent' })
        draftContentOrphanGate.set(identity('chatKey', 'c1'), 'old edit', 'base')
        const drafts = takeDraftsPart(NOW)
        resetComposerDraftsForTests()
        draftContentOrphanGate.clear()
        const commits = commitCallbacks()
        await applyHandoff({ selection: null, drafts }, medium, async () => true, commits.register)
        write(composerKey('a', 'chat1'), (record) => { record.messageInput = 'edited after' })
        draftContentOrphanGate.set(identity('chatKey', 'c1'), 'newer edit', 'base')
        await applyHandoff({ selection: null, drafts }, medium, async () => true, commits.register)
        expect(peek(composerKey('a', 'chat1')).messageInput).toBe('edited after')
        expect(draftContentOrphanGate.get(identity('chatKey', 'c1'), 'base')?.text).toBe('newer edit')
    })

    test('puts text back for a chat that is not loaded, by its key', () => {
        putBackDrafts({
            v: 1,
            at: NOW,
            composer: [{ key: 'gone-char::gone-chat', messageInput: 'for an archived character', messageInputTranslate: '', fileInput: [] }],
            durable: [],
        })
        expect(peek(composerKey('gone-char', 'gone-chat')).messageInput).toBe('for an archived character')
    })

    test('leaves a composer key that holds text alone and fills an empty one', () => {
        write(composerKey('a', 'chat1'), (record) => { record.messageInput = 'typed since' })
        putBackDrafts({
            v: 1,
            at: NOW,
            composer: [
                { key: 'a::chat1', messageInput: 'carried', messageInputTranslate: '', fileInput: [] },
                { key: 'a::chat2', messageInput: 'carried too', messageInputTranslate: '', fileInput: ['inlay1'] },
            ],
            durable: [],
        })
        expect(peek(composerKey('a', 'chat1')).messageInput).toBe('typed since')
        expect(peek(composerKey('a', 'chat2')).messageInput).toBe('carried too')
        expect(peek(composerKey('a', 'chat2')).fileInput).toEqual(['inlay1'])
    })

    test('keeps the newest records within the composer cap when more are carried than it holds', () => {
        const composer = Array.from({ length: 205 }, (_, i) => ({
            key: `a::chat${i}`, messageInput: `text ${i}`, messageInputTranslate: '', fileInput: [] as string[],
        }))
        putBackDrafts({ v: 1, at: NOW, composer, durable: [] })
        expect(peek(composerKey('a', 'chat0')).messageInput).toBe('')
        expect(peek(composerKey('a', 'chat4')).messageInput).toBe('')
        expect(peek(composerKey('a', 'chat5')).messageInput).toBe('text 5')
        expect(peek(composerKey('a', 'chat204')).messageInput).toBe('text 204')
    })

    test('files a durable draft that is absent', () => {
        putBackDrafts({
            v: 1, at: NOW, composer: [],
            durable: [{ key: 'msg:id:chatKey:c1', text: 'edited', baseData: 'base', updatedAt: 500 }],
        })
        expect(draftContentOrphanGate.get(identity('chatKey', 'c1'), 'base')?.text).toBe('edited')
    })

    test('a durable draft already held wins when it is newer, and loses when it is older', () => {
        draftContentOrphanGate.set(identity('chatKey', 'c1'), 'newer local', 'base', 2000)
        const heldUpdatedAt = draftContentOrphanGate.entries()[0].record.updatedAt
        putBackDrafts({
            v: 1, at: NOW, composer: [],
            durable: [{ key: 'msg:id:chatKey:c1', text: 'older carried', baseData: 'base', updatedAt: heldUpdatedAt - 1 }],
        })
        expect(draftContentOrphanGate.get(identity('chatKey', 'c1'), 'base')?.text).toBe('newer local')

        putBackDrafts({
            v: 1, at: NOW, composer: [],
            durable: [{ key: 'msg:id:chatKey:c1', text: 'newer carried', baseData: 'base', updatedAt: heldUpdatedAt + 1 }],
        })
        const kept = draftContentOrphanGate.get(identity('chatKey', 'c1'), 'base')
        expect(kept?.text).toBe('newer carried')
        expect(kept?.updatedAt).toBe(heldUpdatedAt + 1)
    })

    test('a durable draft held with the same time as the carried one stays', () => {
        draftContentOrphanGate.set(identity('chatKey', 'c1'), 'local', 'base')
        const heldUpdatedAt = draftContentOrphanGate.entries()[0].record.updatedAt
        putBackDrafts({
            v: 1, at: NOW, composer: [],
            durable: [{ key: 'msg:id:chatKey:c1', text: 'carried', baseData: 'base', updatedAt: heldUpdatedAt }],
        })
        expect(draftContentOrphanGate.get(identity('chatKey', 'c1'), 'base')?.text).toBe('local')
    })

    test('a record taken from the live stores survives the part and puts every field back', () => {
        write(composerKey('a', 'chat1'), (record) => {
            record.messageInput = 'one'
            record.messageInputTranslate = 'uno'
            record.fileInput = ['f1', 'f2']
        })
        draftContentOrphanGate.set(identity('chatKey', 'c1'), 'edited', 'base')
        const part = parseDraftsPart(JSON.stringify(takeDraftsPart(NOW)))
        expect(part).not.toBeNull()
        resetComposerDraftsForTests()
        draftContentOrphanGate.clear()
        putBackDrafts(part as DraftsPart)
        expect({ ...peek(composerKey('a', 'chat1')), fileInput: [...peek(composerKey('a', 'chat1')).fileInput] })
            .toEqual({ messageInput: 'one', messageInputTranslate: 'uno', fileInput: ['f1', 'f2'] })
        expect(draftContentOrphanGate.get(identity('chatKey', 'c1'), 'base')?.text).toBe('edited')
    })

    test('does not take an empty record', () => {
        write(composerKey('a', 'chat1'), (record) => { record.messageInput = 'x' })
        write(composerKey('a', 'chat1'), (record) => { record.messageInput = '' })
        expect(takeDraftsPart(NOW).composer).toEqual([])
    })

    test.each([
        ['an entry that is not an object', { composer: [1], durable: [] }],
        ['a composer entry without its key', { composer: [{ messageInput: '', messageInputTranslate: '', fileInput: [] }], durable: [] }],
        ['a durable entry with a time that is not a number', { composer: [], durable: [{ key: 'k', text: '', baseData: '', updatedAt: 'x' }] }],
    ])('refuses a drafts part with %s', (_title, body) => {
        expect(parseDraftsPart(JSON.stringify({ v: 1, at: NOW, ...body }))).toBeNull()
    })
})

describe('the blocking kinds of drafts', () => {
    test('a registration of the orphan kind alone does not block, and a composer or message one does', () => {
        registerDraft('orphan', HYPA_DRAFT_KIND)
        expect(hasDraftOfKind('composer')).toBe(false)
        expect(hasDraftOfKind('message')).toBe(false)
        registerDraft('on screen', COMPOSER_DRAFT_KIND)
        expect(hasDraftOfKind('composer')).toBe(true)
        registerDraft('editor')
        expect(hasDraftOfKind('message')).toBe(true)
    })

    test('a put-back durable draft registers as an orphan only, so it never blocks', () => {
        putBackDrafts({
            v: 1, at: NOW, composer: [],
            durable: [{ key: 'msg:id:chatKey:c1', text: 'edited', baseData: 'base', updatedAt: 500 }],
        })
        expect(hasDraftOfKind('message')).toBe(false)
        expect(hasDraftOfKind('composer')).toBe(false)
    })
})

describe('the draft stores count their changes', () => {
    test('a composer write, a restore and a durable set, delete and mismatched read each move the reading', () => {
        const readings: number[][] = [draftsVersions()]
        const moved = () => {
            const now = draftsVersions()
            const before = readings[readings.length - 1]
            readings.push(now)
            return now.some((value, i) => value !== before[i])
        }
        write(composerKey('a', 'c'), (record) => { record.messageInput = 'x' })
        expect(moved()).toBe(true)
        putBackDrafts({ v: 1, at: NOW, composer: [{ key: 'a::d', messageInput: 'y', messageInputTranslate: '', fileInput: [] }], durable: [] })
        expect(moved()).toBe(true)
        draftContentOrphanGate.set(identity('chatKey', 'c1'), 'edited', 'base')
        expect(moved()).toBe(true)
        expect(draftContentOrphanGate.get(identity('chatKey', 'c1'), 'a different base')).toBeUndefined()
        expect(moved()).toBe(true)
        draftContentOrphanGate.set(identity('chatKey', 'c2'), 'edited', 'base')
        moved()
        draftContentOrphanGate.delete(identity('chatKey', 'c2'))
        expect(moved()).toBe(true)
    })

    test('a read that only renews a record does not move the reading', () => {
        draftContentOrphanGate.set(identity('chatKey', 'c1'), 'edited', 'base')
        const before = draftsVersions()
        expect(draftContentOrphanGate.get(identity('chatKey', 'c1'), 'base')?.text).toBe('edited')
        expect(draftsVersions()).toEqual(before)
    })

    test('an eviction by the store cap moves the reading', () => {
        const store = createDraftContentStore({ maxRecords: 1 })
        store.set(identity('k', 'a'), 't', 'b')
        const before = store.version()
        store.set(identity('k', 'b'), 't', 'b')
        expect(store.version()).toBe(before + 2)
        expect(store.size()).toBe(1)
    })
})

describe('applying a read hand-off', () => {
    test('selects the character by its id and deletes the selection part', async () => {
        const medium = createStorageMedium(asStorage(new MemoryStorage()))
        const selection = buildSelectionPart({ chaId: 'a', members: [], now: NOW })
        medium.write('selection', JSON.stringify(selection))
        const select = vi.fn(async () => true)
        await applyHandoff({ selection, drafts: null }, medium, select, commitCallbacks().register)
        expect(select).toHaveBeenCalledWith('a')
        expect(medium.read('selection')).toBeNull()
    })

    test('selects nothing when no character was selected', async () => {
        const medium = createStorageMedium(asStorage(new MemoryStorage()))
        const select = vi.fn(async () => true)
        await applyHandoff({ selection: buildSelectionPart({ chaId: null, members: [], now: NOW }), drafts: null }, medium, select, commitCallbacks().register)
        expect(select).not.toHaveBeenCalled()
    })

    test('reports a selection that fails and still finishes', async () => {
        const medium = createStorageMedium(asStorage(new MemoryStorage()))
        const errors = vi.spyOn(console, 'error').mockImplementation(() => { })
        await applyHandoff(
            { selection: buildSelectionPart({ chaId: 'a', members: [], now: NOW }), drafts: null },
            medium,
            async () => { throw new Error('no') },
            commitCallbacks().register,
        )
        expect(errors).toHaveBeenCalled()
    })
})

describe('writing the record', () => {
    const selection = buildSelectionPart({ chaId: 'a', members: [], now: NOW })
    const drafts: DraftsPart = { v: 1, at: NOW, composer: [], durable: [] }

    test('writes both parts, drafts first', () => {
        const writes: string[] = []
        const memory = new MemoryStorage()
        const base = createStorageMedium(asStorage(memory))
        const ok = writeHandoffSync({ ...base, write: (part, text) => { writes.push(part); return base.write(part, text) } }, selection, drafts)
        expect(ok).toBe(true)
        expect(writes).toEqual(['drafts', 'selection'])
    })

    test('is not written when the drafts part does not read back, and the selection is never written', () => {
        const memory = new MemoryStorage()
        memory.dropWrites = true
        const medium = createStorageMedium(asStorage(memory))
        expect(writeHandoffSync(medium, selection, drafts)).toBe(false)
        expect(medium.read('selection')).toBeNull()
    })
})

function fakeFiles() {
    const files = new Map<string, Uint8Array>()
    let failWrite = false
    let writes = 0
    const api: HandoffFiles = {
        read: async (path) => files.get(path) ?? null,
        writeAtomic: async (path, bytes) => {
            if (failWrite) {
                throw new Error('disk full')
            }
            writes += 1
            await Promise.resolve()
            files.set(path, bytes)
        },
        remove: async (path) => { files.delete(path) },
    }
    return { api, files, setFailWrite: (value: boolean) => { failWrite = value }, writes: () => writes }
}

describe('the file medium of the desktop', () => {
    test('writes a part, reads it back from the file and keeps the other part', async () => {
        const { api, files } = fakeFiles()
        const medium = createFileMedium(api)
        expect(await medium.write('drafts', 'D')).toBe(true)
        expect(await medium.write('selection', 'S')).toBe(true)
        expect(await medium.read('drafts')).toBe('D')
        expect(await medium.read('selection')).toBe('S')
        expect(JSON.parse(new TextDecoder().decode(files.get(HANDOFF_FILE_PATH)))).toEqual({ drafts: 'D', selection: 'S' })
    })

    test('reports a write that failed', async () => {
        const { api, setFailWrite } = fakeFiles()
        vi.spyOn(console, 'error').mockImplementation(() => { })
        setFailWrite(true)
        expect(await createFileMedium(api).write('drafts', 'D')).toBe(false)
    })

    test('refuses a write whose bytes are not on disk when read back', async () => {
        const { api } = fakeFiles()
        const medium = createFileMedium({ ...api, writeAtomic: async () => { } })
        expect(await medium.write('drafts', 'D')).toBe(false)
    })

    test('two removals started together both take effect, and the file goes once it is empty', async () => {
        const { api, files } = fakeFiles()
        const medium = createFileMedium(api)
        await medium.write('drafts', 'D')
        await medium.write('selection', 'S')
        await Promise.all([medium.remove('drafts'), medium.remove('selection')])
        expect(files.has(HANDOFF_FILE_PATH)).toBe(false)
    })

    test('a removal leaves the other part in the file', async () => {
        const { api } = fakeFiles()
        const medium = createFileMedium(api)
        await medium.write('drafts', 'D')
        await medium.write('selection', 'S')
        await medium.remove('selection')
        expect(await medium.read('selection')).toBeNull()
        expect(await medium.read('drafts')).toBe('D')
    })

    test('treats a file that is not a record as having no parts and does not delete it', async () => {
        const { api, files } = fakeFiles()
        files.set(HANDOFF_FILE_PATH, new TextEncoder().encode('not json'))
        const medium = createFileMedium(api)
        expect(await medium.read('selection')).toBeNull()
        await medium.remove('selection')
        expect(files.has(HANDOFF_FILE_PATH)).toBe(true)
    })

    test('writeHandoff writes both parts to the file', async () => {
        const { api } = fakeFiles()
        const medium = createFileMedium(api)
        const selection = buildSelectionPart({ chaId: 'a', members: [], now: NOW })
        expect(await writeHandoff(medium, selection, { v: 1, at: NOW, composer: [], durable: [] })).toBe(true)
        expect(parseSelectionPart((await medium.read('selection')) ?? '', NOW)).toEqual({ status: 'fresh', part: selection })
    })
})

describe('the rate-limit history', () => {
    test('reads back the time that was written, and null before any', () => {
        const memory = new MemoryStorage()
        expect(readReloadHistory(memory)).toBeNull()
        expect(writeReloadHistory(memory, NOW)).toBe(true)
        expect(readReloadHistory(memory)).toBe(NOW)
    })

    test('is unreadable when the stored value is not a time or the storage throws', () => {
        const memory = new MemoryStorage()
        memory.setItem('risu-idle-reload-history', '{"lastAt":"x"}')
        expect(readReloadHistory(memory)).toBe('unreadable')
        expect(readReloadHistory({ getItem: () => { throw new Error('denied') } })).toBe('unreadable')
    })

    test('reports a write that throws or that does not read back', () => {
        const memory = new MemoryStorage()
        memory.failWrites = true
        expect(writeReloadHistory(memory, NOW)).toBe(false)
        const lossy = new MemoryStorage()
        lossy.dropWrites = true
        expect(writeReloadHistory(lossy, NOW)).toBe(false)
    })

    test('lives under its own key, apart from the record', () => {
        const memory = new MemoryStorage()
        const medium = createStorageMedium(asStorage(memory))
        writeReloadHistory(memory, NOW)
        medium.write('selection', 'S')
        medium.remove('selection')
        expect(readReloadHistory(memory)).toBe(NOW)
    })
})
