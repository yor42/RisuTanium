// @vitest-environment jsdom
/**
 * The problems line, the row marker and Try it of the regex pane over the real history service on the memory doubles and the
 * real English `language`. MOCKED: the page store (DBState is a `$state` object, so the pane re-renders from live writes),
 * the save-mark counter and the alert layer. Entries are built like the classic add shape and the shape `RegexData` writes;
 * every write is made by the pane itself.
 */
import { flushSync } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/globalApi.svelte', () => ({ getSaveMarkCount: () => 0, saveAsset: vi.fn() }))
vi.mock('src/ts/alert', () => ({ alertMd: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const state = $state({ db: { characters: [], modules: [] } as unknown })
    return {
        DBState: state,
        selIdState: { selId: 0 },
        MobileGUI: writable(false),
        settingsOpen: writable(false),
        ReloadGUIPointer: writable(0),
        selectedCharID: writable(0),
    }
})

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import { createOwnerHistoryService, type OwnerHistoryService } from '../../ts/studio/history/ownerHistory.svelte'
import { characterOwnerKey, moduleOwnerKey } from '../../ts/studio/history/ownerPhase'
import { setStudioHistoryServiceForTests } from '../../ts/studio/history/studioHistoryService.svelte'
import { createFakeClock } from '../../ts/studio/history/tests/historyTestKit.test-helpers'
import { createClaimDouble, createMemoryStudioStore } from '../../ts/studio/history/tests/studioStoreDoubles'
import { makeCharacter } from '../../ts/studio/history/tests/objService.test-helpers'
import { studioScreen } from '../../ts/studio/studioScreen.svelte'
import { changeTo, click, mountInto, part, parts, settle, setupRig, teardownRig } from './StudioLorePane.rig.test-helpers'
import StudioRegexPane from './StudioRegexPane.svelte'

type Entry = Record<string, unknown>

const A = characterOwnerKey('A')
const M1 = moduleOwnerKey('M1')
const HOSTS = ['character', 'module'] as const

const entry = (find: string, extra: Entry = {}): Entry => ({ comment: 'e', in: find, out: 'b', type: 'editinput', ...extra })

let service: OwnerHistoryService

async function start(host: 'character' | 'module', list: unknown): Promise<void> {
    DBState.db = (host === 'character'
        ? { characters: [makeCharacter({ customscript: list } as never)], modules: [] }
        : { characters: [makeCharacter()], modules: [{ id: 'M1', name: 'M1', assets: [], regex: list }] }) as unknown as typeof DBState.db
    service = createOwnerHistoryService({
        store: createMemoryStudioStore({}),
        claim: createClaimDouble(),
        clock: createFakeClock(),
        pageSession: 'p1',
        getVisitId: () => 'v1',
        registerLeaveFlush: () => () => {},
        openModuleId: () => 'M1',
    })
    service.setModuleAck('M1', { noteEdit: () => {} })
    setStudioHistoryServiceForTests(service)
    await service.whenReady(A)
    await service.whenReady(M1)
}

async function mountRegex(host: 'character' | 'module'): Promise<void> {
    const props: Record<string, unknown> = host === 'character'
        ? { ownerType: 'character', ownerId: 'A', chaId: 'A', moduleId: null, moduleSlotIndex: null }
        : { ownerType: 'module', ownerId: 'M1', chaId: 'A', moduleId: 'M1', moduleSlotIndex: 0 }
    Object.defineProperty(props, 'itemId', { enumerable: true, get: () => studioScreen.selectedItemId })
    studioScreen.selectedOwnerKey = host === 'character' ? 'character:A' : 'module:M1'
    studioScreen.selectedKind = 'regex'
    mountInto(StudioRegexPane, props)
    await settle()
}

const liveList = (host: 'character' | 'module'): Entry[] => host === 'character'
    ? (DBState.db.characters as unknown as { customscript: Entry[] }[])[0].customscript
    : (DBState.db.modules as unknown as { regex: Entry[] }[])[0].regex
const doneOf = (host: 'character' | 'module') => service.view(host === 'character' ? A : M1).done

async function openRow(index: number): Promise<void> {
    await click(document.querySelector<HTMLElement>(`[data-part="studio-regex-row"][data-index="${index}"]`))
}

const area = (name: string): HTMLTextAreaElement => {
    const found = part(name)
    if (!(found instanceof HTMLTextAreaElement)) throw new Error(`no textarea ${name}`)
    return found
}

function typeFind(value: string): void {
    const find = area('studio-regex-find')
    find.value = value
    find.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }))
    flushSync()
}

