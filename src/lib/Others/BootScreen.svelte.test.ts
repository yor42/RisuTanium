// @vitest-environment jsdom

/**
 * `BootScreen.svelte` with the real `bootScreen.svelte.ts` state: names are text nodes, initial focus lands where the
 * model says, an answer is discarded inside `ANSWER_GUARD_MS` of the screen appearing (and again when another screen
 * replaces it), nothing but a button answers a question (no Escape, backdrop click or history step), and an answered
 * screen stays up. Labels: new behaviour. Real timers: the guard is a wall-clock window.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, describe, expect, test, vi } from 'vitest'

// MOCKED: only the alert store `alertPrompts` reads, so the guard constant loads without the application's store graph.
vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

import { ANSWER_GUARD_MS } from 'src/ts/alertPrompts'
import { askBootScreen, getBootScreen, pressBootButton, resetBootScreenForTests, showTerminalBootScreen } from 'src/ts/storage/store2/ui/bootScreen.svelte'
import type { BootScreenModel } from 'src/ts/storage/store2/ui/bootText'
import BootScreen from './BootScreen.svelte'

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function mountScreen(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BootScreen, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    return target
}

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    resetBootScreenForTests()
})

function model(overrides: Partial<BootScreenModel> = {}): BootScreenModel {
    return {
        title: 'The title',
        paragraphs: ['A paragraph.'],
        lists: [],
        details: null,
        buttons: [{ key: 'no', label: 'No' }, { key: 'yes', label: 'Yes' }],
        focus: 'no',
        ...overrides,
    }
}

function button(target: HTMLElement, key: string): HTMLButtonElement {
    const found = target.querySelector<HTMLButtonElement>(`[data-boot-key="${key}"]`)
    if (found === null) {
        throw new Error(`No button ${key}`)
    }
    return found
}

const afterGuard = () => new Promise<void>((resolve) => setTimeout(resolve, ANSWER_GUARD_MS + 40))

async function settled(promise: Promise<unknown>): Promise<'pending' | 'resolved'> {
    return Promise.race([promise.then(() => 'resolved' as const), new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 20))])
}

describe('what is rendered', () => {
    test('names are text nodes: markup, separators and newlines in a name are shown as typed and nothing is parsed', () => {
        const target = mountScreen()
        const names = ['a || b', '<b>bold</b><img src=x onerror=alert(1)>', 'line one\nline two']
        void askBootScreen(model({ lists: [{ heading: 'Heading', items: names }] }))
        flushSync()

        const items = [...target.querySelectorAll('li')]
        expect(items.map((item) => item.textContent)).toEqual(names)
        expect(target.querySelectorAll('b, img')).toHaveLength(0)
        expect(target.querySelector('h2')?.textContent).toBe('Heading')
    })

    test('a long list is rendered whole', () => {
        const target = mountScreen()
        const items = Array.from({ length: 300 }, (_, index) => `name ${index}`)
        void askBootScreen(model({ lists: [{ heading: null, items }] }))
        flushSync()

        expect(target.querySelectorAll('li')).toHaveLength(300)
        expect(target.querySelector('h2')).toBeNull()
    })

    test('title, paragraphs and details appear, and the buttons are in model order', () => {
        const target = mountScreen()
        void askBootScreen(model({ paragraphs: ['One', 'Two'], details: 'Details: x: y' }))
        flushSync()

        expect(target.querySelector('h1')?.textContent).toBe('The title')
        expect([...target.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['One', 'Two', 'Details: x: y'])
        expect([...target.querySelectorAll('button')].map((b) => b.dataset.bootKey)).toEqual(['no', 'yes'])
    })
})

describe('initial focus', () => {
    test('it lands on the button the model names', () => {
        const target = mountScreen()
        void askBootScreen(model({ focus: 'no' }))
        flushSync()
        expect(document.activeElement).toBe(button(target, 'no'))
    })

    test('it follows the model, not the order: naming the other button focuses the other button', () => {
        const target = mountScreen()
        void askBootScreen(model({ focus: 'yes' }))
        flushSync()
        expect(document.activeElement).toBe(button(target, 'yes'))
    })

    test('when every button acts, focus goes to the heading and no button has it', () => {
        const target = mountScreen()
        void askBootScreen(model({ focus: null }))
        flushSync()
        const heading = target.querySelector('h1')
        expect(document.activeElement).toBe(heading)
        expect(heading?.getAttribute('tabindex')).toBe('-1')
    })

    test('a following screen takes focus again', () => {
        const target = mountScreen()
        void askBootScreen(model({ focus: 'no' }))
        flushSync()
        showTerminalBootScreen(model({ buttons: [{ key: 'reload', label: 'Reload' }], focus: 'reload' }), () => { })
        flushSync()
        expect(document.activeElement).toBe(button(target, 'reload'))
    })
})

describe('the answer guard', () => {
    test('a press inside the window is discarded, a press after it answers with the button key', async () => {
        const target = mountScreen()
        const answer = askBootScreen(model())
        flushSync()

        button(target, 'yes').click()
        expect(await settled(answer)).toBe('pending')

        await afterGuard()
        button(target, 'yes').click()
        await expect(answer).resolves.toBe('yes')
    })

    test('a screen that replaces another starts its own window', async () => {
        const target = mountScreen()
        const first = askBootScreen(model())
        flushSync()
        await afterGuard()

        const second = askBootScreen(model({ title: 'Second' }))
        flushSync()
        button(target, 'yes').click()
        expect(await settled(second)).toBe('pending')
        expect(await settled(first)).toBe('pending')

        await afterGuard()
        button(target, 'no').click()
        await expect(second).resolves.toBe('no')
    })

    test('a terminal screen is guarded too', async () => {
        const target = mountScreen()
        const onPress = vi.fn()
        showTerminalBootScreen(model({ buttons: [{ key: 'reload', label: 'Reload' }], focus: 'reload' }), onPress)
        flushSync()

        button(target, 'reload').click()
        expect(onPress).not.toHaveBeenCalled()

        await afterGuard()
        button(target, 'reload').click()
        expect(onPress).toHaveBeenCalledExactlyOnceWith('reload')
    })

    test('a second press after the answer is ignored', async () => {
        const target = mountScreen()
        const answer = askBootScreen(model())
        flushSync()
        await afterGuard()

        button(target, 'yes').click()
        await expect(answer).resolves.toBe('yes')
        pressBootButton('no')
        expect(getBootScreen()?.answered).toBe(true)
    })
})

describe('nothing but a button answers a question', () => {
    test('Escape, Enter on the page, a backdrop click and a history step leave the question open', async () => {
        const target = mountScreen()
        const answer = askBootScreen(model())
        flushSync()
        await afterGuard()

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        target.firstElementChild?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        window.dispatchEvent(new PopStateEvent('popstate'))
        flushSync()

        expect(await settled(answer)).toBe('pending')
        expect(getBootScreen()?.answered).toBe(false)
    })
})

describe('an answered screen stays up', () => {
    test('after an answer the screen is still set, its buttons are off and it says it is working', async () => {
        const target = mountScreen()
        const answer = askBootScreen(model())
        flushSync()
        await afterGuard()

        button(target, 'yes').click()
        await answer
        flushSync()

        expect(getBootScreen()).not.toBeNull()
        expect(getBootScreen()?.answered).toBe(true)
        expect(target.querySelector('h1')?.textContent).toBe('The title')
        expect([...target.querySelectorAll('button')].every((b) => b.disabled)).toBe(true)
        expect(target.textContent).toContain('Working')
    })

    test('a terminal screen is never cleared by a press', async () => {
        const target = mountScreen()
        showTerminalBootScreen(model({ buttons: [{ key: 'reload', label: 'Reload' }], focus: 'reload' }), () => { })
        flushSync()
        await afterGuard()

        button(target, 'reload').click()
        flushSync()

        expect(getBootScreen()).not.toBeNull()
        expect(target.querySelector('h1')?.textContent).toBe('The title')
    })

    test('nothing is shown while no screen is set', () => {
        const target = mountScreen()
        flushSync()
        expect(target.querySelector('h1')).toBeNull()
        expect(target.querySelector('button')).toBeNull()
    })
})
