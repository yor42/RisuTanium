// @vitest-environment jsdom

/**
 * The chat screenshot seam (`runChatScreenshot`): capture, merge and save on one task card with no Cancel, shared by both
 * screenshot callers. The real `exportTask` adapter, `alertTask` slot and `exportNotice` run; only the alert module
 * (spied), the stores it reads and the platform flags are replaced. The seam keeps no ending state of its own: every
 * ending is the adapter's, so a card a newer task replaced stays silent, and a card stepped aside for the Android save
 * picker ends as today's legacy notice.
 *
 * Labels: every test here is RR-m (a new module): its red evidence comes from the scratch mutants of the S6b plan.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'

const env = vi.hoisted(() => ({ isTauri: true }))
const spies = vi.hoisted(() => ({
    alertError: vi.fn(),
    alertNormal: vi.fn(),
    waitUnreadNotice: vi.fn(async () => { }),
}))

vi.mock('src/ts/alert', () => ({
    alertClear: vi.fn(),
    alertWait: vi.fn(),
    alertError: spies.alertError,
    alertNormal: spies.alertNormal,
    waitUnreadNotice: spies.waitUnreadNotice,
    alertNormalWait: vi.fn(async () => { }),
}))

vi.mock('src/ts/stores.svelte', () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}))

vi.mock('src/ts/platform', () => ({
    get isTauri() { return env.isTauri },
    isNodeServer: false,
    isIOS: () => false,
}))

vi.mock('src/ts/storage/tauriByteTransport', () => ({ isAndroidTransport: () => false }))

vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, mitm: '', createWriteStream: undefined } }))

import { runChatScreenshot, type ChatScreenshotRun } from 'src/ts/chatScreenshot'
import { alertTask, resetTaskHostForTests, setTaskClockForTests, taskHostView, taskShown } from 'src/ts/alertTask.svelte'

const PNG = new Uint8Array([1, 2, 3])
type Hook = <T>(open: () => Promise<T>) => Promise<T>

/** A clock that advances one second per read, so every report reaches the published view at once. */
function useSteppingClock(): void {
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
}

function rowsOf(count: number): Element[] {
    return Array.from({ length: count }, () => document.createElement('div'))
}

/** A run whose save resolves true without the picker hook (web and desktop). */
function runOf(overrides: Partial<ChatScreenshotRun<string>> = {}): ChatScreenshotRun<string> {
    return {
        rows: rowsOf(3),
        capture: async () => 'canvas',
        merge: () => PNG,
        save: async () => true,
        ...overrides,
    }
}

function replaceWithNewerTask(): void {
    alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })
}

beforeEach(() => {
    env.isTauri = true
    resetTaskHostForTests()
    useSteppingClock()
    spies.alertError.mockClear()
    spies.alertNormal.mockClear()
    spies.waitUnreadNotice.mockClear()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    return () => {
        resetTaskHostForTests()
        vi.restoreAllMocks()
    }
})

describe('the card', () => {
    test('SS1: one card titled "Taking a screenshot" with three steps and no Cancel; capture runs per row in order', async () => {
        const rows = rowsOf(3)
        const captured: Element[] = []
        let during: ReturnType<typeof taskHostView> = null
        await runChatScreenshot(runOf({
            rows,
            capture: async (row) => { captured.push(row); during = taskHostView(); return 'canvas' },
        }))

        expect(captured).toEqual(rows)
        expect(during?.title).toBe(language.screenshotTaskTitle)
        expect(during?.steps.map((step) => step.label)).toEqual([language.screenshotStepCapture, language.screenshotStepMerge, language.screenshotStepSave])
        expect(during?.steps[0].noun).toBe(language.chatShellMessages)
        expect(during?.cancelOffered).toBe(false)
    })

    test('SS2: each capture sees the count of the rows already captured, merge then save, and a saved run ends done with the saved notice', async () => {
        const rows = rowsOf(3)
        const counts: Array<readonly [number, number] | undefined> = []
        const stepAt: Array<number | undefined> = []
        await runChatScreenshot(runOf({
            rows,
            capture: async () => {
                const count = taskHostView()?.count
                counts.push(count === undefined ? undefined : [count.done, count.total])
                return 'canvas'
            },
            merge: () => { stepAt.push(taskHostView()?.stepIndex); return PNG },
            save: async () => { stepAt.push(taskHostView()?.stepIndex); return true },
        }))

        expect(counts).toEqual([[0, 3], [1, 3], [2, 3]])
        expect(stepAt).toEqual([1, 2])
        expect(taskHostView()?.result?.headline).toBe(language.exportTaskDone)
        expect(taskHostView()?.result?.summary).toEqual([language.screenshotSaved])
        expect(spies.alertNormal).not.toHaveBeenCalled()
    })

    test('SS2b: on the web the saved line is the download-started sentence', async () => {
        env.isTauri = false
        await runChatScreenshot(runOf())
        expect(taskHostView()?.result?.summary).toEqual([language.exportDownloadStarted])
    })

    test('SS3: a save that returns false ends silently with no card', async () => {
        await runChatScreenshot(runOf({ save: async () => false }))

        expect(taskHostView()).toBeNull()
        expect(spies.alertNormal).not.toHaveBeenCalled()
        expect(spies.alertError).not.toHaveBeenCalled()
    })
})

