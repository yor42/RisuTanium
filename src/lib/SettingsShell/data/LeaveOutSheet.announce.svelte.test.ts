// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
vi.mock('../../../ts/backHandlers', () => ({
    registerBackHandler: () => () => { },
    backCloseHandler: () => ({}),
}))

import LeaveOutSheet from './LeaveOutSheet.svelte'
import { leaveOutSheetDef } from '../../../ts/setting/dataLeaveOutSheet'
import { resetPickOpenerForTest } from '../../../ts/pickOpener'
import type { BinLeaveOutEntry } from '../../../ts/drive/binLeaveOut'

const entries: BinLeaveOutEntry[] = [
    { kind: 'taskPresets', count: 2, names: ['Summarize', 'Translate'] },
    { kind: 'usageStats', count: 1 },
]

let target: HTMLElement
let app: Record<string, unknown>

beforeEach(() => {
    resetPickOpenerForTest()
    vi.useFakeTimers()
})

afterEach(async () => {
    await unmount(app)
    target.remove()
    vi.useRealTimers()
})

describe('the leave-out sheet announcement', () => {
    // R307-7
    test('Cancel is focused, and the announce region inside the alertdialog is empty, then holds the opening once', async () => {
        const def = leaveOutSheetDef(entries)
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(LeaveOutSheet, { target, props: { def, background: [], onanswer: () => { } } })
        flushSync()
        const dialog = target.querySelector<HTMLElement>('[role="alertdialog"]')!
        const live = dialog.querySelector<HTMLElement>('[data-part="pattern-dialog-announce"]')!
        expect(live).not.toBeNull()
        expect(document.activeElement).toBe(target.querySelector('[data-part="pattern-warn-cancel"]'))
        expect(live.textContent).toBe('')
        let writes = 0
        const observer = new MutationObserver((records) => { writes += records.length })
        observer.observe(live, { childList: true, characterData: true, subtree: true })
        vi.advanceTimersByTime(300)
        flushSync()
        await Promise.resolve()
        const text = live.textContent ?? ''
        expect(text.startsWith(def.headline)).toBe(true)
        expect(text).toContain(def.consequences![0])
        vi.advanceTimersByTime(5000)
        await Promise.resolve()
        expect(live.textContent).toBe(text)
        expect(writes).toBe(1)
        observer.disconnect()
    })
})
