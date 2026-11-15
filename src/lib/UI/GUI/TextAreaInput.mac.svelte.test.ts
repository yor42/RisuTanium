// @vitest-environment jsdom
/**
 * The pop-up editor shortcut reaches `hotkeyMatches` for a press whose only modifier is the command key, so the
 * Apple chord (command plus X) can open it. `hotkeyMatches` is mocked to false so the editor wait loop never starts.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/ts/stores.svelte', () => ({
    DBState: { db: { hotkeys: [{ key: 'x', ctrl: true, action: 'popupEditor' }], longPressToPopupEditor: false } },
    disableHighlight: writable(false),
    popUpEditorStore: { open: false, value: '', mode: 'default', language: 'markdown' },
}))
vi.mock('src/ts/gui/guisize', () => ({
    textAreaSize: writable(0),
    textAreaTextSize: writable(1),
}))
vi.mock('src/ts/gui/highlight', () => ({
    highlighter: vi.fn(),
    getNewHighlightId: vi.fn(() => 1),
    removeHighlight: vi.fn(),
    AllCBS: ['random', 'randint'],
}))
vi.mock('src/ts/util', () => ({
    sleep: vi.fn(async () => {}),
}))
vi.mock('src/ts/platform', () => ({
    isMobile: false,
}))
vi.mock('src/ts/hotkey', () => ({
    hotkeyMatches: vi.fn(() => false),
}))

import { hotkeyMatches } from 'src/ts/hotkey'
import TextAreaInput from './TextAreaInput.svelte'

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    vi.clearAllMocks()
})

describe('pop-up editor with the command key', () => {
    test('a command-only keydown is offered to hotkeyMatches', () => {
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = mount(TextAreaInput as never, { target, props: { value: '', highlight: false } }) as unknown as Record<string, unknown>
        mounted.push({ target, app })
        flushSync()
        const field = target.querySelector('textarea')!
        const ev = new KeyboardEvent('keydown', { key: 'x', metaKey: true, bubbles: true, cancelable: true })
        field.dispatchEvent(ev)
        expect(hotkeyMatches).toHaveBeenCalledTimes(1)
        expect(vi.mocked(hotkeyMatches).mock.calls[0][1]).toBe(ev)
    })
})
