// @vitest-environment jsdom
/**
 * Chat HTML export (`exportChat` modes 2 and 3) runs on the task card without Cancel. The real `exportChat`, `exportTask`,
 * `exportNotice`, `exportWriters` and `alertTask` run; the alert module is a small store model (every write is logged and
 * `waitUnreadNotice` waits for the next `none`), the translator and `downloadFile` are driven per test, and the Android
 * picker is modelled like `saveThroughPicker`: the hook wraps exactly the picker, never the write.
 *
 * Titles marked (guard) pass before and after the change; every other row fails on an assertion against the previous
 * implementation (legacy waits, notices and `alertClear`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'
import { language } from 'src/lang'

//#region module mocks

type DownloadOptions = { aroundPicker?: <T>(open: () => Promise<T>) => Promise<T> }

const h = vi.hoisted(() => {
    const state = { type: 'none', msg: '' }
    const listeners = new Set<() => void>()
    const api = {
        state,
        alerts: [] as Array<{ type: string, msg: string }>,
        set(type: string, msg: string) {
            state.type = type
            state.msg = msg
            api.alerts.push({ type, msg })
            for (const listener of [...listeners]) listener()
        },
        async waitUnreadNotice() {
            if (['none', 'toast', 'wait', 'progress'].includes(state.type)) return
            await new Promise<void>((resolve) => {
                const listener = () => {
                    if (state.type === 'none') {
                        listeners.delete(listener)
                        resolve()
                    }
                }
                listeners.add(listener)
            })
        },
        errors: [] as string[],
        normals: [] as string[],
        selections: [] as string[],
        selectSamples: [] as unknown[],
        select: vi.fn(),
        download: vi.fn(),
        translate: vi.fn(),
        ensure: vi.fn(),
        isTauri: false,
        android: false,
        translatorType: 'llm',
        hasStubs: false,
        char: undefined as unknown,
        chat: undefined as unknown,
        db: { characters: [] } as unknown,
    }
    return api
})

/** A queue entry that makes the prompt answer with the cancel its caller offered. */
const OFFERED_CANCEL = 'offered-cancel'

vi.mock(import('./platform'), () =>
    ({
        get isTauri() { return h.isTauri },
        isNodeServer: false,
        isIOS: () => false,
    } as unknown as typeof import('./platform'))
)

vi.mock(import('./storage/tauriByteTransport'), async (importOriginal) => ({
    ...(await importOriginal()),
    isAndroidTransport: () => h.android,
}))

vi.mock(import('./storage/database.svelte'), () =>
    ({
        appVer: '1234.5.67',
        getCurrentCharacter: () => h.char,
        getCurrentChat: () => h.chat,
        getDatabase: () => h.db,
    } as unknown as typeof import('./storage/database.svelte'))
)

vi.mock(import('./globalApi.svelte'), () =>
    ({
        aiWatermarkingLawApplies: () => false,
        getFileSrc: () => Promise.resolve(''),
        readImage: () => Promise.resolve(undefined),
        downloadFile: (...args: unknown[]) => h.download(...args),
    } as unknown as typeof import('./globalApi.svelte'))
)

vi.mock(import('./stores.svelte'), () =>
    ({
        DBState: { get db() { return h.db } },
        selIdState: { selId: 0 },
        selectedCharID: writable(0),
    } as unknown as typeof import('./stores.svelte'))
)

vi.mock(import('./alert'), () =>
    ({
        alertSelect: async (msg: string[], display?: string, options?: { cancel?: string }) => {
            h.select(msg, display, options)
            h.selectSamples.push(taskHostView())
            const next = h.selections.shift() ?? '0'
            if (next === OFFERED_CANCEL) {
                return options?.cancel ?? Promise.reject(new Error('no cancel offered'))
            }
            return next
        },
        alertWait: (msg: string) => h.set('wait', msg),
        alertClear: () => h.set('none', ''),
        alertError: (msg: string | Error) => {
            const text = msg instanceof Error ? msg.message : String(msg)
            h.errors.push(text)
            h.set('error', text)
        },
        alertNormal: (msg: string) => {
            h.normals.push(msg)
            h.set('normal', msg)
        },
        alertNormalWait: async () => { },
        waitUnreadNotice: () => h.waitUnreadNotice(),
    } as unknown as typeof import('./alert'))
)

