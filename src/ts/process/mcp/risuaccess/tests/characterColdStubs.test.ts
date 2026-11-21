/**
 * The risuaccess character tools on an ARCHIVED character (a "stub": a
 * placeholder whose full data lives in a cold-storage unit), driven through
 * the REAL `RisuAccessClient.callTool`, `CharacterHandler`, `ChatHandler`, the
 * REAL `coldCharacter.ts` / `coldCharacterRestore.ts`, `characterSaveMarks.ts`
 * and `RisuSaveEncoder` (encode -> decode round trip). The cold-storage read
 * is a mock (`readColdStorageItem`); it says nothing about the native backends.
 *
 * Invariants exercised here:
 * - The read tools return the unit's data for a stub, from a copy: the stub
 *   stays in its slot. A missing unit answers with error text and the user gets
 *   one alert naming the character.
 * - The write tools restore a stub first, then write into the restored
 *   character found again by `chaId` after the confirm prompt, and the write
 *   persists. A failed restore writes nothing, reports an error (never
 *   "Successfully ..."), leaves the stub alone and shows one alert naming the
 *   character.
 * - A character restored or deleted while the confirm prompt is open is
 *   handled: the write lands on the live character, or the tool reports that
 *   the character is gone (the tool's existing character-gone error).
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

//#region module mocks

vi.mock(import('katex'), () => ({}))
vi.mock(import('src/ts/lite'), () => ({}))

const alertConfirmMock = vi.hoisted(() => vi.fn(async () => true))
const readColdStorageItemMock = vi.hoisted(() => vi.fn())
/** Every text shown to the user, except the confirm prompt and progress notices. */
const notices = vi.hoisted(() => ({ texts: [] as string[] }))

vi.mock(import('src/ts/alert'), () => {
    const show = (msg: string | Error) => { notices.texts.push(msg instanceof Error ? msg.message : String(msg)) }
    return {
        alertConfirm: alertConfirmMock,
        alertError: vi.fn(show),
        alertErrorWait: vi.fn(async (msg: string) => { show(msg) }),
        alertNormal: vi.fn(show),
        alertNormalWait: vi.fn(async (msg: string) => { show(msg) }),
        alertMd: vi.fn(show),
        alertToast: vi.fn(show),
        alertWait: vi.fn(() => ({})),
        alertClear: vi.fn(),
    } as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    return {
        DBState: {
            db: {
                characters: [],
            },
        },
        selIdState: {
            selId: 0,
        },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/coldstorage.svelte'), () => ({
    readColdStorageItem: readColdStorageItemMock,
    setColdStorageItem: vi.fn(),
}) as unknown as typeof import('src/ts/process/coldstorage.svelte'))

const memStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => memStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                memStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                memStore.delete(key)
            }),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { RisuAccessClient } from '../client'
import { RisuSaveEncoder, decodeRisuSave } from 'src/ts/storage/risuSave'
import type { Database, character } from 'src/ts/storage/database.svelte'
import type { toSaveType } from 'src/ts/storage/risuSave'
import { installCharacterSaveMarks, resetCharacterSaveMarksForTest } from 'src/ts/storage/characterSaveMarks'
import { buildColdStub } from 'src/ts/process/tests/coldStubFixture'
import { restoreColdCharacter } from 'src/ts/process/coldCharacterRestore'
import type { RunSubject } from 'src/ts/process/chatOrigin'

//#region fixtures

type CharacterFixture = Database['characters'][number]
type ColdCharacter = character & { coldstorage?: string }

const HERO_NAME = 'Archived Hero'
/** The text of the error a write tool answers with when its character is gone after the prompt. */
const CHARACTER_GONE_TEXT = 'character no longer exists'

function makeChat(id: string, text: string) {
    return { id, message: [{ role: 'user', data: text, time: 1 }], note: '', name: id, localLore: [] }
}

function warmCharacter(chaId: string): CharacterFixture {
    return {
        chaId,
        name: `${chaId} name`,
        type: 'character',
        chatPage: 0,
        desc: `${chaId} description`,
        chats: [makeChat(`${chaId}-chat-0`, 'hello')],
        globalLore: [],
        customscript: [],
        additionalAssets: [],
        triggerscript: [],
    } as unknown as CharacterFixture
}

