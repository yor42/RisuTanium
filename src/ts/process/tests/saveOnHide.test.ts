import { describe, expect, test, vi } from 'vitest'

// The installer takes its collaborators as arguments; this keeps the page's save loop out of the module graph.
vi.mock('src/ts/globalApi.svelte', () => ({ requestSaveNow: vi.fn() }))

import { installSaveOnHide, type SaveOnHideDeps } from 'src/ts/process/saveOnHide'
import type { InFlightKind } from 'src/ts/process/inFlightWork'
import type { ActiveStream } from 'src/ts/process/activeStreams'

function setup(options: { kinds?: InFlightKind[], streams?: ActiveStream[], visibility?: 'visible' | 'hidden' } = {}) {
    const doc = new EventTarget() as EventTarget & { visibilityState: 'visible' | 'hidden' }
    doc.visibilityState = options.visibility ?? 'hidden'
    const win = new EventTarget()
    const calls: string[] = []
    const deps: SaveOnHideDeps = {
        doc: doc as unknown as SaveOnHideDeps['doc'],
        win: win as unknown as SaveOnHideDeps['win'],
        kinds: () => options.kinds ?? ['chat'],
        streams: () => options.streams ?? [],
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

    test.each([[[]], [['tts', 'image']], [['request', 'busy']]] as const)('does nothing without a chat in flight (%j)', (kinds) => {
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

    test('the returned function removes both listeners', () => {
        const { doc, win, deps, uninstall } = setup({ streams: [{ chaId: 'a', replyChatId: 'r1' }] })

        uninstall()
        doc.dispatchEvent(new Event('visibilitychange'))
        win.dispatchEvent(new Event('pagehide'))

        expect(deps.saveNow).not.toHaveBeenCalled()
    })
})