vi.mock(import('./util'), async (importOriginal) => ({
    ...(await importOriginal()),
    findCharacterbyId: () => ({ name: 'Aria' } as ReturnType<typeof import('./util').findCharacterbyId>),
    getUserName: () => 'User',
}))

vi.mock(import('./translator/translator'), () =>
    ({
        translateHTML: (v: string) => h.translate(v),
    } as unknown as typeof import('./translator/translator'))
)

vi.mock(import('./process/chatOrigin'), () =>
    ({
        originOf: () => null,
        createSendSubject: () => undefined,
    } as unknown as typeof import('./process/chatOrigin'))
)

vi.mock(import('./process/moduleEnsure'), () =>
    ({
        ensureCurrentModulesOrAlert: (...args: unknown[]) => h.ensure(...args),
        ensureModulesOrAlert: (...args: unknown[]) => h.ensure(...args),
    } as unknown as typeof import('./process/moduleEnsure'))
)

vi.mock(import('./process/moduleRefList'), () =>
    ({
        hasModuleStubs: () => h.hasStubs,
        unloadedModulesOf: () => [],
    } as unknown as typeof import('./process/moduleRefList'))
)

// Nothing here reads the node key; the module is replaced so its crypto dependency stays out of this graph.
vi.mock(import('./storage/nodeKey'), () => ({} as unknown as typeof import('./storage/nodeKey')))
vi.mock('src/ts/vendor/streamSaver', () => ({ default: { useBlobFallback: false, mitm: '', createWriteStream: undefined } }))
vi.mock(import('./process/index.svelte'), () => ({ doingChat: writable(false) } as unknown as typeof import('./process/index.svelte')))
vi.mock(import('./characterCards'), () => ({} as unknown as typeof import('./characterCards')))
vi.mock(import('./pngChunk'), () => ({} as unknown as typeof import('./pngChunk')))
vi.mock(import('./process/inlayScreen'), () => ({} as unknown as typeof import('./process/inlayScreen')))
vi.mock(import('./process/coldCharacterRestore'), () => ({} as unknown as typeof import('./process/coldCharacterRestore')))
vi.mock(import('./media/avatarThumb'), () => ({} as unknown as typeof import('./media/avatarThumb')))
vi.mock(import('./storage/characterSaveMarks'), () => ({} as unknown as typeof import('./storage/characterSaveMarks')))
vi.mock(import('./process/memory/busyActions'), () => ({} as unknown as typeof import('./process/memory/busyActions')))
vi.mock(import('./process/files/inlayCleanup'), () => ({} as unknown as typeof import('./process/files/inlayCleanup')))
vi.mock(import('./media'), () => ({} as unknown as typeof import('./media')))

//#endregion

import { exportChat } from './characters'
import { withFileIncompleteSentence } from './exportWriters'
import {
    alertTask,
    resetTaskHostForTests,
    setTaskClockForTests,
    taskHostView,
    taskShown,
} from './alertTask.svelte'

const MESSAGES = 3

function useSteppingClock(): void {
    let tick = 0
    setTaskClockForTests({ now: () => (tick += 1000), setTimeout: (run, ms) => setTimeout(run, ms), clearTimeout: (timer) => clearTimeout(timer), hidden: () => false })
}

function deferred() {
    let resolve: () => void = () => { }
    const promise = new Promise<void>((done) => { resolve = done })
    return { promise, resolve }
}

