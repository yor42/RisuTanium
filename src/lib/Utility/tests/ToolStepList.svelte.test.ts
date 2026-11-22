// @vitest-environment jsdom

/**
 * The tool-step list of the Utility screen. (R) = regression reproducer; (G) = guard.
 *
 * REAL: the component and the language table. Nothing is mocked: the list only renders the steps it is given.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test } from 'vitest'
import { language } from 'src/lang'
import type { ToolStep } from 'src/ts/process/request/toolLoop'
import ToolStepList from '../ToolStepList.svelte'

const RLO = String.fromCharCode(0x202E)
const mounted: Array<{ instance: object, target: HTMLElement }> = []

function open(steps: ToolStep[]): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(ToolStepList, { target, props: { steps } })
    mounted.push({ instance, target })
    flushSync()
    return target
}

afterEach(() => {
    for (const { instance, target } of mounted.splice(0)) {
        void unmount(instance)
        target.remove()
    }
})

const all = (root: HTMLElement, id: string) => [...root.querySelectorAll(`[data-testid="${id}"]`)]

describe('ToolStepList', () => {
    test('(G) a run without steps renders nothing', () => {
        expect(open([]).querySelector('[data-testid="tool-step-list"]')).toBeNull()
    })

    test('(G) each step shows its tool, its outcome in words and its target', () => {
        const root = open([
            { name: 'read_file', summary: 'notes/a.md', outcome: 'ran' },
            { name: 'delete_file', summary: 'b.md', outcome: 'denied' },
            { name: 'write_file', summary: 'c.md', outcome: 'refused' },
            { name: 'edit_file', summary: 'd.md', outcome: 'error' },
            { name: 'move_file', summary: 'e.md -> f.md', outcome: 'stopped' },
        ])

        expect(all(root, 'tool-step-name').map(node => node.textContent)).toEqual(['read_file', 'delete_file', 'write_file', 'edit_file', 'move_file'])
        expect(all(root, 'tool-step-outcome').map(node => node.textContent)).toEqual(
            ['ran', 'denied', 'refused', 'error', 'stopped'].map(key => language.utility.steps.outcome[key as keyof typeof language.utility.steps.outcome]),
        )
        expect(all(root, 'tool-step-target').map(node => node.textContent)).toEqual(['notes/a.md', 'b.md', 'c.md', 'd.md', 'e.md -> f.md'])
    })

    test('(R) a hostile path and tool name render as text, never as markup', () => {
        const hostile = `<img src=x onerror="window.pwned=1"><b>bold</b>${RLO}evil.md`
        const root = open([{ name: '<script>alert(1)</script>', summary: hostile, outcome: 'ran' }])

        expect(root.querySelector('img')).toBeNull()
        expect(root.querySelector('b')).toBeNull()
        expect(root.querySelector('script')).toBeNull()
        expect(all(root, 'tool-step-target')[0].textContent).toBe(hostile)
        expect(all(root, 'tool-step-name')[0].textContent).toBe('<script>alert(1)</script>')
    })

    test('(G) the model-supplied texts sit in bidi isolation elements', () => {
        const root = open([{ name: 'read_file', summary: `a${RLO}b.md`, outcome: 'ran' }])

        expect(all(root, 'tool-step-target')[0].tagName).toBe('BDI')
        expect(all(root, 'tool-step-name')[0].tagName).toBe('BDI')
    })
})
