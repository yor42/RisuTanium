// @vitest-environment jsdom
/**
 * Every mode checkbox of the mode visibility group is named through aria-label equal to the visible mode name, and
 * keeps its aria-describedby link to the description. REAL: ModeVisibilityGroup and the homeModes rules.
 * MOCKED: `stores.svelte` (a `$state` DBState stand-in).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../ts/storage/database.svelte'
import { controlName, unnamedControls } from '../a11yNames.test-helpers'

vi.mock(import('../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('../../ts/stores.svelte')
})

import { DBState } from '../../ts/stores.svelte'
import ModeVisibilityGroup from './ModeVisibilityGroup.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('ModeVisibilityGroup form control names', () => {
    test.each([false, true])('with hiding %s every mode checkbox carries aria-label equal to its visible name', (hide) => {
        DBState.db = { visibleModes: ['rp', 'hybrid'], hideUnusedModes: hide } as unknown as Database
        const target = document.createElement('div')
        document.body.appendChild(target)
        mounted.push(mount(ModeVisibilityGroup, { target, props: { onaskshowall: vi.fn() } }))
        flushSync()
        const boxes = [...target.querySelectorAll<HTMLInputElement>('[data-part="mode-checkbox"]')]
        expect(boxes).toHaveLength(3)
        for (const box of boxes) {
            const visible = box.closest('label')!.querySelector('span.flex-col > span')!.textContent!.trim()
            expect(visible).not.toBe('')
            expect(box.getAttribute('aria-label')).toBe(visible)
            expect(controlName(box)).toBe(visible)
            expect(box.hasAttribute('aria-labelledby')).toBe(false)
            expect(box.getAttribute('aria-describedby')).not.toBeNull()
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
