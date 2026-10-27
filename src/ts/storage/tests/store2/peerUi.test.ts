// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { get, writable } from 'svelte/store'

// MOCKED: the alert store the prompts share, and `alertSelect`, `alertMd`, `alertWait`, `alertClear` and `waitAlert` (the full alert module drags in
// the whole app). The replacement asks through the real prompt controller in `alertPrompts` and builds the message exactly
// as `alertSelect` does; `alertMd` posts the markdown alert and records it, and `waitAlert` resolves with the first `none`,
// as the real ones do.
const posted = vi.hoisted(() => ({ markdown: [] as string[], toasts: [] as string[] }))
vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/alert'), async () => {
    const { askPrompt } = await import('src/ts/alertPrompts')
    const { alertStore: store } = await import('src/ts/stores.svelte')
    return {
        alertMd: (msg: string) => {
            posted.markdown.push(msg)
            store.set({ type: 'markdown', msg })
        },
        alertToast: (msg: string) => {
            posted.toasts.push(msg)
        },
        // `alertWait` posts and returns the exact object, as the real one does; `alertClear` leaves a prompt alone, as the real one does.
        alertWait: (msg: string, onCancel?: () => void) => {
            const data = onCancel ? { type: 'wait', msg, onCancel } : { type: 'wait', msg }
            store.set(data as alertData)
            return data
        },
        alertClear: () => {
            if (get(store).type === 'select') {
                return
            }
            store.set({ type: 'none', msg: '' })
        },
        waitAlert: () => new Promise<void>((resolve) => {
            const stop = store.subscribe((value) => {
                if (value.type === 'none') {
                    queueMicrotask(() => stop())
                    resolve()
                }
            })
        }),
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
import type { ParkCheck, PeerLiveState, PeerOffer, PeerParkPrompt } from 'src/ts/storage/store2/saveLoop'
import { acknowledged, createPeerUi, type PeerExportResult } from 'src/ts/storage/store2/ui/peerUi'

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

/** The loop's answer to a Reload press when every resident is clean. */
const cleanNow = async (): Promise<ParkCheck> => 'clean'

/** A request the test settles itself, counting how often the loop was asked. */
function manualCheck() {
    let settle: (verdict: ParkCheck) => void = () => { }
    const calls = { count: 0 }
    const request = (): Promise<ParkCheck> => {
        calls.count += 1
        return new Promise<ParkCheck>((resolve) => { settle = resolve })
    }
    return { request, calls, answer: (verdict: ParkCheck) => settle(verdict) }
}

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
    posted.markdown.length = 0
    posted.toasts.length = 0
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
        // No export is available in these prompts, so the Node wording names no Export button.
        ['node', () => ` ${text().peerNoSaveNode} ${text().peerNodeReloadDropsOnly}`],
        ['replaced', () => ` ${text().peerNoSaveReplaced}`],
        ['carries', () => ` ${text().peerNoSaveBlockedCount.replace('{count}', '0')}`],
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

describe('decide: the shared Save-mine-unavailable message names what is blocked', () => {
    /** Asks a Reload-only prompt that carries `blocked`, and returns the sentence after the title. */
    async function blockedSentence(names: string[], count: number): Promise<string> {
        const { ui } = newUi()
        void ui.decide(prompt({ offers: ['reload'], saveMineUnavailable: 'carries', blocked: { names, count } }))
        await waitForSelect()
        const { title, labels } = selectParts()
        // The title holds no `||`: the buttons after it are exactly the offers.
        expect(labels).toEqual([text().peerReload])
        const head = `${text().peerCommitTitle} `
        expect(title.startsWith(head)).toBe(true)
        return title.substring(head.length)
    }

    const listed = (list: string) => text().peerNoSaveBlocked.replace('{names}', () => list)
    const counted = (count: number) => text().peerNoSaveBlockedCount.replace('{count}', String(count))

    test('no names: the sentence carries the count alone', async () => {
        expect(await blockedSentence([], 3)).toBe(counted(3))
    })

    test('the count is the plan count, not zero, when the list is empty', async () => {
        expect(await blockedSentence([], 7)).toBe(counted(7))
    })

    test('names that clean to nothing leave the count alone', async () => {
        expect(await blockedSentence([' ', '​'], 2)).toBe(counted(2))
    })

    test('one name', async () => {
        expect(await blockedSentence(['Alice'], 1)).toBe(listed('Alice'))
    })

    test('five names are all shown, with no suffix', async () => {
        expect(await blockedSentence(['A', 'B', 'C', 'D', 'E'], 5)).toBe(listed('A, B, C, D, E'))
    })

    test('six names show five and the rest as (+1)', async () => {
        expect(await blockedSentence(['A', 'B', 'C', 'D', 'E', 'F'], 6)).toBe(listed('A, B, C, D, E (+1)'))
    })

    test('six names with two empty show four and (+2): the suffix is the count minus the names shown', async () => {
        expect(await blockedSentence(['A', '', 'B', ' ', 'C', 'D'], 6)).toBe(listed('A, B, C, D (+2)'))
    })

    test('a count above the names listed is counted in the suffix', async () => {
        expect(await blockedSentence(['A', 'B'], 9)).toBe(listed('A, B (+7)'))
    })

    test('a name with || or a run of | never splits the title', async () => {
        expect(await blockedSentence(['a||b', 'c|||||d'], 2)).toBe(listed('a|b, c|d'))
    })

    test('a bar at either end of a name goes, so it cannot meet the separator after the title', async () => {
        expect(await blockedSentence(['x|', '|y|'], 2)).toBe(listed('x, y'))
    })

    test('newlines and tabs become one space', async () => {
        expect(await blockedSentence(['line one\r\nline\ttwo'], 1)).toBe(listed('line one line two'))
    })

    test('control and bidi characters go, and a bar run they separated does not rejoin', async () => {
        expect(await blockedSentence(['a‮b\u0007c', 'p|​|q'], 2)).toBe(listed('abc, p|q'))
    })

    test('a long name is cut to 40 characters with an ellipsis', async () => {
        expect(await blockedSentence(['x'.repeat(200)], 1)).toBe(listed(`${'x'.repeat(39)}…`))
    })

    test('a name with a replacement pattern is shown literally', async () => {
        expect(await blockedSentence(['$&', '$1 $$'], 2)).toBe(listed('$&, $1 $$'))
    })
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
        ui.parkedClean(prompt({ reason: 'peer-commit', unsaved: false, offers: ['reload'] }), () => calm(), cleanNow)
        await waitForSelect()
        expect(selectParts()).toEqual({ title: text().peerCleanCommit, labels: [text().peerReloadOnly, text().peerKeepReading] })
        await press(1)
        await vi.waitFor(() => expect(shown().type).toBe('none'))

        ui.parkedClean(prompt({ reason: 'replaced', unsaved: false, offers: ['reload'] }), () => calm(), cleanNow)
        await waitForSelect()
        expect(selectParts().title).toBe(text().peerCleanReplaced)
    })

    test('Reload reloads', async () => {
        const { ui, reload } = newUi()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm(), cleanNow)
        await waitForSelect()
        await press(0)
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    })

    test('reproducer: Reload on a tab that became dirty after the prompt was asked reloads nothing', async () => {
        const { ui, reload } = newUi()
        let state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, cleanNow)
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
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, cleanNow)
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
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, cleanNow)
        await waitForSelect()
        state = calm()
        await press(0)
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    })

    test('reproducer: a tab with typed text gets the wording that says a reload discards it, for each reason', async () => {
        const { ui } = newUi()
        const typed: PeerLiveState = { parked: true, dirty: false, drafts: true }
        ui.parkedClean(prompt({ reason: 'peer-commit', unsaved: false, offers: ['reload'] }), () => typed, cleanNow)
        await waitForSelect()
        expect(selectParts()).toEqual({ title: text().peerCleanCommitDrafts, labels: [text().peerReloadDrafts, text().peerKeepReading] })
        await press(1)
        await vi.waitFor(() => expect(shown().type).toBe('none'))

        ui.parkedClean(prompt({ reason: 'replaced', unsaved: false, offers: ['reload'] }), () => typed, cleanNow)
        await waitForSelect()
        expect(selectParts()).toEqual({ title: text().peerCleanReplacedDrafts, labels: [text().peerReloadDrafts, text().peerKeepReading] })
    })

    test('Reload on the prompt that warned of typed text reloads', async () => {
        const { ui, reload } = newUi()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => ({ parked: true, dirty: false, drafts: true }), cleanNow)
        await waitForSelect()
        await press(0)
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    })

    test('reproducer: text typed after a prompt without the warning was shown makes Reload ask again with the warning, and reload nothing', async () => {
        const { ui, reload } = newUi()
        let state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, cleanNow)
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
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, cleanNow)
        await waitForSelect()
        state = { ...state, drafts: true }
        await press(0)
        await vi.waitFor(() => expect(selectParts().title).toBe(text().peerCleanCommitDrafts))
        await press(1)
        await vi.waitFor(() => expect(shown().type).toBe('none'))

        state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, cleanNow)
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
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm(), cleanNow)
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
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm(), cleanNow)
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
            ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm(), cleanNow)
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