/** The full character the unit holds: every list a write tool edits has one entry to edit or delete. */
function heroCharacter(): character {
    return {
        chaId: 'hero',
        name: HERO_NAME,
        type: 'character',
        chatPage: 1,
        firstMsgIndex: 0,
        creatorNotes: '',
        lastInteraction: 5000,
        desc: 'hero description',
        firstMessage: 'hero greeting',
        chats: [makeChat('hero-chat-0', 'first chat message'), makeChat('hero-chat-1', 'second chat message'), makeChat('hero-chat-2', 'third chat message')],
        globalLore: [{ comment: 'entry1', content: 'hero lore content', key: 'k', alwaysActive: false, secondkey: '', selective: false, insertorder: 100, mode: 'normal' }],
        customscript: [{ comment: 'script1', in: 'hero-in', out: 'hero-out', type: 'editdisplay', flag: '', ableFlag: true }],
        additionalAssets: [['asset1', 'hero-path', 'png']],
        triggerscript: [{ comment: '', type: 'manual', conditions: [], effect: [{ type: 'triggerlua', code: 'print("hero lua")' }] }],
    } as unknown as character
}

const units = new Map<string, { kind: 'ok', character: unknown } | { kind: 'error' }>()

function installUnitReader(): void {
    readColdStorageItemMock.mockImplementation(async (key: string) => {
        const entry = units.get(key)
        if (!entry) {
            return { status: 'missing' }
        }
        if (entry.kind === 'error') {
            return { status: 'error', error: new Error('unit unreadable') }
        }
        return { status: 'ok', value: { character: structuredClone(entry.character) } }
    })
}

/**
 * The stub as it sits in the list after load: the fields the boot-time format
 * check fills on every character are default-filled, so a reader that does not
 * look behind the stub sees empty data rather than a crash.
 */
function loadedStub(hero: character, key: string): CharacterFixture {
    const stub = buildColdStub(hero, key, []) as unknown as Record<string, unknown>
    Object.assign(stub, { customscript: [], firstMessage: '', globalLore: [], desc: '', viewScreen: 'none', emotionImages: [] })
    return stub as unknown as CharacterFixture
}

/** [warm, hero stub]. With `unit` false the hero's unit does not exist. */
function installDb(unit = true): Database {
    const hero = heroCharacter()
    if (unit) {
        units.set('unit-hero', { kind: 'ok', character: hero })
    }
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: ['warm', 'hero'],
        characters: [warmCharacter('warm'), loadedStub(hero, 'unit-hero')],
    } as unknown as Database
    DBState.db = db
    return db
}

