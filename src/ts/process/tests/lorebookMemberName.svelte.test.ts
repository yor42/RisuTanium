// @vitest-environment jsdom

/**
 * The speaker name the REAL `loadLoreBookV3Prompt` (`../lorebook.svelte`) puts in front of a group
 * member's message in the scanned text: the live member's name, else the group's join record, else
 * "Unknown Character". The scanned text is read from the `matchLog` the call returns for an entry
 * keyed on the message body.
 *
 * Classes: `regression reproducer:` fails on the code before the member record existed (the scanned
 * speaker was "Unknown Character"); `guard:` passes before and after.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'

const h = vi.hoisted(() => ({
    db: {
        characters: [] as unknown[],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
    },
}))

vi.mock('../../stores.svelte', () => ({
    DBState: { db: h.db },
    selectedCharID: writable(0),
}))
vi.mock('../../storage/database.svelte', () => ({
    getDatabase: () => h.db,
}))
vi.mock('../../alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../../lang', () => ({ language: {} }))
vi.mock('../../globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../characters', () => ({ createBlankChar: vi.fn(() => ({ name: 'Unknown Character' })), getCharImage: vi.fn() }))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))
vi.mock('../../parser/chatVar.svelte', () => ({ getChatVar: vi.fn(), setChatVar: vi.fn() }))
vi.mock('../../parser/parser.svelte', () => ({ risuChatParser: vi.fn((text: string) => text) }))
vi.mock('../../tokenizer', () => ({ tokenize: vi.fn(async (text: string) => text.length) }))
vi.mock('../modules', () => ({ getModuleLorebooks: vi.fn(() => []) }))
vi.mock('../../storage/characterSaveMarks', () => ({ markCharacterForSave: vi.fn() }))
vi.mock('../memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { loadLoreBookV3Prompt } from '../lorebook.svelte'

type Members = Record<string, unknown> | undefined

function bodyKeyed() {
    return {
        key: 'spoken', comment: 'entry', content: 'LORE BODY', mode: 'normal', insertorder: 100,
        alwaysActive: false, secondkey: '', selective: false,
    }
}

// A group whose last message was said by member 'm-1'. `members` is risutanium_members exactly as
// joinRecord writes it ({name, slot 0..7}); `live` are the member characters still in the list.
function setGroup(members: Members, live: { chaId: string, name: string }[]) {
    h.db.characters = [
        {
            type: 'group', name: 'Group', chatPage: 0, characters: ['m-1'],
            globalLore: [bodyKeyed()],
            loreSettings: { scanDepth: 5, tokenBudget: 100000, fullWordMatching: false, recursiveScanning: false },
            chats: [{
                id: 'chat-1', localLore: [],
                message: [{ role: 'char', data: 'spoken text', time: 0, saying: 'm-1' }],
            }],
            ...(members === undefined ? {} : { risutanium_members: members }),
        },
        ...live.map((c) => ({ ...c, type: 'character', chats: [], chatPage: 0 })),
    ]
}

// The scanned text of the hit; plain keys match against lower-cased text.
const scannedPrompt = async () => {
    const log = (await loadLoreBookV3Prompt()).matchLog
    expect(log).toHaveLength(1)
    return log[0].prompt
}

beforeEach(() => {
    h.db.characters = []
})

describe('lorebook scan: speaker of a group member message', () => {
    test('regression reproducer: a deleted member is scanned under the name recorded at join', async () => {
        setGroup({ 'm-1': { name: 'Alice', slot: 0 } }, [])
        expect(await scannedPrompt()).toBe('\x01{{alice}}:spoken text\x01')
    })

    test('guard: a live member is scanned under its own name, not the record', async () => {
        setGroup({ 'm-1': { name: 'Alice', slot: 0 } }, [{ chaId: 'm-1', name: 'Alicia' }])
        expect(await scannedPrompt()).toBe('\x01{{alicia}}:spoken text\x01')
    })

    test('guard: a deleted member with no record is scanned as Unknown Character', async () => {
        setGroup(undefined, [])
        expect(await scannedPrompt()).toBe('\x01{{unknown character}}:spoken text\x01')
    })
})