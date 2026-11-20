import { afterEach, describe, expect, test, vi } from 'vitest'
import { ANNOUNCE_SETTLE_MS, afterFrameSettle, isTopmostShell, makeInert, onShellOpen, registerShell, returnFocus, tabbables, trapTab, watchFocus } from './patternFocus'

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

    test('keeps only the checked radio of a named group, as the browser visits it', () => {
        const root = build('<button id="a">a</button><input type="radio" name="g" id="r1"><input type="radio" name="g" id="r2" checked><input type="radio" name="g" id="r3"><button id="z">z</button>')
        expect(tabbables(root).map((element) => element.id)).toEqual(['a', 'r2', 'z'])
    })

    test('keeps the first radio of a named group when none is checked', () => {
        const root = build('<input type="radio" name="g" id="r1"><input type="radio" name="g" id="r2"><button id="z">z</button>')
        expect(tabbables(root).map((element) => element.id)).toEqual(['r1', 'z'])
    })

    test('keeps every unnamed radio and one stop per distinct group', () => {
        const root = build('<input type="radio" id="u1"><input type="radio" id="u2"><input type="radio" name="g" id="g1"><input type="radio" name="g" id="g2" checked><input type="radio" name="h" id="h1" checked><input type="radio" name="h" id="h2">')
        expect(tabbables(root).map((element) => element.id)).toEqual(['u1', 'u2', 'g2', 'h1'])
    })

    test('radios of one name in different forms are separate groups', () => {
        const root = build('<form><input type="radio" name="g" id="f1a" checked><input type="radio" name="g" id="f1b"></form><form><input type="radio" name="g" id="f2a"><input type="radio" name="g" id="f2b" checked></form>')
        expect(tabbables(root).map((element) => element.id)).toEqual(['f1a', 'f2b'])
    })

    test('a disabled checked radio does not hide the group from Tab', () => {
        const root = build('<input type="radio" name="g" id="r1"><input type="radio" name="g" id="r2" checked disabled><button id="z">z</button>')
        expect(tabbables(root).map((element) => element.id)).toEqual(['r1', 'z'])
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

    // R307-13
    test('Shift+Tab from a non-tabbable heading before the first control wraps to the last control', () => {
        const root = build('<h2 id="title" tabindex="-1">Title</h2><button id="a">a</button><button id="b">b</button>')
        document.getElementById('title')!.focus()
        expect(document.activeElement?.id).toBe('title')
        const event = tab(true)
        expect(trapTab(event, root)).toBe(true)
        expect(event.defaultPrevented).toBe(true)
        expect(document.activeElement?.id).toBe('b')
    })

    test('Shift+Tab from the checked radio of a leading named group wraps to the last control', () => {
        const root = build('<input type="radio" name="g" id="r1"><input type="radio" name="g" id="r2" checked><input type="radio" name="g" id="r3"><button id="z">z</button>')
        document.getElementById('r2')!.focus()
        const event = tab(true)
        expect(trapTab(event, root)).toBe(true)
        expect(event.defaultPrevented).toBe(true)
        expect(document.activeElement?.id).toBe('z')
    })

    test('Shift+Tab from a leading named group with none checked wraps to the last control', () => {
        const root = build('<input type="radio" name="g" id="r1"><input type="radio" name="g" id="r2"><button id="z">z</button>')
        document.getElementById('r1')!.focus()
        expect(trapTab(tab(true), root)).toBe(true)
        expect(document.activeElement?.id).toBe('z')
    })

    test('Tab from the last control wraps forward onto the checked radio of the leading group', () => {
        const root = build('<input type="radio" name="g" id="r1"><input type="radio" name="g" id="r2" checked><button id="z">z</button>')
        document.getElementById('z')!.focus()
        expect(trapTab(tab(), root)).toBe(true)
        expect(document.activeElement?.id).toBe('r2')
    })

    test('Shift+Tab from a trailing checked radio is left to the browser', () => {
        const root = build('<button id="a">a</button><input type="radio" name="g" id="r1"><input type="radio" name="g" id="r2" checked>')
        document.getElementById('r2')!.focus()
        expect(trapTab(tab(true), root)).toBe(false)
    })

    test('Shift+Tab from a non-tabbable element after the first control is left to the browser', () => {
        const root = build('<button id="a">a</button><p id="mid" tabindex="-1">mid</p><button id="b">b</button>')
        document.getElementById('mid')!.focus()
        expect(trapTab(tab(true), root)).toBe(false)
    })
})

