// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'

// MOCKED: the alert store the prompts share, and `alertSelect` (the full alert module drags in the whole app). The
// replacement asks through the real prompt controller in `alertPrompts` and builds the message exactly as `alertSelect` does.
vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/alert'), async () => {
    const { askPrompt } = await import('src/ts/alertPrompts')
    return {
        alertSelect: async (msg: string[], display?: string) => await askPrompt({
            type: 'select',
            msg: display !== undefined ? `__DISPLAY__${display}||${msg.join('||')}` : msg.join('||'),
        }),
    } as unknown as typeof import('src/ts/alert')
})

import { changeLanguage, language } from 'src/lang'
import type { alertData } from 'src/ts/alert'
import { ANSWER_GUARD_MS, resetAlertPromptsForTests } from 'src/ts/alertPrompts'
import { alertStore } from 'src/ts/stores.svelte'
import type { PeerLiveState, PeerOffer, PeerParkPrompt } from 'src/ts/storage/store2/saveLoop'
import { acknowledged, createPeerUi } from 'src/ts/storage/store2/ui/peerUi'

/**
 * The in-session peer prompts (`store2/ui/peerUi.ts`). The alert controller is real: a prompt is the `select` alert in
 * the shared store, and an answer is the `none` value a button press puts there once the answer guard has passed.
 * Labels: new behaviour. Real timers: the answer guard is a wall-clock window.
 */

const text = () => language.store2Boot

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds))

function shown(): alertData {
    return get(alertStore)
}

/** The title and button labels of the `select` alert on screen. */
function selectParts(): { title: string, labels: string[] } {
    const data = shown()
    expect(data.type).toBe('select')
    expect(data.msg.startsWith('__DISPLAY__')).toBe(true)
    const [title, ...labels] = data.msg.substring('__DISPLAY__'.length).split('||')
    return { title, labels }
}

async function waitForSelect(): Promise<void> {
    await vi.waitFor(() => expect(shown().type).toBe('select'))
}

async function press(index: number): Promise<void> {
    await sleep(ANSWER_GUARD_MS + 40)
    alertStore.set({ type: 'none', msg: String(index) })
}

/** The live state of a tab that is parked with nothing unsaved and no typed text. */
const calm = (): PeerLiveState => ({ parked: true, dirty: false, drafts: false })

function newUi(options: { exportAvailable?: boolean } = {}) {
    const reload = vi.fn()
    return { reload, ui: createPeerUi({ reload, ...options }) }
}

const prompt = (fields: Partial<PeerParkPrompt> & Pick<PeerParkPrompt, 'offers'>): PeerParkPrompt => ({
    reason: 'peer-commit',
    unsaved: true,
    ...fields,
})

beforeEach(() => {
    changeLanguage('en')
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
})

afterEach(() => {
    resetAlertPromptsForTests()
    alertStore.set({ type: 'none', msg: '' })
})

describe('decide: the wording of every reason and every reason save-mine is missing', () => {
    const reasons = [
        ['peer-commit', () => text().peerCommitTitle],
        ['replaced', () => text().peerReplacedTitle],
    ] as const
    const missing = [
        [undefined, () => ''],
        ['node', () => ` ${text().peerNoSaveNode}`],
        ['replaced', () => ` ${text().peerNoSaveReplaced}`],
        ['unloaded-characters', () => ` ${text().peerNoSaveUnloaded}`],
    ] as const
    const offerSets: PeerOffer[][] = [['reload'], ['reload', 'save-mine']]

    for (const [reason, titleOf] of reasons) {
        for (const [unavailable, suffix] of missing) {
            for (const offers of offerSets) {
                test(`${reason}, save-mine unavailable ${String(unavailable)}, offers ${offers.join('+')}`, async () => {
                    const { ui } = newUi()
                    void ui.decide(prompt({ reason, offers, saveMineUnavailable: unavailable }))
                    await waitForSelect()
                    const { title, labels } = selectParts()
                    expect(title).toBe(`${titleOf()}${suffix()}`)
                    expect(labels).toEqual(offers.map((offer) => offer === 'reload' ? text().peerReload : text().peerSaveMine))
                })
            }
        }
    }
})