async function turns(count = 20): Promise<void> {
    for (let i = 0; i < count; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Mode '2' is an HTML file and '3' an HTML embed; both ask translate ('0' translates) and persona questions. */
const run = async (selections: string[]) => {
    h.selections = selections
    await exportChat(0)
}

/** The Android download: the hook wraps exactly the picker; a write failure throws the incomplete-file error. */
function androidDownload(options: { path: string | null, writeFails?: boolean, samples: Array<{ shown: boolean, type: string, alerts: number }> }) {
    return async (_name: string, _data: Buffer, downloadOptions?: DownloadOptions) => {
        const openPicker = async () => {
            options.samples.push({ shown: taskShown(), type: h.state.type, alerts: h.alerts.length })
            return options.path
        }
        const path = downloadOptions?.aroundPicker ? await downloadOptions.aroundPicker(openPicker) : await openPicker()
        if (path === null) return false
        if (options.writeFails) throw withFileIncompleteSentence(new Error('synthetic write failure'))
        return true
    }
}

const clipboardBefore = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

beforeEach(() => {
    resetTaskHostForTests()
    useSteppingClock()
    h.state.type = 'none'
    h.state.msg = ''
    h.alerts.length = 0
    h.errors.length = 0
    h.normals.length = 0
    h.selectSamples.length = 0
    h.select.mockReset()
    h.ensure.mockReset()
    h.download.mockReset()
    h.download.mockResolvedValue(true)
    h.translate.mockReset()
    h.translate.mockImplementation(async (v: string) => v)
    h.isTauri = false
    h.android = false
    h.translatorType = 'llm'
    h.hasStubs = false
    const chat = {
        fmIndex: -1,
        message: Array.from({ length: MESSAGES }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data: `Message ${i}` })),
    }
    const char = { type: 'character', name: 'Aria', firstMessage: 'Hello there', chatPage: 0, chats: [chat], defaultVariables: '' }
    h.chat = chat
    h.char = char
    h.db = { characters: [char], globalChatVariables: {}, templateDefaultVariables: '', translatorType: 'llm' }
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.stubGlobal('ClipboardItem', class { constructor(public items: Record<string, Blob>) { } })
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write: vi.fn(async () => { }) } })
})

afterEach(() => {
    resetTaskHostForTests()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    if (clipboardBefore) Object.defineProperty(navigator, 'clipboard', clipboardBefore)
    else Reflect.deleteProperty(navigator, 'clipboard')
})

describe('HTML file export on the card', () => {
    it('CH1: one card without Cancel, the export steps, no legacy wait and no "Translating" text', async () => {
        let sampled: ReturnType<typeof taskHostView> = null
        h.download.mockImplementation(async () => { sampled = taskHostView(); return true })

        await run(['2', '1', '0'])

        expect(sampled?.title).toBe('Exporting chat')
        expect(sampled?.subtitle).toBe('Aria')
        expect(sampled?.steps.map((step) => step.label)).toEqual(['Prepare messages', language.exportStepWrite])
        expect(sampled?.steps[0].noun).toBe(language.chatShellMessages)
        expect(sampled?.cancelOffered).toBe(false)
        expect(sampled?.stepIndex).toBe(1)
        expect(h.alerts.filter((alert) => alert.type === 'wait')).toEqual([])
        expect(h.alerts.some((alert) => alert.msg.includes(language.translating))).toBe(false)
    })

    it('CH2: the count starts at 0 / n, follows each parse and reaches n / n before the write step', async () => {
        const counts: Array<{ done: number, total: number } | undefined> = []
        const steps: number[] = []
        h.translate.mockImplementation(async (v: string) => {
            counts.push(taskHostView()?.count)
            steps.push(taskHostView()?.stepIndex ?? -1)
            return v
        })

        await run(['2', '0', '0'])

        // One translation per message, then the first message of the template.
        expect(counts).toEqual([
            { done: 0, total: MESSAGES },
            { done: 1, total: MESSAGES },
            { done: 2, total: MESSAGES },
            { done: MESSAGES, total: MESSAGES },
        ])
        expect(steps).toEqual([0, 0, 0, 0])
    })

    it('CH3: saved on the web and on desktop ends on a done card and posts no legacy notice', async () => {
        await run(['2', '1', '0'])
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.result?.headline).toBe(language.exportTaskDone)
        expect(taskHostView()?.result?.summary).toEqual([language.exportDownloadStarted])
        expect(h.normals).toEqual([])

        resetTaskHostForTests()
        h.isTauri = true
        await run(['2', '1', '0'])
        expect(taskHostView()?.result?.summary).toEqual([language.successExport])
        expect(h.normals).toEqual([])
    })

    it('CH4: a dismissed picker leaves no card, no wait, no clear and no notice', async () => {
        h.download.mockResolvedValue(false)

        await run(['2', '1', '0'])

        expect(taskHostView()).toBeNull()
        expect(taskShown()).toBe(false)
        expect(h.normals).toEqual([])
        expect(h.alerts).toEqual([])
    })

    it('CH5: a failure ends as a fail card with the error text as detail and posts no alert', async () => {
        const first = new Error('synthetic message failure')
        let calls = 0
        h.translate.mockImplementation(async (v: string) => {
            if (++calls === 2) throw first
            return v
        })
        await run(['2', '0', '0'])
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.headline).toBe(language.exportTaskFailed)
        expect(taskHostView()?.failure?.detail).toBe('synthetic message failure')
        expect(console.error).toHaveBeenCalledWith(first)
        expect(h.errors).toEqual([])

        resetTaskHostForTests()
        const second = new Error('synthetic first message failure')
        calls = 0
        h.translate.mockImplementation(async (v: string) => {
            if (++calls === MESSAGES + 1) throw second
            return v
        })
        await run(['2', '0', '0'])
        expect(taskHostView()?.failure?.detail).toBe('synthetic first message failure')
        expect(h.errors).toEqual([])

        resetTaskHostForTests()
        h.translate.mockImplementation(async (v: string) => v)
        const third = withFileIncompleteSentence(new Error('synthetic write failure'))
        h.download.mockRejectedValue(third)
        await run(['2', '1', '0'])
        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toContain(language.exportFailedFileIncomplete)
        expect(console.error).toHaveBeenCalledWith(third)
        expect(h.errors).toEqual([])
    })
})

