// @vitest-environment jsdom
/**
 * A tester Run, end to end through the page, writes nothing. The REAL runner,
 * lorebook scan, `chatVar` and `chatOrigin` run over a `$state` database whose
 * entries do reach write paths (the two flag decorators and a text that sets a
 * variable); the database is deep-compared before and after, and the save
 * marks are doubles that must never be called. Editing an entry afterwards
 * shows the stale line. The parser is a stand-in that performs the variable
 * macros through `chatVar` with the subject it is given; the tokenizer counts
 * characters.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import { buildOwnerModel } from '../../ts/studio/ownerModel'
import { makeCharacter, makeChat, makeInput } from '../../ts/studio/studioFixtures.test-helpers'
import '../../ts/polyfill'

const writes = vi.hoisted(() => ({
    markCharacterForSave: vi.fn(),
    markDbWrite: vi.fn(),
    setDatabase: vi.fn(),
}))

const db = $state({ db: {} as unknown as Database })
const selection = $state({ selId: 0 })
const ReloadGUIPointer = writable(0)
const MobileGUI = writable(false)
const settingsOpen = writable(false)
const CharConfigSubMenu = writable(0)
const SettingsMenuIndex = writable(-1)
const botMakerMode = writable(false)
const sideBarStore = writable(false)
const QuickSettings = $state({ open: true })

// Getters: the statically imported modules are evaluated before these consts are initialised.
vi.mock('../../ts/stores.svelte', () => ({
    get DBState() { return db },
    get selIdState() { return selection },
    get selectedCharID() { return writable(0) },
    get ReloadGUIPointer() { return ReloadGUIPointer },
    get MobileGUI() { return MobileGUI },
    get settingsOpen() { return settingsOpen },
    get CharConfigSubMenu() { return CharConfigSubMenu },
    get SettingsMenuIndex() { return SettingsMenuIndex },
    get botMakerMode() { return botMakerMode },
    get sideBarStore() { return sideBarStore },
    get QuickSettings() { return QuickSettings },
}))
vi.mock('../../ts/chatShell/shellSwitch.svelte', () => ({ shellEligible: () => false }))
vi.mock('../../lang', async () => {
    const helpers = await import('../../ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})
vi.mock('../../ts/storage/database.svelte', () => ({
    setDatabase: writes.setDatabase,
    getDatabase: () => ({}),
    getCurrentChat: () => undefined,
    getCurrentCharacter: () => undefined,
}))
vi.mock('../../ts/alert', () => ({ alertError: vi.fn(), alertNormal: vi.fn() }))
vi.mock('../../ts/globalApi.svelte', () => ({ downloadFile: vi.fn() }))
vi.mock('../../ts/util', () => ({
    findCharacterbyId: vi.fn(() => undefined),
    pickHashRand: (_cid: number, word: string) => word.length,
    selectSingleFile: vi.fn(),
    parseKeyValue: () => [],
}))
vi.mock('../../ts/parser/parser.svelte', async () => {
    const vars = await import('../../ts/parser/chatVar.svelte')
    return {
        risuChatParser: (text: string, arg?: { subject?: import('../../ts/process/chatOrigin').RunSubject }) => text
            .replace(/\{\{setvar::([^:}]+)::([^}]*)\}\}/g, (_all, key: string, value: string) => {
                vars.setChatVar(key, value, arg?.subject)
                return ''
            })
            .replace(/\{\{getvar::([^}]+)\}\}/g, (_all, key: string) => vars.getChatVar(key, arg?.subject)),
    }
})
vi.mock('../../ts/tokenizer', () => ({ tokenize: async (text: string) => text.length }))
vi.mock('../../ts/process/modules', () => ({
    getModules: vi.fn(() => []),
    getModuleLorebooks: vi.fn(() => []),
}))
vi.mock('../../ts/storage/characterSaveMarks', () => ({
    markCharacterForSave: writes.markCharacterForSave,
    markDbWrite: writes.markDbWrite,
}))
vi.mock('../../ts/process/memory/busyActions', () => ({ beginBusy: vi.fn() }))

import { loreTestSlot, resetLoreTestFor } from '../../ts/studio/loreTestSession.svelte'
import { resetStudioScreenForTests } from '../../ts/studio/studioScreen.svelte'
import StudioLoreTester from './StudioLoreTester.svelte'

function lore(key: string, content: string, over: Record<string, unknown> = {}) {
    return { key, comment: key, content, mode: 'normal', insertorder: 100, alwaysActive: false, secondkey: '', selective: false, ...over }
}

function seed(): void {
    db.db = {
        characters: [{
            type: 'character',
            chaId: 'cha-1',
            name: 'Char',
            chatPage: 0,
            globalLore: [
                lore('alpha', '@@keep_activate_after_match\nkeeps', { comment: 'keep', id: 'k1' }),
                lore('beta', '@@dont_activate_after_match\nspent', { comment: 'once', id: 'k2' }),
                lore('dragon', '{{setvar::counter::1}}{{getvar::counter}}', { comment: 'vars' }),
            ],
            loreSettings: { scanDepth: 10, tokenBudget: 100000, fullWordMatching: false, recursiveScanning: true },
            chats: [{
                id: 'chat-1',
                name: 'Chat',
                note: '',
                localLore: [],
                message: [{ role: 'user', data: 'alpha beta dragon', time: 0 }],
            }],
        }],
        username: 'User',
        loreBookDepth: 5,
        loreBookToken: 100000,
        templateDefaultVariables: '',
        globalChatVariables: {},
        enabledModules: [],
        moduleIntergration: '',
        modules: [],
        personas: [],
    } as unknown as Database
}

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)

// The session imports the runner lazily on the first Run; loading it here keeps that import inside the hook's
// timeout instead of the test's short wait.
beforeAll(async () => {
    await import('../../ts/studio/loreTest')
}, 120_000)

beforeEach(() => {
    resetStudioScreenForTests()
    resetLoreTestFor('reset-between-tests')
    writes.markCharacterForSave.mockClear()
    writes.markDbWrite.mockClear()
    writes.setDatabase.mockClear()
    seed()
})

afterEach(async () => {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
    resetStudioScreenForTests()
})

describe('a tester Run through the page', () => {
    test('regression reproducer (M-R1): the database stays deep-equal, nothing is marked, the entries really ran, and an edit then shows the stale line', async () => {
        const model = buildOwnerModel(makeInput({ character: makeCharacter({ chaId: 'cha-1', chats: [makeChat({ id: 'chat-1', name: 'Chat' })] }) }))
        host = document.createElement('div')
        document.body.appendChild(host)
        app = mount(StudioLoreTester, { target: host, props: { model } })
        flushSync()

        const before = $state.snapshot(db.db)
        part('studio-lore-test-run')?.click()
        flushSync()
        await vi.waitFor(() => {
            flushSync()
            expect(loreTestSlot.pending).toBe(false)
            expect(loreTestSlot.outcome?.status).toBe('ok')
        })

        const reasons = Array.from(document.querySelectorAll('[data-part="studio-lore-test-row"]'))
            .map((row) => `${row.querySelector('button, span')?.textContent}|${row.getAttribute('data-active')}`)
        expect(reasons).toEqual(expect.arrayContaining(['keep|true', 'vars|true']))
        expect($state.snapshot(db.db)).toStrictEqual(before)
        expect(writes.markCharacterForSave).not.toHaveBeenCalled()
        expect(writes.markDbWrite).not.toHaveBeenCalled()
        expect(writes.setDatabase).not.toHaveBeenCalled()
        expect(part('studio-lore-test-stale')).toBeNull()

        Object.assign(db.db.characters[0].globalLore[0], { content: 'edited' })
        flushSync()
        expect(part('studio-lore-test-stale')?.textContent).toBe('studioLoreTestStale')
        expect(writes.markCharacterForSave).not.toHaveBeenCalled()
    })
})
