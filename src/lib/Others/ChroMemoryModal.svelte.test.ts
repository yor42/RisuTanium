// @vitest-environment happy-dom

/**
 * The ChroMemory modal: the Last send tab shows the trace of this chat only, the Index tab writes
 * the shadow setting and discards the index, and the X and Android Back close it. (R) = regression
 * reproducer (the modal does not exist on the base); (G) = guard.
 *
 * Mounts the REAL modal and both tabs over a `$state` database and the real trace stores.
 * MOCKED: `stores.svelte` (state and the open flag only), the alert module and `alertBack`.
 * `discardChroMemoryIndex` is wrapped in a spy that still runs the real function.
 */
import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import { fillLang } from 'src/lang/fill'

//#region module mocks

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: async () => true,
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
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

vi.mock('src/ts/process/memory/chroMemory/shadow', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/process/memory/chroMemory/shadow')>()
    return { ...actual, discardChroMemoryIndex: vi.fn(actual.discardChroMemoryIndex) }
})

//#endregion

import { DBState, hypaV3ModalOpen, selectedCharID } from 'src/ts/stores.svelte'
import { installBackGuard, resetBackHandlersForTests } from 'src/ts/backHandlers'
import { chroLoreTrace, chroMemoryDiscarded, chroMemoryTrace } from 'src/ts/process/memory/chroMemory/traceStore'
import type { ChroLoreTrace } from 'src/ts/process/memory/chroMemory/loreRecall'
import { discardChroMemoryIndex, type ChroMemoryTrace } from 'src/ts/process/memory/chroMemory/shadow'
import ChroMemoryModal from './ChroMemoryModal.svelte'

const KEY = 'c0:chat'
const showToast = vi.fn()
const mounted: Array<ReturnType<typeof mount>> = []

function installDb(): void {
    DBState.db = {
        ltmEngine: true,
        ltmSettings: { budgetTokens: 900, future: { x: 1 } },
        characters: [{
            chaId: 'c0', name: 'c0', type: 'character', chatPage: 0, firstMessage: '',
            chats: [{
                id: 'chat', name: '', note: '', localLore: [],
                message: [
                    { role: 'user', data: 'zero', chatId: 'm0' },
                    { role: 'char', data: 'one', chatId: 'm1' },
                    { role: 'user', data: `<b>bold</b>   ${'x'.repeat(200)}`, chatId: 'm2' },
                ],
            }],
        }],
    } as unknown as Database
    selectedCharID.set(0)
}

function traceFor(chatKey: string, patch: Partial<ChroMemoryTrace> = {}): ChroMemoryTrace {
    return {
        v: 1, mode: 'inject', chatKey, at: 1, ms: 12.4, outcome: 'injected',
        d0: { records: 30, units: 45, firstChatId: 'm0', lastChatId: 'm29' },
        index: { units: 45, removed: 1, added: 2, churn: 0.25, rebuilt: false, fresh: false, rebuildCause: null },
        rebuildCause: 'fresh',
        query: { chatId: 'm29', terms: ['alpha', 'beta'] },
        admission: 'none', budgetTokens: 900, T: 450, countCap: 12, slots: 3, counted: 3, countCapped: false,
        items: [
            { source: { kind: 'turn', chatId: 'm2', index: 2, off: 0 }, rank: { lexical: 1, dense: null, fused: null }, tokens: 100 },
            { source: { kind: 'turn', chatId: '#first', index: -1, off: 0 }, rank: { lexical: 2, dense: null, fused: null }, tokens: 50 },
        ],
        makeRoom: { room: 600, limit: 5000, reserved: 0, floor: 4, evictedChats: 3, evictedTokens: 321, itemsDropped: 2 },
        timings: { index: 1, rank: 1, pack: 1, room: 1 },
        timeBox: 'none', error: null,
        ...patch,
    }
}

