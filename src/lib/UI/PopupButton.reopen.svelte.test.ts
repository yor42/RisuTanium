// @vitest-environment happy-dom

/**
 * Opening, closing and reopening the popup menu through the REAL
 * `PopupButton.svelte`, with the REAL `PopupList.svelte` mounted the way
 * `App.svelte` mounts it (only while `popupStore.children` is set).
 *
 * Invariants pinned here:
 *  - one tap on the menu button opens the popup again after the popup was
 *    closed by a click on an item inside it;
 *  - one tap on the menu button opens the popup again after the popup was
 *    closed by a click outside it;
 *  - a tap on the menu button while the popup is open closes it.
 *
 * The test "guard: a tap while the popup is open closes it" passes with or
 * without the fix and pins behaviour that must be preserved.
 */

import { createRawSnippet, flushSync, mount, unmount, untrack } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
}) as unknown as typeof import('src/ts/util'))

// Shaped like `popupStore` in `src/ts/stores.svelte.ts`.
vi.mock(import('src/ts/stores.svelte'), () => {
    const popupStore = $state({
        children: null as null | import('svelte').Snippet,
        mouseX: 0,
        mouseY: 0,
        openId: 0,
    })
    return { popupStore } as unknown as typeof import('src/ts/stores.svelte')
})

import { popupStore } from 'src/ts/stores.svelte'
import PopupButton from './PopupButton.svelte'
import PopupList from './PopupList.svelte'

const itemSnippet = createRawSnippet(() => ({
    render: () => '<button class="popup-item">item</button>',
}))

let buttonApp: ReturnType<typeof mount> | null = null
let listApp: ReturnType<typeof mount> | null = null
let stopListHost: (() => void) | null = null

beforeEach(() => {
    const buttonTarget = document.createElement('div')
    const listTarget = document.createElement('div')
    document.body.append(buttonTarget, listTarget)
    buttonApp = mount(PopupButton, { target: buttonTarget, props: { children: itemSnippet } })

    stopListHost = $effect.root(() => {
        $effect(() => {
            const open = popupStore.children !== null
            untrack(() => {
                if (open && listApp === null) {
                    listApp = mount(PopupList, { target: listTarget })
                } else if (!open && listApp !== null) {
                    void unmount(listApp)
                    listApp = null
                }
            })
        })
    })
    flushSync()
})

afterEach(() => {
    stopListHost?.()
    stopListHost = null
    if (listApp !== null) {
        void unmount(listApp)
        listApp = null
    }
    if (buttonApp !== null) {
        void unmount(buttonApp)
        buttonApp = null
    }
    document.body.replaceChildren()
    popupStore.children = null
    popupStore.openId = 0
})

/**
 * Lets every pending timer and promise continuation run, then flushes the DOM.
 * `PopupList` registers its outside-click listener a timer after it mounts, so
 * the wait must outlast that timer before the next click.
 */
async function settle(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 60))
    flushSync()
}

function menuButton(): HTMLElement {
    const button = document.querySelector<HTMLElement>('.button-icon-menu')
    expect(button, 'the menu button').not.toBeNull()
    return button!
}

async function tapMenu(): Promise<void> {
    menuButton().click()
    await settle()
}

const isOpen = () => popupStore.children !== null

describe('the popup menu button', () => {
    test('opens the popup again with one tap after an item inside the popup was clicked', async () => {
        await tapMenu()
        expect(isOpen(), 'opened by the first tap').toBe(true)

        const item = document.querySelector<HTMLElement>('.popup-item')
        expect(item, 'the popup item').not.toBeNull()
        item!.click()
        await settle()
        expect(isOpen(), 'closed by the click on the item').toBe(false)

        await tapMenu()

        expect(isOpen(), 'open after one tap on the menu button').toBe(true)
    })

    test('guard: a tap while the popup is open closes it', async () => {
        await tapMenu()
        expect(isOpen(), 'opened by the first tap').toBe(true)

        await tapMenu()

        expect(isOpen(), 'open after the second tap').toBe(false)
        expect(popupStore.openId, 'openId after the second tap').toBe(0)
    })

    test('opens the popup again with one tap after a click outside the popup', async () => {
        await tapMenu()
        expect(isOpen(), 'opened by the first tap').toBe(true)

        document.body.click()
        await settle()
        expect(isOpen(), 'closed by the click outside').toBe(false)

        await tapMenu()

        expect(isOpen(), 'open after one tap on the menu button').toBe(true)
    })
})
