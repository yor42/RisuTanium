// @vitest-environment jsdom
/**
 * The four radios of the backup chooser (format rtb and bin, scope full and, for .rtb, settings) are named through aria-label
 * equal to the visible choice text. REAL: BackupChooserSheet and PatternDialog. MOCKED: the Back handlers, as the
 * sibling test does.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
vi.mock('../../../ts/backHandlers', () => ({
    registerBackHandler: () => () => { },
    backCloseHandler: () => ({}),
}))

import BackupChooserSheet from './BackupChooserSheet.svelte'
import { language } from '../../../lang'
import { resetPickOpenerForTest } from '../../../ts/pickOpener'
import { controlName, unnamedControls } from '../../a11yNames.test-helpers'

let target: HTMLElement
let app: Record<string, unknown>

beforeEach(() => { resetPickOpenerForTest() })
afterEach(async () => {
    await unmount(app)
    target.remove()
})

describe('BackupChooserSheet form control names', () => {
    test('each radio carries aria-label equal to its visible text and no aria-labelledby', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(BackupChooserSheet, { target, props: { background: [], onanswer: () => { } } })
        flushSync()
        const radios = [...target.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
        expect(radios.map((radio) => radio.getAttribute('aria-label'))).toEqual([
            language.settingsShellDataFormatRtb,
            language.settingsShellDataFormatBin,
            language.settingsShellDataScopeFull,
            language.settingsShellDataScopeSettings,
        ])
        for (const radio of radios) {
            expect(radio.hasAttribute('aria-labelledby')).toBe(false)
            expect(controlName(radio)).toBe(radio.closest('label')!.textContent!.trim())
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })

    test('the encrypt and show-password checkboxes carry aria-label equal to their visible text', () => {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(BackupChooserSheet, { target, props: { background: [], onanswer: () => { } } })
        flushSync()
        const encrypt = target.querySelector<HTMLInputElement>('[data-part="data-chooser-encrypt-toggle"]')!
        expect(encrypt.getAttribute('aria-label')).toBe(language.settingsShellDataEncrypt)
        encrypt.click()
        flushSync()
        const show = target.querySelector<HTMLInputElement>('[data-part="data-chooser-password-show"]')!
        expect(show.getAttribute('aria-label')).toBe(language.rtbRestorePasswordShow)
        for (const box of [encrypt, show]) {
            expect(box.hasAttribute('aria-labelledby')).toBe(false)
            expect(controlName(box)).toBe(box.closest('label')!.textContent!.trim())
        }
        const fields = [
            [target.querySelector<HTMLInputElement>('[data-part="data-chooser-password"]')!, language.rtbRestorePasswordLabel],
            [target.querySelector<HTMLInputElement>('[data-part="data-chooser-password-again"]')!, language.settingsShellDataEncryptAgain],
        ] as const
        for (const [field, label] of fields) {
            const labelId = field.getAttribute('aria-labelledby')!
            expect(document.getElementById(labelId)!.textContent).toBe(label)
            expect(field.getAttribute('aria-describedby')!.split(' ')[0]).toBe(labelId)
            expect(controlName(field)).toBe(label)
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
