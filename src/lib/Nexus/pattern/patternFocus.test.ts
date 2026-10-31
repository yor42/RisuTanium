import { afterEach, describe, expect, test } from 'vitest'
import { isTopmostShell, makeInert, registerShell, returnFocus, tabbables, trapTab, watchFocus } from './patternFocus'

let host: HTMLElement

function build(html: string): HTMLElement {
    host = document.createElement('div')
    host.innerHTML = html
    document.body.appendChild(host)
    return host
}

function tab(shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
    document.activeElement?.dispatchEvent(event)
    return event
}

afterEach(() => {
    host?.remove()
})

describe('tabbables', () => {
    test('skips disabled, hidden, inert and negative-tabindex controls', () => {
        const root = build('<button id="a">a</button><button disabled>b</button><div hidden><button>c</button></div><button tabindex="-1">d</button><div inert><button>e</button></div><input id="f">')
        expect(tabbables(root).map((element) => element.id)).toEqual(['a', 'f'])
    })
})

describe('trapTab', () => {
    test('wraps forward from the last control and backward from the first', () => {
        const root = build('<button id="a">a</button><button id="b">b</button>')
        document.getElementById('b')!.focus()
        expect(trapTab(tab(), root)).toBe(true)
        expect(document.activeElement?.id).toBe('a')
        expect(trapTab(tab(true), root)).toBe(true)
        expect(document.activeElement?.id).toBe('b')
    })

    test('leaves a Tab inside the list to the browser', () => {
        const root = build('<button id="a">a</button><button id="b">b</button><button id="c">c</button>')
        document.getElementById('b')!.focus()
        const event = tab()
        expect(trapTab(event, root)).toBe(false)
        expect(event.defaultPrevented).toBe(false)
    })

    test('pulls focus in when it is outside, and holds it on the root when nothing is tabbable', () => {
        const root = build('<p>text</p>')
        root.tabIndex = -1
        const outside = document.createElement('button')
        document.body.appendChild(outside)
        outside.focus()
        expect(trapTab(new KeyboardEvent('keydown', { key: 'Tab', cancelable: true }), root)).toBe(true)
        expect(document.activeElement).toBe(root)
        outside.remove()
    })
})

describe('makeInert', () => {
    test('restores each element to the state it had, including one already inert', () => {
        const root = build('<main id="m"></main><aside id="s" inert></aside>')
        const main = root.querySelector<HTMLElement>('#m')!
        const aside = root.querySelector<HTMLElement>('#s')!
        const restore = makeInert([main, aside])
        expect(main.hasAttribute('inert')).toBe(true)
        expect(aside.hasAttribute('inert')).toBe(true)
        restore()
        expect(main.hasAttribute('inert')).toBe(false)
        expect(aside.hasAttribute('inert')).toBe(true)
    })
})

describe('returnFocus', () => {
    test('focuses a connected trigger and refuses a detached or inert one', () => {
        const root = build('<button id="t">t</button><div inert><button id="i">i</button></div>')
        expect(returnFocus(root.querySelector<HTMLElement>('#t'))).toBe(true)
        expect(returnFocus(root.querySelector<HTMLElement>('#i'))).toBe(false)
        expect(returnFocus(document.createElement('button'))).toBe(false)
        expect(returnFocus(null)).toBe(false)
    })
})

describe('watchFocus', () => {
    test('moves focus to the fallback when the focused control is removed, and stops when told to', async () => {
        const root = build('<div id="shell" tabindex="-1"><button id="a">a</button></div>')
        const shell = root.querySelector<HTMLElement>('#shell')!
        const stop = watchFocus(shell, shell)
        shell.querySelector<HTMLElement>('#a')!.focus()
        shell.querySelector('#a')!.remove()
        await Promise.resolve()
        await Promise.resolve()
        expect(document.activeElement).toBe(shell)
        stop()
        shell.innerHTML = '<button id="b">b</button>'
        shell.querySelector<HTMLElement>('#b')!.focus()
        shell.querySelector('#b')!.remove()
        await Promise.resolve()
        await Promise.resolve()
        expect(document.activeElement).not.toBe(shell)
    })

    test('does nothing while the shell is not active', async () => {
        const root = build('<div id="shell" tabindex="-1"><button id="a">a</button></div><button id="out">out</button>')
        const shell = root.querySelector<HTMLElement>('#shell')!
        const stop = watchFocus(shell, shell, () => false)
        root.querySelector<HTMLElement>('#out')!.focus()
        await Promise.resolve()
        expect(document.activeElement?.id).toBe('out')
        stop()
    })
})

describe('shell stack', () => {
    test('only the most recently registered shell is topmost', () => {
        const first = {}
        const second = {}
        const dropFirst = registerShell(first)
        const dropSecond = registerShell(second)
        expect(isTopmostShell(first)).toBe(false)
        expect(isTopmostShell(second)).toBe(true)
        dropSecond()
        expect(isTopmostShell(first)).toBe(true)
        dropFirst()
        expect(isTopmostShell(first)).toBe(false)
    })
})