describe('moduleEdited: a closable prompt that names the module', () => {
    const info = { moduleId: 'mod-1', moduleName: 'Edited module' }

    test('new behaviour: the buttons are Reload and Keep working, and the title names the module', async () => {
        const { ui } = newUi()
        ui.moduleEdited(info, () => true)
        await waitForSelect()
        expect(selectParts()).toEqual({
            title: text().moduleEditedTitle.replace('{name}', () => 'Edited module'),
            labels: [text().peerReload, text().moduleEditedKeep],
        })
    })

    test('new behaviour: the title says that characters and chats are still saved, that module changes are not, and that Reload discards what is unsaved', async () => {
        const title = text().moduleEditedTitle
        expect(title).toContain('Your characters and chats are still being saved')
        expect(title).toContain('changes to modules are not saved')
        expect(title).toContain('lost if the app is closed')
        expect(title).toContain('anything else not yet saved in this tab')
        expect(title).not.toContain('nothing in this tab is being saved')
    })

    test('new behaviour: Reload reloads while the stub is still the blocker at the press', async () => {
        const { ui, reload } = newUi()
        ui.moduleEdited(info, () => true)
        await waitForSelect()
        await press(0)
        await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    })

    test('new behaviour: Reload reloads nothing once a later pass has saved, and the probe is read at the press', async () => {
        const { ui, reload } = newUi()
        let blocked = true
        ui.moduleEdited(info, () => blocked)
        await waitForSelect()
        blocked = false
        await press(0)
        await vi.waitFor(() => expect(shown().type).toBe('none'))
        await sleep(30)
        expect(reload).not.toHaveBeenCalled()
    })

    test('new behaviour: Keep working closes the prompt and reloads nothing', async () => {
        const { ui, reload } = newUi()
        ui.moduleEdited(info, () => true)
        await waitForSelect()
        await press(1)
        await vi.waitFor(() => expect(shown().type).toBe('none'))
        await sleep(30)
        expect(reload).not.toHaveBeenCalled()
        expect(shown().type).toBe('none')
    })

    test.each(['error', 'normal', 'markdown'] as const)('new behaviour: a %s alert is left up until it is acknowledged, then the prompt asks', async (type) => {
        const { ui } = newUi()
        alertStore.set({ type, msg: 'the save failed' })
        ui.moduleEdited(info, () => true)
        await sleep(40)
        expect(shown()).toEqual({ type, msg: 'the save failed' })

        alertStore.set({ type: 'none', msg: '' })
        await waitForSelect()
        expect(selectParts().labels).toEqual([text().peerReload, text().moduleEditedKeep])
    })

    test('new behaviour: a name with || or control characters never splits the title or adds a button', async () => {
        const { ui } = newUi()
        ui.moduleEdited({ moduleId: 'mod-1', moduleName: 'Bad||Name‮\nx' }, () => true)
        await waitForSelect()
        const parts = selectParts()
        expect(parts.labels).toEqual([text().peerReload, text().moduleEditedKeep])
        expect(parts.title).toBe(text().moduleEditedTitle.replace('{name}', () => 'Bad|Name x'))
    })

    test('new behaviour: a long name is cut to 40 characters with an ellipsis', async () => {
        const { ui } = newUi()
        ui.moduleEdited({ moduleId: 'mod-1', moduleName: 'n'.repeat(60) }, () => true)
        await waitForSelect()
        expect(selectParts().title).toBe(text().moduleEditedTitle.replace('{name}', () => `${'n'.repeat(39)}…`))
    })

    test('new behaviour: a name with a replacement pattern is shown literally', async () => {
        const { ui } = newUi()
        ui.moduleEdited({ moduleId: 'mod-1', moduleName: 'a$&b' }, () => true)
        await waitForSelect()
        expect(selectParts().title).toBe(text().moduleEditedTitle.replace('{name}', () => 'a$&b'))
    })
})