function loreTraceFor(chatKey: string, patch: Partial<ChroLoreTrace> = {}): ChroLoreTrace {
    return {
        v: 1, chatKey, at: 1, ms: 2, mode: 'inject', outcome: 'placed',
        query: { chars: 40, terms: 5 },
        budget: { loreToken: 2000, unused: 1500, cap: 5000, limit: 1500, used: 64 },
        candidates: { missed: 9, staticExcluded: 1, linked: 0, duplicate: 0, identityMiss: 0, eligible: 8 },
        admission: { tau: 0.02, rejected: 3 },
        index: { state: 'ready', entries: 77, buildMs: 3 },
        items: [
            { source: { kind: 'lore', from: 'chat', index: 4, name: 'Wyvern roost' }, rank: { lexical: 1, dense: null, fused: null }, score: 2.5, tokens: 40 },
            { source: { kind: 'lore', from: 'module', index: 9, name: 'Sky citadel' }, rank: { lexical: 2, dense: null, fused: null }, score: 1.5, tokens: 24 },
        ],
        renders: 2, droppedEmpty: 0, trimmed: null,
        ...patch,
    }
}

function mountModal(): { target: HTMLElement, destroy: () => void } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const component = mount(ChroMemoryModal, { target, props: {} })
    mounted.push(component)
    flushSync()
    return {
        target,
        destroy: () => {
            unmount(component)
            mounted.splice(mounted.indexOf(component), 1)
            target.remove()
        },
    }
}

function tab(target: HTMLElement, label: string): HTMLButtonElement {
    return Array.from(target.querySelectorAll<HTMLButtonElement>('[role=tab]')).find((b) => b.textContent?.trim() === label)!
}

beforeEach(() => {
    showToast.mockReset()
    resetBackHandlersForTests()
    installBackGuard({ showToast })
    hypaV3ModalOpen.set(true)
    chroMemoryTrace.set(null)
    chroLoreTrace.set(null)
    chroMemoryDiscarded.set(null)
    vi.mocked(discardChroMemoryIndex).mockClear()
    installDb()
})

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
    resetBackHandlersForTests()
})

describe('Last send tab', () => {
    test('UI4 (R): a trace for this chat renders the tiles, lines and items', () => {
        chroMemoryTrace.set(traceFor(KEY))
        const { target } = mountModal()
        const text = target.textContent ?? ''
        expect(text).toContain(language.chroMemoryOutcomeInjected)
        expect(text).toContain(fillLang(language.chroMemoryTokensOf, { tokens: 450, budget: 900 }))
        expect(text).toContain(fillLang(language.chroMemoryMs, { ms: 12 }))
        expect(text).toContain(fillLang(language.chroMemorySearched, { records: 30, units: 45 }))
        expect(text).toContain('alpha, beta')
        expect(text).toContain(fillLang(language.chroMemoryMadeRoom, { chats: 3, tokens: 321 }))
        expect(text).toContain(fillLang(language.chroMemoryItemsDropped, { count: 2 }))
        expect(text).toContain('#2')
        expect(text).toContain(fillLang(language.chroMemoryItemMeta, { tokens: 100, rank: 1 }))
        expect(text).toContain(language.chroMemoryItemFirst)
        const meter = target.querySelector('[role=meter]')!
        expect(meter.getAttribute('aria-valuenow')).toBe('450')
        expect((meter.firstElementChild as HTMLElement).style.width).toBe('50%')
        expect(text).not.toContain(language.chroMemoryNoSend)
    })

    test('UI4 (R): another chat\'s trace shows only the empty state', () => {
        chroMemoryTrace.set(traceFor('other:chat'))
        const { target } = mountModal()
        expect(target.textContent).toContain(language.chroMemoryNoSend)
        expect(target.textContent).not.toContain(language.chroMemoryOutcomeInjected)
        expect(target.querySelector('[role=meter]')).toBeNull()
    })

    test('UI4 (G): the excerpt is plain text, flattened and cut at 120 characters; a first-message item has none', () => {
        chroMemoryTrace.set(traceFor(KEY))
        const { target } = mountModal()
        expect(target.querySelector('b')).toBeNull()
        const items = Array.from(target.querySelectorAll('li'))
        expect(items).toHaveLength(2)
        const excerpt = items[0].lastElementChild!.textContent!
        expect(excerpt.startsWith('<b>bold</b> xxx')).toBe(true)
        expect(excerpt.endsWith('…')).toBe(true)
        expect(excerpt.length).toBe(121)
        expect(items[1].children).toHaveLength(1)
    })

    test('UI4 (G): an excerpt needs the message at that index to carry the same chatId', () => {
        chroMemoryTrace.set(traceFor(KEY, { items: [
            { source: { kind: 'turn', chatId: 'moved', index: 2, off: 0 }, rank: { lexical: 1, dense: null, fused: null }, tokens: 10 },
        ] }))
        const { target } = mountModal()
        expect(target.querySelector('li')!.children).toHaveLength(1)
    })

    test('UI4 (R): each outcome maps to its own text; an error shows in the error colour', () => {
        const cases: Array<[ChroMemoryTrace['outcome'], string]> = [
            ['packed', language.chroMemoryOutcomePacked],
            ['nothing-packed', language.chroMemoryOutcomeNothing],
            ['empty-d0', language.chroMemoryOutcomeEmpty],
            ['no-query', language.chroMemoryOutcomeNoQuery],
            ['no-room', language.chroMemoryOutcomeNoRoom],
            ['dropped-at-recheck', language.chroMemoryOutcomeRecheck],
        ]
        for (const [outcome, label] of cases) {
            chroMemoryTrace.set(traceFor(KEY, { outcome }))
            const { target, destroy } = mountModal()
            expect(target.textContent, outcome).toContain(label)
            destroy()
        }
        chroMemoryTrace.set(traceFor(KEY, { outcome: 'error', error: 'boom' }))
        const { target } = mountModal()
        const el = Array.from(target.querySelectorAll('div')).find((d) => d.textContent === fillLang(language.chroMemoryOutcomeError, { error: 'boom' }))!
        expect(el.classList.contains('text-draculared')).toBe(true)
    })

    test('UI4 (G): a live trace replaces the empty state without remounting', () => {
        const { target } = mountModal()
        expect(target.textContent).toContain(language.chroMemoryNoSend)
        chroMemoryTrace.set(traceFor(KEY))
        flushSync()
        expect(target.textContent).toContain(language.chroMemoryOutcomeInjected)
    })
})

