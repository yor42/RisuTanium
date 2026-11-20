// @vitest-environment jsdom
/**
 * The four radios of the backup chooser (format rtb and bin, scope full and partial) are named through aria-label
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
            language.settingsShellDataScopePartial,
        ])
        for (const radio of radios) {
            expect(radio.hasAttribute('aria-labelledby')).toBe(false)
            expect(controlName(radio)).toBe(radio.closest('label')!.textContent!.trim())
        }
        expect(unnamedControls(target, { fields: true })).toEqual([])
    })
})
