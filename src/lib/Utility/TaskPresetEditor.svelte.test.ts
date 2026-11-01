// @vitest-environment jsdom

/**
 * The task-preset editor edits the stored presets in place. (R) = regression reproducer: fails when the editor rebuilds
 * a preset from its known fields (a key this build does not know would be lost) or when New/Delete/range handling is
 * removed; (G) = guard that may pass before and after.
 *
 * REAL: the editor and the form components. MOCKED: `DBState` (a `$state` object, as the page holds it), the confirm
 * dialog and the model picker (it reads the whole model catalogue, which these cases do not exercise).
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { TaskPreset } from 'src/ts/process/utility/taskPreset'
import type { Database } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({ confirm: vi.fn(async (_message: string) => true) }))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/alert', () => ({ alertConfirm: h.confirm }))
vi.mock('../UI/ModelList.svelte', () => ({
    default: (_anchor: unknown) => {},
}))

import { language } from 'src/lang'
import { DBState } from 'src/ts/stores.svelte'
import TaskPresetEditor from './TaskPresetEditor.svelte'

type Stored = TaskPreset & { futureKey?: { n: number[] } }

const mounted: Array<{ instance: object, target: HTMLElement }> = []

function stored(): Stored[] {
    return DBState.db.taskPresets as Stored[]
}

function seed(presets: Array<Record<string, unknown>>) {
    DBState.db = { taskPresets: presets } as never
}

function open(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(TaskPresetEditor, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    return target
}

function buttonWithText(root: HTMLElement, text: string): HTMLButtonElement {
    const found = Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.trim() === text)
    if (!found) {
        throw new Error(`no button "${text}"`)
    }
    return found
}

function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

beforeEach(() => {
    h.confirm.mockReset()
    h.confirm.mockResolvedValue(true)
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
})

describe('editing a preset in place', () => {
    test('(R) T42: renaming a preset keeps a key this build does not know', () => {
        seed([{ id: 'a', name: 'one', instructions: 'x', model: 'gpt4o', futureKey: { n: [1] } }])
        const root = open()

        buttonWithText(root, 'one').click()
        flushSync()
        typeInto(root.querySelector<HTMLInputElement>('#task-preset-name')!, 'renamed')

        expect(stored()[0].name).toBe('renamed')
        expect(stored()[0].futureKey).toEqual({ n: [1] })
        expect(stored()[0].instructions).toBe('x')
    })

    test('(R) the instructions field writes the stored instructions', () => {
        seed([{ id: 'a', name: 'one', instructions: 'x', model: 'gpt4o' }])
        const root = open()

        buttonWithText(root, 'one').click()
        flushSync()
        typeInto(root.querySelector<HTMLTextAreaElement>('#task-preset-instructions')!, 'Fix the grammar.')

        expect(stored()[0].instructions).toBe('Fix the grammar.')
    })

    test('(R) New adds a preset with a fresh id and selects it', () => {
        seed([{ id: 'a', name: 'one', instructions: '', model: 'gpt4o' }])
        const root = open()

        buttonWithText(root, language.utility.editor.newPreset).click()
        flushSync()

        expect(stored()).toHaveLength(2)
        expect(stored()[1].id).not.toBe('a')
        expect(stored()[1].id).not.toBe('')
        expect(root.querySelector('#task-preset-name')).not.toBeNull()
    })

    test('(R) New on a profile with no list creates the list', () => {
        DBState.db = {} as never
        const root = open()

        buttonWithText(root, language.utility.editor.newPreset).click()
        flushSync()

        expect(stored()).toHaveLength(1)
    })
})

describe('temperature and max tokens', () => {
    test('(R) the global switch adds and removes the field, and a typed value is clamped into range', () => {
        seed([{ id: 'a', name: 'one', instructions: '', model: 'gpt4o' }])
        const root = open()
        buttonWithText(root, 'one').click()
        flushSync()
        expect(root.querySelector('#task-preset-temperature')).toBeNull()

        const boxes = root.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
        boxes[0].click()
        flushSync()
        expect(stored()[0].temperature).toBe(1)

        const field = root.querySelector<HTMLInputElement>('#task-preset-temperature')!
        field.value = '5'
        field.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(stored()[0].temperature).toBe(2)

        boxes[0].click()
        flushSync()
        expect('temperature' in stored()[0]).toBe(false)
    })

    test('(R) max tokens is a whole number of at least 1, and a blank entry keeps the stored value', () => {
        seed([{ id: 'a', name: 'one', instructions: '', model: 'gpt4o', maxTokens: 500 }])
        const root = open()
        buttonWithText(root, 'one').click()
        flushSync()

        const field = root.querySelector<HTMLInputElement>('#task-preset-max-tokens')!
        field.value = '0.2'
        field.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(stored()[0].maxTokens).toBe(1)

        field.value = ''
        field.dispatchEvent(new Event('change', { bubbles: true }))
        flushSync()
        expect(stored()[0].maxTokens).toBe(1)
    })
})

describe('deleting', () => {
    test('(R) a confirmed delete removes the preset; a declined one keeps it', async () => {
        seed([{ id: 'a', name: 'one', instructions: '', model: 'gpt4o' }])
        const root = open()
        buttonWithText(root, 'one').click()
        flushSync()

        h.confirm.mockResolvedValue(false)
        buttonWithText(root, language.utility.editor.delete).click()
        await vi.waitFor(() => expect(h.confirm).toHaveBeenCalledTimes(1))
        expect(stored()).toHaveLength(1)
        expect(h.confirm.mock.calls[0][0]).toContain('one')

        h.confirm.mockResolvedValue(true)
        buttonWithText(root, language.utility.editor.delete).click()
        await vi.waitFor(() => expect(stored()).toHaveLength(0))
    })
})

describe('notes and the damaged-preset notice', () => {
    test('(G) the device-only and global-settings notes are shown', () => {
        seed([])
        const root = open()

        expect(root.querySelector('[data-testid="task-preset-device-note"]')?.textContent).toBe(language.utility.editor.deviceOnlyNote)
        expect(root.querySelector('[data-testid="task-preset-global-note"]')?.textContent).toBe(language.utility.editor.globalSettingsNote)
    })

    test('(R) a preset with a bad field shows the notice and names the problem; a good one shows none', () => {
        seed([
            { id: 'a', name: 'good', instructions: '', model: 'gpt4o' },
            { id: 'b', name: 'bad', instructions: '', model: 'gpt4o', temperature: 9 },
        ])
        const root = open()

        buttonWithText(root, 'good').click()
        flushSync()
        expect(root.querySelector('[data-testid="task-preset-damaged"]')).toBeNull()

        buttonWithText(root, 'bad').click()
        flushSync()
        const notice = root.querySelector('[data-testid="task-preset-damaged"]')
        expect(notice?.textContent).toContain(language.utility.damagedPreset)
        expect(notice?.textContent).toContain('temperature')
    })
})