describe('failures', () => {
    test.each([
        ['capture', { capture: async () => { throw new Error('canvas failure') } }],
        ['merge', { merge: () => { throw new Error('canvas failure') } }],
        ['save', { save: async () => { throw new Error('canvas failure') } }],
    ] as const)('SS4: a failing %s ends a fail card headed with the screenshot error and the error text as detail', async (_name, overrides) => {
        await runChatScreenshot(runOf(overrides))

        expect(taskHostView()?.failure?.headline).toBe(language.errors.screenshotFailed)
        expect(taskHostView()?.failure?.detail).toBe('canvas failure')
        expect(console.error).toHaveBeenCalled()
        expect(spies.alertError).not.toHaveBeenCalled()
    })

    test('SS5: a card replaced during capture stays replaced; a later success or failure posts nothing', async () => {
        await runChatScreenshot(runOf({ capture: async () => { replaceWithNewerTask(); return 'canvas' } }))
        expect(taskHostView()?.title).toBe('Newer task')
        expect(spies.alertNormal).not.toHaveBeenCalled()

        resetTaskHostForTests()
        useSteppingClock()
        await runChatScreenshot(runOf({ capture: async () => { replaceWithNewerTask(); throw new Error('late') } }))
        expect(taskHostView()?.title).toBe('Newer task')
        expect(spies.alertError).not.toHaveBeenCalled()
        expect(spies.alertNormal).not.toHaveBeenCalled()
    })

    test('SS6: the seam never rejects, whatever fails', async () => {
        await expect(runChatScreenshot(runOf({ capture: async () => { throw new Error('a') } }))).resolves.toBeUndefined()
        await expect(runChatScreenshot(runOf({ merge: () => { throw new Error('b') } }))).resolves.toBeUndefined()
        await expect(runChatScreenshot(runOf({ save: async () => { throw new Error('c') } }))).resolves.toBeUndefined()
    })
})

describe('the Android save picker', () => {
    test('SS7: the card is gone while the picker is open, and a saved file ends as the legacy notice', async () => {
        let shownInPicker: boolean | undefined
        await runChatScreenshot(runOf({
            save: async (_png, aroundPicker: Hook) => {
                await aroundPicker(async () => { shownInPicker = taskShown(); return '/picked/chat.png' })
                return true
            },
        }))

        expect(shownInPicker).toBe(false)
        expect(spies.alertNormal).toHaveBeenCalledTimes(1)
        expect(spies.alertNormal).toHaveBeenCalledWith(language.screenshotSaved)
        expect(taskHostView()).toBeNull()
    })

    test('SS8: a dismissed picker ends silently with no card', async () => {
        await runChatScreenshot(runOf({
            save: async (_png, aroundPicker: Hook) => {
                const path = await aroundPicker(async () => null)
                return path !== null
            },
        }))

        expect(taskHostView()).toBeNull()
        expect(spies.alertNormal).not.toHaveBeenCalled()
        expect(spies.alertError).not.toHaveBeenCalled()
    })

    test('SS9: a write that fails after the picker posts today\'s screenshot error text and logs the error', async () => {
        const failure = new Error('synthetic write failure')
        await expect(runChatScreenshot(runOf({
            save: async (_png, aroundPicker: Hook) => {
                await aroundPicker(async () => '/picked/chat.png')
                throw failure
            },
        }))).resolves.toBeUndefined()

        expect(console.error).toHaveBeenCalledWith(failure)
        expect(spies.alertError).toHaveBeenCalledTimes(1)
        expect(spies.alertError).toHaveBeenCalledWith(language.errors.screenshotFailed)
        expect(taskHostView()).toBeNull()
    })

    test('SS10a: a card a newer task replaced before the picker stays silent when the write then fails', async () => {
        const failure = new Error('synthetic write failure')
        let newerInPicker: string | undefined
        let shownInPicker: boolean | undefined
        let before: ReturnType<typeof taskHostView> = null
        await expect(runChatScreenshot(runOf({
            merge: () => { replaceWithNewerTask(); before = taskHostView(); return PNG },
            save: async (_png, aroundPicker: Hook) => {
                await aroundPicker(async () => { newerInPicker = taskHostView()?.title; shownInPicker = taskShown(); return '/picked/chat.png' })
                throw failure
            },
        }))).resolves.toBeUndefined()

        expect(newerInPicker).toBe('Newer task')
        expect(shownInPicker).toBe(true)
        expect(spies.alertError).not.toHaveBeenCalled()
        expect(spies.alertNormal).not.toHaveBeenCalled()
        expect(console.error).toHaveBeenCalledWith(failure)
        expect(taskHostView()).toEqual(before)
    })

    test('SS10b: a card a newer task replaced before the picker stays silent when the save succeeds', async () => {
        const newer = () => taskHostView()?.title
        await runChatScreenshot(runOf({
            merge: () => { replaceWithNewerTask(); return PNG },
            save: async (_png, aroundPicker: Hook) => {
                await aroundPicker(async () => '/picked/chat.png')
                return true
            },
        }))

        expect(newer()).toBe('Newer task')
        expect(spies.alertError).not.toHaveBeenCalled()
        expect(spies.alertNormal).not.toHaveBeenCalled()
    })
})
