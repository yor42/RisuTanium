// @vitest-environment jsdom

/**
 * What the chat shows after a merge (T25): a message whose `<img src>` named the removed asset, rewritten by the merge to
 * the kept name, resolves to the kept file in the real `ChatBody` over the real `trimMarkdown` (DOMPurify under jsdom).
 * The text is the merge's own output (`buildMergePreview` and its edits), and the image lookup is exact-only
 * (`assetMaxDifference` 0), so the rewritten name is what resolves: the same message left as it was finds nothing.
 *
 * The sanitized-markup rows fail with an identity `trimMarkdown`: the author's `onerror` survives it, and the assertion
 * that it is gone is the one that kills that mutant (MC-239).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { flushSync, mount, tick, unmount } from 'svelte'
import { clearChatBodyRenderCache } from './chatBodyRenderCache'

interface Held {
    resolve: (value: string) => void
}

const h = vi.hoisted(() => ({
    parses: [] as Held[],
}))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: {} as Record<string, unknown> })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        ReloadChatPointer: writable({} as Record<number, number>),
    }
})

vi.mock('src/ts/parser/parser.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/parser/parser.svelte')>()
    return {
        ...actual,
        ParseMarkdown: vi.fn(() => new Promise<string>((resolve) => { h.parses.push({ resolve }) })),
    }
})

vi.mock('src/ts/translator/translator', () => ({
    getLLMCache: async () => null,
    waitForTranslatorModules: async () => {},
    translateHTML: vi.fn(() => new Promise<string>(() => {})),
}))

vi.mock('src/ts/alert', () => ({
    alertError: vi.fn(),
    alertWait: vi.fn(),
}))

vi.mock('src/ts/storage/database.svelte', async () => {
    const stores = await import('src/ts/stores.svelte')
    type CharShape = { chats?: unknown[], chatPage?: number }
    const db = () => (stores.DBState as unknown as { db: Record<string, unknown> }).db
    const getCurrentCharacter = () => (db().characters as CharShape[] | undefined)?.[0]
    const getCurrentChat = () => {
        const char = getCurrentCharacter()
        return char?.chats?.[char.chatPage ?? 0]
    }
    return { appVer: '1234.5.67', getDatabase: db, getCurrentCharacter, getCurrentChat }
})

vi.mock('src/ts/process/modules', () => ({
    getModuleAssets: () => [],
    getModuleRegexScripts: () => [],
    moduleUpdate: () => {},
}))

vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: async (path: string) => `blob:${path}`,
    setUsingSw: vi.fn(),
    readImage: vi.fn(),
}))

vi.mock('src/ts/process/files/inlays', () => ({ getInlayRender: vi.fn(async () => null) }))

import { DBState } from 'src/ts/stores.svelte'
import { applyEditsTo, assetRow, DEFAULT_SETTINGS, groupRow } from 'src/ts/studio/assets/assetFixtures.test-helpers'
import { groupDuplicates } from 'src/ts/studio/assets/duplicateGroups'
import { buildMergePreview } from 'src/ts/studio/assets/mergePreview'
import ChatBody from './ChatBody.svelte'

const mounted: Array<{ target: HTMLElement, instance: Record<string, unknown> }> = []

// The row of the removed name has gone with the merge; the kept row's file is the one the message must resolve to.
const KEPT = assetRow('smile', 'assets/smile.png')
const REMOVED = assetRow('smile2', 'assets/smile.png')
const MESSAGE = '<p>hi</p><img src="smile2" onerror="alert(1)">'

function setDb(rows: string[][]): void {
    DBState.db = {
        translatorType: 'google',
        translator: 'ko',
        translatorInputLanguage: 'en',
        aiModel: 'gpt',
        autoTranslate: false,
        autoTranslateCachedOnly: false,
        translateBeforeHTMLFormatting: false,
        legacyTranslation: false,
        showTranslationLoading: false,
        newImageHandlingBeta: true,
        hideAllImages: false,
        assetMaxDifference: 0,
        characters: [{
            chaId: 'a', type: 'character', chatPage: 0, modules: [], customscript: [], additionalAssets: rows,
            chats: [{ id: 'cA', modules: [], message: [] }],
        }],
        modules: [],
        enabledModules: [],
        moduleIntergration: '',
        personas: [],
    } as never
}

// What the merge of `smile2` into `smile` writes into the message, from the model the preview builds over the owner as it was.
function mergedMessage(): string {
    const rows = [KEPT, REMOVED]
    const group = groupDuplicates(rows.map((row, index) => groupRow(row[0], row[1], index))).find((candidate) => candidate.cls === 'sameFileDifferentNames')
    if (!group) throw new Error('no candidate group')
    const model = buildMergePreview({ kind: 'character', source: { desc: MESSAGE, additionalAssets: rows } }, 'asset', group, 'smile', [], DEFAULT_SETTINGS)
    return applyEditsTo(MESSAGE, 'desc', model.textEdits)
}

async function showMessage(text: string): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const props = {
        character: 'char', idx: 0, msgDisplay: 'FIRST', role: 'char', translated: false, translating: false, retranslate: false,
        renderRevision: 0, modelShortName: '', bodyRoot: target,
    }
    const instance = mount(ChatBody, { target, props: props as never }) as Record<string, unknown>
    mounted.push({ target, instance })
    flushSync()
    h.parses[0].resolve(text)
    for (let round = 0; round < 3; round++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        flushSync()
        await tick()
    }
    return target
}

beforeEach(() => {
    h.parses.length = 0
    clearChatBodyRenderCache()
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
    for (const row of mounted.splice(0)) {
        await unmount(row.instance).catch(() => {})
        row.target.remove()
    }
    document.body.replaceChildren()
    vi.restoreAllMocks()
})

describe('a chat message after a merge', () => {
    test('the merge rewrote the removed name to the kept one, and nothing else of the message', () => {
        expect(mergedMessage()).toBe('<p>hi</p><img src="smile" onerror="alert(1)">')
    })

    test('its image resolves to the kept file, with the author\'s onerror removed by the sanitizer', async () => {
        setDb([[...KEPT]])
        const target = await showMessage(mergedMessage())
        const img = target.querySelector('img')
        expect(img?.getAttribute('src')).toBe('blob:assets/smile.png')
        expect(img?.hasAttribute('noimage')).toBe(false)
        expect(img?.hasAttribute('onerror')).toBe(false)
        expect(target.innerHTML).not.toContain('onerror')
    })

    test('the same message left as it was finds no picture once the removed row is gone', async () => {
        setDb([[...KEPT]])
        const target = await showMessage(MESSAGE)
        const img = target.querySelector('img')
        expect(img?.getAttribute('noimage')).toBe('true')
        expect(img?.getAttribute('src')).toBe('smile2')
        expect(target.innerHTML).not.toContain('onerror')
    })
})
