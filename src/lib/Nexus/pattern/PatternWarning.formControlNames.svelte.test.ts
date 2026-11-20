// @vitest-environment jsdom
/**
 * The acknowledgement checkbox of a warning that asks for one is named through aria-label equal to the
 * acknowledgement text beside it, and exists only when the warning asks. REAL: PatternWarning.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { controlName, unnamedControls } from '../../a11yNames.test-helpers'
import PatternWarning from './PatternWarning.svelte'
import type { PatternWarningDef } from './patternWarning'

const mounted: Array<ReturnType<typeof mount>> = []

function show(def: PatternWarningDef): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mounted.push(mount(PatternWarning as never, { target, props: { def, onanswer: () => {} } }))
    flushSync()
    return target
}

afterEach(() => {
    for (const component of mounted.splice(0)) unmount(component)
    document.body.replaceChildren()
})

describe('PatternWarning form control names', () => {
    test('the acknowledgement checkbox carries aria-label equal to the acknowledgement text and no aria-labelledby', () => {
        const target = show({ severity: 'danger', headline: 'Replace all data?', consequences: ['one'], ack: 'I understand this replaces my data', actions: { cancel: 'Cancel', primary: 'Replace' } })
        const box = target.querySelector<HTMLInputElement>('.pattern-ack-box')!
        expect(box.getAttribute('aria-label')).toBe('I understand this replaces my data')
        expect(box.hasAttribute('aria-labelledby')).toBe(false)
        expect(controlName(box)).toBe(box.closest('label')!.textContent!.trim())
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('a warning without an acknowledgement renders no checkbox', () => {
        const target = show({ severity: 'danger', headline: 'Replace all data?', consequences: ['one'], actions: { cancel: 'Cancel', primary: 'Replace' } })
        expect(target.querySelector('input[type="checkbox"]')).toBeNull()
    })
})