describe('afterFrameSettle', () => {
    // R307-8
    test('runs once, one frame plus the settle after the call, not before', () => {
        vi.useFakeTimers()
        try {
            const callback = vi.fn()
            afterFrameSettle(callback)
            vi.advanceTimersByTime(ANNOUNCE_SETTLE_MS)
            expect(callback).not.toHaveBeenCalled()
            vi.advanceTimersByTime(20)
            expect(callback).toHaveBeenCalledTimes(1)
            vi.advanceTimersByTime(5000)
            expect(callback).toHaveBeenCalledTimes(1)
        } finally {
            vi.useRealTimers()
        }
    })

    test('takes its own delay, and the returned function cancels before or after the frame', () => {
        vi.useFakeTimers()
        try {
            const late = vi.fn()
            afterFrameSettle(late, 500)
            vi.advanceTimersByTime(300)
            expect(late).not.toHaveBeenCalled()
            vi.advanceTimersByTime(300)
            expect(late).toHaveBeenCalledTimes(1)

            const beforeFrame = vi.fn()
            afterFrameSettle(beforeFrame)()
            const afterFrame = vi.fn()
            const cancel = afterFrameSettle(afterFrame)
            vi.advanceTimersByTime(30)
            cancel()
            vi.advanceTimersByTime(1000)
            expect(beforeFrame).not.toHaveBeenCalled()
            expect(afterFrame).not.toHaveBeenCalled()
        } finally {
            vi.useRealTimers()
        }
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

describe('makeInert held by two layers', () => {
    // Regression reproducer: the second layer recorded the first layer's flag as the element's own state.
    test('releasing the first layer and then the second leaves nothing inert', () => {
        const root = build('<main id="x"></main>')
        const x = root.querySelector<HTMLElement>('#x')!
        const releaseA = makeInert([x])
        const releaseB = makeInert([x])
        releaseA()
        expect(x.hasAttribute('inert')).toBe(true)
        releaseB()
        expect(x.hasAttribute('inert')).toBe(false)
    })

    test('releasing the second layer first, then the first, leaves nothing inert', () => {
        const root = build('<main id="x"></main>')
        const x = root.querySelector<HTMLElement>('#x')!
        const releaseA = makeInert([x])
        const releaseB = makeInert([x])
        releaseB()
        expect(x.hasAttribute('inert')).toBe(true)
        releaseA()
        expect(x.hasAttribute('inert')).toBe(false)
    })

    test('an element that was inert before the first layer stays inert after every release', () => {
        const root = build('<aside id="s" inert></aside>')
        const s = root.querySelector<HTMLElement>('#s')!
        const releaseA = makeInert([s])
        const releaseB = makeInert([s])
        releaseA()
        releaseB()
        expect(s.hasAttribute('inert')).toBe(true)
    })

    test('a layer that holds only part of the elements releases only those', () => {
        const root = build('<main id="a"></main><main id="b"></main>')
        const a = root.querySelector<HTMLElement>('#a')!
        const b = root.querySelector<HTMLElement>('#b')!
        const releaseAll = makeInert([a, b])
        const releaseB = makeInert([b])
        releaseAll()
        expect(a.hasAttribute('inert')).toBe(false)
        expect(b.hasAttribute('inert')).toBe(true)
        releaseB()
        expect(b.hasAttribute('inert')).toBe(false)
    })

    test('releasing the same layer twice does not release another layer\'s hold', () => {
        const root = build('<main id="x"></main>')
        const x = root.querySelector<HTMLElement>('#x')!
        const releaseA = makeInert([x])
        makeInert([x])
        releaseA()
        releaseA()
        expect(x.hasAttribute('inert')).toBe(true)
    })

    test('an element listed twice in one layer is held once', () => {
        const root = build('<main id="x"></main>')
        const x = root.querySelector<HTMLElement>('#x')!
        const release = makeInert([x, x])
        release()
        expect(x.hasAttribute('inert')).toBe(false)
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

    test('onShellOpen reports each registered shell with its element until the listener is dropped', () => {
        const seen: Array<HTMLElement | undefined> = []
        const stop = onShellOpen((element) => { seen.push(element) })
        const element = document.createElement('div')
        const dropWith = registerShell({}, element)
        const dropWithout = registerShell({})
        expect(seen).toEqual([element, undefined])
        stop()
        registerShell({})()
        expect(seen.length).toBe(2)
        dropWithout()
        dropWith()
    })
})
