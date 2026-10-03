// @vitest-environment happy-dom

/**
 * `ToolConversion.svelte` (the Playground's prompt conversion page): each Delete removes its
 * own row, a cancelled file picker does nothing, Run is available only with a supported
 * file, and a failing conversion is shown as an error instead of escaping the click.
 *
 * Mounts the REAL `ToolConversion.svelte`. The file picker, the prompt module and the alert
 * module are mocks. Titles beginning "regression reproducer:" fail against the version of
 * the page that lacks the behaviour they name.
 */
import { flushSync, mount, unmount } from 'svelte'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

//#region module mocks

const mocks = vi.hoisted(() => ({
    selectMultipleFile: vi.fn(),
    promptConvertion: vi.fn(),
    alertError: vi.fn(),
}))

vi.mock(import('src/ts/util'), () => ({
    selectMultipleFile: mocks.selectMultipleFile,
}) as unknown as typeof import('src/ts/util'))

vi.mock(import('src/ts/process/prompt'), () => ({
    detectPromptJSONType: (text: string) => text.startsWith('supported') ? 'STINST' : 'NOTSUPPORTED',
    promptConvertion: mocks.promptConvertion,
}) as unknown as typeof import('src/ts/process/prompt'))

vi.mock(import('src/ts/alert'), () => ({
    alertError: mocks.alertError,
}) as unknown as typeof import('src/ts/alert'))

//#endregion

import ToolConversion from './ToolConversion.svelte'

//#region helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function settle(): Promise<void> {
    await sleep(20)
    flushSync()
}

interface Mounted { target: HTMLElement, app: Record<string, unknown> }
let mounted: Mounted[] = []

function mountPage(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(ToolConversion, { target, props: {} }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    flushSync()
    return target
}

const encode = (text: string) => new TextEncoder().encode(text)
const picked = (...entries: Array<[string, string]>) => entries.map(([name, text]) => ({ name, data: encode(text) }))

function button(target: HTMLElement, label: string, index = 0): HTMLButtonElement {
    const all = Array.from(target.querySelectorAll('button')).filter((b) => b.textContent?.trim() === label)
    return all[index] as HTMLButtonElement
}

const fileNames = (target: HTMLElement) =>
    Array.from(target.querySelectorAll('div.justify-between span:not(.rounded-md)')).map((s) => s.textContent?.trim())

async function add(target: HTMLElement, ...entries: Array<[string, string]>): Promise<void> {
    mocks.selectMultipleFile.mockResolvedValueOnce(picked(...entries))
    button(target, 'Add').click()
    await settle()
}

const unhandled: unknown[] = []
const recordUnhandled = (reason: unknown) => { unhandled.push(reason) }

beforeEach(() => {
    mocks.selectMultipleFile.mockReset()
    mocks.promptConvertion.mockReset()
    mocks.alertError.mockReset()
    unhandled.length = 0
    process.on('unhandledRejection', recordUnhandled)
})

afterEach(async () => {
    process.off('unhandledRejection', recordUnhandled)
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

//#endregion

describe('the prompt conversion page', () => {
    test('guard: added files are listed in the order they were picked', async () => {
        const target = mountPage()
        await add(target, ['a.json', 'supported-a'], ['b.json', 'nope'])
        expect(fileNames(target)).toEqual(['a.json', 'b.json'])
    })

    test('regression reproducer: Delete removes only its own row', async () => {
        const target = mountPage()
        await add(target, ['a.json', 'supported-a'], ['b.json', 'supported-b'])
        button(target, 'Delete', 0).click()
        await settle()
        expect(fileNames(target)).toEqual(['b.json'])
    })

    test('regression reproducer: a cancelled file picker adds nothing and throws nothing', async () => {
        const target = mountPage()
        mocks.selectMultipleFile.mockResolvedValueOnce(null)
        button(target, 'Add').click()
        await settle()
        expect(fileNames(target)).toEqual([])
        expect(unhandled).toEqual([])
    })

    test('regression reproducer: Run is disabled until a supported file is listed', async () => {
        const target = mountPage()
        expect(button(target, 'Run').disabled).toBe(true)
        await add(target, ['bad.json', 'nope'])
        expect(button(target, 'Run').disabled).toBe(true)
        await add(target, ['good.json', 'supported-good'])
        expect(button(target, 'Run').disabled).toBe(false)
    })

    test('regression reproducer: Run is disabled again when the last supported file is deleted', async () => {
        const target = mountPage()
        await add(target, ['bad.json', 'nope'], ['good.json', 'supported-good'])
        button(target, 'Delete', 1).click()
        await settle()
        expect(button(target, 'Run').disabled).toBe(true)
    })

    test('guard: Run passes the listed files to the conversion', async () => {
        const target = mountPage()
        await add(target, ['good.json', 'supported-good'])
        button(target, 'Run').click()
        await settle()
        expect(mocks.promptConvertion).toHaveBeenCalledTimes(1)
        expect(mocks.promptConvertion.mock.calls[0][0]).toEqual([
            { name: 'good.json', content: 'supported-good', type: 'STINST' },
        ])
    })

    test('regression reproducer: a conversion that throws is shown as an error and the page stays usable', async () => {
        const target = mountPage()
        await add(target, ['good.json', 'supported-good'])
        mocks.promptConvertion.mockImplementationOnce(() => { throw new TypeError('no samplers') })
        button(target, 'Run').click()
        await settle()
        expect(mocks.alertError).toHaveBeenCalledTimes(1)
        expect((mocks.alertError.mock.calls[0][0] as Error).message).toBe('no samplers')
        expect(unhandled).toEqual([])
        expect(button(target, 'Run').disabled).toBe(false)
    })
})