// The problems line runs 250 ms after the last change.
async function afterPause(): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, 320))
    await settle()
}

function messageOf(pattern: string): string {
    try {
        new RegExp(pattern, 'g')
    } catch (error) {
        return (error as Error).message
    }
    throw new Error('pattern compiles')
}

beforeEach(() => {
    setupRig()
})
afterEach(async () => {
    await teardownRig()
})

describe('T21U: the problems line and the row marker', () => {
    test.each(HOSTS)('a broken Find shows the engine message after the pause and the text is still written (%s)', async (host) => {
        await start(host, [entry('a')])
        await mountRegex(host)
        await openRow(0)
        expect(part('studio-regex-problems')?.getAttribute('aria-live')).toBe('polite')
        expect(part('studio-regex-problem-invalid')).toBeNull()

        typeFind('(')
        await settle()
        expect(part('studio-regex-problem-invalid')).toBeNull()
        await afterPause()
        expect(liveList(host)[0].in).toBe('(')
        expect(doneOf(host)).toHaveLength(1)
        expect(part('studio-regex-problem-invalid')?.textContent).toBe(language.studioRegexInvalid(messageOf('(')))

        typeFind('(a)')
        await afterPause()
        expect(liveList(host)[0].in).toBe('(a)')
        expect(part('studio-regex-problem-invalid')).toBeNull()
    })

    test('a move flag with u shows no problem', async () => {
        await start('character', [entry('a', { flag: '<move_bottom>u', ableFlag: true })])
        await mountRegex('character')
        await openRow(0)
        await afterPause()
        expect(part('studio-regex-problem-invalid')).toBeNull()
        expect(part('studio-regex-note-empty')).toBeNull()
        expect(part('studio-regex-note-cbs')).toBeNull()
    })

    test('an invalid flag combination shows its message', async () => {
        await start('character', [entry('a', { flag: 'uv', ableFlag: true })])
        await mountRegex('character')
        await openRow(0)
        await afterPause()
        expect(part('studio-regex-problem-invalid')).not.toBeNull()
    })

    test('an empty Find and a cbs entry show their notes, never an error', async () => {
        await start('character', [entry(''), entry('{{char}}', { flag: '<cbs>u', ableFlag: true })])
        await mountRegex('character')
        await openRow(0)
        expect(part('studio-regex-note-empty')?.textContent).toBe(language.studioRegexEmptyFind)
        expect(part('studio-regex-problem-invalid')).toBeNull()
    })

    test('a cbs entry shows the not-checked note', async () => {
        await start('character', [entry('{{char}}', { flag: '<cbs>u', ableFlag: true })])
        await mountRegex('character')
        await openRow(0)
        expect(part('studio-regex-note-cbs')?.textContent).toBe(language.studioRegexNotCheckedCbs)
        expect(part('studio-regex-problem-invalid')).toBeNull()
    })

    test('the list marks a row whose pattern does not compile, with the message in its title', async () => {
        await start('character', [entry('a'), entry('(')])
        await mountRegex('character')
        const chips = parts('studio-regex-invalid-chip')
        expect(chips).toHaveLength(1)
        expect(chips[0].textContent).toBe(language.studioRegexInvalidMarker)
        expect(chips[0].getAttribute('title')).toBe(language.studioRegexInvalid(messageOf('(')))
        expect(chips[0].closest('[data-part="studio-regex-row"]')?.getAttribute('data-index')).toBe('1')

        liveList('character')[0].in = '['
        flushSync()
        await settle()
        expect(parts('studio-regex-invalid-chip')).toHaveLength(2)
        liveList('character')[0].in = 'a'
        flushSync()
        await settle()
        expect(parts('studio-regex-invalid-chip')).toHaveLength(1)
    })
})

