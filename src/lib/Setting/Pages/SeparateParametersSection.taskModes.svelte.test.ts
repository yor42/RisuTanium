// @vitest-environment jsdom

/**
 * T-R10 / T-R13 (#929, S1a): the classic Separate Parameters section lists one editor per parameter block and never one for
 * the per-task modes key (`taskModes`), and its checkbox writes the modes and the flag together through the shared helper.
 * The REAL section is mounted with its real Accordion and CheckInput; the block editor renders nothing here.
 *
 * Titles: `new-behaviour` fails on the pre-change base only because the fixture holds the key (the base lists every
 * container key); `reproducer` fails on the base because it writes the flag alone; `guard` passes before and after.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as Record<string, unknown> })
    return { DBState: state, selIdState: { selId: 0 } } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/lib/Others/AllSeperateParameters.svelte', () => ({ default: () => { } }))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import SeparateParametersSection from './SeparateParametersSection.svelte'

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

const MIX = { memory: 'own', emotion: 'same', translate: 'same', otherAx: 'same' }

function blocks(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { memory: { temperature: 1 }, emotion: {}, translate: {}, otherAx: {}, overrides: {}, ...extra }
}

function mountWith(db: Record<string, unknown>): HTMLElement {
    DBState.db = db as unknown as Database
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(SeparateParametersSection, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

function openSection(root: HTMLElement) {
    const outer = Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === language.seperateParameters)
    if (!outer) throw new Error('no section header')
    outer.click()
    flushSync()
}

function headers(root: HTMLElement): string[] {
    return Array.from(root.querySelectorAll('button')).map((b) => b.textContent?.trim() ?? '')
}

function checkbox(root: HTMLElement): HTMLInputElement {
    const input = root.querySelector('input[type="checkbox"]')
    if (!(input instanceof HTMLInputElement)) throw new Error('no checkbox')
    return input
}

function container(): Record<string, unknown> {
    return (DBState.db as unknown as { seperateParameters: Record<string, unknown> }).seperateParameters
}

beforeEach(() => {
    DBState.db = {} as unknown as Database
})

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('T-R10 the classic section has no taskModes editor', () => {
    test('new-behaviour: one row per container block while the flag is on and the key is present, none for the key', () => {
        const root = mountWith({ seperateParametersEnabled: true, seperateParameters: blocks({ taskModes: { ...MIX } }) })
        openSection(root)

        const names = headers(root)
        expect(names).not.toContain('taskModes')
        expect(names).toEqual([language.seperateParameters, language.longTermMemory, language.emotionImage, language.translator, language.others, 'overrides'])
    })

    test('guard: a container key that is not the modes key still gets its own labelled row', () => {
        const root = mountWith({ seperateParametersEnabled: true, seperateParameters: blocks() })
        openSection(root)

        expect(headers(root)).toContain('overrides')
    })
})

describe('T-R13 the checkbox writes modes and flag together', () => {
    test('reproducer: checking it makes all four tasks own and the flag on; unchecking makes all same and the flag off', () => {
        const root = mountWith({ seperateParametersEnabled: false, seperateParameters: blocks() })
        openSection(root)

        checkbox(root).click()
        flushSync()
        expect(container().taskModes).toEqual({ memory: 'own', emotion: 'own', translate: 'own', otherAx: 'own' })
        expect((DBState.db as unknown as Record<string, unknown>).seperateParametersEnabled).toBe(true)

        checkbox(root).click()
        flushSync()
        expect(container().taskModes).toEqual({ memory: 'same', emotion: 'same', translate: 'same', otherAx: 'same' })
        expect((DBState.db as unknown as Record<string, unknown>).seperateParametersEnabled).toBe(false)
    })

    test('guard: the checkbox shows the flag and leaves the blocks as they were', () => {
        const root = mountWith({ seperateParametersEnabled: true, seperateParameters: blocks() })
        openSection(root)
        expect(checkbox(root).checked).toBe(true)

        checkbox(root).click()
        flushSync()

        expect(container().memory).toEqual({ temperature: 1 })
        expect(checkbox(root).checked).toBe(false)
    })
})
