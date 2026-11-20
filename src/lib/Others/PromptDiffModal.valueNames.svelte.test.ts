// @vitest-environment jsdom

/**
 * `PromptDiffModal.svelte`: the context-radius range (shown while only the changes are shown) is named by the visible
 * label span beside it. Mounts the REAL component over two fixture presets; only `getDatabase` and the Android Back
 * registry are replaced, as in `PromptDiffModal.names.svelte.test.ts`.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'
import type { Database } from 'src/ts/storage/database.svelte'

const dbBox = vi.hoisted(() => ({ db: {} as unknown }))

vi.mock(import('../../ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
}) as unknown as typeof import('../../ts/storage/database.svelte'))

vi.mock('src/ts/backHandlers', () => ({
    registerBackHandler: () => () => {},
    backCloseHandler: () => () => false,
}))

import { language } from 'src/lang'
import { fieldNameProblems, unnamedControls } from 'src/lib/a11yNames.test-helpers'
import PromptDiffModal from './PromptDiffModal.svelte'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await sleep(20)
        flushSync()
    }
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

const bodyLines = (changed: string) =>
    Array.from({ length: 30 }, (_, i) => (i === 15 ? changed : `line ${i}`)).join('\n')

function plain(name: string | undefined, text: string) {
    return { type: 'plain', type2: 'normal', role: 'system', text, ...(name === undefined ? {} : { name }) }
}

function useDb(showOnlyChanges: boolean): void {
    dbBox.db = {
        promptDiffPrefs: { isGrouped: false, contextRadius: 1, diffStyle: 'line', formatStyle: 'card', viewStyle: 'unified', showOnlyChanges },
        botPresets: [
            { promptTemplate: [plain('Main', bodyLines('old')), plain(undefined, 'same'), plain('Gone', 'removed body')] },
            { promptTemplate: [plain('Main', bodyLines('new')), plain(undefined, 'same'), plain('Extra', 'added body')] },
        ],
    } as unknown as Database
}

async function mountModal(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PromptDiffModal, { target, props: { firstPresetId: 0, secondPresetId: 1 } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
    return target
}

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

const KNOWN_UNNAMED: string[] = []

describe('PromptDiffModal value-control names', { timeout: 60_000 }, () => {
    test('regression reproducer: the context range is named by its visible label span while only changes are shown', async () => {
        useDb(true)
        const target = await mountModal()
        expect(fieldNameProblems(target, [{ name: language.promptDiff.context }])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })

    test('compatibility guard: with every line shown the modal has no value control (passes before and after)', async () => {
        useDb(false)
        const target = await mountModal()
        expect(fieldNameProblems(target, [])).toEqual([])
        expect(unnamedControls(target, { fields: true, values: true })).toEqual(KNOWN_UNNAMED)
    })
})
