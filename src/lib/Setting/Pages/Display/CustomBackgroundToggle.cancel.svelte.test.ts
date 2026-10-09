// @vitest-environment happy-dom

/**
 * Closing the file chooser after switching the custom background on puts the
 * setting back off: the placeholder value written while the chooser was open is
 * reset and nothing else is written. Mounts the REAL component over the REAL
 * `selectSingleFile`; the chooser is played by `util.domPickerHarness.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installDomPicker, type DomPicker } from 'src/ts/util.domPickerHarness'

const h = vi.hoisted(() => ({
    db: { customBackground: '', allowAllExtentionFiles: false, characters: [] as unknown[] },
    begin: vi.fn(() => ({ end: vi.fn() })),
    save: vi.fn(async () => 'saved-bg'),
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: () => h.db,
    saveImage: h.save,
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/process/memory/busyActions'), () => ({ beginBusy: h.begin }) as unknown as typeof import('src/ts/process/memory/busyActions'))
vi.mock(import('src/ts/characters'), () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }) as unknown as typeof import('src/ts/characters'))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import CustomBackgroundToggle from './CustomBackgroundToggle.svelte'

let picker: DomPicker
let target: HTMLElement
let app: Record<string, unknown>

beforeEach(() => {
    picker = installDomPicker()
    h.db.customBackground = ''
    h.begin.mockClear()
    h.save.mockClear()
    target = document.createElement('div')
    document.body.appendChild(target)
    app = mount(CustomBackgroundToggle, { target, props: {} }) as unknown as Record<string, unknown>
    flushSync()
})

afterEach(async () => {
    await unmount(app as never)
    target.remove()
    picker.restore()
})

function turnOn(): void {
    const input = target.querySelector('input[type="checkbox"]') as HTMLInputElement
    input.checked = true
    input.dispatchEvent(new Event('change', { bubbles: true }))
}

describe('the custom background switch', () => {
    test('closing the chooser puts the setting back off and saves nothing', async () => {
        turnOn()
        expect(h.db.customBackground).toBe('-')

        picker.cancel()
        await new Promise((resolve) => setTimeout(resolve, 30))

        expect(h.db.customBackground).toBe('')
        expect(h.begin).not.toHaveBeenCalled()
        expect(h.save).not.toHaveBeenCalled()
    })

    test('guard: a chosen image becomes the custom background', async () => {
        turnOn()

        picker.pick([new File([Uint8Array.of(1, 2)], 'bg.png')])
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(h.db.customBackground).toBe('saved-bg')
    })
})
