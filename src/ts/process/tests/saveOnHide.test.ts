import { describe, expect, test, vi } from 'vitest'

// The installer takes its collaborators as arguments; this keeps the page's save loop out of the module graph.
vi.mock('src/ts/globalApi.svelte', () => ({ requestSaveNow: vi.fn(), hasUnsavedSaveMarks: vi.fn(() => false) }))

import { flushBeforeLeaving, flushPageBeforeLeaving, installSaveOnHide, type FlushDeps, type SaveOnHideDeps } from 'src/ts/process/saveOnHide'
import { hasUnsavedSaveMarks, requestSaveNow } from 'src/ts/globalApi.svelte'
import { beginInFlight, resetInFlightForTest } from 'src/ts/process/inFlightWork'
import type { InFlightKind } from 'src/ts/process/inFlightWork'
import type { ActiveStream } from 'src/ts/process/activeStreams'

function setup(options: { kinds?: InFlightKind[], streams?: ActiveStream[], visibility?: 'visible' | 'hidden', unsaved?: boolean } = {}) {
    const doc = new EventTarget() as EventTarget & { visibilityState: 'visible' | 'hidden' }
    doc.visibilityState = options.visibility ?? 'hidden'
    const win = new EventTarget()
    const calls: string[] = []
    const deps: SaveOnHideDeps = {
        doc: doc as unknown as SaveOnHideDeps['doc'],
        win: win as unknown as SaveOnHideDeps['win'],
        kinds: () => options.kinds ?? ['chat'],
        streams: () => options.streams ?? [],
        unsaved: () => options.unsaved ?? false,
        mark: vi.fn((chaId: string | undefined) => { calls.push(`mark:${chaId}`) }),
        saveNow: vi.fn(() => { calls.push('saveNow') }),
    }
    const uninstall = installSaveOnHide(deps)
    return { doc, win, deps, calls, uninstall }
}

describe('the hide trigger', () => {
    test('marks every active stream and its group member, then saves at once, when the page is hidden', () => {
        const { doc, calls } = setup({ streams: [
            { chaId: 'group', memberChaId: 'member', replyChatId: 'r1' },
            { chaId: 'solo', replyChatId: 'r2' },
        ] })

        doc.dispatchEvent(new Event('visibilitychange'))

        expect(calls).toEqual(['mark:group', 'mark:member', 'mark:solo', 'mark:undefined', 'saveNow'])
    })

    test('also acts on pagehide', () => {
        const { win, deps } = setup({ streams: [{ chaId: 'a', replyChatId: 'r1' }] })

        win.dispatchEvent(new Event('pagehide'))

        expect(deps.saveNow).toHaveBeenCalledTimes(1)
        expect(deps.mark).toHaveBeenCalledWith('a')
    })

    test('does nothing when the page becomes visible', () => {
        const { doc, deps } = setup({ visibility: 'visible', streams: [{ chaId: 'a', replyChatId: 'r1' }] })

        doc.dispatchEvent(new Event('visibilitychange'))

        expect(deps.saveNow).not.toHaveBeenCalled()
        expect(deps.mark).not.toHaveBeenCalled()
    })

    test.each([[[]], [['tts', 'image']], [['request', 'busy']]] as const)('does nothing without a chat in flight and without an unsaved edit (%j)', (kinds) => {
        const { doc, win, deps } = setup({ kinds: [...kinds], streams: [{ chaId: 'a', replyChatId: 'r1' }] })

        doc.dispatchEvent(new Event('visibilitychange'))
        win.dispatchEvent(new Event('pagehide'))

        expect(deps.saveNow).not.toHaveBeenCalled()
        expect(deps.mark).not.toHaveBeenCalled()
    })

    test('with a chat in flight but no stream yet (prompt building), it still saves now and marks nothing', () => {
        const { doc, deps } = setup({ kinds: ['chat'], streams: [] })

        doc.dispatchEvent(new Event('visibilitychange'))

        expect(deps.mark).not.toHaveBeenCalled()
        expect(deps.saveNow).toHaveBeenCalledTimes(1)
    })

    test('both events together ask for the save twice, which the latch makes one save', () => {
        const { doc, win, deps } = setup({ streams: [{ chaId: 'a', replyChatId: 'r1' }] })

        doc.dispatchEvent(new Event('visibilitychange'))
        win.dispatchEvent(new Event('pagehide'))

        expect(deps.saveNow).toHaveBeenCalledTimes(2)
    })

    test('with no chat in flight, an unsaved edit is saved at once on visibilitychange and marks nothing (reproducer)', () => {
        const { doc, deps } = setup({ kinds: [], unsaved: true })

        doc.dispatchEvent(new Event('visibilitychange'))

        expect(deps.saveNow).toHaveBeenCalledTimes(1)
        expect(deps.mark).not.toHaveBeenCalled()
    })

    test('with no chat in flight, an unsaved edit is saved at once on pagehide and marks nothing (reproducer)', () => {
        const { win, deps } = setup({ kinds: [], unsaved: true })

        win.dispatchEvent(new Event('pagehide'))

        expect(deps.saveNow).toHaveBeenCalledTimes(1)
        expect(deps.mark).not.toHaveBeenCalled()
    })

    test('with no chat in flight and no unsaved edit, neither event asks for a save (guard)', () => {
        const { doc, win, deps } = setup({ kinds: [], unsaved: false })

        doc.dispatchEvent(new Event('visibilitychange'))
        win.dispatchEvent(new Event('pagehide'))

        expect(deps.saveNow).not.toHaveBeenCalled()
        expect(deps.mark).not.toHaveBeenCalled()
    })

    test('with an unsaved edit but the page becoming visible, nothing is requested (guard)', () => {
        const { doc, deps } = setup({ kinds: [], unsaved: true, visibility: 'visible' })

        doc.dispatchEvent(new Event('visibilitychange'))

        expect(deps.saveNow).not.toHaveBeenCalled()
    })

    test('a chat in flight keeps its own branch whether or not an edit is unsaved (guard)', () => {
        const { doc, deps } = setup({ kinds: ['chat'], unsaved: false, streams: [{ chaId: 'a', replyChatId: 'r1' }] })

        doc.dispatchEvent(new Event('visibilitychange'))

        expect(deps.mark).toHaveBeenCalledWith('a')
        expect(deps.saveNow).toHaveBeenCalledTimes(1)
    })

    test('a chat in flight on a page with an unsaved edit still marks its streams before the request (guard)', () => {
        const { doc, calls } = setup({ kinds: ['chat'], unsaved: true, streams: [{ chaId: 'a', replyChatId: 'r1' }] })

        doc.dispatchEvent(new Event('visibilitychange'))

        expect(calls).toEqual(['mark:a', 'mark:undefined', 'saveNow'])
    })

    test('the returned function removes both listeners', () => {
        const { doc, win, deps, uninstall } = setup({ streams: [{ chaId: 'a', replyChatId: 'r1' }] })

        uninstall()
        doc.dispatchEvent(new Event('visibilitychange'))
        win.dispatchEvent(new Event('pagehide'))

        expect(deps.saveNow).not.toHaveBeenCalled()
    })
})

