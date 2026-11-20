// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
vi.mock('../../../ts/backHandlers', () => ({
    registerBackHandler: () => () => { },
    backCloseHandler: () => ({}),
}))

import BackupChooserSheet from './BackupChooserSheet.svelte'
import { language } from '../../../lang'
import { imeEventSequence, enterKeydown } from '../../../ts/ime/tests/imeEventSequence'
import type { BackupChoice } from '../../../ts/setting/dataSheets.svelte'

/**
 * Encryption in the "Make a backup" chooser (CHORE-128 S2): the checkbox, the two masked fields, the Show toggle, the
 * fixed warning, the plain-HTTP line, Start's refusals (one reason line, the field marked and focused, the text kept) and
 * Enter doing nothing in a field. Compatibility guards of new behaviour, mounted through the real chooser and dialog shell.
 *
 * Every negative assertion sits beside a control that shows the forbidden effect is reachable in the same state: a valid
 * pair that Start answers, a password typed before a switch, or a field shown while ticked.
 */

const mounts: Array<{ app: Record<string, unknown>, target: HTMLElement }> = []

function mountSheet(): { onanswer: ReturnType<typeof vi.fn<(choice: BackupChoice | null) => void>>, target: HTMLElement, unmountSheet: () => Promise<void> } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const onanswer = vi.fn<(choice: BackupChoice | null) => void>()
    const app = mount(BackupChooserSheet, { target, props: { background: [], onanswer } })
    flushSync()
    const entry = { app, target }
    mounts.push(entry)
    return {
        onanswer,
        target,
        unmountSheet: async () => {
            await unmount(app)
            target.remove()
            mounts.splice(mounts.indexOf(entry), 1)
        },
    }
}

afterEach(async () => {
    for (const { app, target } of mounts.splice(0)) {
        await unmount(app)
        target.remove()
    }
    vi.restoreAllMocks()
})

const one = <T extends HTMLElement>(selector: string): T | null => document.querySelector<T>(selector)
const tick = () => one<HTMLInputElement>('[data-part="data-chooser-encrypt-toggle"]')!
const field1 = () => one<HTMLInputElement>('[data-part="data-chooser-password"]')
const field2 = () => one<HTMLInputElement>('[data-part="data-chooser-password-again"]')
const showBox = () => one<HTMLInputElement>('[data-part="data-chooser-password-show"]')
const warning = () => one('[data-part="data-chooser-encrypt-warning"]')
const problemLine = () => one('[data-part="data-chooser-password-problem"]')
const startButton = () => one<HTMLButtonElement>('[data-part="data-chooser-start"]')!
const radio = (name: string, value: string) => one<HTMLInputElement>(`input[type="radio"][name$="-${name}"][value="${value}"]`)!

function click(element: HTMLElement): void {
    element.click()
    flushSync()
}

function type(field: HTMLInputElement, text: string): void {
    field.value = text
    field.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
}

function typeBoth(text: string): void {
    type(field1()!, text)
    type(field2()!, text)
}

function escape(field: HTMLElement, init: { isComposing?: boolean, keyCode?: number } = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: init.keyCode ?? 27, isComposing: init.isComposing ?? false, bubbles: true, cancelable: true })
    field.dispatchEvent(event)
    flushSync()
    return event
}

const NFD = ' Pw é 한 '

describe('the sealed answer (T-S2-3)', () => {
    test('A1: the first entry is answered exactly as typed, not trimmed, normalized or folded', () => {
        expect(NFD).not.toBe(NFD.normalize('NFC'))
        expect(NFD).not.toBe(NFD.normalize('NFKC'))
        expect(NFD).not.toBe(NFD.trim())
        const { onanswer } = mountSheet()
        click(tick())
        typeBoth(NFD)
        click(startButton())
        expect(onanswer).toHaveBeenCalledTimes(1)
        const choice = onanswer.mock.calls[0][0]
        expect(choice).toEqual({ format: 'rtb', scope: 'full', password: NFD })
        expect((choice as { password: string }).password).toBe(NFD)
    })

    test('NFD and NFC spellings of one password match and the first is handed on', () => {
        const nfc = NFD.normalize('NFC')
        const { onanswer } = mountSheet()
        click(tick())
        type(field1()!, NFD)
        type(field2()!, nfc)
        click(startButton())
        expect(onanswer).toHaveBeenCalledWith({ format: 'rtb', scope: 'full', password: NFD })
    })
})

