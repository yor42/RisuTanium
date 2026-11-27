// @vitest-environment jsdom

/**
 * ToastHost stacking and inert behavior while a modal layer (`PatternDialog`) is open (#700):
 * the stack stays visible (not suspended) and timers stay paused, while the host element is marked `inert`,
 * lowered below `--pattern-z-layer` in CSS, and guarded against focus return while paused.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import postcss from 'postcss'
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('../../../ts/alertPrompts', () => ({ pageCovered: () => false }))
vi.mock('../../../ts/alertBack', () => ({ closeDialogForBack: () => { } }))
vi.mock('../../../ts/caughtErrors', () => ({ recordCaughtError: vi.fn() }))

import { resetBackHandlersForTests } from '../../../ts/backHandlers'
import { createToastHost, resetToastHostForTests, type ToastClock, type ToastHost } from '../../../ts/toast/toastHost.svelte'
import { modalLayerCount, holdModalLayer } from './modalLayers.svelte'
import PatternDialog from './PatternDialog.svelte'
import ToastHostView from './ToastHost.svelte'

function fakeClock(): ToastClock & { advance(ms: number): void } {
    let time = 0
    let nextKey = 1
    const timers = new Map<number, { at: number, run: () => void }>()
    return {
        now: () => time,
        after(ms, run) {
            const key = nextKey++
            timers.set(key, { at: time + ms, run })
            return () => { timers.delete(key) }
        },
        advance(ms) {
            const target = time + ms
            for (;;) {
                let next: [number, { at: number, run: () => void }] | null = null
                for (const entry of timers) {
                    if (entry[1].at <= target && (next === null || entry[1].at < next[1].at)) {
                        next = entry
                    }
                }
                if (next === null) break
                timers.delete(next[0])
                time = next[1].at
                next[1].run()
            }
            time = target
        },
    }
}

const dialogBody = createRawSnippet(() => ({
    render: () => '<div><button id="ok">OK</button><button data-pattern-initial>Cancel</button></div>',
}))

let clock: ReturnType<typeof fakeClock>
let host: ToastHost
let mountedApps: Array<ReturnType<typeof mount>> = []
let nodes: HTMLElement[] = []

function addNode<K extends keyof HTMLElementTagNameMap>(tag: K): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag)
    document.body.appendChild(node)
    nodes.push(node)
    return node
}

function mountToastHost(): void {
    const target = addNode('div')
    mountedApps.push(mount(ToastHostView, { target, props: { host } }))
    flushSync()
}

function hostRoot(): HTMLElement {
    const found = document.querySelector<HTMLElement>('[data-part="toast-host"]')
    if (found === null) throw new Error('toast host missing')
    return found
}

function mountDialog(background: readonly HTMLElement[] = []): { state: { value: boolean } } {
    const target = addNode('div')
    const state = $state({ value: false })
    mountedApps.push(mount(PatternDialog, {
        target,
        props: {
            labelId: 'dialog-label',
            background,
            get open() { return state.value },
            children: dialogBody,
        },
    }))
    flushSync()
    return { state }
}

function setOpen(state: { value: boolean }, value: boolean): void {
    state.value = value
    flushSync()
}

function toastHostStyleText(): string {
    const sveltePath = path.resolve(process.cwd(), 'src/lib/Nexus/pattern/ToastHost.svelte')
    const source = readFileSync(sveltePath, 'utf8')
    const match = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(source)
    return match ? match[1] : ''
}

function findRuleDeclarations(css: string, selectorMatch: (selector: string) => boolean, property: string): string[] {
    const values: string[] = []
    postcss.parse(css).walkRules((rule) => {
        if (rule.selectors.some(selectorMatch)) {
            rule.walkDecls(property, (decl) => {
                values.push(decl.value.trim())
            })
        }
    })
    return values
}

beforeEach(() => {
    clock = fakeClock()
    host = createToastHost({ clock })
})

afterEach(async () => {
    for (const app of mountedApps.reverse()) {
        await unmount(app)
    }
    mountedApps = []
    for (const node of nodes.splice(0)) {
        node.remove()
    }
    resetBackHandlersForTests()
    resetToastHostForTests()
    expect(modalLayerCount()).toBe(0)
})

describe('ToastHost modal stacking (#700)', () => {
    test('regression reproducer: toast host becomes inert and lowers z-index below --pattern-z-layer while a PatternDialog is open', () => {
        mountToastHost()
        host.post({ kind: 'warning', text: 'Reply stopped' })
        flushSync()

        const background = addNode('main')
        const dialog = mountDialog([background])
        setOpen(dialog.state, true)

        const root = hostRoot()
        expect(root.hasAttribute('data-paused')).toBe(true)
        expect((root as HTMLElement & { inert?: boolean }).inert === true || root.hasAttribute('inert')).toBe(true)
        expect(root.hasAttribute('data-suspended')).toBe(false)
        expect(root.style.visibility).not.toBe('hidden')

        const css = toastHostStyleText()
        const pausedZ = findRuleDeclarations(css, (sel) => sel.includes('.toast-stack[data-paused]'), 'z-index')
        expect(pausedZ).toEqual(['calc(var(--pattern-z-layer) - 1)'])

        const pausedToastPointer = findRuleDeclarations(
            css,
            (sel) => sel.includes('.toast-stack[data-paused]') && sel.includes('.toast'),
            'pointer-events',
        )
        const pausedMorePointer = findRuleDeclarations(
            css,
            (sel) => sel.includes('.toast-stack[data-paused]') && sel.includes('task-toast-more'),
            'pointer-events',
        )
        expect(pausedToastPointer).toEqual(['none'])
        expect(pausedMorePointer).toEqual(['none'])

        setOpen(dialog.state, false)
        expect(root.hasAttribute('data-paused')).toBe(false)
        expect((root as HTMLElement & { inert?: boolean }).inert === true || root.hasAttribute('inert')).toBe(false)
    })

    test('regression reproducer: removing a previously focused toast while a modal layer pauses the stack does not steal focus back to origin', () => {
        const origin = addNode('button')
        origin.textContent = 'Trigger'
        mountToastHost()
        const id = host.post({ kind: 'warning', text: 'Reply stopped' })
        flushSync()

        const dismiss = document.querySelector<HTMLButtonElement>('[data-part="toast-dismiss"]')!
        origin.focus()
        dismiss.focus()
        flushSync()
        expect(document.activeElement).toBe(dismiss)

        const release = holdModalLayer()
        try {
            flushSync()
            expect(hostRoot().hasAttribute('data-paused')).toBe(true)

            host.dismiss(id)
            flushSync()

            expect(document.activeElement).not.toBe(origin)
        } finally {
            release()
            flushSync()
        }
    })

    test('guard: toast host stays interactive and un-paused when no modal layer is open', () => {
        mountToastHost()
        host.post({ kind: 'info', text: 'Reply arrived' })
        flushSync()

        const root = hostRoot()
        expect(root.hasAttribute('data-paused')).toBe(false)
        expect((root as HTMLElement & { inert?: boolean }).inert === true || root.hasAttribute('inert')).toBe(false)

        const dismiss = document.querySelector<HTMLButtonElement>('[data-part="toast-dismiss"]')!
        dismiss.click()
        flushSync()
        expect(host.visible).toHaveLength(0)
    })
})