describe('the flush shared with the Back press', () => {
    function flushDeps(options: { kinds: InFlightKind[], unsaved: boolean, streams?: ActiveStream[] }): FlushDeps & { calls: string[] } {
        const calls: string[] = []
        return {
            calls,
            kinds: () => options.kinds,
            streams: () => options.streams ?? [],
            unsaved: () => options.unsaved,
            mark: (chaId) => { calls.push(`mark:${chaId}`) },
            saveNow: () => { calls.push('saveNow') },
        }
    }

    test('with a chat in flight it marks the streams, then saves, even on a page without unsaved edits', () => {
        const deps = flushDeps({ kinds: ['chat'], unsaved: false, streams: [{ chaId: 'a', replyChatId: 'r1' }] })

        flushBeforeLeaving(deps)

        expect(deps.calls).toEqual(['mark:a', 'mark:undefined', 'saveNow'])
    })

    test('with unsaved edits and no chat it saves and marks nothing', () => {
        const deps = flushDeps({ kinds: [], unsaved: true })

        flushBeforeLeaving(deps)

        expect(deps.calls).toEqual(['saveNow'])
    })

    test('a clean page with no chat is not asked to save, because the request itself would mark it dirty', () => {
        const deps = flushDeps({ kinds: ['tts'], unsaved: false })

        flushBeforeLeaving(deps)

        expect(deps.calls).toEqual([])
    })
})

describe('the page flush wiring used by the Back press', () => {
    test('a clean page with no chat in flight requests no save', () => {
        resetInFlightForTest()
        vi.mocked(requestSaveNow).mockClear()
        vi.mocked(hasUnsavedSaveMarks).mockReturnValue(false)

        flushPageBeforeLeaving()

        expect(requestSaveNow).not.toHaveBeenCalled()
    })

    test('a page with unsaved marks requests one save', () => {
        resetInFlightForTest()
        vi.mocked(requestSaveNow).mockClear()
        vi.mocked(hasUnsavedSaveMarks).mockReturnValue(true)

        flushPageBeforeLeaving()
        vi.mocked(hasUnsavedSaveMarks).mockReturnValue(false)

        expect(requestSaveNow).toHaveBeenCalledTimes(1)
    })

    test('a chat in flight requests a save even on a clean page', () => {
        resetInFlightForTest()
        vi.mocked(requestSaveNow).mockClear()
        vi.mocked(hasUnsavedSaveMarks).mockReturnValue(false)
        const end = beginInFlight('chat')

        flushPageBeforeLeaving()
        end()

        expect(requestSaveNow).toHaveBeenCalledTimes(1)
    })
})