describe('HTML embed export on the card', () => {
    it('CH6: copied ends on a done card with the clipboard summary and no legacy notice', async () => {
        const write = vi.mocked(navigator.clipboard.write)
        let sampled: ReturnType<typeof taskHostView> = null
        write.mockImplementation(async () => { sampled = taskHostView() })

        await run(['3', '1', '0'])

        expect(sampled?.title).toBe('Copying chat')
        expect(sampled?.steps.map((step) => step.label)).toEqual(['Prepare messages', 'Copy to clipboard'])
        expect(sampled?.cancelOffered).toBe(false)
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.result?.summary).toEqual([language.clipboardSuccess])
        expect(h.normals).toEqual([])
    })

    it('CH7: a refused clipboard write ends as a fail card', async () => {
        vi.mocked(navigator.clipboard.write).mockRejectedValue(new Error('synthetic clipboard refusal'))

        await run(['3', '1', '0'])

        expect(taskHostView()?.state).toBe('failed')
        expect(taskHostView()?.failure?.detail).toBe('synthetic clipboard refusal')
        expect(h.errors).toEqual([])
    })
})

describe('where the card does not open', () => {
    it('CH8 (guard): modes 0 and 1 and a stop before the render show no card; the prompts see no card', async () => {
        const sampled: Array<ReturnType<typeof taskHostView>> = []
        h.download.mockImplementation(async () => { sampled.push(taskHostView()); return true })
        await run(['0'])
        await run(['1'])
        expect(sampled).toEqual([null, null])
        expect(h.normals).toHaveLength(2)

        h.db = { ...(h.db as object), translatorType: 'google' }
        h.hasStubs = true
        h.normals.length = 0
        h.ensure.mockImplementation(async () => { sampled.push(taskHostView()); return false })
        h.download.mockClear()
        await run(['2', '0', '0'])
        expect(h.ensure).toHaveBeenCalledTimes(1)
        expect(sampled).toEqual([null, null, null])
        expect(h.download).not.toHaveBeenCalled()
        expect(taskHostView()).toBeNull()

        h.selectSamples.length = 0
        for (const answers of [['2', '1', '0'], ['3', '1', '0'], ['2', OFFERED_CANCEL], ['3', '1', OFFERED_CANCEL]]) {
            // A finished run leaves its result card up; the next prompt is sampled on a clean slot.
            resetTaskHostForTests()
            await run(answers)
        }
        expect(h.selectSamples).toHaveLength(2 * 3 + 2 + 3)
        expect(h.selectSamples.every((sample) => sample === null)).toBe(true)
    })

    it('CH9: a card a newer task replaced stays silent and the newer card stays', async () => {
        const gate = deferred()
        let calls = 0
        h.translate.mockImplementation(async (v: string) => {
            if (++calls === 1) await gate.promise
            return v
        })
        const done = run(['2', '0', '0'])
        await turns()
        alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })
        gate.resolve()
        await done

        expect(taskHostView()?.title).toBe('Newer task')
        expect(h.normals).toEqual([])
        expect(h.errors).toEqual([])
    })
})

