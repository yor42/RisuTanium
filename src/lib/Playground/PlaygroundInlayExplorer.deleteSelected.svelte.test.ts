// @vitest-environment happy-dom

/**
 * `PlaygroundInlayExplorer.svelte`'s "delete selected" button deletes exactly the assets
 * that were ticked when the confirmation was shown, even if a box is ticked while the
 * confirmation is open or while the deletion is running; such a box stays ticked.
 *
 * Mounts the REAL `PlaygroundInlayExplorer.svelte`. The inlay store is a stub that records
 * removals and can hold one open; the alert confirm is a mock the test holds open and
 * answers. Titles beginning "guard:" pin behaviour that must be preserved before and after
 * the change; every other test is a regression reproducer for the behaviour it names.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { language } from 'src/lang'

//#region module mocks

const confirms = vi.hoisted(() => {
    const pending: Array<{ message: string, settle: (answer: boolean) => void }> = []
    return {
        pending,
        ask: (message: string) => new Promise<boolean>((settle) => { pending.push({ message, settle }) }),
    }
})

const inlays = vi.hoisted(() => ({
    removed: [] as string[],
    holds: new Map<string, Promise<void>>(),
}))

vi.mock(import('src/ts/alert'), () => {
    const stub: Record<string, unknown> = {
        alertConfirm: confirms.ask,
        alertStore: writable({ type: 'none', msg: '' }),
    }
    return new Proxy(stub, {
        get: (t, k) => (k in t ? t[k as string] : k === 'then' ? undefined : vi.fn()),
        has: () => true,
    }) as unknown as typeof import('src/ts/alert')
})

vi.mock(import('src/ts/process/files/inlays'), () => ({
    listInlayAssets: vi.fn(async () => ['a1', 'a2', 'a3', 'a4'].map((id) => [id, {
        type: 'image', name: 'name-' + id, size: 1, ext: 'png', width: 1, height: 1,
    }])),
    getInlayAssetBlob: vi.fn(async () => ({ data: new Blob(['x']), ext: 'png', type: 'image', name: 'n' })),
    getInlayRender: vi.fn(async (id: string) => {
        if (id === 'a3') return null
        if (id === 'a4') return { type: 'signature', url: '', source: 'signature' }
        return { type: 'image', url: 'cache://' + id, source: 'store-url' }
    }),
    removeInlayAsset: vi.fn(async (id: string) => {
        inlays.removed.push(id)
        await inlays.holds.get(id)
    }),
}) as unknown as typeof import('src/ts/process/files/inlays'))

//#endregion

import PlaygroundInlayExplorer from './PlaygroundInlayExplorer.svelte'
import { getInlayAssetBlob, getInlayRender } from 'src/ts/process/files/inlays'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

async function mountExplorer(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PlaygroundInlayExplorer, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
    return target
}

/** The card of the asset named `id`'s display name; cards are rebuilt when their box toggles, so look it up each time. */
function box(target: HTMLElement, id: string): HTMLInputElement {
    const title = Array.from(target.querySelectorAll('p.font-medium')).find((p) => p.textContent?.trim() === 'name-' + id)
    if (!title) throw new Error('asset not shown: ' + id)
    return title.closest('div.border')!.querySelector('input[type=checkbox]') as HTMLInputElement
}

async function tick(target: HTMLElement, id: string): Promise<void> {
    box(target, id).click()
    await settle()
}

const shown = (target: HTMLElement) => Array.from(target.querySelectorAll('p.font-medium')).map((p) => p.textContent!.trim().replace('name-', ''))
const isTicked = (target: HTMLElement, id: string) => box(target, id).checked

async function clickDeleteSelected(target: HTMLElement): Promise<void> {
    const button = (Array.from(target.querySelectorAll('button')) as HTMLButtonElement[]).find((b) => b.textContent?.trim() === language.playground.inlayDeleteSelected.trim())
    if (!button) throw new Error('the delete selected button is not shown')
    button.click()
    await settle()
}

async function answer(value: boolean): Promise<void> {
    const next = confirms.pending.shift()
    if (!next) throw new Error('no confirmation is open')
    next.settle(value)
    await settle()
}

beforeEach(() => {
    vi.mocked(getInlayAssetBlob).mockClear()
    vi.mocked(getInlayRender).mockClear()
    confirms.pending.length = 0
    inlays.removed.length = 0
    inlays.holds.clear()
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('deleting the selected inlay assets', () => {
    test('guard: with nothing else changing, exactly the ticked assets are removed and the selection is cleared', async () => {
        const target = await mountExplorer()
        await tick(target, 'a1')
        await tick(target, 'a2')
        await clickDeleteSelected(target)
        expect(confirms.pending.length).toBe(1)
        await answer(true)
        expect(inlays.removed).toEqual(['a1', 'a2'])
        expect(shown(target)).toEqual(['a3', 'a4'])
        expect(target.querySelectorAll('input[type=checkbox]:checked').length).toBe(0)
    })

    test('guard: refusing the confirmation removes nothing and keeps the selection', async () => {
        const target = await mountExplorer()
        await tick(target, 'a1')
        await clickDeleteSelected(target)
        await answer(false)
        expect(inlays.removed).toEqual([])
        expect(isTicked(target, 'a1')).toBe(true)
    })

    test('a box ticked while the confirmation is open is not deleted and stays ticked', async () => {
        const target = await mountExplorer()
        await tick(target, 'a1')
        await tick(target, 'a2')
        await clickDeleteSelected(target)
        await tick(target, 'a3')
        await answer(true)
        expect(inlays.removed).toEqual(['a1', 'a2'])
        expect(shown(target)).toEqual(['a3', 'a4'])
        expect(isTicked(target, 'a3')).toBe(true)
    })

    test('a box ticked while the deletion is running is not deleted and stays ticked', async () => {
        const target = await mountExplorer()
        let release!: () => void
        inlays.holds.set('a1', new Promise<void>((resolve) => { release = resolve }))
        await tick(target, 'a1')
        await tick(target, 'a2')
        await clickDeleteSelected(target)
        await answer(true)
        expect(inlays.removed).toEqual(['a1'])
        await tick(target, 'a3')
        release()
        await settle()
        expect(inlays.removed).toEqual(['a1', 'a2'])
        expect(shown(target)).toEqual(['a3', 'a4'])
        expect(isTicked(target, 'a3')).toBe(true)
    })

    test('a preview is shown from the render cache without reading the body, and deleting it revokes no cache-owned URL', async () => {
        const revoke = vi.spyOn(URL, 'revokeObjectURL')
        const target = await mountExplorer()
        expect(vi.mocked(getInlayAssetBlob)).not.toHaveBeenCalled()
        const srcs = Array.from(target.querySelectorAll('img')).map((img) => img.getAttribute('src'))
        expect(srcs).toEqual(['cache://a1', 'cache://a2'])
        await tick(target, 'a1')
        await clickDeleteSelected(target)
        await answer(true)
        expect(inlays.removed).toEqual(['a1'])
        expect(Array.from(target.querySelectorAll('img')).map((img) => img.getAttribute('src'))).toEqual(['cache://a2'])
        expect(revoke).not.toHaveBeenCalled()
        revoke.mockRestore()
    })
})