describe('decide: the answer maps over the displayed offers', () => {
    test('export-first is not shown without the export, and reload stays the first button', async () => {
        const { ui } = newUi()
        const answer = ui.decide(prompt({ offers: ['reload', 'export-first'], saveMineUnavailable: 'node' }))
        await waitForSelect()
        expect(selectParts().labels).toEqual([text().peerReload])
        await press(0)
        await expect(answer).resolves.toBe('reload')
    })

    test('an offer left out ahead of another does not shift the answer: index 1 is save-mine, never export-first', async () => {
        const { ui } = newUi()
        const answer = ui.decide(prompt({ offers: ['reload', 'export-first', 'save-mine'] }))
        await waitForSelect()
        expect(selectParts().labels).toEqual([text().peerReload, text().peerSaveMine])
        await press(1)
        await expect(answer).resolves.toBe('save-mine')
    })

    test('with the export available it is shown in its place and answers export-first', async () => {
        const { ui } = newUi({ exportAvailable: true })
        const answer = ui.decide(prompt({ offers: ['reload', 'export-first'], saveMineUnavailable: 'node' }))
        await waitForSelect()
        expect(selectParts().labels).toEqual([text().peerReload, text().peerExportFirst])
        await press(1)
        await expect(answer).resolves.toBe('export-first')
    })

    test('an index no button has is read as reload', async () => {
        const { ui } = newUi()
        const answer = ui.decide(prompt({ offers: ['reload', 'save-mine'] }))
        await waitForSelect()
        await press(7)
        await expect(answer).resolves.toBe('reload')
    })
})

describe('parkedClean: a closable prompt asked once', () => {
    test('the buttons are Reload and Keep reading, and the title names the reason', async () => {
        const { ui } = newUi()
        ui.parkedClean(prompt({ reason: 'peer-commit', unsaved: false, offers: ['reload'] }), () => calm())
        await waitForSelect()
        expect(selectParts()).toEqual({ title: text().peerCleanCommit, labels: [text().peerReloadOnly, text().peerKeepReading] })
        await press(1)
        await vi.waitFor(() => expect(shown().type).toBe('none'))

        ui.parkedClean(prompt({ reason: 'replaced', unsaved: false, offers: ['reload'] }), () => calm())
        await waitForSelect()
        expect(selectParts().title).toBe(text().peerCleanReplaced)
    })

    test('Reload reloads', async () => {
        const { ui, reload } = newUi()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm())
        await waitForSelect()
        await press(0)
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    })

    test('reproducer: Reload on a tab that became dirty after the prompt was asked reloads nothing', async () => {
        const { ui, reload } = newUi()
        let state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state)
        await waitForSelect()
        state = { ...state, dirty: true }
        await press(0)
        await vi.waitFor(() => expect(shown().type).toBe('none'))
        await sleep(30)
        expect(reload).not.toHaveBeenCalled()
    })

    test('reproducer: Reload on a page that was unparked after the prompt was asked reloads nothing', async () => {
        const { ui, reload } = newUi()
        let state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state)
        await waitForSelect()
        state = { ...state, parked: false }
        await press(0)
        await vi.waitFor(() => expect(shown().type).toBe('none'))
        await sleep(30)
        expect(reload).not.toHaveBeenCalled()
    })

    test('the state is read when Reload is pressed, so a tab that is clean then still reloads', async () => {
        const { ui, reload } = newUi()
        let state: PeerLiveState = { parked: true, dirty: true, drafts: false }
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state)
        await waitForSelect()
        state = calm()
        await press(0)
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    })

    test('reproducer: a tab with typed text gets the wording that says a reload discards it, for each reason', async () => {
        const { ui } = newUi()
        const typed: PeerLiveState = { parked: true, dirty: false, drafts: true }
        ui.parkedClean(prompt({ reason: 'peer-commit', unsaved: false, offers: ['reload'] }), () => typed)
        await waitForSelect()
        expect(selectParts()).toEqual({ title: text().peerCleanCommitDrafts, labels: [text().peerReloadDrafts, text().peerKeepReading] })
        await press(1)
        await vi.waitFor(() => expect(shown().type).toBe('none'))

        ui.parkedClean(prompt({ reason: 'replaced', unsaved: false, offers: ['reload'] }), () => typed)
        await waitForSelect()
        expect(selectParts()).toEqual({ title: text().peerCleanReplacedDrafts, labels: [text().peerReloadDrafts, text().peerKeepReading] })
    })

    test('Reload on the prompt that warned of typed text reloads', async () => {
        const { ui, reload } = newUi()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => ({ parked: true, dirty: false, drafts: true }))
        await waitForSelect()
        await press(0)
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    })

    test('reproducer: text typed after a prompt without the warning was shown makes Reload ask again with the warning, and reload nothing', async () => {
        const { ui, reload } = newUi()
        let state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state)
        await waitForSelect()
        expect(selectParts().title).toBe(text().peerCleanCommit)
        state = { ...state, drafts: true }
        await press(0)
        await vi.waitFor(() => expect(selectParts().title).toBe(text().peerCleanCommitDrafts))
        expect(selectParts().labels).toEqual([text().peerReloadDrafts, text().peerKeepReading])
        expect(reload).not.toHaveBeenCalled()

        await press(0)
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    })

    test('the second ask follows the same rules: Keep reading closes it, and a tab that became dirty reloads nothing', async () => {
        const { ui, reload } = newUi()
        let state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state)
        await waitForSelect()
        state = { ...state, drafts: true }
        await press(0)
        await vi.waitFor(() => expect(selectParts().title).toBe(text().peerCleanCommitDrafts))
        await press(1)
        await vi.waitFor(() => expect(shown().type).toBe('none'))

        state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state)
        await waitForSelect()
        state = { ...state, drafts: true }
        await press(0)
        await vi.waitFor(() => expect(selectParts().title).toBe(text().peerCleanCommitDrafts))
        state = { ...state, dirty: true }
        await press(0)
        await vi.waitFor(() => expect(shown().type).toBe('none'))
        await sleep(30)
        expect(reload).not.toHaveBeenCalled()
    })

    test('Keep reading closes the prompt without a reload, and a later prompt then shows', async () => {
        const { ui, reload } = newUi()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm())
        await waitForSelect()
        await press(1)
        await vi.waitFor(() => expect(shown().type).toBe('none'))
        await sleep(30)
        expect(reload).not.toHaveBeenCalled()

        void ui.decide(prompt({ offers: ['reload'] }))
        await waitForSelect()
        expect(selectParts().title).toBe(text().peerCommitTitle)
    })
})