describe('a legacy alert posted by the translator', () => {
    it('CH10: the error stays the last alert write and the result waits under it', async () => {
        let calls = 0
        h.translate.mockImplementation(async (v: string) => {
            if (++calls === 2) h.set('error', 'ERR::synthetic')
            return v
        })

        await run(['2', '0', '0'])

        expect(h.alerts[h.alerts.length - 1]).toEqual({ type: 'error', msg: 'ERR::synthetic' })
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.result?.headline).toBe(language.exportTaskDone)

        resetTaskHostForTests()
        h.alerts.length = 0
        calls = 0
        await run(['3', '0', '0'])
        expect(h.alerts[h.alerts.length - 1]).toEqual({ type: 'error', msg: 'ERR::synthetic' })
        expect(taskHostView()?.state).toBe('done')
        expect(taskHostView()?.result?.summary).toEqual([language.clipboardSuccess])
    })
})

describe('the Android picker', () => {
    const samples: Array<{ shown: boolean, type: string, alerts: number }> = []

    beforeEach(() => {
        samples.length = 0
        h.isTauri = true
        h.android = true
    })

    it('CH11 (a): no card and no covering alert while the picker is open, then today\'s notice', async () => {
        h.download.mockImplementation(androidDownload({ path: 'content://chosen', samples }))

        await run(['2', '1', '0'])

        expect(samples).toEqual([{ shown: false, type: 'none', alerts: 0 }])
        expect(h.normals).toEqual([language.successExportChosenLocation])
        expect(taskHostView()).toBeNull()
    })

    it('CH11 (b): a dismissed picker leaves no card and writes nothing to the alert store afterwards', async () => {
        h.download.mockImplementation(androidDownload({ path: null, samples }))

        await run(['2', '1', '0'])

        expect(samples).toHaveLength(1)
        expect(samples[0].shown).toBe(false)
        expect(h.alerts).toHaveLength(samples[0].alerts)
        expect(taskHostView()).toBeNull()
    })

    it('CH11 (c) (guard): a failed write posts one error with the incomplete-file sentence and no card', async () => {
        h.download.mockImplementation(androidDownload({ path: 'content://chosen', writeFails: true, samples }))

        await run(['2', '1', '0'])

        expect(h.errors).toHaveLength(1)
        expect(h.errors[0]).toContain(language.exportFailedFileIncomplete)
        expect(taskHostView()).toBeNull()
    })

    it('CH11 (d): the picker waits until a translator error is read, then the notice follows', async () => {
        let calls = 0
        h.translate.mockImplementation(async (v: string) => {
            if (++calls === 2) h.set('error', 'ERR::synthetic')
            return v
        })
        h.download.mockImplementation(androidDownload({ path: 'content://chosen', samples }))

        const done = run(['2', '0', '0'])
        await turns()
        expect(samples).toHaveLength(0)
        expect(h.state).toEqual({ type: 'error', msg: 'ERR::synthetic' })
        expect(h.alerts[h.alerts.length - 1]).toEqual({ type: 'error', msg: 'ERR::synthetic' })

        h.set('none', '')
        await done

        expect(samples).toHaveLength(1)
        expect(samples[0].shown).toBe(false)
        expect(h.normals).toEqual([language.successExportChosenLocation])
    })

    it('CH11 (e): a replaced card stays silent through the picker, even when the write fails', async () => {
        const gate = deferred()
        let calls = 0
        h.translate.mockImplementation(async (v: string) => {
            if (++calls === 1) await gate.promise
            return v
        })
        h.download.mockImplementation(androidDownload({ path: 'content://chosen', writeFails: true, samples }))

        const done = run(['2', '0', '0'])
        await turns()
        alertTask({ title: 'Newer task', steps: [{ label: 'Step' }] })
        gate.resolve()
        await done

        expect(samples).toHaveLength(1)
        expect(samples[0].shown).toBe(true)
        expect(h.errors).toEqual([])
        expect(h.normals).toEqual([])
        expect(taskHostView()?.title).toBe('Newer task')
    })
})