describe('close', () => {
    test('UI4 (R): the X closes the modal flag and never touches chat data', () => {
        const before = JSON.stringify(DBState.db.characters)
        const { target } = mountModal()
        target.querySelector<HTMLButtonElement>(`button[aria-label="${language.uiCommon.close}"]`)!.click()
        flushSync()
        expect(get(hypaV3ModalOpen)).toBe(false)
        expect(JSON.stringify(DBState.db.characters)).toBe(before)
    })

    test('UI4 (R): Android Back closes the modal, then the root warns', () => {
        mountModal()
        expect(window.__risuTaniumBack?.()).toBe(true)
        flushSync()
        expect(get(hypaV3ModalOpen)).toBe(false)
        expect(showToast).not.toHaveBeenCalled()
    })
})

describe('Index tab', () => {
    test('UI5 (R): the tab shows the index tiles and the build cause', () => {
        chroMemoryTrace.set(traceFor(KEY, { rebuildCause: 'chat-switch' }))
        const { target } = mountModal()
        tab(target, language.chroMemoryTabIndex).click()
        flushSync()
        const text = target.textContent ?? ''
        expect(text).toContain(language.chroMemoryUnits)
        expect(text).toContain('45')
        expect(text).toContain('25%')
        expect(text).toContain(language.chroMemoryTimeBoxOff)
        expect(text).toContain(language.chroMemoryBuildChatSwitch)
    })

    test('UI5 (G): tail-shrink and mid-removal read as changed; no cause reads as none', () => {
        for (const [cause, label] of [['tail-shrink', language.chroMemoryBuildChanged], ['mid-removal', language.chroMemoryBuildChanged], [null, language.chroMemoryBuildNone]] as const) {
            chroMemoryTrace.set(traceFor(KEY, { rebuildCause: cause }))
            const { target, destroy } = mountModal()
            tab(target, language.chroMemoryTabIndex).click()
            flushSync()
            expect(target.textContent, String(cause)).toContain(label)
            destroy()
        }
    })

    test('UI5 (R): the shadow check writes ltmSettings.shadow and keeps every other key; mounting writes nothing', () => {
        const before = JSON.stringify(DBState.db.ltmSettings)
        const { target } = mountModal()
        tab(target, language.chroMemoryTabIndex).click()
        flushSync()
        expect(JSON.stringify(DBState.db.ltmSettings)).toBe(before)
        const check = target.querySelector<HTMLInputElement>('input[type=checkbox]')!
        expect(check.checked).toBe(false)
        check.click()
        flushSync()
        expect(DBState.db.ltmSettings).toEqual({ budgetTokens: 900, future: { x: 1 }, shadow: true })
        check.click()
        flushSync()
        expect(DBState.db.ltmSettings).toEqual({ budgetTokens: 900, future: { x: 1 }, shadow: false })
    })

    test('UI5 (R): Rebuild discards this chat\'s index at once, with no confirm', () => {
        const { target } = mountModal()
        tab(target, language.chroMemoryTabIndex).click()
        flushSync()
        const rebuild = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.chroMemoryRebuild)!
        rebuild.click()
        flushSync()
        expect(discardChroMemoryIndex).toHaveBeenCalledExactlyOnceWith(KEY)
    })

    test('UI5 (R): Rebuild shows the notice for this chat when the slot belongs to another chat', () => {
        chroMemoryTrace.set(traceFor('other:chat'))
        const { target } = mountModal()
        tab(target, language.chroMemoryTabIndex).click()
        flushSync()
        expect(target.textContent).not.toContain(language.chroMemoryRebuilt)
        const rebuild = Array.from(target.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.chroMemoryRebuild)!
        rebuild.click()
        flushSync()
        expect(target.textContent).toContain(language.chroMemoryRebuilt)
    })

    test('UI5 (R): after a discard for this chat the notice shows and the old index tiles are hidden; another chat\'s discard shows nothing', () => {
        chroMemoryTrace.set(traceFor(KEY))
        const { target } = mountModal()
        tab(target, language.chroMemoryTabIndex).click()
        flushSync()
        expect(target.textContent).toContain(language.chroMemoryUnits)
        chroMemoryDiscarded.set('other:chat')
        flushSync()
        expect(target.textContent).not.toContain(language.chroMemoryRebuilt)
        chroMemoryDiscarded.set(KEY)
        flushSync()
        expect(target.textContent).toContain(language.chroMemoryRebuilt)
        expect(target.textContent).not.toContain(language.chroMemoryUnits)
        chroMemoryTrace.set(traceFor(KEY, { at: 2 }))
        chroMemoryDiscarded.set(null)
        flushSync()
        expect(target.textContent).toContain(language.chroMemoryUnits)
    })
})

