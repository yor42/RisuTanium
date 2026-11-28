// @vitest-environment jsdom

/**
 * The off switch of a registry slider remembers its number under the active preset's id and index. A delete of the active preset at index 0
 * keeps the index but changes the id, so the toggle restores the range minimum, never the deleted preset's number. A preset without an id
 * remembers nothing. MOCKED: `stores.svelte` as a `$state` stand-in for `DBState`; the slider and its checkbox are real.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { SettingContext, SettingItem } from 'src/ts/setting/types'

vi.mock(import('src/ts/alert'), () => ({
    alertMd: vi.fn(),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state, selIdState: { state: -1 } } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/platform', () => ({
    isMobile: false,
    isTauri: false,
    isNodeServer: false,
}))

import { DBState } from 'src/ts/stores.svelte'
import SettingSlider from './SettingSlider.svelte'

const ctx = {} as unknown as SettingContext
const item: SettingItem = {
    id: 'test.off', type: 'slider', labelKey: 'frequencyPenalty', bindKey: 'frequencyPenalty',
    options: { min: 0, max: 200, step: 1, disableable: true },
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

function setup(presets: Array<{ id?: string }>) {
    DBState.db = { frequencyPenalty: 50, botPresets: presets, botPresetsId: 0 } as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(SettingSlider, { target, props: { item, ctx } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return () => target.querySelector<HTMLInputElement>('input[type="checkbox"]')!
}

const db = () => DBState.db as unknown as { frequencyPenalty: number, botPresets: Array<{ id?: string }>, botPresetsId: number }

beforeEach(() => { DBState.db = {} as unknown as Database })
afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('SettingSlider off switch memory', () => {
    test('regression reproducer: off then on restores the number for the same active preset', () => {
        const box = setup([{ id: 'p0' }, { id: 'p1' }])
        box().click()
        flushSync()
        expect(db().frequencyPenalty).toBe(-1000)
        box().click()
        flushSync()
        expect(db().frequencyPenalty).toBe(50)
    })

    test('compatibility guard (mutant: id left out of the token): the active preset replaced under an unchanged index restores the minimum', () => {
        const box = setup([{ id: 'p0' }, { id: 'p1' }])
        box().click()
        flushSync()
        db().botPresets = [{ id: 'p1' }]
        db().frequencyPenalty = -1000
        flushSync()
        box().click()
        flushSync()
        expect(db().frequencyPenalty).toBe(0)
    })

    test('compatibility guard: a preset without an id remembers nothing', () => {
        const box = setup([{}])
        box().click()
        flushSync()
        box().click()
        flushSync()
        expect(db().frequencyPenalty).toBe(0)
    })
})