describe('both prompts wait for an alert that needs its OK', () => {
    // Every type whose Escape action closes it: an alert that waits for an OK, or a viewer the prompt would replace.
    const holding = ['error', 'normal', 'markdown', 'wait2', 'requestdata', 'hypaV2', 'branches', 'requestlogs', 'pukmakkurit'] as const
    const passing = ['wait', 'progress', 'toast'] as const

    test.each(holding)('decide leaves a %s alert up until it is acknowledged, then asks', async (type) => {
        const { ui } = newUi()
        alertStore.set({ type, msg: 'the save failed' })
        void ui.decide(prompt({ offers: ['reload'] }))
        await sleep(40)
        expect(shown()).toEqual({ type, msg: 'the save failed' })

        alertStore.set({ type: 'none', msg: '' })
        await waitForSelect()
        expect(selectParts().title).toBe(text().peerCommitTitle)
    })

    test.each(holding)('parkedClean leaves a %s alert up until it is acknowledged, then asks', async (type) => {
        const { ui } = newUi()
        alertStore.set({ type, msg: 'the save failed' })
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm())
        await sleep(40)
        expect(shown().type).toBe(type)

        alertStore.set({ type: 'none', msg: '' })
        await waitForSelect()
        expect(selectParts().title).toBe(text().peerCleanCommit)
    })

    test.each(passing)('a %s alert never holds the prompt', async (type) => {
        const { ui } = newUi()
        alertStore.set({ type, msg: 'busy' })
        void ui.decide(prompt({ offers: ['reload'] }))
        await waitForSelect()
        expect(selectParts().title).toBe(text().peerCommitTitle)
    })

    test.each(['decide', 'parkedClean'] as const)('%s: an error posted right after the holding alert closed is not replaced', async (which) => {
        const { ui } = newUi()
        alertStore.set({ type: 'error', msg: 'first' })
        if (which === 'decide') {
            void ui.decide(prompt({ offers: ['reload'] }))
        } else {
            ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm())
        }
        await sleep(20)
        // The close and the next post happen in one synchronous step, before the waiting prompt resumes.
        alertStore.set({ type: 'none', msg: '' })
        alertStore.set({ type: 'error', msg: 'late' })
        await sleep(40)
        expect(shown()).toEqual({ type: 'error', msg: 'late' })

        alertStore.set({ type: 'none', msg: '' })
        await waitForSelect()
    })

    test('acknowledged resolves at once when nothing is up', async () => {
        await expect(acknowledged()).resolves.toBeUndefined()
    })
})

describe('the rest of the handler', () => {
    test('reload is the page reload it was given', () => {
        const { ui, reload } = newUi()
        ui.reload()
        expect(reload).toHaveBeenCalledTimes(1)
    })

    test('the export is not available in this build', async () => {
        const { ui } = newUi()
        await expect(ui.exportThisTab('manifest')).rejects.toThrow(/not available/)
    })
})