describe('Start with a problem (T-S2-4)', () => {
    test('A2: an empty first field, a lone surrogate and a mismatch each keep the sheet open and say why', () => {
        const { onanswer } = mountSheet()
        click(tick())

        click(startButton())
        expect(onanswer).not.toHaveBeenCalled()
        expect(problemLine()?.textContent).toBe(language.rtbRestorePasswordUnusable)
        expect(field1()!.getAttribute('aria-invalid')).toBe('true')
        expect(field2()!.getAttribute('aria-invalid')).toBeNull()
        expect(document.activeElement).toBe(field1())
        expect(field1()!.getAttribute('aria-describedby')).toBe(problemLine()!.id)

        typeBoth('\ud800')
        click(startButton())
        expect(onanswer).not.toHaveBeenCalled()
        expect(problemLine()?.textContent).toBe(language.rtbRestorePasswordUnusable)
        expect(field1()!.getAttribute('aria-invalid')).toBe('true')
        expect(document.activeElement).toBe(field1())
        expect(field1()!.value).toBe('\ud800')
        expect(field2()!.value).toBe('\ud800')

        type(field1()!, 'a')
        type(field2()!, 'b')
        click(startButton())
        expect(onanswer).not.toHaveBeenCalled()
        expect(problemLine()?.textContent).toBe(language.settingsShellDataEncryptMismatch)
        expect(field2()!.getAttribute('aria-invalid')).toBe('true')
        expect(field1()!.getAttribute('aria-invalid')).toBeNull()
        expect(document.activeElement).toBe(field2())
        expect(field2()!.getAttribute('aria-describedby')).toBe(problemLine()!.id)
        expect(field1()!.value).toBe('a')
        expect(field2()!.value).toBe('b')
        // Start stays enabled: it reports the problem instead of being disabled.
        expect(startButton().disabled).toBe(false)
        expect(startButton().getAttribute('aria-disabled')).toBeNull()

        // Control in the same mount: a valid pair answers.
        typeBoth('same text')
        click(startButton())
        expect(onanswer).toHaveBeenCalledTimes(1)
        expect(onanswer).toHaveBeenCalledWith({ format: 'rtb', scope: 'full', password: 'same text' })
    })
})

describe('the answer without a password (T-S2-5)', () => {
    const TOKEN = 'c128-T0k3n-한'

    function ticked(): { onanswer: ReturnType<typeof vi.fn<(choice: BackupChoice | null) => void>> } {
        const { onanswer } = mountSheet()
        click(tick())
        typeBoth(TOKEN)
        // Control: there is a password to leak right before the switch.
        expect(field1()!.value).toBe(TOKEN)
        expect(field2()!.value).toBe(TOKEN)
        return { onanswer }
    }

    function expectNoPassword(onanswer: ReturnType<typeof vi.fn<(choice: BackupChoice | null) => void>>): BackupChoice {
        expect(onanswer).toHaveBeenCalledTimes(1)
        const choice = onanswer.mock.calls[0][0]!
        expect(Object.hasOwn(choice, 'password')).toBe(false)
        expect(JSON.stringify(choice)).not.toContain(TOKEN)
        return choice
    }

    test('A3: unticking after typing answers a plain .rtb', () => {
        const { onanswer } = ticked()
        click(tick())
        click(startButton())
        expect(expectNoPassword(onanswer)).toEqual({ format: 'rtb', scope: 'full' })
    })

    test('A3: choosing .bin after typing answers a .bin in full with no password, and disables the checkbox', () => {
        const { onanswer } = ticked()
        click(radio('format', 'bin'))
        expect(tick().disabled).toBe(true)
        expect(field1()).toBeNull()
        click(startButton())
        expect(expectNoPassword(onanswer)).toEqual({ format: 'bin', scope: 'full' })
    })

    test('A3: choosing .bin partial after typing answers a partial .bin with no password', () => {
        const { onanswer } = ticked()
        click(radio('format', 'bin'))
        click(radio('scope', 'partial'))
        expect(tick().disabled).toBe(true)
        click(startButton())
        expect(expectNoPassword(onanswer)).toEqual({ format: 'bin', scope: 'partial' })
    })
})

