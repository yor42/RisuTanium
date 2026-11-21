// @vitest-environment jsdom

/**
 * The preset bundle preview: every row starts ticked, the name shown is the name the import will write, Import answers
 * the ticked indices and is disabled at zero, Cancel answers `cancel`, and names, folders and models render as text.
 * No sanitizer is involved, so the markup assertions check text nodes rather than sanitizer output.
 */

import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { language } from 'src/lang'
import { PRESET_BUNDLE_CANCEL } from 'src/ts/storage/presetBundle'
import PresetBundlePrompt from './PresetBundlePrompt.svelte'

const HOSTILE = '<img src=x onerror="window.__presetBundleXss = true"><b>bold</b>'

type View = { rows: { name: string, folder: string | null, aiModel: string }[], existingNames: string[] }

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountPrompt(view: View, onanswer: (message: string) => void): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(PresetBundlePrompt, { target, props: { view, messageId: 'msg', onanswer } }))
    flushSync()
    return target
}

const boxes = (target: HTMLElement) => [...target.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
const button = (target: HTMLElement, label: string) =>
    [...target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label) as HTMLButtonElement

afterEach(async () => {
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((target) => target.remove())
    document.body.replaceChildren()
    delete (window as unknown as Record<string, unknown>).__presetBundleXss
    vi.clearAllMocks()
})

describe('PresetBundlePrompt.svelte', () => {
    test('every row starts ticked and the count sentence describes the dialog', () => {
        const target = mountPrompt({ rows: [{ name: 'A', folder: null, aiModel: 'm1' }, { name: 'B', folder: 'RP', aiModel: '' }], existingNames: [] }, vi.fn())
        expect(boxes(target).map((b) => b.checked)).toEqual([true, true])
        expect(target.querySelector('#msg')?.textContent).toBe(language.presetBundleCount(2))
        expect(target.textContent).toContain(language.presetBundleKeysRemoved)
        expect(target.textContent).toContain(language.presetBundleNoFolder)
        expect(target.textContent).toContain(`${language.presetBundleFolder}: RP`)
        expect(target.textContent).toContain(`${language.model}: m1`)
    })

    test('(R) Import answers the ticked indices and is disabled with nothing ticked', () => {
        const onanswer = vi.fn()
        const target = mountPrompt({ rows: [{ name: 'A', folder: null, aiModel: '' }, { name: 'B', folder: null, aiModel: '' }, { name: 'C', folder: null, aiModel: '' }], existingNames: [] }, onanswer)
        boxes(target)[1].click()
        flushSync()
        button(target, language.import).click()
        expect(onanswer).toHaveBeenLastCalledWith('[0,2]')
        boxes(target).forEach((b) => { if (b.checked) b.click() })
        flushSync()
        expect(button(target, language.import).disabled).toBe(true)
        onanswer.mockClear()
        button(target, language.import).click()
        expect(onanswer).not.toHaveBeenCalled()
    })

    test('Cancel answers the cancel token', () => {
        const onanswer = vi.fn()
        const target = mountPrompt({ rows: [{ name: 'A', folder: null, aiModel: '' }], existingNames: [] }, onanswer)
        button(target, language.cancel).click()
        expect(onanswer).toHaveBeenCalledWith(PRESET_BUNDLE_CANCEL)
    })

    test('(R) a name already taken shows the suffix it will get, live with the ticks', () => {
        const target = mountPrompt({ rows: [{ name: 'Alpha', folder: null, aiModel: '' }, { name: 'Beta', folder: null, aiModel: '' }, { name: 'Beta', folder: null, aiModel: '' }], existingNames: ['Alpha'] }, vi.fn())
        const suffixes = () => [...target.querySelectorAll('[data-row-suffix]')].map((s) => s.textContent)
        expect(suffixes()).toEqual([' (2)', '', ' (2)'])
        boxes(target)[1].click()
        flushSync()
        expect(suffixes()).toEqual([' (2)', '', ''])
    })

    test('names, folders and models render as text, never as markup', () => {
        const target = mountPrompt({ rows: [{ name: HOSTILE, folder: HOSTILE, aiModel: HOSTILE }], existingNames: [] }, vi.fn())
        expect(target.querySelector('img')).toBeNull()
        expect(target.querySelector('b')).toBeNull()
        expect(target.querySelector('[data-row-name]')?.textContent).toContain(HOSTILE)
        expect(target.querySelector('[data-row-folder]')?.textContent).toContain(HOSTILE)
        expect(target.querySelector('[data-row-model]')?.textContent).toContain(HOSTILE)
    })
})