describe('the card paints its count during a long export', () => {
    /** Each clock read advances `stepMs`; a macrotask armed before the export marks every parse it has already run before. */
    async function countsSeenByParses(selections: string[], stepMs: number) {
        let clock = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (clock += stepMs))
        let macrotaskRan = false
        setTimeout(() => { macrotaskRan = true }, 0)
        const seen: Array<{ macrotaskRan: boolean, done: number | undefined }> = []
        h.translate.mockImplementation(async (v: string) => {
            seen.push({ macrotaskRan, done: taskHostView()?.count?.done })
            return v
        })
        await run(selections)
        return seen
    }

    it('CH12: a slow HTML file export reaches a real macrotask boundary before the last message', async () => {
        const seen = await countsSeenByParses(['2', '0', '0'], 60)

        // One parse per message, then the first message of the template.
        expect(seen).toHaveLength(MESSAGES + 1)
        // Only a macrotask yield lets a timer armed before the export run while messages are still being counted.
        expect(seen.some((entry) => entry.macrotaskRan && entry.done !== undefined && entry.done < MESSAGES)).toBe(true)
    })

    it('CH13: a slow HTML embed export reaches a real macrotask boundary before the last message', async () => {
        const seen = await countsSeenByParses(['3', '0', '0'], 60)

        expect(seen).toHaveLength(MESSAGES + 1)
        expect(seen.some((entry) => entry.macrotaskRan && entry.done !== undefined && entry.done < MESSAGES)).toBe(true)
    })

    it('CH14 (guard): a fast export does not yield per message and finishes in one turn', async () => {
        const seen = await countsSeenByParses(['2', '0', '0'], 0.001)

        expect(seen).toHaveLength(MESSAGES + 1)
        expect(seen.some((entry) => entry.macrotaskRan)).toBe(false)
        expect(taskHostView()?.state).toBe('done')
    })

    it('CH15: yields that cost far more than the interval stay a small fraction of the export', async () => {
        const total = 100
        const chat = {
            fmIndex: -1,
            message: Array.from({ length: total }, (_, i) => ({ role: i % 2 === 0 ? 'user' : 'char', data: `Message ${i}` })),
        }
        h.chat = chat
        h.char = { type: 'character', name: 'Aria', firstMessage: 'Hello there', chatPage: 0, chats: [chat], defaultVariables: '' }
        h.db = { characters: [h.char], globalChatVariables: {}, templateDefaultVariables: '', translatorType: 'llm' }

        const realSetTimeout = globalThis.setTimeout
        const yieldMs = 1000
        let clock = 0
        let yields = 0
        vi.spyOn(performance, 'now').mockImplementation(() => (clock += 60))
        vi.spyOn(globalThis, 'setTimeout').mockImplementation(((handler: TimerHandler, timeout?: number) => {
            if (timeout === 0) {
                yields++
                clock += yieldMs
            }
            return realSetTimeout(handler, timeout)
        }) as typeof setTimeout)

        await run(['2', '0', '0'])

        const loopMs = clock - yields * yieldMs
        expect(yields).toBeGreaterThan(0)
        expect(yields).toBeLessThanOrEqual(loopMs / (4 * yieldMs) + 2)
        expect(taskHostView()?.state).toBe('done')
    })
})
