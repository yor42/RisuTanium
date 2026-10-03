// @vitest-environment happy-dom

/**
 * Two behaviours of the REAL `HypaV3Modal.svelte` with its real summary items, over a real
 * `$state` database:
 *
 *  - the Apply button of a single summary's re-roll writes the re-roll result to the summary
 *    only when a successful result is on screen: never while the re-roll is still running,
 *    never after a failed re-roll, and what is written is the (possibly edited) text of the
 *    re-roll textarea;
 *  - the HypaV2 to V3 conversion button reports each failure in the active language and
 *    converts a well-formed HypaV2 history.
 *
 * The summarizer, the translator and the script engine are stubs; every alert call is
 * recorded. Titles beginning "guard:" pin behaviour that must be preserved before and after
 * the change; every other test is a regression reproducer for the behaviour it names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { changeLanguage, language } from 'src/lang'
import { fillLang } from 'src/lang/fill'

//#region module mocks

const noticeMessages = vi.hoisted(() => [] as Array<{ name: string, message: unknown }>)

const summarizer = vi.hoisted(() => {
    const pending: Array<(text: string) => void> = []
    const rejecters: Array<(error: Error) => void> = []
    return {
        pending,
        rejecters,
        run: () => new Promise<string>((resolve, reject) => { pending.push(resolve); rejecters.push(reject) }),
    }
})

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: async () => true,
        alertStore: writable({ type: 'none', msg: '' }),
    }
    const recorded: Record<string, unknown> = {}
    return new Proxy(stub, {
        get: (t, k) => {
            if (k in t) return t[k as string]
            if (k === 'then' || typeof k === 'symbol') return undefined
            return (recorded[k] ??= vi.fn(async (message?: unknown) => { noticeMessages.push({ name: k, message }) }))
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
    summarize: vi.fn(() => summarizer.run()),
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

//#endregion

import { DBState, selectedCharID } from 'src/ts/stores.svelte'
import HypaV3Modal from './HypaV3Modal.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountModal(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(HypaV3Modal, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

beforeEach(() => {
    noticeMessages.length = 0
    summarizer.pending.length = 0
    summarizer.rejecters.length = 0
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
    changeLanguage('en')
})

//#endregion

describe('applying a single summary re-roll', () => {
    function installRerollDb(): void {
        DBState.db = {
            characters: [{
                chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '',
                chats: [{
                    id: 'chat-0', name: '', note: '', localLore: [],
                    message: [{ chatId: 'memo-s0', role: 'char', data: 'a message to summarize' }],
                    hypaV3Data: {
                        summaries: [{ text: 'original', chatMemos: ['memo-s0'], isImportant: false }],
                        categories: [{ id: '', name: 'none' }],
                        lastSelectedSummaries: [],
                    },
                }],
            }],
        } as unknown as Database
        selectedCharID.set(0)
    }

    const summaryText = () => DBState.db.characters[0].chats[0].hypaV3Data.summaries[0].text

    const originalArea = (target: HTMLElement) =>
        (Array.from(target.querySelectorAll('textarea')) as HTMLTextAreaElement[]).find((t) => !t.readOnly)!

    /** The card's header buttons are, in order: translate, important, reroll, delete this, delete after. */
    function rerollButton(target: HTMLElement): HTMLButtonElement {
        const card = originalArea(target).closest('div.flex.flex-col.p-2') as HTMLElement
        const header = card.firstElementChild as HTMLElement
        return (header.lastElementChild as HTMLElement).querySelectorAll('button')[2] as HTMLButtonElement
    }

    /** The re-roll result textarea: the second editable textarea of the card. */
    function rerolledArea(target: HTMLElement): HTMLTextAreaElement {
        const card = originalArea(target).closest('div.flex.flex-col.p-2') as HTMLElement
        const areas = (Array.from(card.querySelectorAll('textarea')) as HTMLTextAreaElement[]).filter((t) => !t.readOnly)
        if (areas.length < 2) throw new Error('the re-roll result is not shown')
        return areas[1]
    }

    /** The re-roll result's header holds translate, cancel and apply, in that order. */
    function applyButton(target: HTMLElement): HTMLButtonElement {
        const header = rerolledArea(target).parentElement!.previousElementSibling as HTMLElement
        const buttons = header.querySelectorAll('button')
        return buttons[buttons.length - 1] as HTMLButtonElement
    }

    async function startReroll(target: HTMLElement): Promise<void> {
        rerollButton(target).click()
        await settle()
    }

    async function finishReroll(text: string): Promise<void> {
        summarizer.rejecters.shift()
        const resolve = summarizer.pending.shift()
        if (!resolve) throw new Error('the summarizer is not running')
        resolve(text)
        await settle()
    }

    async function failReroll(): Promise<void> {
        summarizer.pending.shift()
        const reject = summarizer.rejecters.shift()
        if (!reject) throw new Error('the summarizer is not running')
        reject(new Error('summarizer failed'))
        await settle()
    }

    async function clickApply(target: HTMLElement): Promise<void> {
        applyButton(target).click()
        await settle()
    }

    test('regression reproducer: Apply while the re-roll is still running leaves the summary text unchanged', async () => {
        installRerollDb()
        const target = mountModal()
        await startReroll(target)
        expect(summarizer.pending.length).toBe(1)
        expect(rerolledArea(target).value).toBe(language.loadingEllipsis)

        await clickApply(target)

        expect(summaryText()).toBe('original')
        expect(applyButton(target).disabled).toBe(true)
    })

    test('regression reproducer: Apply after a failed re-roll leaves the summary text unchanged', async () => {
        installRerollDb()
        const target = mountModal()
        await startReroll(target)
        await failReroll()
        expect(rerolledArea(target).value).toBe(language.hypaV3Modal.rerollFailed)

        await clickApply(target)

        expect(summaryText()).toBe('original')
        expect(applyButton(target).disabled).toBe(true)
    })

    test('guard: Apply after a successful re-roll writes the re-roll result to the summary', async () => {
        installRerollDb()
        const target = mountModal()
        await startReroll(target)
        await finishReroll('rerolled text')
        expect(rerolledArea(target).value).toBe('rerolled text')

        expect(applyButton(target).disabled).toBe(false)
        await clickApply(target)

        expect(summaryText()).toBe('rerolled text')
    })

    test('guard: a successful re-roll after a failed one can be applied', async () => {
        installRerollDb()
        const target = mountModal()
        await startReroll(target)
        await failReroll()
        await startReroll(target)
        await finishReroll('second attempt')

        expect(applyButton(target).disabled).toBe(false)
        await clickApply(target)

        expect(summaryText()).toBe('second attempt')
    })

    test('guard: an edit of the re-roll textarea after success is what Apply writes', async () => {
        installRerollDb()
        const target = mountModal()
        await startReroll(target)
        await finishReroll('rerolled text')

        const area = rerolledArea(target)
        area.value = 'edited by the user'
        area.dispatchEvent(new Event('input', { bubbles: true }))
        await settle()
        expect(applyButton(target).disabled).toBe(false)
        await clickApply(target)

        expect(summaryText()).toBe('edited by the user')
    })
})

