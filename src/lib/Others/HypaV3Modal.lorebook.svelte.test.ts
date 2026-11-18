// @vitest-environment happy-dom

/**
 * The HypaV3 modal's More dropdown moves summaries to this chat's lorebook and back. All tests mount the
 * REAL modal with its real header and summary items over a `$state` database, and click the real buttons.
 * They are acceptance tests of a new control: on a base without it they fail on a real assertion (the button
 * is absent), and the labels are compared as literal English text so that an undefined `language` key cannot
 * make them pass vacuously. (G) marks a guard that may pass before and after.
 *
 * MOCKED: the alert module, the summarizer, the translator, the script engine, the save marks,
 * `stores.svelte` and `alertBack`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertNormal: vi.fn(),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' || typeof k === 'symbol' ? undefined : vi.fn(async () => {})),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(true),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(0),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    summarize: vi.fn(async () => ''),
    getCurrentHypaV3Preset: vi.fn(() => ({ settings: { processRegexScript: false } })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScriptFull: vi.fn(),
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import { alertConfirm } from 'src/ts/alert'
import { summarize } from 'src/ts/process/memory/hypav3'
import { markCharacterForSave } from 'src/ts/storage/characterSaveMarks'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import HypaV3Modal from './HypaV3Modal.svelte'

const EXPORT_LABEL = "Export summaries to this chat's lorebook"
const IMPORT_LABEL = "Import this chat's lorebook entries as summaries"

const mounted: Array<ReturnType<typeof mount>> = []

type Summary = { text: string; chatMemos: string[]; isImportant: boolean; categoryId?: string; tags?: string[] }
type LoreEntry = {
    key: string; secondkey: string; insertorder: number; comment: string; content: string
    mode: 'normal' | 'folder' | 'child'; alwaysActive: boolean; selective: boolean
}

function installDb(summaries: Summary[], localLore: LoreEntry[] = []): void {
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '',
            chats: [{
                id: 'chat', name: '', message: [], note: '', localLore,
                hypaV3Data: {
                    summaries,
                    categories: [{ id: '', name: 'none' }, { id: 'cat_1', name: 'Places' }],
                    lastSelectedSummaries: [],
                },
            }],
        }],
    } as unknown as Database
    selectedCharID.set(0)
}

function loreEntry(content: string, key = ''): LoreEntry {
    return { key, secondkey: '', insertorder: 100, comment: '', content, mode: 'normal', alwaysActive: false, selective: false }
}

function mountModal(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(HypaV3Modal, { target, props: {} }))
    flushSync()
    return target
}

async function settle(): Promise<void> {
    await vi.advanceTimersByTimeAsync(20)
    flushSync()
}

function openMore(target: HTMLElement): void {
    ;(target.querySelector('div.relative > button') as HTMLButtonElement).click()
    flushSync()
}

function byLabel(target: HTMLElement, label: string): HTMLButtonElement | null {
    return target.querySelector(`button[aria-label="${label}"]`)
}

function chat() {
    return DBState.db.characters[0].chats[0]
}

beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    resetBackHandlersForTests()
    vi.mocked(alertConfirm).mockReset().mockResolvedValue(true)
    vi.mocked(markCharacterForSave).mockReset()
    vi.mocked(summarize).mockClear()
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
    resetBackHandlersForTests()
    vi.useRealTimers()
})

describe('HypaV3 modal lorebook transfer', () => {
    test('H1 the More dropdown shows both buttons with their accessible names, and only once it is open', async () => {
        installDb([{ text: 'first', chatMemos: ['m'], isImportant: false }])
        const target = mountModal()
        await settle()
        expect(byLabel(target, EXPORT_LABEL)).toBeNull()
        openMore(target)
        const exportButton = byLabel(target, EXPORT_LABEL)
        const importButton = byLabel(target, IMPORT_LABEL)
        expect(exportButton).not.toBeNull()
        expect(importButton).not.toBeNull()
        expect(exportButton!.title).toBe(EXPORT_LABEL)
        expect(importButton!.title).toBe(IMPORT_LABEL)
    })

    test('H2 export adds the summary to this chat\'s lorebook with its tags and category as the key, and marks the character', async () => {
        installDb([{ text: 'The harbor.', chatMemos: ['m'], isImportant: false, categoryId: 'cat_1', tags: ['harbor'] }])
        const target = mountModal()
        await settle()
        openMore(target)
        byLabel(target, EXPORT_LABEL)!.click()
        await settle()
        expect(chat().localLore).toHaveLength(1)
        expect(chat().localLore[0]).toMatchObject({ key: 'harbor, Places', content: 'The harbor.', alwaysActive: false, mode: 'normal' })
        expect(markCharacterForSave).toHaveBeenCalledWith('c0')
        expect(chat().hypaV3Data!.summaries).toHaveLength(1)
    })

    test('H3 import adds the lorebook entry before the existing summary and shows it in the modal', async () => {
        installDb([{ text: 'first', chatMemos: ['m'], isImportant: false }], [loreEntry('Imported text', 'a, b')])
        const target = mountModal()
        await settle()
        openMore(target)
        byLabel(target, IMPORT_LABEL)!.click()
        await settle()
        const summaries = chat().hypaV3Data!.summaries
        expect(summaries.map((s) => s.text)).toEqual(['Imported text', 'first'])
        expect(summaries[0]).toMatchObject({ chatMemos: [], isImportant: false, tags: ['a', 'b'] })
        expect(markCharacterForSave).toHaveBeenCalledWith('c0')
        // The modal re-renders with the new summary first (its tags show) and the old one renumbered.
        expect(target.textContent).toContain('Summary #2')
        expect(target.textContent).toContain('#a#b')
    })

    test('H4 an import clears the bulk selection, which is index-based', async () => {
        installDb([{ text: 'first', chatMemos: ['m'], isImportant: false }], [loreEntry('Imported text')])
        const target = mountModal()
        await settle()
        const bar = target.querySelector('h1')!.nextElementSibling as HTMLElement
        ;(bar.querySelectorAll(':scope > button')[2] as HTMLButtonElement).click()
        flushSync()
        const checkbox = target.querySelector('input[type="checkbox"]') as HTMLInputElement
        checkbox.click()
        flushSync()
        expect(target.querySelectorAll('.ring-blue-500')).toHaveLength(1)
        openMore(target)
        byLabel(target, IMPORT_LABEL)!.click()
        await settle()
        expect(chat().hypaV3Data!.summaries).toHaveLength(2)
        expect(target.querySelectorAll('.ring-blue-500')).toHaveLength(0)
    })

    test('H5 a cancelled import keeps the bulk selection', async () => {
        installDb([{ text: 'first', chatMemos: ['m'], isImportant: false }], [loreEntry('Imported text')])
        vi.mocked(alertConfirm).mockResolvedValue(false)
        const target = mountModal()
        await settle()
        const bar = target.querySelector('h1')!.nextElementSibling as HTMLElement
        ;(bar.querySelectorAll(':scope > button')[2] as HTMLButtonElement).click()
        flushSync()
        ;(target.querySelector('input[type="checkbox"]') as HTMLInputElement).click()
        flushSync()
        openMore(target)
        byLabel(target, IMPORT_LABEL)!.click()
        await settle()
        expect(chat().hypaV3Data!.summaries).toHaveLength(1)
        expect(target.querySelectorAll('.ring-blue-500')).toHaveLength(1)
    })

    test('P2 reroll on a summary with no connected messages sends no summarization request', async () => {
        installDb([{ text: 'imported', chatMemos: [], isImportant: false }])
        const target = mountModal()
        await settle()
        const button = target.querySelector('svg.lucide-refresh-cw')!.closest('button') as HTMLButtonElement
        expect(button.disabled).toBe(false)
        button.click()
        await settle()
        expect(summarize).not.toHaveBeenCalled()
    })

    test('P2g (G) reroll on a summary with connected messages still sends a request', async () => {
        installDb([{ text: 'first', chatMemos: ['m'], isImportant: false }])
        DBState.db.characters[0].chats[0].message = [{ role: 'user', data: 'hello', chatId: 'm', time: 0 }]
        const target = mountModal()
        await settle()
        ;(target.querySelector('svg.lucide-refresh-cw')!.closest('button') as HTMLButtonElement).click()
        await settle()
        expect(summarize).toHaveBeenCalledTimes(1)
    })
})
