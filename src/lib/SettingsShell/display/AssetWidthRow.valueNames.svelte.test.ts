// @vitest-environment jsdom

/**
 * `AssetWidthRow.svelte` value control: the custom-width slider is named by the visible max-width label
 * span through `aria-labelledby`, and the three radio choices stay outside the value-control scope. Mounts
 * the REAL row with the real SliderInput; `stores.svelte` is a plain stand-in as in
 * `formControlNames.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'
import type { SettingContext } from '../../../ts/setting/types'

vi.mock(import('../../../ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return {
        DBState: state,
        MobileGUI: writable(false),
        selIdState: { selId: -1 },
    } as unknown as typeof import('../../../ts/stores.svelte')
})

import { language } from '../../../lang'
import { fieldNameProblems, unnamedControls, type FieldExpectation } from '../../a11yNames.test-helpers'
import AssetWidthRow from './AssetWidthRow.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function show(db: Record<string, unknown>): HTMLElement {
    const ctx = { db: db as unknown as Database } as SettingContext
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(AssetWidthRow, { target, props: { ctx } }))
    flushSync()
    return target
}

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

const KNOWN_UNNAMED: string[] = []

function check(target: HTMLElement, expected: FieldExpectation[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    // The slider is named by the visible span; a lost labelId would fall back to a duplicate sr-only name.
    expect(target.querySelectorAll('span.sr-only')).toHaveLength(0)
}

describe('AssetWidthRow value control is named', () => {
    test('custom width: the slider takes the max-width label', () => {
        check(show({ assetWidth: 12 }), [{ name: language.settingsShellAssetMaxWidth }])
    })

    test('unlimited width has no value control', () => {
        check(show({ assetWidth: -1 }), [])
    })
})