describe('HypaV2 to V3 conversion', () => {
    function installConvertDb(hypaV2Data: unknown): void {
        DBState.db = {
            characters: [{
                chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '',
                chats: [{
                    id: 'chat-0', name: '', message: [], note: '', localLore: [],
                    hypaV3Data: { summaries: [], categories: [{ id: '', name: 'none' }], lastSelectedSummaries: [] },
                    hypaV2Data,
                }],
            }],
        } as unknown as Database
        selectedCharID.set(0)
    }

    const convertedTexts = () => DBState.db.characters[0].chats[0].hypaV3Data.summaries.map((s) => s.text)

    async function clickConvert(target: HTMLElement): Promise<void> {
        const button = (Array.from(target.querySelectorAll('button')) as HTMLButtonElement[])
            .find((b) => b.textContent?.trim() === language.hypaV3Modal.convertButton.trim())
        if (!button) throw new Error('the convert button is not shown')
        button.click()
        await settle()
    }

    const lastNotice = () => noticeMessages.filter((n) => n.name === 'alertNormalWait').at(-1)?.message

    test('guard: a HypaV2 history without main chunks reports the localized no-chunks failure', async () => {
        installConvertDb({ mainChunks: [] })
        await clickConvert(mountModal())
        expect(lastNotice()).toBe(
            language.hypaV3Modal.convertErrorMessage.replace('{0}', language.hypaV3Modal.convertErrorNoMainChunks))
        expect(lastNotice()).toBe('Failed to convert HypaV2 data to V3: No main chunks found.')
        expect(convertedTexts()).toEqual([])
    })

    test('guard: a chunk whose chatMemos is not an array reports its index', async () => {
        installConvertDb({ mainChunks: [{ text: 'a', chatMemos: ['m'] }, { text: 'b', chatMemos: 'not an array' }] })
        await clickConvert(mountModal())
        expect(lastNotice()).toBe(
            language.hypaV3Modal.convertErrorMessage.replace(
                '{0}', fillLang(language.hypaV3Modal.convertErrorChunkNotArray, { index: 1 })))
        expect(lastNotice()).toBe("Failed to convert HypaV2 data to V3: Chunk 1's chatMemos is not an array.")
        expect(convertedTexts()).toEqual([])
    })

    test('guard: a chunk whose chatMemos is empty reports its index', async () => {
        installConvertDb({ mainChunks: [{ text: 'a', chatMemos: [] }] })
        await clickConvert(mountModal())
        expect(lastNotice()).toBe(
            language.hypaV3Modal.convertErrorMessage.replace(
                '{0}', fillLang(language.hypaV3Modal.convertErrorChunkEmpty, { index: 0 })))
        expect(lastNotice()).toBe("Failed to convert HypaV2 data to V3: Chunk 0's chatMemos is empty.")
        expect(convertedTexts()).toEqual([])
    })

    test('guard: a HypaV2 history that cannot be read reports the unexpected-error template', async () => {
        installConvertDb({})
        await clickConvert(mountModal())
        const prefix = language.hypaV3Modal.convertErrorMessage.replace(
            '{0}', language.hypaV3Modal.convertErrorUnexpected.split('{message}')[0])
        const shown = String(lastNotice())
        expect(shown.startsWith(prefix)).toBe(true)
        expect(shown.length).toBeGreaterThan(prefix.length)
        expect(shown.startsWith('Failed to convert HypaV2 data to V3: Error occurred: ')).toBe(true)
        expect(convertedTexts()).toEqual([])
    })

    test('guard: a well-formed HypaV2 history converts and reports success', async () => {
        installConvertDb({ mainChunks: [{ text: 'first', chatMemos: ['m1'] }, { text: 'second', chatMemos: ['m2', 'm3'] }] })
        await clickConvert(mountModal())
        expect(lastNotice()).toBe('Successfully converted HypaV2 data to V3')
        expect(convertedTexts()).toEqual(['first', 'second'])
    })

    test('guard: Korean shows the Korean button and the Korean failure message', async () => {
        changeLanguage('ko')
        installConvertDb({ mainChunks: [{ text: 'a', chatMemos: [] }] })
        const target = mountModal()
        expect(target.textContent).toContain('아직 요약이 없지만, HypaV2 데이터를 V3로 변환할 수 있습니다.')
        await clickConvert(target)
        expect(lastNotice()).toBe('HypaV2 데이터를 V3로 변환하는데 실패했습니다: 청크 0의 chatMemos가 비어 있습니다.')
    })

    test('guard: Korean shows the Korean success message', async () => {
        changeLanguage('ko')
        installConvertDb({ mainChunks: [{ text: 'a', chatMemos: ['m'] }] })
        await clickConvert(mountModal())
        expect(lastNotice()).toBe('HypaV2 데이터를 V3로 성공적으로 변환했습니다')
    })
})