describe('T22U: Try it', () => {
    async function openTry(host: 'character' | 'module', list: Entry[], sample: string): Promise<void> {
        await start(host, list)
        await mountRegex(host)
        await openRow(0)
        await click(part('studio-regex-try-toggle'))
        const box = area('studio-regex-try-sample')
        box.value = sample
        box.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
    }

    test.each(HOSTS)('the toggle is collapsed; Run shows the count, spans, result and the scope lines and writes nothing (%s)', async (host) => {
        await start(host, [entry('a')])
        await mountRegex(host)
        await openRow(0)
        const toggle = part('studio-regex-try-toggle')
        expect(toggle?.getAttribute('aria-expanded')).toBe('false')
        expect(part('studio-regex-try-sample')).toBeNull()
        await click(toggle)
        expect(toggle?.getAttribute('aria-expanded')).toBe('true')

        const before = JSON.stringify(DBState.db)
        const box = area('studio-regex-try-sample')
        box.value = 'aa'
        box.dispatchEvent(new Event('input', { bubbles: true }))
        flushSync()
        await click(part('studio-regex-try-run'))
        expect(part('studio-regex-try-count')?.textContent).toBe(language.studioRegexTryMatches(2))
        expect(parts('studio-regex-try-span').map((span) => span.textContent)).toEqual(['0: a', '1: a'])
        expect(part('studio-regex-try-text')?.textContent).toBe('bb')
        expect(part('studio-regex-try-one')?.textContent).toBe(language.studioRegexTryOneEntry)
        expect(part('studio-regex-try-cbs')?.textContent).toBe(language.studioRegexTryCbsNotRun)
        expect(doneOf(host)).toHaveLength(0)
        expect(JSON.stringify(DBState.db)).toBe(before)
    })

    test('a sample without a match says so', async () => {
        await openTry('character', [entry('a')], 'xyz')
        await click(part('studio-regex-try-run'))
        expect(part('studio-regex-try-count')?.textContent).toBe(language.studioRegexTryNoMatch)
        expect(part('studio-regex-try-text')?.textContent).toBe('xyz')
    })

    test('a directive shows its matches and the not-run line, no result text', async () => {
        await openTry('character', [entry('a', { flag: '<move_bottom>u', ableFlag: true })], 'aa')
        await click(part('studio-regex-try-run'))
        expect(part('studio-regex-try-directive')?.textContent).toBe(language.studioRegexTryDirectiveNotRun)
        expect(part('studio-regex-try-text')).toBeNull()
        expect(parts('studio-regex-try-span').length).toBeGreaterThan(0)
    })

    test('a translation-stage entry says it runs like the translation step', async () => {
        await openTry('character', [entry('a', { type: 'edittrans' })], 'aa')
        await click(part('studio-regex-try-run'))
        expect(part('studio-regex-try-engine')?.textContent).toBe(language.studioRegexTryTranslationEngine)
        expect(part('studio-regex-try-cbs')).toBeNull()
        expect(part('studio-regex-try-text')?.textContent).toBe('bb')
    })

    test('a stage that never runs shows only the never-runs line, with no sample and no Run', async () => {
        await start('character', [entry('a', { type: 'disabled' })])
        await mountRegex('character')
        await openRow(0)
        await click(part('studio-regex-try-toggle'))
        expect(part('studio-regex-try-never')?.textContent).toBe(language.studioRegexTryStageNeverRuns)
        expect(part('studio-regex-try-sample')).toBeNull()
        expect(part('studio-regex-try-run')).toBeNull()
    })

    test('a cbs entry is not run and says so', async () => {
        await openTry('character', [entry('{{char}}', { flag: '<cbs>u', ableFlag: true })], 'aa')
        await click(part('studio-regex-try-run'))
        expect(part('studio-regex-try-note')?.textContent).toBe(language.studioRegexNotCheckedCbs)
        expect(part('studio-regex-try-count')).toBeNull()
    })

    test('the result is cleared when the entry changes', async () => {
        await openTry('character', [entry('a')], 'aa')
        await click(part('studio-regex-try-run'))
        expect(part('studio-regex-try-count')).not.toBeNull()
        changeTo(document.querySelector<HTMLSelectElement>('[data-part="studio-regex-stage"]') as HTMLSelectElement, 'editoutput')
        await settle()
        expect(part('studio-regex-try-count')).toBeNull()
        expect(area('studio-regex-try-sample').value).toBe('aa')
    })
})
