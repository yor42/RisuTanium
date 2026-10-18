// @vitest-environment jsdom

/**
 * The recovery screen as the page renders it: `BootScreen.svelte` over the real boot-screen state and the real recovery
 * models, with `RecoveryScreen.svelte` listing the saved versions. A saved version is a button that goes through the same
 * guard and single-answer rule as every boot button; the states of the checking and install screens show what the models
 * say, and an unchecked result is never shown as a number. Labels: new behaviour. Real timers: the guard is a wall-clock
 * window.
 */
import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

// MOCKED: only the alert store `alertPrompts` reads, so the guard constant loads without the application's store graph.
vi.mock(import('src/ts/stores.svelte'), () => ({
    alertStore: writable({ type: 'none', msg: '' }),
}) as unknown as typeof import('src/ts/stores.svelte'))

import { changeLanguage, language } from 'src/lang'
import { ANSWER_GUARD_MS } from 'src/ts/alertPrompts'
import { askBootScreen, getBootScreen, resetBootScreenForTests, showTerminalBootScreen } from 'src/ts/storage/store2/ui/bootScreen.svelte'
import {
    pickButtonKey, recoveryBlockedBeforeWriteScreen, recoveryChangedScreen, recoveryCheckingScreen, recoveryInstallScreen,
    recoveryOffersScreen, recoveryUnexpectedScreen, type BootScreenModel,
} from 'src/ts/storage/store2/ui/bootText'
import BootScreen from './BootScreen.svelte'

const mounted: { target: HTMLElement, app: Record<string, unknown> }[] = []

