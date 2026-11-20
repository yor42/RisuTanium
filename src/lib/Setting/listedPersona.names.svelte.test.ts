// @vitest-environment jsdom

/**
 * `listedPersona.svelte`: the header X has an accessible name, its glyph is hidden from assistive
 * technology and its hover uses a scheme token. The scrim stays `bg-black/50` (E2). Mocks are those
 * of `listedPersona.back.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import { language } from 'src/lang'
import { controlName, exposedIcons, paletteClasses, unnamedControls } from 'src/lib/a11yNames.test-helpers'

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
import ListedPersona from './listedPersona.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function mountList(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(ListedPersona, { target, props: { close: () => {} } }))
    flushSync()
    return target
}

beforeEach(() => {
    DBState.db = { personas: [{ name: 'One', note: 'n' }, { name: 'Two', note: '' }], selectedPersona: 0 } as unknown as Database
})

afterEach(() => {
    for (const component of mounted.splice(0)) {
        unmount(component)
    }
    document.body.replaceChildren()
})

describe('persona list accessible names', () => {
    test('regression reproducer: the header X is named Close and its glyph is hidden', () => {
        const target = mountList()
        expect(unnamedControls(target)).toEqual([])
        const x = target.querySelector('div.grow.flex.justify-end > button') as HTMLButtonElement
        expect(controlName(x)).toBe(language.uiCommon.close)
        expect(exposedIcons(target)).toEqual([])
    })

    test('regression reproducer: the X hover is a scheme token and only the scrim keeps a palette class', () => {
        const target = mountList()
        const x = target.querySelector('div.grow.flex.justify-end > button') as HTMLButtonElement
        expect(x.classList.contains('hover:text-textcolor')).toBe(true)
        expect(paletteClasses(target, { allow: [/^bg-black\/50$/] })).toEqual([])
    })
})
