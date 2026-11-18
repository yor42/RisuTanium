// @vitest-environment jsdom
/**
 * The lorebook tester's UI over a mocked runner: what is shown for each
 * outcome, which controls exist, what the session keeps across a remount or a
 * character change, and the stale line on a reactive database. The stores and
 * the locale are replaced (strings answer with their key and arguments); the
 * owner model, the screen store and the session are real.
 *
 * `regression reproducer (M-U..)` tests fail when the named UI rule is removed.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { LoreTestEntry, LoreTestOutcome, LoreTestReason } from '../../ts/studio/loreTest'
import { buildOwnerModel, type OwnerModel, type OwnerModelInput } from '../../ts/studio/ownerModel'
import {
    loreBody,
    makeCharacter,
    makeChat,
    makeInput,
    residentModule,
    stubModule,
    studioDbOf,
} from '../../ts/studio/studioFixtures.test-helpers'

const h = vi.hoisted(() => ({
    run: vi.fn(),
    runnerLoaded: false,
    onReset: (_chaId: string): void => {},
}))

interface TesterDb extends ReturnType<typeof studioDbOf> {
    loreBookDepth: number
    loreBookToken: number
    username: string
    templateDefaultVariables: string
}

const db = $state({ db: {} as TesterDb })
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
vi.mock('../../ts/studio/loreTest', () => {
    h.runnerLoaded = true
    return { runLoreTest: h.run }
})
// The effect that binds the slot to the character reports what the page showed at that moment.
vi.mock('../../ts/studio/loreTestSession.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../ts/studio/loreTestSession.svelte')>()
    return {
        ...actual,
        resetLoreTestFor: (chaId: string) => {
            h.onReset(chaId)
            actual.resetLoreTestFor(chaId)
        },
    }
})

import { loreTestSlot, resetLoreTestFor } from '../../ts/studio/loreTestSession.svelte'
import { resetStudioScreenForTests, studioScreen } from '../../ts/studio/studioScreen.svelte'
import StudioCombined from './StudioCombined.svelte'
import StudioLoreTester from './StudioLoreTester.svelte'

let app: ReturnType<typeof mount> | undefined
let host: HTMLElement | undefined

function inputOf(over: Partial<OwnerModelInput> = {}, chaId = 'cha-1', withChat = true): OwnerModelInput {
    return makeInput({
        character: makeCharacter({
            chaId,
            globalLore: [loreBody('char lore', 'body')],
            chats: withChat ? [makeChat({ id: 'chat-1', name: 'First chat', localLore: [loreBody('chat lore', 'body')] })] : [],
            modules: [],
        }),
        ...over,
    })
}

function useDb(input: OwnerModelInput): OwnerModel {
    db.db = { ...studioDbOf(input), loreBookDepth: 5, loreBookToken: 1000, username: 'User', templateDefaultVariables: '' }
    return buildOwnerModel(input)
}

const holder = $state<{ model: OwnerModel | null }>({ model: null })

function show(model: OwnerModel): void {
    holder.model = model
    host = document.createElement('div')
    document.body.appendChild(host)
    app = mount(StudioLoreTester, { target: host, props: holder as { model: OwnerModel } })
    flushSync()
}

async function hide(): Promise<void> {
    if (app) await unmount(app)
    app = undefined
    host?.remove()
    host = undefined
}

const part = (name: string) => document.querySelector<HTMLElement>(`[data-part="${name}"]`)
const parts = (name: string) => Array.from(document.querySelectorAll<HTMLElement>(`[data-part="${name}"]`))
const textarea = () => part('studio-lore-test-input') as HTMLTextAreaElement | null
const runButton = () => part('studio-lore-test-run') as HTMLButtonElement | null
const rowIndexes = () => parts('studio-lore-test-row').map((row) => Number(row.dataset.index))

function typeText(text: string): void {
    const input = textarea()
    if (!input) throw new Error('no input')
    input.value = text
    input.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

async function runNow(): Promise<void> {
    runButton()?.click()
    flushSync()
    await vi.waitFor(() => {
        flushSync()
        expect(loreTestSlot.pending).toBe(false)
    })
}

function entry(over: Partial<LoreTestEntry> = {}): LoreTestEntry {
    return {
        index: 0,
        label: 'entry',
        folder: false,
        owner: { type: 'character', id: null, index: 0 },
        activated: true,
        reason: { kind: 'always', linked: false },
        outcome: 'kept',
        mergedInto: null,
        warnings: [],
        tokens: 10,
        order: 1,
        chance: null,
        ...over,
    }
}

function outcomeOf(entries: LoreTestEntry[], over: Partial<Extract<LoreTestOutcome, { status: 'ok' }>> = {}): LoreTestOutcome {
    return {
        status: 'ok',
        contextChat: { name: 'First chat' },
        messageAdded: true,
        budget: { used: 30, limit: 1000 },
        scanDepth: 5,
        attribution: 'ok',
        entries,
        ...over,
    }
}

function notActive(index: number, reason: LoreTestReason): LoreTestEntry {
    return entry({ index, label: `off ${index}`, activated: false, reason, outcome: null, tokens: null, order: null })
}

beforeEach(() => {
    resetStudioScreenForTests()
    resetLoreTestFor('reset-between-tests')
    h.run.mockReset()
    h.run.mockImplementation(() => Promise.resolve(outcomeOf([])))
    h.runnerLoaded = false
    h.onReset = () => {}
})

afterEach(async () => {
    await hide()
    resetStudioScreenForTests()
})

describe('where the tester is', () => {
    test.each([
        ['lore', true],
        ['regex', false],
        ['toggles', false],
    ] as const)('regression reproducer (M-U1): the combined %s view has the tester: %s', async (kind, present) => {
        const model = useDb(inputOf())
        host = document.createElement('div')
        document.body.appendChild(host)
        app = mount(StudioCombined, { target: host, props: { model, kind } })
        flushSync()
        expect(part('studio-combined')).not.toBeNull()
        expect(part('studio-lore-test') !== null).toBe(present)
    })
})

describe('a private character', () => {
    test('regression reproducer (M-U2): only the note shows, and the runner is never loaded', () => {
        const input = inputOf()
        input.character = { ...input.character, license: 'private' }
        show(useDb(input))
        expect(part('studio-lore-test-private')?.textContent).toBe('studioLoreTestPrivate')
        expect(textarea()).toBeNull()
        expect(runButton()).toBeNull()
        expect(loreTestSlot.chaId).toBe('reset-between-tests')
        expect(h.runnerLoaded).toBe(false)
    })
})

describe('the scope line', () => {
    test('regression reproducer (M-U14): chat with text, then chat with empty or blank text', () => {
        show(useDb(inputOf()))
        expect(part('studio-lore-test-scope')?.textContent?.trim()).toBe('studioLoreTestScopeNoMessage(First chat,5)')
        typeText('a dragon')
        expect(part('studio-lore-test-scope')?.textContent?.trim()).toBe('studioLoreTestScope(First chat,5)')
        typeText('   ')
        expect(part('studio-lore-test-scope')?.textContent?.trim()).toBe('studioLoreTestScopeNoMessage(First chat,5)')
    })

    test('regression reproducer (M-U6): without a chat, with text and without', () => {
        show(useDb(inputOf({}, 'cha-1', false)))
        expect(part('studio-lore-test-scope')?.textContent?.trim()).toBe('studioLoreTestNothingScanned')
        typeText('a dragon')
        expect(part('studio-lore-test-scope')?.textContent?.trim()).toBe('studioLoreTestNoChat')
    })

    test('before a Run the depth is the character setting, else the database default', () => {
        const input = inputOf()
        input.character = { ...input.character }
        const model = useDb(input)
        ;(db.db.characters[0] as unknown as { loreSettings: { scanDepth: number } }).loreSettings = { scanDepth: 12 }
        show(model)
        expect(part('studio-lore-test-scope')?.textContent?.trim()).toContain(',12)')
    })
})

describe('the modules note', () => {
    const lorebook = [{ key: 'k', secondkey: '', insertorder: 1, comment: 'm', content: 'body', mode: 'normal' as const, alwaysActive: false, selective: false }]

    test('regression reproducer (M-U17): counts stubs and off modules that carry lore, not empty ones; hidden at zero', () => {
        show(useDb(inputOf()))
        expect(part('studio-lore-test-modules')).toBeNull()
    })

    test('regression reproducer (M-U17): an active stub, an off module with lore and an off module without lore make 2', async () => {
        await hide()
        const input = inputOf({
            modules: [stubModule('st'), residentModule('o1', { lorebook }), residentModule('o2')],
        })
        input.character = { ...input.character, modules: ['st'] }
        show(useDb(input))
        expect(part('studio-lore-test-modules')?.textContent).toBe('studioLoreTestModulesSkipped(2)')
    })

    test('regression reproducer (M-U17): a second row of an active id is not applied and counts when it has lore', () => {
        const input = inputOf({ modules: [residentModule('r1', { lorebook }), residentModule('r1', { lorebook })] })
        input.character = { ...input.character, modules: ['r1'] }
        show(useDb(input))
        expect(part('studio-lore-test-modules')?.textContent).toBe('studioLoreTestModulesSkipped(1)')
    })
})

describe('the result', () => {
    test('regression reproducer (M-U3): the runner gets the character and the typed text; Run is off only while pending', async () => {
        show(useDb(inputOf()))
        typeText('a dragon')
        let finish: (outcome: LoreTestOutcome) => void = () => {}
        h.run.mockImplementationOnce(() => new Promise<LoreTestOutcome>((resolve) => { finish = resolve }))
        expect(runButton()?.disabled).toBe(false)
        runButton()?.click()
        flushSync()
        expect(runButton()?.disabled).toBe(true)
        expect(runButton()?.textContent).toBe('studioLoreTestRunning')
        await vi.waitFor(() => expect(h.run).toHaveBeenCalledWith({ chaId: 'cha-1', text: 'a dragon' }))
        finish(outcomeOf([entry()]))
        await vi.waitFor(() => {
            flushSync()
            expect(runButton()?.disabled).toBe(false)
        })
        expect(runButton()?.textContent).toBe('studioLoreTestRun')
        expect(part('studio-lore-test-budget')?.textContent).toBe('studioLoreTestBudget(30,1000)')
    })

    test('regression reproducer (G2-1): the live region carries only the short status lines, never the result rows', async () => {
        h.run.mockImplementation(() => Promise.resolve(outcomeOf([entry({ label: 'kept row' }), notActive(1, { kind: 'noKey' })])))
        show(useDb(inputOf()))
        await runNow()
        const live = Array.from(document.querySelectorAll<HTMLElement>('[aria-live]'))
        expect(live.length).toBe(1)
        expect(live[0].getAttribute('aria-live')).toBe('polite')
        expect(live[0].contains(part('studio-lore-test-budget'))).toBe(true)
        expect(live[0].querySelector('[data-part="studio-lore-test-row"]')).toBeNull()
        expect(live[0].querySelector('[data-part="studio-lore-test-list"]')).toBeNull()
        expect(live[0].querySelector('[data-part="studio-lore-test-inactive-toggle"]')).toBeNull()
        const lore = db.db.characters[0].globalLore?.[0]
        if (!lore) throw new Error('no lore entry')
        Object.assign(lore, { content: 'edited' })
        flushSync()
        expect(live[0].contains(part('studio-lore-test-stale'))).toBe(true)
    })

    test('regression reproducer (M-U4, M-U5): each reason, the warning, the tokens, the order and the chance are written out', async () => {
        h.run.mockImplementation(() => Promise.resolve(outcomeOf([
            entry({ index: 0, label: 'a', reason: { kind: 'matched', key: 'dragon', at: { kind: 'message', position: 2 } }, order: 1, tokens: 10, chance: 30 }),
            entry({ index: 1, label: 'b', reason: { kind: 'matched', key: 'knight', at: { kind: 'typed' } }, order: 2, warnings: [{ kind: 'invalidRegex', key: '(' }] }),
            entry({ index: 2, label: 'c', reason: { kind: 'matched', key: 'wolf', at: { kind: 'entry', index: 0, label: 'a' } }, order: 3 }),
            entry({ index: 3, label: 'd', reason: { kind: 'forced', decorator: 'activate' }, order: 4 }),
            entry({ index: 4, label: 'e', reason: { kind: 'kept' }, order: 5 }),
            notActive(5, { kind: 'noKey' }),
            notActive(6, { kind: 'noMatch', query: 'key' }),
            notActive(7, { kind: 'noMatch', query: 'secondkey' }),
            notActive(8, { kind: 'noMatch', query: 'additional' }),
            notActive(9, { kind: 'excluded', key: 'orc', at: { kind: 'typed' } }),
            notActive(10, { kind: 'excludedNoHit', decorator: 'exclude_keys_all' }),
            notActive(11, { kind: 'decorator', name: 'dont_activate' }),
            notActive(12, { kind: 'spent' }),
            notActive(13, { kind: 'linkedOff' }),
            notActive(14, { kind: 'invalidRegex', key: '(' }),
        ])))
        show(useDb(inputOf()))
        await runNow()
        const reasonOf = (index: number) => document.querySelector(`[data-part="studio-lore-test-row"][data-index="${index}"] [data-part="studio-lore-test-reason"]`)?.textContent
        expect(reasonOf(0)).toBe('studioLoreTestMatchedMessage(dragon,2)')
        expect(reasonOf(1)).toBe('studioLoreTestMatchedTyped(knight)')
        expect(reasonOf(2)).toBe('studioLoreTestMatchedEntry(wolf,a)')
        expect(reasonOf(3)).toBe('studioLoreTestForced(activate)')
        expect(reasonOf(4)).toBe('studioLoreTestKept')
        expect(part('studio-lore-test-warning')?.textContent).toBe('studioLoreTestInvalidRegex(()')
        expect(document.querySelector('[data-index="0"] [data-part="studio-lore-test-tokens"]')?.textContent).toBe('studioLoreTestTokens(10)')
        expect(document.querySelector('[data-index="0"] [data-part="studio-lore-test-order"]')?.textContent).toBe('studioLoreTestOrder(1)')
        expect(document.querySelector('[data-index="0"] [data-part="studio-lore-test-chance"]')?.textContent).toBe('studioLoreTestChance(30)')
        expect(document.querySelector('[data-index="1"] [data-part="studio-lore-test-chance"]')).toBeNull()
        // The inactive group is collapsed until opened.
        expect(part('studio-lore-test-inactive-toggle')?.textContent).toBe('studioLoreTestInactiveGroup(10)')
        expect(reasonOf(5)).toBeUndefined()
        part('studio-lore-test-inactive-toggle')?.click()
        flushSync()
        expect(reasonOf(5)).toBe('studioLoreTestNoKey')
        expect(reasonOf(6)).toBe('studioLoreTestNoMatch')
        expect(reasonOf(7)).toBe('studioLoreTestNoSecondMatch')
        expect(reasonOf(8)).toBe('studioLoreTestNoExtraMatch')
        expect(reasonOf(9)).toBe('studioLoreTestExcluded(orc)')
        expect(reasonOf(10)).toBe('studioLoreTestExcludedNoHit(exclude_keys_all)')
        expect(reasonOf(11)).toBe('studioLoreTestDecorator(dont_activate)')
        expect(reasonOf(12)).toBe('studioLoreTestSpent')
        expect(reasonOf(13)).toBe('studioLoreTestLinkedOff')
        expect(reasonOf(14)).toBe('studioLoreTestInvalidRegex(()')
        expect(parts('studio-lore-test-reason').map((element) => element.textContent)).not.toContain('undefined')
    })

    test('regression reproducer: activated entries come first, kept in prompt order, then merged, dead injectors and cut', async () => {
        h.run.mockImplementation(() => Promise.resolve(outcomeOf([
            entry({ index: 0, outcome: 'cut', order: null, label: 'cut' }),
            entry({ index: 1, outcome: 'kept', order: 2, label: 'second' }),
            notActive(2, { kind: 'noKey' }),
            entry({ index: 3, outcome: 'merged', mergedInto: 'second', order: null, label: 'merged' }),
            entry({ index: 4, outcome: 'kept', order: 1, label: 'first' }),
            entry({ index: 5, outcome: 'injectTargetMissing', order: null, label: 'dead' }),
            entry({ index: 6, folder: true, label: 'folder', activated: false, reason: { kind: 'noKey' }, outcome: null }),
        ])))
        show(useDb(inputOf()))
        await runNow()
        expect(rowIndexes()).toEqual([4, 1, 3, 5, 0])
        const outcomeText = (index: number) => document.querySelector(`[data-index="${index}"] [data-part="studio-lore-test-outcome"]`)?.textContent
        expect(outcomeText(3)).toBe('studioLoreTestMerged(second)')
        expect(outcomeText(5)).toBe('studioLoreTestInjectMissing')
        expect(outcomeText(0)).toBe('studioLoreTestCut')
        expect(part('studio-lore-test-inactive-toggle')?.textContent).toBe('studioLoreTestInactiveGroup(1)')
    })

    test('regression reproducer (M-U13, M-U15): 101 inactive entries are collapsed, then one page, then all', async () => {
        h.run.mockImplementation(() => Promise.resolve(outcomeOf(Array.from({ length: 101 }, (_, index) => notActive(index, { kind: 'noMatch', query: 'key' })))))
        show(useDb(inputOf()))
        await runNow()
        expect(part('studio-lore-test-inactive-toggle')?.textContent).toBe('studioLoreTestInactiveGroup(101)')
        expect(part('studio-lore-test-inactive-toggle')?.getAttribute('aria-expanded')).toBe('false')
        expect(parts('studio-lore-test-row').length).toBe(0)
        part('studio-lore-test-inactive-toggle')?.click()
        flushSync()
        expect(parts('studio-lore-test-row').length).toBe(100)
        expect(part('studio-lore-test-more')?.textContent).toBe('studioShowMore(1)')
        part('studio-lore-test-more')?.click()
        flushSync()
        expect(parts('studio-lore-test-row').length).toBe(101)
        expect(part('studio-lore-test-more')).toBeNull()
    })

    test('regression reproducer: the attribution note shows only when owners could not be matched', async () => {
        h.run.mockImplementation(() => Promise.resolve(outcomeOf([entry({ owner: null })], { attribution: 'unavailable' })))
        show(useDb(inputOf()))
        await runNow()
        expect(part('studio-lore-test-attribution')?.textContent).toBe('studioLoreTestNoAttribution')
    })

    test('regression reproducer: the label opens the entry in its owner, and an unmatched owner has no button', async () => {
        h.run.mockImplementation(() => Promise.resolve(outcomeOf([
            entry({ index: 0, label: 'char lore', owner: { type: 'character', id: null, index: 0 } }),
            entry({ index: 1, label: 'chat lore', owner: { type: 'chat', id: 'chat-1', index: 0 } }),
            entry({ index: 2, label: 'lost', owner: null }),
        ])))
        show(useDb(inputOf()))
        await runNow()
        expect(parts('studio-lore-test-open').length).toBe(2)
        parts('studio-lore-test-open')[1].click()
        flushSync()
        expect(studioScreen.selectedOwnerKey).toBe('chat:chat-1')
        expect(studioScreen.selectedKind).toBe('lore')
        expect(studioScreen.selectedItemId).toBe('chat-1/lore:0')
    })

    test('regression reproducer: a runner failure and a refusal show the error line', async () => {
        h.run.mockImplementationOnce(() => Promise.reject(new Error('boom')))
        show(useDb(inputOf()))
        await runNow()
        expect(part('studio-lore-test-error')?.textContent).toBe('studioLoreTestError')
        h.run.mockImplementationOnce(() => Promise.resolve({ status: 'refused', reason: 'cold' } satisfies LoreTestOutcome))
        await runNow()
        expect(part('studio-lore-test-error')?.textContent).toBe('studioLoreTestError')
        expect(part('studio-lore-test-budget')).toBeNull()
    })
})

describe('the session in the page', () => {
    test('regression reproducer (M-U11): the text and the result survive a remount for the same character', async () => {
        h.run.mockImplementation(() => Promise.resolve(outcomeOf([entry({ label: 'kept row' })])))
        const model = useDb(inputOf())
        show(model)
        typeText('a dragon')
        await runNow()
        await hide()
        show(model)
        expect(textarea()?.value).toBe('a dragon')
        expect(parts('studio-lore-test-row').length).toBe(1)
    })

    test('regression reproducer (M-U12): a remount for another character starts empty', async () => {
        h.run.mockImplementation(() => Promise.resolve(outcomeOf([entry({ label: 'kept row' })])))
        show(useDb(inputOf()))
        typeText('a dragon')
        await runNow()
        await hide()
        show(useDb(inputOf({}, 'cha-2')))
        expect(textarea()?.value).toBe('')
        expect(parts('studio-lore-test-row').length).toBe(0)
    })

    test('regression reproducer (M-U19): rebinding the same instance never draws the previous character, not even before the reset effect runs', async () => {
        h.run.mockImplementation(() => Promise.resolve(outcomeOf([entry({ label: 'kept row' })])))
        show(useDb(inputOf()))
        typeText('a dragon')
        await runNow()
        expect(parts('studio-lore-test-row').length).toBe(1)
        const seenAtReset: { text: string | undefined, rows: number }[] = []
        h.onReset = () => {
            seenAtReset.push({ text: textarea()?.value, rows: parts('studio-lore-test-row').length })
        }
        const other = buildOwnerModel(inputOf({}, 'cha-2'))
        holder.model = other
        flushSync()
        // The reset effect ran after the page had already been redrawn for the new character.
        expect(seenAtReset).toEqual([{ text: '', rows: 0 }])
        expect(textarea()?.value).toBe('')
        expect(parts('studio-lore-test-row').length).toBe(0)
        expect(loreTestSlot).toMatchObject({ chaId: 'cha-2', text: '', outcome: null })
    })
})

describe('the stale line on a reactive database', () => {
    test('regression reproducer (M-U7, M-U20): an edit to a lore entry after a Run shows the stale line and dims the list, with no unsafe mutation', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        h.run.mockImplementation(() => Promise.resolve(outcomeOf([entry({ label: 'kept row' })])))
        show(useDb(inputOf()))
        await runNow()
        expect(part('studio-lore-test-stale')).toBeNull()
        expect(part('studio-lore-test-list')?.dataset.stale).toBe('false')
        const lore = db.db.characters[0].globalLore?.[0]
        if (!lore) throw new Error('no lore entry')
        Object.assign(lore, { content: 'edited' })
        flushSync()
        expect(part('studio-lore-test-stale')?.textContent).toBe('studioLoreTestStale')
        expect(part('studio-lore-test-list')?.dataset.stale).toBe('true')
        expect(part('studio-lore-test-list')?.className).toContain('opacity-50')
        expect(runButton()?.disabled).toBe(false)
        expect(errors.mock.calls.map((call) => String(call[0])).filter((message) => message.includes('state_unsafe_mutation'))).toEqual([])
        errors.mockRestore()
        await runNow()
        expect(part('studio-lore-test-stale')).toBeNull()
    })
})
