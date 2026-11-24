// @vitest-environment jsdom

/**
 * `listedPersona.svelte` carries the overlay vocabulary on its real elements (W1-T7b): the identity root, the frame and header, the close
 * button and one `modal-row` button per persona, with the pick and the close unchanged. Mocks are those of `listedPersona.names.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        openPersonaList: writable(true),
        alertStore: writable({ type: 'none', msg: '' }),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/persona', () => ({ changeUserPersona: vi.fn() }))
vi.mock('src/ts/alertBack', () => ({ closeDialogForBack: vi.fn() }))

import { DBState } from 'src/ts/stores.svelte'
import { changeUserPersona } from 'src/ts/persona'
import ListedPersona from './listedPersona.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function mountList(close: () => void): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(ListedPersona, { target, props: { close } }))
    flushSync()
    return target
}

beforeEach(() => {
    vi.mocked(changeUserPersona).mockClear()
    DBState.db = { personas: [{ name: 'One', note: 'n' }, { name: 'Two', note: '' }], selectedPersona: 0 } as unknown as Database
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
})

describe('listedPersona overlay parts', () => {
    test('the root, frame, header and title nest as the vocabulary says', () => {
        const target = mountList(() => {})
        const rootEl = target.firstElementChild as HTMLElement
        expect(rootEl.getAttribute('data-part')).toBe('modal-listed-persona')
        const frame = rootEl.querySelector(':scope > [data-part="modal-frame"]')
        expect(frame).not.toBeNull()
        const header = frame!.querySelector(':scope > [data-part="modal-header"]')
        expect(header).not.toBeNull()
        expect(header!.querySelector('[data-part="modal-title"]')?.textContent).toBe(language.persona)
    })

    test('the close button is a named button and calls close', () => {
        const close = vi.fn()
        const target = mountList(close)
        const button = target.querySelector('[data-part="modal-close"]') as HTMLButtonElement
        expect(button.tagName).toBe('BUTTON')
        expect(button.getAttribute('aria-label')).toBe(language.uiCommon.close)
        button.click()
        expect(close).toHaveBeenCalledTimes(1)
    })

    test('each persona is one modal-row button, and picking a row switches the persona and closes', () => {
        const close = vi.fn()
        const target = mountList(close)
        const rows = [...target.querySelectorAll('[data-part="modal-row"]')]
        expect(rows).toHaveLength(2)
        for (const row of rows) expect(row.tagName).toBe('BUTTON')
        ;(rows[1] as HTMLButtonElement).click()
        expect(changeUserPersona).toHaveBeenCalledWith(1)
        expect(close).toHaveBeenCalledTimes(1)
    })
})
