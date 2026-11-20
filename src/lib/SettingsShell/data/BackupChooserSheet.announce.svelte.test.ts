// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
vi.mock('../../../ts/backHandlers', () => ({
    registerBackHandler: () => () => { },
    backCloseHandler: () => ({}),
}))

import BackupChooserSheet from './BackupChooserSheet.svelte'
import { language } from '../../../lang'
import { resetPickOpenerForTest } from '../../../ts/pickOpener'

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

describe('the backup chooser announcement', () => {
    // R307-7b
    test('the format radio keeps first focus; the announce region is empty, then holds the heading once', async () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(BackupChooserSheet, { target, props: { background: [], onanswer: () => { } } })
        flushSync()
        const live = target.querySelector<HTMLElement>('[data-part="pattern-dialog-announce"]')!
        expect(live).not.toBeNull()
        expect(document.activeElement).toBe(target.querySelector('input[type="radio"][value="rtb"]'))
        expect(live.textContent).toBe('')
        let writes = 0
        const observer = new MutationObserver((records) => { writes += records.length })
        observer.observe(live, { childList: true, characterData: true, subtree: true })
        vi.advanceTimersByTime(300)
        flushSync()
        await Promise.resolve()
        expect(live.textContent).toBe(language.settingsShellDataMakeBackup)
        vi.advanceTimersByTime(5000)
        await Promise.resolve()
        expect(live.textContent).toBe(language.settingsShellDataMakeBackup)
        expect(writes).toBe(1)
        observer.disconnect()
    })
})