describe('moduleNotSaved: one toast that names the module', () => {
    test('new behaviour: the toast names the module in both places and no prompt is asked', async () => {
        const { ui } = newUi()
        ui.moduleNotSaved({ moduleId: 'mod-1', moduleName: 'Stuck module' })
        expect(posted.toasts).toEqual([text().moduleNotSaved.replaceAll('{name}', () => 'Stuck module')])
        expect(posted.toasts[0]).toContain('"Stuck module" is deleted or replaced')
        expect(posted.toasts[0]).toContain('Your characters and chats are still being saved')
        expect(posted.toasts[0]).toContain('lost if the app is closed or reloaded')
        expect(shown().type).toBe('none')
    })

    test('new behaviour: a name with || or control characters is cleaned, a long name is cut, a replacement pattern is literal', () => {
        const { ui } = newUi()
        ui.moduleNotSaved({ moduleId: 'mod-1', moduleName: 'Bad||Name‮\nx' })
        ui.moduleNotSaved({ moduleId: 'mod-2', moduleName: 'n'.repeat(60) })
        ui.moduleNotSaved({ moduleId: 'mod-3', moduleName: 'a$&b' })
        expect(posted.toasts).toEqual([
            text().moduleNotSaved.replaceAll('{name}', () => 'Bad|Name x'),
            text().moduleNotSaved.replaceAll('{name}', () => `${'n'.repeat(39)}…`),
            text().moduleNotSaved.replaceAll('{name}', () => 'a$&b'),
        ])
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

describe('exportThisTab: saved only after the person has pressed the hand-off prompt\'s own button', () => {
    /** Closes the writer's report once it is up; the prompt after it is what holds the reload. */
    const closeReport = async () => {
        await vi.waitFor(() => expect(shown().type).toBe('markdown'))
        alertStore.set({ type: 'none', msg: '' })
    }
    const saved = (notices: string[]) => vi.fn(async (_manifestKey: string): Promise<PeerExportResult> => ({ status: 'saved', notices }))

    // New behaviour (Gate 1 C1, mutant M15: resolve without waiting for the answer).
    test('a saved export keeps the prompt up with the writer report and resolves only when its button is pressed', async () => {
        const write = saved(['Partial backup successful.'])
        const reload = vi.fn()
        const ui = createPeerUi({ reload, exportAvailable: true, exportThisTab: write })
        let settled: 'saved' | 'declined' | 'failed' | null = null
        const answer = ui.exportThisTab('manifest').then((value) => { settled = value })
        await closeReport()
        await waitForSelect()
        expect(write).toHaveBeenCalledWith('manifest')
        expect(posted.markdown).toEqual(['Partial backup successful.'])
        const { title, labels } = selectParts()
        expect(title).toBe(text().peerExportHandedOff)
        expect(labels).toEqual([text().peerExportReloadNow])
        await sleep(60)
        expect(settled).toBeNull()
        await press(0)
        await answer
        expect(settled).toBe('saved')
        expect(reload).not.toHaveBeenCalled()
    })

    // New behaviour (Gate 2 R1): a toast or a direct store clear is not this prompt's answer.
    test('a toast landing on the open prompt, and a direct alert-store clear after it, do not answer it: it is shown again until its button is pressed', async () => {
        const ui = createPeerUi({ reload: vi.fn(), exportAvailable: true, exportThisTab: saved([]) })
        let settled: 'saved' | 'declined' | 'failed' | null = null
        const answer = ui.exportThisTab('manifest').then((value) => { settled = value })
        await closeReport()
        await waitForSelect()
        await sleep(ANSWER_GUARD_MS + 40)

        alertStore.set({ type: 'toast', msg: 'late toast' })
        alertStore.set({ type: 'none', msg: '' })
        await vi.waitFor(() => expect(shown().type).toBe('select'))
        expect(settled).toBeNull()

        await sleep(ANSWER_GUARD_MS + 40)
        alertStore.set({ type: 'none', msg: '' })
        await vi.waitFor(() => expect(shown().type).toBe('select'))
        await sleep(60)
        expect(settled).toBeNull()

        await press(0)
        await answer
        expect(settled).toBe('saved')
    })

    test('a plain success posts the inlays-not-included sentence as the report', async () => {
        const ui = createPeerUi({ reload: vi.fn(), exportAvailable: true, exportThisTab: saved([]) })
        const answer = ui.exportThisTab('manifest')
        await closeReport()
        await waitForSelect()
        expect(posted.markdown).toEqual([language.partialBackupInlaysNotIncluded])
        await press(0)
        await expect(answer).resolves.toBe('saved')
    })

    // New behaviour (Gate 2 R2): a report holding `||` must not split the prompt into extra buttons.
    test('a report containing || still gives exactly one Reload now button, at index 0, and the prompt text is the language string alone', async () => {
        const ui = createPeerUi({ reload: vi.fn(), exportAvailable: true, exportThisTab: saved(["'Profile Image' from A||B"]) })
        const answer = ui.exportThisTab('manifest')
        await closeReport()
        await waitForSelect()
        expect(posted.markdown).toEqual(["'Profile Image' from A||B"])
        const { title, labels } = selectParts()
        expect(title).toBe(text().peerExportHandedOff)
        expect(labels).toEqual([text().peerExportReloadNow])
        await press(0)
        await expect(answer).resolves.toBe('saved')
    })

    test('the hand-off prompt tells the person to wait for the download before pressing the button', () => {
        expect(text().peerExportHandedOff).toMatch(/download/i)
        expect(text().peerExportHandedOff).toContain(text().peerExportReloadNow)
    })

    // New behaviour: reload follows only a saved outcome.
    test.each(['declined', 'failed'] as const)('new behaviour: a %s export resolves as itself and posts no hand-off notice', async (status) => {
        const ui = createPeerUi({ reload: vi.fn(), exportAvailable: true, exportThisTab: async () => ({ status }) })
        await expect(ui.exportThisTab('manifest')).resolves.toBe(status)
        expect(shown().type).toBe('none')
    })

    test('a throw of the export is the handler failing: it rejects', async () => {
        const ui = createPeerUi({ reload: vi.fn(), exportAvailable: true, exportThisTab: async () => { throw new Error('boom') } })
        await expect(ui.exportThisTab('manifest')).rejects.toThrow('boom')
    })
})

describe('autoExport: the same export without the blocking hand-off', () => {
    test.each(['saved', 'declined', 'failed'] as const)('new behaviour: a %s export resolves as itself with no alert and no prompt', async (status) => {
        const write = vi.fn(async (_manifestKey: string): Promise<PeerExportResult> => status === 'saved' ? { status, notices: ['Partial backup successful.'] } : { status })
        const ui = createPeerUi({ reload: vi.fn(), exportAvailable: true, exportThisTab: write })
        await expect(ui.autoExport?.('manifest')).resolves.toBe(status)
        expect(write).toHaveBeenCalledTimes(1)
        expect(write).toHaveBeenCalledWith('manifest')
        expect(posted.markdown).toEqual([])
        expect(shown().type).toBe('none')
    })

    test('new behaviour: a throw of the export rejects', async () => {
        const ui = createPeerUi({ reload: vi.fn(), exportAvailable: true, exportThisTab: async () => { throw new Error('boom') } })
        await expect(ui.autoExport?.('manifest')).rejects.toThrow('boom')
    })

    test('new behaviour: without an export in this build it rejects', async () => {
        const { ui } = newUi()
        await expect(ui.autoExport?.('manifest')).rejects.toThrow(/not available/)
    })
})

describe('decide: the Node wording says what Reload drops and what the automatic export did', () => {
    const node = (fields: Partial<PeerParkPrompt> = {}) => prompt({ offers: ['reload', 'export-first'], saveMineUnavailable: 'node', ...fields })

    test('new behaviour: with the export shown the title says Reload drops the changes and Export keeps them without other images, assets and inlays', async () => {
        const { ui } = newUi({ exportAvailable: true })
        void ui.decide(node())
        await waitForSelect()
        const { title } = selectParts()
        expect(title).toBe(`${text().peerCommitTitle} ${text().peerNoSaveNode} ${text().peerNodeReloadDrops}`)
        expect(text().peerNodeReloadDrops).toMatch(/Reload drops this tab's unsaved changes/)
        expect(text().peerNodeReloadDrops).toMatch(/Export this tab first keeps them in a file without other images, assets and inlays/)
    })

    test('new behaviour: a saved automatic export adds the line that the file was handed to the browser and the download must be checked before Reload', async () => {
        const { ui } = newUi({ exportAvailable: true })
        void ui.decide(node({ autoExport: 'saved' }))
        await waitForSelect()
        const { title, labels } = selectParts()
        expect(title).toBe(`${text().peerCommitTitle} ${text().peerNoSaveNode} ${text().peerNodeReloadDrops} ${text().peerAutoExportSaved}`)
        expect(text().peerAutoExportSaved).toMatch(/handed to your browser/)
        expect(text().peerAutoExportSaved).toMatch(/without other images, assets and inlays/)
        expect(text().peerAutoExportSaved).toMatch(/arrived and has finished before you press Reload/)
        expect(labels).toEqual([text().peerReload, text().peerExportFirst])
    })

    test('new behaviour: an automatic export that did not finish adds the did-not-finish line, not the saved one, and keeps both buttons', async () => {
        const { ui } = newUi({ exportAvailable: true })
        void ui.decide(node({ autoExport: 'not-finished' }))
        await waitForSelect()
        const { title, labels } = selectParts()
        expect(title).toBe(`${text().peerCommitTitle} ${text().peerNoSaveNode} ${text().peerNodeReloadDrops} ${text().peerAutoExportNotFinished}`)
        expect(title).not.toContain(text().peerAutoExportSaved)
        expect(labels).toEqual([text().peerReload, text().peerExportFirst])
    })
})

describe('parkedClean: Reload asks the loop to check before it reloads', () => {
    test('the loop is asked only after an allowed press: Keep reading, a dirty page and an unparked page ask nothing', async () => {
        const { ui, reload } = newUi()
        const check = manualCheck()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm(), check.request)
        await waitForSelect()
        await press(1)
        await vi.waitFor(() => expect(shown().type).toBe('none'))

        let state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, check.request)
        await waitForSelect()
        state = { ...state, dirty: true }
        await press(0)
        await vi.waitFor(() => expect(shown().type).toBe('none'))

        state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, check.request)
        await waitForSelect()
        state = { ...state, parked: false }
        await press(0)
        await vi.waitFor(() => expect(shown().type).toBe('none'))
        await sleep(30)
        expect(check.calls.count).toBe(0)
        expect(reload).not.toHaveBeenCalled()
    })

    test('reproducer: the wait alert shows while the loop checks, and every answer clears it; only clean reloads', async () => {
        for (const verdict of ['clean', 'dirty', 'moved'] as const) {
            const { ui, reload } = newUi()
            const check = manualCheck()
            ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm(), check.request)
            await waitForSelect()
            await press(0)
            await vi.waitFor(() => expect(shown().type).toBe('wait'))
            expect(shown().msg).toBe(text().peerChecking)
            expect(check.calls.count).toBe(1)
            expect(reload).not.toHaveBeenCalled()
            check.answer(verdict)
            await vi.waitFor(() => expect(shown().type).toBe('none'))
            await sleep(20)
            expect(reload).toHaveBeenCalledTimes(verdict === 'clean' ? 1 : 0)
        }
    })

    test('reproducer: a mark that arrived while the loop checked reloads nothing, although the answer was clean', async () => {
        const { ui, reload } = newUi()
        let state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, async () => {
            state = { ...state, dirty: true }
            return 'clean'
        })
        await waitForSelect()
        await press(0)
        await vi.waitFor(() => expect(shown().type).toBe('none'))
        await sleep(30)
        expect(reload).not.toHaveBeenCalled()
    })

    test('reproducer: a page unparked while the loop checked reloads nothing, although the answer was clean', async () => {
        const { ui, reload } = newUi()
        let state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, async () => {
            state = { ...state, parked: false }
            return 'clean'
        })
        await waitForSelect()
        await press(0)
        await vi.waitFor(() => expect(shown().type).toBe('none'))
        await sleep(30)
        expect(reload).not.toHaveBeenCalled()
    })

    test('reproducer: text typed while the loop checked asks again with the warning and reloads nothing', async () => {
        const { ui, reload } = newUi()
        let state = calm()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => state, async () => {
            state = { ...state, drafts: true }
            return 'clean'
        })
        await waitForSelect()
        await press(0)
        await vi.waitFor(() => expect(selectParts().title).toBe(text().peerCleanCommitDrafts))
        expect(reload).not.toHaveBeenCalled()
    })

    test('Cancel on the wait alert closes it and reloads nothing, even if the loop answers clean afterwards', async () => {
        const { ui, reload } = newUi()
        const check = manualCheck()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm(), check.request)
        await waitForSelect()
        await press(0)
        await vi.waitFor(() => expect(shown().type).toBe('wait'))
        shown().onCancel?.()
        await vi.waitFor(() => expect(shown().type).toBe('none'))
        check.answer('clean')
        await sleep(30)
        expect(reload).not.toHaveBeenCalled()
    })

    test('an alert that replaced the wait alert is left on screen when the loop answers', async () => {
        const { ui, reload } = newUi()
        const check = manualCheck()
        ui.parkedClean(prompt({ unsaved: false, offers: ['reload'] }), () => calm(), check.request)
        await waitForSelect()
        await press(0)
        await vi.waitFor(() => expect(shown().type).toBe('wait'))
        alertStore.set({ type: 'error', msg: 'a save failed' })
        check.answer('dirty')
        await sleep(30)
        expect(shown()).toMatchObject({ type: 'error', msg: 'a save failed' })
        expect(reload).not.toHaveBeenCalled()
    })
})