function makeTracker(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

function deferred<T>() {
    let resolve!: (v: T) => void
    const promise = new Promise<T>((res) => { resolve = res })
    return { promise, resolve }
}

function liveOf(chaId: string): ColdCharacter {
    return DBState.db.characters.find((c: CharacterFixture) => c.chaId === chaId) as unknown as ColdCharacter
}

function textOf(result: { type: string, text?: string }[]): string {
    return result.map((part) => part.text ?? '').join('\n')
}

function noticesNaming(name: string): string[] {
    return notices.texts.filter((text) => text.includes(name))
}

async function tick(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Lets the call reach its confirm prompt. */
async function untilPrompted(): Promise<void> {
    for (let i = 0; i < 50 && alertConfirmMock.mock.calls.length === 0; i++) {
        await tick()
    }
}

beforeEach(() => {
    resetCharacterSaveMarksForTest()
    units.clear()
    notices.texts.length = 0
    readColdStorageItemMock.mockReset()
    installUnitReader()
    alertConfirmMock.mockReset()
    alertConfirmMock.mockImplementation(async () => true)
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

//#endregion

const readCases: { name: string, args: Record<string, unknown>, expected: string[] }[] = [
    { name: 'risu-get-character-info', args: { id: 'hero', fields: ['description', 'greeting'] }, expected: ['hero description', 'hero greeting'] },
    { name: 'risu-list-character-lorebooks', args: { id: 'hero' }, expected: ['entry1'] },
    { name: 'risu-get-character-lorebook', args: { id: 'hero', names: ['entry1'] }, expected: ['hero lore content'] },
    { name: 'risu-get-character-regex-scripts', args: { id: 'hero' }, expected: ['hero-in', 'hero-out'] },
    { name: 'risu-get-character-additional-assets', args: { id: 'hero' }, expected: ['hero-path'] },
    { name: 'risu-get-character-lua-script', args: { id: 'hero' }, expected: ['hero lua'] },
    { name: 'risu-get-chat-history', args: { id: 'hero' }, expected: ['second chat message'] },
]

describe('risuaccess read tools on an archived character', () => {
    for (const readCase of readCases) {
        test(`${readCase.name} returns the unit's data and leaves the stub in its slot`, async () => {
            installDb()
            const stubBefore = DBState.db.characters[1]
            const client = new RisuAccessClient()

            const text = textOf(await client.callTool(readCase.name, readCase.args))

            for (const expected of readCase.expected) {
                expect(text).toContain(expected)
            }
            expect(DBState.db.characters[1]).toBe(stubBefore)
            expect((DBState.db.characters[1] as ColdCharacter).coldstorage).toBe('unit-hero')
        })

        test(`${readCase.name} answers with error text and one alert naming the character when the unit is missing`, async () => {
            installDb(false)
            const client = new RisuAccessClient()

            const text = textOf(await client.callTool(readCase.name, readCase.args))

            expect(text).toMatch(/^Error/)
            expect(noticesNaming(HERO_NAME)).toHaveLength(1)
            expect(notices.texts).toHaveLength(1)
            expect((DBState.db.characters[1] as ColdCharacter).coldstorage).toBe('unit-hero')
        })
    }

    test('guard: risu-list-characters lists an archived character by chaId, name and type without reading its unit', async () => {
        installDb()
        const client = new RisuAccessClient()

        const text = textOf(await client.callTool('risu-list-characters', {}))

        expect(text).toContain('hero')
        expect(text).toContain(HERO_NAME)
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
    })

    test('guard: a read tool on a full character answers from memory without reading a unit', async () => {
        installDb()
        const client = new RisuAccessClient()

        const text = textOf(await client.callTool('risu-get-character-info', { id: 'warm', fields: ['description'] }))

        expect(text).toContain('warm description')
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
    })
})

// Each row: the tool, its arguments for the archived hero, and what the
// restored hero must hold afterwards.
const writeCases: { name: string, args: Record<string, unknown>, assertWritten: (char: ColdCharacter) => void }[] = [
    {
        name: 'risu-set-character-info',
        args: { id: 'hero', data: { description: 'rewritten by tool' } },
        assertWritten: (char) => expect(char.desc).toBe('rewritten by tool'),
    },
    {
        name: 'risu-set-character-lorebook',
        args: { id: 'hero', name: 'entry2', content: 'added by tool', keys: ['k2'] },
        assertWritten: (char) => {
            expect(char.globalLore.map((e) => e.comment)).toEqual(['entry1', 'entry2'])
            expect(char.globalLore[1].content).toBe('added by tool')
        },
    },
    {
        name: 'risu-delete-character-lorebook',
        args: { id: 'hero', name: 'entry1' },
        assertWritten: (char) => expect(char.globalLore).toHaveLength(0),
    },
    {
        name: 'risu-set-character-regex-scripts',
        args: { id: 'hero', name: 'script2', in: 'foo', out: 'bar' },
        assertWritten: (char) => expect(char.customscript.map((s) => s.comment)).toEqual(['script1', 'script2']),
    },
    {
        name: 'risu-delete-character-regex-scripts',
        args: { id: 'hero', name: 'script1' },
        assertWritten: (char) => expect(char.customscript).toHaveLength(0),
    },
    {
        name: 'risu-set-character-lua-script',
        args: { id: 'hero', code: 'print("rewritten")' },
        assertWritten: (char) => expect(char.triggerscript[0].effect[0]).toMatchObject({ code: 'print("rewritten")' }),
    },
    {
        name: 'risu-delete-character-additional-assets',
        args: { id: 'hero', assetName: 'asset1' },
        assertWritten: (char) => expect(char.additionalAssets).toHaveLength(0),
    },
]

describe('risuaccess write tools on an archived character', () => {
    for (const writeCase of writeCases) {
        test(`${writeCase.name} restores the character first, writes into it, reports success and persists the write`, async () => {
            const db = installDb()
            const tracker = makeTracker()
            installCharacterSaveMarks({ tracker, schedule: () => {} })
            const encoder = new RisuSaveEncoder()
            await encoder.init(structuredClone(db) as Database, { compression: false })
            tracker.character = []
            const client = new RisuAccessClient()

            const text = textOf(await client.callTool(writeCase.name, writeCase.args))

            expect(text).toMatch(/^Successfully/)
            const hero = liveOf('hero')
            expect(hero.coldstorage).toBeUndefined()
            expect(hero.desc).toBe(writeCase.name === 'risu-set-character-info' ? 'rewritten by tool' : 'hero description')
            expect(hero.chats).toHaveLength(3)
            writeCase.assertWritten(hero)
            expect(tracker.character).toContain('hero')

            await encoder.set(structuredClone(DBState.db) as Database, structuredClone(tracker) as toSaveType)
            const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
            const decodedHero = decoded.characters?.find((c: CharacterFixture) => c.chaId === 'hero') as unknown as ColdCharacter
            expect(decodedHero.coldstorage).toBeUndefined()
            expect(decodedHero.chats).toHaveLength(3)
            writeCase.assertWritten(decodedHero)
        })

        test(`${writeCase.name} with a missing unit reports an error, writes nothing, leaves the stub and shows one alert naming the character`, async () => {
            installDb(false)
            const tracker = makeTracker()
            installCharacterSaveMarks({ tracker, schedule: () => {} })
            const stubBefore = DBState.db.characters[1]
            const stubJson = JSON.stringify(stubBefore)
            const client = new RisuAccessClient()

            const text = textOf(await client.callTool(writeCase.name, writeCase.args))

            expect(text).not.toContain('Successfully')
            expect(text).toMatch(/^Error/)
            expect(DBState.db.characters[1]).toBe(stubBefore)
            expect(JSON.stringify(DBState.db.characters[1])).toBe(stubJson)
            expect(tracker.character).not.toContain('hero')
            expect(noticesNaming(HERO_NAME)).toHaveLength(1)
            expect(notices.texts).toHaveLength(1)
        })
    }

    test('an unreadable unit is reported the same way: error text, stub unchanged, one alert naming the character', async () => {
        installDb()
        units.set('unit-hero', { kind: 'error' })
        const stubBefore = DBState.db.characters[1]
        const client = new RisuAccessClient()

        const text = textOf(await client.callTool('risu-set-character-lorebook', { id: 'hero', name: 'entry2', content: 'added by tool' }))

        expect(text).not.toContain('Successfully')
        expect(DBState.db.characters[1]).toBe(stubBefore)
        expect((DBState.db.characters[1] as ColdCharacter).coldstorage).toBe('unit-hero')
        expect(noticesNaming(HERO_NAME)).toHaveLength(1)
        expect(notices.texts).toHaveLength(1)
    })

    test('a character restored by another path while the confirm prompt is open receives the write in the list', async () => {
        installDb()
        const gate = deferred<boolean>()
        alertConfirmMock.mockImplementationOnce(() => gate.promise)
        const client = new RisuAccessClient()

        const call = client.callTool('risu-set-character-lorebook', { id: 'hero', name: 'entry2', content: 'added by tool' })
        await untilPrompted()
        const outcome = await restoreColdCharacter(DBState.db.characters[1])
        expect(outcome.status).toBe('restored')
        gate.resolve(true)
        const text = textOf(await call)

        expect(text).toMatch(/^Successfully/)
        const hero = liveOf('hero')
        expect(hero.coldstorage).toBeUndefined()
        expect(hero.globalLore.map((e) => e.comment)).toEqual(['entry1', 'entry2'])
    })

    test.each([
        ['an archived character', true],
        ['a full character', false],
    ])('%s deleted while the confirm prompt is open makes the write fail with the character-gone error', async (_label, archived) => {
        installDb()
        if (!archived) {
            const outcome = await restoreColdCharacter(DBState.db.characters[1])
            expect(outcome.status).toBe('restored')
        }
        const gate = deferred<boolean>()
        alertConfirmMock.mockImplementationOnce(() => gate.promise)
        const client = new RisuAccessClient()

        const call = client.callTool('risu-set-character-lorebook', { id: 'hero', name: 'entry2', content: 'added by tool' })
        await untilPrompted()
        DBState.db.characters.splice(1, 1)
        gate.resolve(true)
        const text = textOf(await call)

        expect(text).toContain(CHARACTER_GONE_TEXT)
        expect(text).not.toContain('Successfully')
    })

    test('guard: a write addressed by subject whose character is deleted while the prompt is open fails with the character-gone error', async () => {
        installDb()
        const outcome = await restoreColdCharacter(DBState.db.characters[1])
        expect(outcome.status).toBe('restored')
        const owner = DBState.db.characters[1]
        let alive = true
        const subject = { resolve: () => (alive ? { owner } : undefined) } as unknown as RunSubject
        const gate = deferred<boolean>()
        alertConfirmMock.mockImplementationOnce(() => gate.promise)
        const client = new RisuAccessClient()

        const call = client.callTool('risu-set-character-lorebook', { id: '', name: 'entry2', content: 'added by tool' }, { subject })
        await untilPrompted()
        alive = false
        gate.resolve(true)
        const text = textOf(await call)

        expect(text).toContain(CHARACTER_GONE_TEXT)
    })

    test('guard: a write to a full character does not read a unit and reports success', async () => {
        installDb()
        const client = new RisuAccessClient()

        const text = textOf(await client.callTool('risu-set-character-info', { id: 'warm', data: { description: 'rewritten by tool' } }))

        expect(text).toMatch(/^Successfully/)
        expect(liveOf('warm').desc).toBe('rewritten by tool')
        expect(readColdStorageItemMock).not.toHaveBeenCalled()
    })
})
