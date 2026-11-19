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
    save: vi.fn(async (_file: Blob) => 'saved-bg'),
    alert: vi.fn(),
    desktop: false,
    limit: 1024 * 1024,
}))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: () => h.db,
    saveImage: vi.fn(),
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    saveAssetFromBlob: h.save,
    pickedAssetLimitBytes: vi.fn(async () => h.limit),
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...await importOriginal(),
    isDesktopTransport: () => h.desktop,
}))
vi.mock(import('src/ts/alert'), async (importOriginal) => ({
    ...await importOriginal(),
    alertError: h.alert,
}))
vi.mock(import('src/ts/stores.svelte'), () => ({
    DBState: { db: h.db },
    selectedCharID: { subscribe: vi.fn() },
}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/process/memory/busyActions'), () => ({ beginBusy: h.begin }) as unknown as typeof import('src/ts/process/memory/busyActions'))
vi.mock(import('src/ts/characters'), () => ({ createBlankChar: vi.fn(), getCharImage: vi.fn() }) as unknown as typeof import('src/ts/characters'))
vi.mock('@tauri-apps/api/webviewWindow', () => ({ getCurrentWebviewWindow: vi.fn(() => ({})) }))
vi.mock('src/lib/UI/PopupList.svelte', () => ({ default: {} }))

import CustomBackgroundToggle from './CustomBackgroundToggle.svelte'
import { DESKTOP_WHOLE_READ_URL_LIMIT_BYTES } from 'src/ts/storage/assetUrlGate'
import { assetTooLargeMessage } from 'src/ts/storage/pickedAssetLimit'

let picker: DomPicker
let target: HTMLElement
let app: Record<string, unknown>

beforeEach(() => {
    picker = installDomPicker()
    h.db.customBackground = ''
    h.begin.mockClear()
    h.save.mockClear()
    h.alert.mockClear()
    h.desktop = false
    h.limit = 1024 * 1024
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

    test('regression reproducer: an image above the asset limit puts the setting back off, saves nothing and shows one notice', async () => {
        turnOn()

        const file = new File([Uint8Array.of(1, 2)], 'huge.png')
        Object.defineProperty(file, 'size', { value: 1024 * 1024 + 1 })
        picker.pick([file])
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(h.db.customBackground).toBe('')
        expect(h.begin).not.toHaveBeenCalled()
        expect(h.save).not.toHaveBeenCalled()
        expect(h.alert).toHaveBeenCalledTimes(1)
        expect(h.alert).toHaveBeenCalledWith('"huge.png" is larger than the 1 MB limit, so it was not added.')
    })

    test('regression reproducer: on desktop an image of 1024 MiB is refused although the store limit allows it', async () => {
        h.desktop = true
        h.limit = 1024 * 1024 * 1024
        turnOn()

        const file = new File([Uint8Array.of(1, 2)], 'huge.png')
        Object.defineProperty(file, 'size', { value: 1024 * 1024 * 1024 })
        picker.pick([file])
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(h.save).not.toHaveBeenCalled()
        expect(h.db.customBackground).toBe('')
    })

    test('rule: the desktop refusal names the file and the display limit and starts no save', async () => {
        h.desktop = true
        h.limit = 1024 * 1024 * 1024
        turnOn()

        const file = new File([Uint8Array.of(1, 2)], 'huge.png')
        Object.defineProperty(file, 'size', { value: DESKTOP_WHOLE_READ_URL_LIMIT_BYTES + 1 })
        picker.pick([file])
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(h.alert).toHaveBeenCalledTimes(1)
        expect(h.alert).toHaveBeenCalledWith(assetTooLargeMessage(['huge.png'], DESKTOP_WHOLE_READ_URL_LIMIT_BYTES))
        expect(h.db.customBackground).toBe('')
        expect(h.begin).not.toHaveBeenCalled()
    })

    test('guard: off desktop an image of 1024 MiB is saved when the store limit allows it', async () => {
        h.desktop = false
        h.limit = 1024 * 1024 * 1024
        turnOn()

        const file = new File([Uint8Array.of(1, 2)], 'big.png')
        Object.defineProperty(file, 'size', { value: 1024 * 1024 * 1024 })
        picker.pick([file])
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(h.save).toHaveBeenCalledWith(file)
        expect(h.db.customBackground).toBe('saved-bg')
    })

    test('guard: on desktop an image of exactly the display limit is saved', async () => {
        h.desktop = true
        h.limit = 1024 * 1024 * 1024
        turnOn()

        const file = new File([Uint8Array.of(1, 2)], 'edge.png')
        Object.defineProperty(file, 'size', { value: DESKTOP_WHOLE_READ_URL_LIMIT_BYTES })
        picker.pick([file])
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(h.save).toHaveBeenCalledWith(file)
        expect(h.db.customBackground).toBe('saved-bg')
    })

    test('guard: a chosen image becomes the custom background', async () => {
        turnOn()

        const file = new File([Uint8Array.of(1, 2)], 'bg.png')
        picker.pick([file])
        await new Promise((resolve) => setTimeout(resolve, 300))

        expect(h.save).toHaveBeenCalledWith(file)
        expect(h.db.customBackground).toBe('saved-bg')
    })
})
