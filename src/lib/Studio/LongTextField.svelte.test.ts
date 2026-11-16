// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { flushStudioFields } from '../../ts/studio/fieldFlush'
import type { StudioResult } from '../../ts/studio/history/ownerHistory.svelte'
import type { LongTextWritePort } from '../../ts/studio/longText/fieldWrite'
import LongTextField from './LongTextField.svelte'

interface Fixture {
    owner: { value: string }
    writes: string[]
    results: (StudioResult | null)[]
    steps: { count: number }
    port: LongTextWritePort
}

function fixture(stored: string): Fixture {
    const owner = $state({ value: stored })
    const writes: string[] = []
    const steps = { count: 0 }
    return {
        owner,
        writes,
        results: [],
        steps,
        port: {
            read: () => owner.value,
            write: (value) => {
                writes.push(value)
                owner.value = value
                return { ok: true }
            },
            closeStep: () => {
                steps.count += 1
            },
        },
    }
}

let mounted: ReturnType<typeof mount>[] = []
let hosts: HTMLElement[] = []

function mountField(fix: Fixture, overrides: { editable?: boolean, busy?: boolean, label?: string } = {}): { area: HTMLTextAreaElement, exported: { insertText(start: number, end: number, text: string, caret: number): void } } {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const app = mount(LongTextField, {
        target: host,
        props: {
            port: fix.port,
            part: 'studio-form-desc',
            label: overrides.label,
            kind: 'desc',
            mode: 'cbs',
            editable: overrides.editable ?? true,
            busy: overrides.busy ?? false,
            fieldClass: 'w-full',
            onresult: (result: StudioResult | null) => fix.results.push(result),
        },
    })
    mounted.push(app)
    hosts.push(host)
    flushSync()
    return { area: host.querySelector('textarea') as HTMLTextAreaElement, exported: app }
}

afterEach(async () => {
    for (const app of mounted.splice(0)) await unmount(app)
    for (const host of hosts.splice(0)) host.remove()
})

function typeInto(area: HTMLTextAreaElement, value: string, composing = false): void {
    area.value = value
    area.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: composing, inputType: composing ? 'insertCompositionText' : 'insertText' }))
}

describe('the long-text field shell', () => {
    test('shows the stored text with LF endings and marks read-only and busy', () => {
        const { area } = mountField(fixture('a\r\nb\rc'), { editable: false, busy: true })
        expect(area.value).toBe('a\nb\nc')
        expect(area.readOnly).toBe(true)
        expect(area.getAttribute('aria-busy')).toBe('true')
        expect(area.getAttribute('dir')).toBe('auto')
        expect(area.dataset.part).toBe('studio-form-desc')
    })

    test('the label names the textarea', () => {
        const { area } = mountField(fixture('x'), { label: 'Description' })
        const id = area.getAttribute('aria-labelledby') as string
        expect(document.getElementById(id)?.textContent).toBe('Description')
    })

    test('focus records the focus value', () => {
        const { area } = mountField(fixture('d0'))
        area.focus()
        expect(area.dataset.studioFocusValue).toBe('d0')
    })

    test('a non-composing input writes through the port in the stored line-ending style', () => {
        const fix = fixture('a\r\nb')
        const { area } = mountField(fix)
        typeInto(area, 'a\nbX')
        expect(fix.writes).toEqual(['a\r\nbX'])
        expect(fix.results).toEqual([{ ok: true }])
    })

    test('a composing input is held and written at compositionend', () => {
        const fix = fixture('d0')
        const { area } = mountField(fix)
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        typeInto(area, 'd0ㅎ', true)
        typeInto(area, 'd0한', true)
        expect(fix.writes).toEqual([])
        area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
        expect(fix.writes).toEqual(['d0한'])
    })

    test('focus and blur without input write nothing and close the step', () => {
        const fix = fixture('a\r\nb')
        const { area } = mountField(fix)
        area.focus()
        area.blur()
        expect(fix.writes).toEqual([])
        expect(fix.results).toEqual([])
        expect(fix.steps.count).toBe(1)
    })

    test('a registry flush writes held text', () => {
        const fix = fixture('d0')
        const { area } = mountField(fix)
        typeInto(area, 'd0한', true)
        flushStudioFields('hide')
        expect(fix.writes).toEqual(['d0한'])
    })

    test('after unmount nothing is written or closed, and the registry no longer reaches the field', async () => {
        const fix = fixture('d0')
        const { area } = mountField(fix)
        typeInto(area, 'd0한', true)
        for (const app of mounted.splice(0)) await unmount(app)
        flushStudioFields('leave')
        expect(fix.writes).toEqual([])
        expect(fix.steps.count).toBe(0)
    })

    test('insertText replaces the range through an input event and moves the caret', () => {
        const fix = fixture('hello world')
        const { area, exported } = mountField(fix)
        exported.insertText(6, 11, 'there', 11)
        expect(fix.writes).toEqual(['hello there'])
        expect(area.selectionStart).toBe(11)
        expect(area.dataset.studioFocusValue).toBe('hello there')
        expect(fix.steps.count).toBe(2)
    })

    test('insertText is ignored while read-only or composing', () => {
        const readonly = fixture('ab')
        mountField(readonly, { editable: false }).exported.insertText(0, 0, 'x', 1)
        expect(readonly.writes).toEqual([])
        const fix = fixture('ab')
        const { area, exported } = mountField(fix)
        area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
        exported.insertText(0, 0, 'x', 1)
        expect(fix.writes).toEqual([])
    })
})