describe('Recalled lore (S18)', () => {
    test('S18 (R): this chat lore trace shows the outcome, items with name, source, tokens and rank, and used of limit', () => {
        chroLoreTrace.set(loreTraceFor(KEY))
        const { target } = mountModal()
        const text = target.textContent ?? ''
        expect(text).toContain(language.chroMemoryLoreSection)
        expect(text).toContain(language.chroMemoryOutcomeInjected)
        expect(text).toContain(fillLang(language.chroMemoryLoreUsed, { used: 64, limit: 1500 }))
        expect(text).toContain('Wyvern roost')
        expect(text).toContain('Sky citadel')
        expect(text).toContain(language.chroMemoryLoreFromChat)
        expect(text).toContain(language.chroMemoryLoreFromModule)
        expect(text).toContain(fillLang(language.chroMemoryItemMeta, { tokens: 40, rank: 1 }))
        expect(text).not.toContain(language.chroMemoryNoSend)
    })

    test('S18 (R): another chat lore trace shows nothing of it', () => {
        chroLoreTrace.set(loreTraceFor('other:chat'))
        const { target } = mountModal()
        expect(target.textContent).not.toContain(language.chroMemoryLoreSection)
        expect(target.textContent).not.toContain('Wyvern roost')
        expect(target.textContent).toContain(language.chroMemoryNoSend)
    })

    test('S18 (R): the removed-at-trim count shows only when entries were removed', () => {
        chroLoreTrace.set(loreTraceFor(KEY, { trimmed: { removed: 2 } }))
        const { target, destroy } = mountModal()
        expect(target.textContent).toContain(fillLang(language.chroMemoryLoreRemoved, { count: 2 }))
        destroy()
        chroLoreTrace.set(loreTraceFor(KEY, { trimmed: { removed: 0 } }))
        const second = mountModal()
        expect(second.target.textContent).not.toContain(fillLang(language.chroMemoryLoreRemoved, { count: 0 }))
    })

    test('S18 (R): each of the ten outcomes maps to its own text; an error shows in the error colour', () => {
        const cases: Array<[ChroLoreTrace['outcome'], string]> = [
            ['placed', language.chroMemoryOutcomeInjected],
            ['would-place', language.chroMemoryOutcomePacked],
            ['budget-cut', language.chroMemoryLoreOutcomeBudgetCut],
            ['no-budget', language.chroMemoryLoreOutcomeNoBudget],
            ['no-query', language.chroMemoryOutcomeNoQuery],
            ['index-building', language.chroMemoryLoreOutcomeIndexBuilding],
            ['no-candidates', language.chroMemoryLoreOutcomeNoCandidates],
            ['nothing-admitted', language.chroMemoryOutcomeNothing],
            ['nothing-fit', language.chroMemoryLoreOutcomeNothingFit],
        ]
        for (const [outcome, label] of cases) {
            chroLoreTrace.set(loreTraceFor(KEY, { outcome }))
            const { target, destroy } = mountModal()
            expect(target.textContent, outcome).toContain(label)
            destroy()
        }
        chroLoreTrace.set(loreTraceFor(KEY, { outcome: 'error', error: 'boom' }))
        const { target } = mountModal()
        const el = Array.from(target.querySelectorAll('div')).find((d) => d.textContent === fillLang(language.chroMemoryOutcomeError, { error: 'boom' }))!
        expect(el.classList.contains('text-draculared')).toBe(true)
    })

    test('S18 (G): the memory section and the lore section show together, and a live lore trace appears without remounting', () => {
        chroMemoryTrace.set(traceFor(KEY))
        const { target } = mountModal()
        expect(target.textContent).not.toContain(language.chroMemoryLoreSection)
        chroLoreTrace.set(loreTraceFor(KEY))
        flushSync()
        expect(target.textContent).toContain(language.chroMemoryLoreSection)
        expect(target.textContent).toContain(language.chroMemoryOutcomeInjected)
        expect(target.querySelector('[role=meter]')).not.toBeNull()
    })

    test('S18 (R): the Index tab shows the lore index size, building, failed and not-built states', () => {
        const states: Array<[ChroLoreTrace['index']['state'], string]> = [
            ['ready', '77'],
            ['building', language.chroMemoryLoreIndexBuilding],
            ['failed', language.chroMemoryLoreIndexFailed],
            ['none', language.chroMemoryLoreIndexNone],
        ]
        for (const [state, label] of states) {
            chroLoreTrace.set(loreTraceFor(KEY, { index: { state, entries: 77, buildMs: 1 } }))
            const { target, destroy } = mountModal()
            tab(target, language.chroMemoryTabIndex).click()
            flushSync()
            expect(target.textContent, state).toContain(language.chroMemoryLoreIndex)
            expect(target.textContent, state).toContain(label)
            if (state !== 'ready') expect(target.textContent, state).not.toContain('77')
            destroy()
        }
    })

    test('S18 (R): with no lore trace the Index tab shows no lore tile', () => {
        const { target } = mountModal()
        tab(target, language.chroMemoryTabIndex).click()
        flushSync()
        expect(target.textContent).not.toContain(language.chroMemoryLoreIndex)
    })

    test('S18 (R): the searchLore check writes only through writeLtmSettings, keeps every other key, and mounting writes nothing', () => {
        const before = JSON.stringify(DBState.db.ltmSettings)
        const { target } = mountModal()
        tab(target, language.chroMemoryTabIndex).click()
        flushSync()
        expect(JSON.stringify(DBState.db.ltmSettings)).toBe(before)
        const checks = target.querySelectorAll<HTMLInputElement>('input[type=checkbox]')
        expect(checks).toHaveLength(2)
        const lore = checks[1]
        expect(lore.checked).toBe(false)
        lore.click()
        flushSync()
        expect(DBState.db.ltmSettings).toEqual({ budgetTokens: 900, future: { x: 1 }, searchLore: true })
        expect(target.textContent).toContain(language.chroMemorySearchLoreDesc)
        lore.click()
        flushSync()
        expect(DBState.db.ltmSettings).toEqual({ budgetTokens: 900, future: { x: 1 }, searchLore: false })
    })
})