describe('the fields, Show and the warning (T-S2-6)', () => {
    test('A4, A5: the fields and the warning show iff ticked, Show switches both, and a new opening starts hidden', async () => {
        const first = mountSheet()
        expect(tick().checked).toBe(false)
        expect(field1()).toBeNull()
        expect(field2()).toBeNull()
        expect(warning()).toBeNull()
        click(tick())
        expect(field1()!.type).toBe('password')
        expect(field2()!.type).toBe('password')
        expect(warning()?.textContent).toBe(language.settingsShellDataEncryptWarning)
        expect(showBox()!.checked).toBe(false)
        click(showBox()!)
        expect(field1()!.type).toBe('text')
        expect(field2()!.type).toBe('text')
        click(showBox()!)
        expect(field1()!.type).toBe('password')
        expect(field2()!.type).toBe('password')
        click(tick())
        expect(field1()).toBeNull()
        expect(field2()).toBeNull()
        expect(warning()).toBeNull()
        expect(showBox()).toBeNull()
        click(tick())
        click(showBox()!)
        // Control for the remount: ticked, Show on and both fields visible.
        expect(tick().checked).toBe(true)
        expect(showBox()!.checked).toBe(true)
        expect(field1()!.type).toBe('text')
        expect(field2()!.type).toBe('text')
        await first.unmountSheet()

        mountSheet()
        expect(tick().checked).toBe(false)
        expect(field1()).toBeNull()
        expect(warning()).toBeNull()
        click(tick())
        expect(field1()!.type).toBe('password')
        expect(field2()!.type).toBe('password')
        expect(showBox()!.checked).toBe(false)
    })

    test('the second field is labelled with the new text and the first with the restore prompt\'s', () => {
        mountSheet()
        click(tick())
        expect(field1()!.closest('label')!.textContent).toContain(language.rtbRestorePasswordLabel)
        expect(field2()!.closest('label')!.textContent).toContain(language.settingsShellDataEncryptAgain)
    })
})

describe('the plain-HTTP line (T-S2-7)', () => {
    const occurrences = () => (document.body.textContent ?? '').split(language.settingsShellDataEncryptSlow).length - 1

    test('A4: with crypto.subtle undefined the line is under the checkbox, ticked or not, once; with it, there is none', () => {
        expect(globalThis.crypto.subtle).toBeDefined()
        mountSheet()
        expect(occurrences()).toBe(0)
        click(tick())
        expect(occurrences()).toBe(0)
        for (const { app, target } of mounts.splice(0)) {
            void unmount(app)
            target.remove()
        }

        const own = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle')
        Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, value: undefined })
        try {
            mountSheet()
            expect(occurrences()).toBe(1)
            expect(tick().closest('[data-part="data-chooser-encrypt"]')!.textContent).toContain(language.settingsShellDataEncryptSlow)
            click(tick())
            expect(occurrences()).toBe(1)
            click(tick())
            expect(occurrences()).toBe(1)
        } finally {
            if (own) {
                Object.defineProperty(globalThis.crypto, 'subtle', own)
            } else {
                delete (globalThis.crypto as { subtle?: SubtleCrypto }).subtle
            }
        }
    })
})

describe('Enter and Escape in a field (T-S2-8)', () => {
    const FIELDS = [['the first field', field1], ['the second field', field2]] as const

    test('A6: Enter, composing or not, never answers and keeps the composed text; Start answers in that same state', () => {
        const { onanswer } = mountSheet()
        click(tick())
        imeEventSequence(field1()!, '한글')
        imeEventSequence(field2()!, '한글')
        flushSync()
        expect(field1()!.value).toBe('한글')
        expect(field2()!.value).toBe('한글')
        expect(problemLine()).toBeNull()

        const now = vi.spyOn(performance, 'now')
        for (const [name, get] of FIELDS) {
            const field = get()!
            const plain = enterKeydown(field)
            flushSync()
            expect(onanswer, `${name}: plain Enter`).not.toHaveBeenCalled()
            expect(plain.defaultPrevented).toBe(false)
            enterKeydown(field, { isComposing: true })
            enterKeydown(field, { keyCode: 229 })
            for (const gap of [2, 200]) {
                now.mockReturnValue(1000)
                imeEventSequence(field, '한글')
                now.mockReturnValue(1000 + gap)
                enterKeydown(field)
                flushSync()
                expect(onanswer, `${name}: Enter at +${gap} ms`).not.toHaveBeenCalled()
            }
            expect(field1()!.value).toBe('한글')
            expect(field2()!.value).toBe('한글')
        }
        expect(onanswer).not.toHaveBeenCalled()

        // Control in the same mount and state: Start answers once.
        click(startButton())
        expect(onanswer).toHaveBeenCalledTimes(1)
        expect(onanswer).toHaveBeenCalledWith({ format: 'rtb', scope: 'full', password: '한글' })
    })

    test('A6: a composing Escape answers nothing, in either flag form, and a plain Escape answers null', () => {
        const { onanswer } = mountSheet()
        click(tick())
        imeEventSequence(field1()!, '한글')
        imeEventSequence(field2()!, '한글')
        flushSync()
        const composing = escape(field1()!, { isComposing: true })
        expect(composing.defaultPrevented).toBe(true)
        const code229 = escape(field2()!, { keyCode: 229, isComposing: false })
        expect(code229.defaultPrevented).toBe(true)
        expect(onanswer).not.toHaveBeenCalled()
        expect(field1()!.value).toBe('한글')
        expect(startButton()).not.toBeNull()

        // Control: a plain Escape answers null once.
        escape(field1()!)
        expect(onanswer).toHaveBeenCalledTimes(1)
        expect(onanswer).toHaveBeenCalledWith(null)
    })
})