function mountScreen(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(BootScreen, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    return target
}

beforeEach(() => {
    changeLanguage('en')
})

afterEach(async () => {
    for (const { target, app } of mounted.splice(0)) {
        await unmount(app as never)
        target.remove()
    }
    resetBootScreenForTests()
})

const text = () => language.store2Boot
const afterGuard = () => new Promise<void>((resolve) => setTimeout(resolve, ANSWER_GUARD_MS + 40))

function button(target: HTMLElement, key: string): HTMLButtonElement {
    const found = target.querySelector<HTMLButtonElement>(`[data-boot-key="${key}"]`)
    if (found === null) {
        throw new Error(`No button ${key}`)
    }
    return found
}

function keys(target: HTMLElement): string[] {
    return [...target.querySelectorAll<HTMLButtonElement>('button')].map((element) => element.dataset.bootKey ?? '')
}

async function settled(promise: Promise<unknown>): Promise<'pending' | 'resolved'> {
    return Promise.race([promise.then(() => 'resolved' as const), new Promise<'pending'>((resolve) => setTimeout(() => resolve('pending'), 20))])
}

const VERSIONS = ['store2/m-0000a1234567890123456789ab', 'store2/m-0000a0234567890123456789ab']

function offers(overrides: Partial<Parameters<typeof recoveryOffersScreen>[0]> = {}): BootScreenModel {
    return recoveryOffersScreen({ shown: VERSIONS, hasOlder: true, listFailed: null, offers: { convert: true, freshStart: true }, ...overrides })
}

describe('the saved versions', () => {
    test('each version is a button in order under its heading, then the offers; focus is on the heading', () => {
        const target = mountScreen()
        void askBootScreen(offers())
        flushSync()

        expect(keys(target)).toEqual([...VERSIONS.map(pickButtonKey), 'recoveryShowOlder', 'recoveryConvertOffer', 'recoveryFreshOffer'])
        expect(target.querySelector('h2')?.textContent).toBe(text().recoveryListHeading)
        expect(button(target, pickButtonKey(VERSIONS[0])).textContent).toMatch(/^Saved /)
        expect(document.activeElement).toBe(target.querySelector('h1'))
    })

    test('a screen with no saved version shows no list heading', () => {
        const target = mountScreen()
        void askBootScreen(offers({ shown: [], hasOlder: false }))
        flushSync()
        expect(target.querySelector('h2')).toBeNull()
        expect(target.querySelector('ul')).toBeNull()
    })

    test('a press inside the guard window is discarded; a press after it answers with the version\'s key, once', async () => {
        const target = mountScreen()
        const answer = askBootScreen(offers())
        flushSync()

        button(target, pickButtonKey(VERSIONS[1])).click()
        expect(await settled(answer)).toBe('pending')

        await afterGuard()
        button(target, pickButtonKey(VERSIONS[1])).click()
        await expect(answer).resolves.toBe(pickButtonKey(VERSIONS[1]))

        // The answered screen stays up with every button off, including the versions.
        flushSync()
        expect(getBootScreen()?.answered).toBe(true)
        expect([...target.querySelectorAll('button')].every((element) => element.disabled)).toBe(true)
    })

    test('a double press on a version answers once', async () => {
        const target = mountScreen()
        let answers = 0
        const answer = askBootScreen(offers()).then((key) => { answers += 1; return key })
        flushSync()
        await afterGuard()

        button(target, pickButtonKey(VERSIONS[0])).click()
        button(target, pickButtonKey(VERSIONS[1])).click()
        await expect(answer).resolves.toBe(pickButtonKey(VERSIONS[0]))
        expect(answers).toBe(1)
    })

    test('Escape, the backdrop and a history step answer nothing', async () => {
        const target = mountScreen()
        const answer = askBootScreen(offers())
        flushSync()
        await afterGuard()

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        target.firstElementChild?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        window.dispatchEvent(new PopStateEvent('popstate'))
        flushSync()
        expect(await settled(answer)).toBe('pending')
    })
})

describe('the checking screen', () => {
    test('Skip is there on the first frame and is the only button; there is no Cancel; focus is on the heading', () => {
        const target = mountScreen()
        void askBootScreen(recoveryCheckingScreen())
        flushSync()
        expect(keys(target)).toEqual(['recoveryCheckSkip'])
        expect(document.activeElement).toBe(target.querySelector('h1'))
        expect(target.textContent).toContain(text().recoveryChecking)
    })

    test('Skip answers once the guard window has passed, and not before', async () => {
        const target = mountScreen()
        const answer = askBootScreen(recoveryCheckingScreen())
        flushSync()
        button(target, 'recoveryCheckSkip').click()
        expect(await settled(answer)).toBe('pending')
        await afterGuard()
        button(target, 'recoveryCheckSkip').click()
        await expect(answer).resolves.toBe('recoveryCheckSkip')
    })
})

describe('the install confirmation', () => {
    test('counted: the counts are shown, Cancel has focus and Install is the second button', () => {
        const target = mountScreen()
        void askBootScreen(recoveryInstallScreen({ checked: true, missingImages: 7, missingInlays: 2, unknownLists: 0 }, null).model)
        flushSync()
        expect(target.textContent).toContain('7 images this version refers to could not be found.')
        expect(target.textContent).toContain('Up to 2 inlays this version refers to could not be found.')
        expect(keys(target)).toEqual(['recoveryCancel', 'recoveryInstallGo'])
        expect(document.activeElement).toBe(button(target, 'recoveryCancel'))
    })

    test.each([['skipped', 'skipped'], ['could not check', 'list-failed']] as const)('%s: no number is shown, the sentence is, and Install is reachable and enabled', (_name, cause) => {
        const target = mountScreen()
        void askBootScreen(recoveryInstallScreen({ checked: false, unknownLists: 0 }, cause).model)
        flushSync()
        const body = target.textContent ?? ''
        expect(body.includes(text().recoveryCountsSkipped)).toBe(cause === 'skipped')
        expect(body.includes(text().recoveryCountsUnchecked)).toBe(cause !== 'skipped')
        expect(body).not.toMatch(/\d/)
        expect(button(target, 'recoveryInstallGo').disabled).toBe(false)
        expect(document.activeElement).toBe(button(target, 'recoveryCancel'))
    })
})

describe('the ended screens', () => {
    const ended: [string, () => BootScreenModel][] = [
        ['changed', recoveryChangedScreen],
        ['unexpected', () => recoveryUnexpectedScreen('boom')],
    ]

    test.each(ended)('%s: Reload is the only button, it has focus, it is guarded and the screen is not cleared by it', async (_name, build) => {
        const target = mountScreen()
        const onPress = vi.fn()
        showTerminalBootScreen(build(), onPress)
        flushSync()
        expect(keys(target)).toEqual(['reload'])
        expect(document.activeElement).toBe(button(target, 'reload'))

        button(target, 'reload').click()
        expect(onPress).not.toHaveBeenCalled()
        await afterGuard()
        button(target, 'reload').click()
        expect(onPress).toHaveBeenCalledExactlyOnceWith('reload')
        flushSync()
        expect(target.querySelector('h1')).not.toBeNull()
    })

    test('the unexpected screen shows its message under Details as text', () => {
        const target = mountScreen()
        showTerminalBootScreen(recoveryUnexpectedScreen('<b>boom</b>'), () => { })
        flushSync()
        expect(target.textContent).toContain('<b>boom</b>')
        expect(target.querySelectorAll('b')).toHaveLength(0)
    })

    test('a stop before the marker has OK as its only button, focused, and the reason', () => {
        const target = mountScreen()
        void askBootScreen(recoveryBlockedBeforeWriteScreen({ reason: 'convert-read-failed', detail: 'x' }).model)
        flushSync()
        expect(keys(target)).toEqual(['recoveryBack'])
        expect(document.activeElement).toBe(button(target, 'recoveryBack'))
        expect(target.textContent).toContain(text().recoveryStepNothingWritten)
        expect(target.textContent).not.toContain(text().blockedNothingChanged)
    })
})
