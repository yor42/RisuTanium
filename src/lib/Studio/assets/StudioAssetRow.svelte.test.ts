// @vitest-environment jsdom
/**
 * The row's select tick: the visible box is small, but the hit area around it is a 44 px square that toggles it, so a
 * finger anywhere in that square ticks the row. jsdom has no layout, so the guarantee is read from the structure and
 * the size classes.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('src/lang', async () => {
    const helpers = await import('src/ts/studio/studioFixtures.test-helpers')
    return { language: helpers.studioLanguageMock() }
})

import StudioAssetRow from './StudioAssetRow.svelte'

let target: HTMLElement | undefined
let component: ReturnType<typeof mount> | undefined

afterEach(() => {
    if (component) unmount(component)
    target?.remove()
    component = undefined
    target = undefined
})

function mountRow(onselect: (on: boolean) => void, selecting = true): HTMLElement {
    target = document.createElement('div')
    document.body.append(target)
    component = mount(StudioAssetRow, {
        target,
        props: {
            rowKey: 'k0', name: 'happy', ext: 'png', shown: 'thumb', size: 10, thumbUrl: '', mediaUrl: undefined, previewing: false,
            excludeShown: false, excluded: false, editable: true, menuOpen: false, renamedFrom: null, selecting, selected: false,
            oncommit: (value: string) => value, ondelete: () => {}, onpreview: () => {}, ontoggleexclude: () => {}, onmenutoggle: () => {}, onmenuclose: () => {}, onselect,
        },
    })
    flushSync()
    return target
}

describe('StudioAssetRow select tick touch target', () => {
    test('the tick sits in a hit-area label of at least 44 px in both dimensions', () => {
        const root = mountRow(() => {})
        const box = root.querySelector('[data-part="studio-asset-select"]') as HTMLInputElement
        const hit = box.closest('label') as HTMLElement
        expect(hit).not.toBeNull()
        expect(hit.dataset.part).toBe('studio-asset-select-hit')
        expect(hit.classList.contains('min-h-11')).toBe(true)
        expect(hit.classList.contains('min-w-11')).toBe(true)
        expect(hit.classList.contains('items-center')).toBe(true)
        expect(hit.classList.contains('justify-center')).toBe(true)
        expect(box.getAttribute('aria-label')).toBe('happy')
    })

    test('a click on the hit area toggles the checkbox and reports it', () => {
        const calls: boolean[] = []
        const root = mountRow((on) => calls.push(on))
        const box = root.querySelector('[data-part="studio-asset-select"]') as HTMLInputElement
        ;(box.closest('label') as HTMLElement).click()
        flushSync()
        expect(box.checked).toBe(true)
        expect(calls).toEqual([true])
    })

    test('no tick is rendered while the list is not selecting', () => {
        const root = mountRow(() => {}, false)
        expect(root.querySelector('[data-part="studio-asset-select-hit"]')).toBeNull()
    })
})
