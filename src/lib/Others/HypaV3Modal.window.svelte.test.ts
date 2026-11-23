// @vitest-environment jsdom

/**
 * `HypaV3Modal.svelte` with a long summary list: only the summary cards near the dialog's view are
 * in the page, and a search hit on a far summary mounts that card. Mounts the REAL modal over a real
 * `$state` database with the window host's test geometry (a 600 px band). "regression reproducer:"
 * titles fail against the modal that mounted every card.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: vi.fn(async () => true),
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => {
            if (k in t) return t[k as string]
            if (k === 'then' || typeof k === 'symbol') return undefined
            return vi.fn(async () => {})
        },
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        selectedCharID: writable(0),
        hypaV3ModalOpen: writable(false),
        settingsOpen: writable(false),
        SettingsMenuIndex: writable(0),
        selIdState: { selId: -1 },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/process/memory/hypav3'), () => ({
    summarize: vi.fn(async () => 'REROLLED'),
    getCurrentHypaV3Preset: vi.fn(() => ({ settings: { processRegexScript: false } })),
}) as unknown as typeof import('src/ts/process/memory/hypav3'))

vi.mock(import('src/ts/translator/translator'), () => ({
    translateHTML: vi.fn(async (text: string) => text),
}) as unknown as typeof import('src/ts/translator/translator'))

vi.mock(import('src/ts/process/scripts'), () => ({
    processScriptFull: vi.fn(),
    risuChatParser: vi.fn((text: string) => text),
}) as unknown as typeof import('src/ts/process/scripts'))

vi.mock(import('src/ts/process/moduleRefList'), () => ({
    hasModuleStubs: vi.fn(() => false),
}) as unknown as typeof import('src/ts/process/moduleRefList'))

vi.mock(import('src/ts/process/moduleEnsure'), () => ({
    ensureCurrentModulesOrAlert: vi.fn(async (): Promise<boolean> => true),
}) as unknown as typeof import('src/ts/process/moduleEnsure'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

//#endregion

import { DBState } from 'src/ts/stores.svelte'
import { setWindowGeometryForTests } from 'src/ts/windowing/windowHost.svelte'
import { enterKeydown, imeEventSequence } from 'src/ts/ime/tests/imeEventSequence'
import HypaV3Modal from './HypaV3Modal.svelte'

const COUNT = 300
let frames: (() => void)[] = []
function runFrames(): void {
    const pending = frames
    frames = []
    for (const frame of pending) frame()
    flushSync()
}

function installDb(count: number): void {
    const texts = Array.from({ length: count }, (_, i) => 'sum' + i)
    DBState.db = {
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: 'hello', chats: [{
                id: 'chat-a', name: '', note: '', localLore: [], message: [],
                hypaV3Data: {
                    summaries: texts.map((text) => ({ text, chatMemos: [] })),
                    categories: [{ id: '', name: 'none' }],
                    lastSelectedSummaries: [],
                },
            }],
        }],
    } as unknown as Database
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountModal(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(HypaV3Modal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    await Promise.resolve()
    flushSync()
    runFrames()
    return target
}

beforeEach(() => {
    frames = []
    Element.prototype.scrollIntoView = () => {}
    setWindowGeometryForTests({
        rectOf: () => ({ top: 0, height: 600 }),
        viewport: () => 600,
        scrollBy: () => {},
        schedule: (callback) => {
            frames.push(callback)
            return () => { frames = frames.filter((frame) => frame !== callback) }
        },
    })
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    setWindowGeometryForTests(undefined)
    document.body.innerHTML = ''
})

describe('the windowed summary list', () => {
    test('regression reproducer: 300 summaries mount only the cards near the view', async () => {
        installDb(COUNT)
        const target = await mountModal()
        const cards = target.querySelectorAll('[data-window-key]').length
        expect(cards).toBeGreaterThan(0)
        expect(cards).toBeLessThan(60)
    })

    test('regression reproducer: a search hit on a far summary mounts that card', async () => {
        installDb(COUNT)
        const scrolled: Element[] = []
        Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this) }
        const target = await mountModal()
        expect(Array.from(target.querySelectorAll('textarea')).some((t) => t.value === 'sum250')).toBe(false)
        const bar = target.querySelector('h1')!.nextElementSibling as HTMLElement
        ;(bar.querySelector(':scope > button') as HTMLButtonElement).click()
        await new Promise((resolve) => setTimeout(resolve, 20))
        flushSync()
        const field = target.querySelector<HTMLInputElement>('form input')!
        imeEventSequence(field, 'sum250')
        flushSync()
        enterKeydown(field)
        await new Promise((resolve) => setTimeout(resolve, 50))
        flushSync()
        const card = Array.from(target.querySelectorAll('textarea')).find((t) => t.value === 'sum250')
        expect(card).toBeDefined()
        expect(scrolled).toContain(card)
        // The jump's focus timer must not fire into the unmounted modal.
        await new Promise((resolve) => setTimeout(resolve, 350))
    })

    test('guard: a short list mounts every card', async () => {
        installDb(3)
        const target = await mountModal()
        expect(target.querySelectorAll('[data-window-key]').length).toBe(3)
    })
})
