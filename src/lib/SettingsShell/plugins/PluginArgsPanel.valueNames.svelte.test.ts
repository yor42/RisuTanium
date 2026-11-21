// @vitest-environment jsdom

/**
 * `PluginArgsPanel.svelte` value controls: the option select, the text and number inputs and the textarea
 * of a plugin argument are named by the argument's visible label span through `aria-labelledby`; the
 * radio and checkbox arguments are outside the value-control scope. Mounts the REAL panel with the real
 * SelectInput and CheckInput over a plain `DBState` stand-in.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'
import type { RisuPlugin } from '../../../ts/plugins/plugins.svelte'

vi.mock(import('../../../ts/stores.svelte'), () => {
    const state = $state({ db: { plugins: [] } as unknown as Database })
    return { DBState: state } as unknown as typeof import('../../../ts/stores.svelte')
})

import { controlName, fieldNameProblems, unnamedControls, type FieldExpectation } from '../../a11yNames.test-helpers'
import PluginArgsPanel from './PluginArgsPanel.svelte'

const mounted: Array<ReturnType<typeof mount>> = []

function show(plugins: RisuPlugin[]): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    plugins.forEach((plugin) => {
        const holder = document.createElement('div')
        target.appendChild(holder)
        mounted.push(mount(PluginArgsPanel, { target: holder, props: { plugin } }))
    })
    flushSync()
    return target
}

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

function plugin(extra: Partial<RisuPlugin>): RisuPlugin {
    return { name: 'p', script: '', version: 3, customLink: [], enabled: true, ...extra } as unknown as RisuPlugin
}

const KNOWN_UNNAMED: string[] = []

// The native text, textarea and decimal inputs are text fields rather than value controls, so the table does
// not list them; their names are asserted here in document order.
function textFieldNames(target: HTMLElement): string[] {
    return Array.from(target.querySelectorAll('input[type="text"], textarea')).map((el) => controlName(el))
}

function check(target: HTMLElement, expected: FieldExpectation[], textNames: string[]): void {
    expect(fieldNameProblems(target, expected)).toEqual([])
    expect(textFieldNames(target)).toEqual(textNames)
    expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    // Every control is named by its visible label span; a lost labelledby would fall back to no name at all.
    expect(target.querySelectorAll('span.sr-only')).toHaveLength(0)
}

describe('PluginArgsPanel value controls are named', () => {
    test('select, text, textarea and number arguments take their argMeta label', () => {
        check(show([plugin({
            arguments: { mode: ['a', 'b'], note: 'string', body: 'string', count: 'int' },
            realArg: { mode: 'a', note: '', body: '', count: 1 },
            argMeta: {
                mode: { name: 'Mode label' },
                note: { name: 'Note label' },
                body: { name: 'Body label', textarea: true },
                count: { name: 'Count label' },
            },
        } as unknown as Partial<RisuPlugin>)]), [{ name: 'Mode label' }], ['Note label', 'Body label', 'Count label'])
    })

    test('an argument without argMeta is named by its key', () => {
        check(show([plugin({
            arguments: { mode: ['a', 'b'], count: 'int' },
            realArg: { mode: 'a', count: 1 },
        } as unknown as Partial<RisuPlugin>)]), [{ name: 'mode' }], ['count'])
    })

    test('checkbox and radio arguments sit between the value controls without a toggle pairing', () => {
        check(show([plugin({
            arguments: { first: ['a', 'b'], flag: 'int', pickS: 'string', pickN: 'int', last: 'int' },
            realArg: { first: 'a', flag: '0', pickS: 'x', pickN: 1, last: 2 },
            argMeta: {
                first: { name: 'First label' },
                flag: { name: 'Flag label', checkbox: '1' },
                pickS: { name: 'Pick S', radio: 'X|x,Y|y' },
                pickN: { name: 'Pick N', radio: 'One|1,Two|2' },
                last: { name: 'Last label' },
            },
        } as unknown as Partial<RisuPlugin>)]), [{ name: 'First label' }], ['Last label'])
    })

    test('two panels give each value control its own naming span', () => {
        const one = plugin({ arguments: { mode: ['a'] }, realArg: { mode: 'a' }, argMeta: { mode: { name: 'Mode one' } } } as unknown as Partial<RisuPlugin>)
        const two = plugin({ arguments: { mode: ['a'], count: 'int' }, realArg: { mode: 'a', count: 1 }, argMeta: { mode: { name: 'Mode two' }, count: { name: 'Count two' } } } as unknown as Partial<RisuPlugin>)
        check(show([one, two]), [{ name: 'Mode one' }, { name: 'Mode two' }], ['Count two'])
    })
})
