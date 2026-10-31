// @vitest-environment happy-dom

/**
 * `PromptDiffModal.svelte` in card format compares two presets even when one of them has no prompt template
 * (a preset saved without the key, or with it set to null). The preset without a template is shown as empty,
 * so the other preset's cards appear as additions instead of the modal failing to render them.
 *
 * Mounts the REAL component over two fixture presets. MOCKED: `getDatabase`, which returns a plain object
 * holding the two presets and the stored preferences.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import 'src/ts/polyfill'
import type { Database } from 'src/ts/storage/database.svelte'

const dbBox = vi.hoisted(() => ({ db: {} as unknown }))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => dbBox.db),
}) as unknown as typeof import('src/ts/storage/database.svelte'))

// The modal registers an Android Back handler; the real registry pulls in the real stores module,
// which this test's partial database mock cannot serve.
vi.mock('src/ts/backHandlers', () => ({
    registerBackHandler: () => () => {},
    backCloseHandler: () => () => false,
}))

import PromptDiffModal from 'src/lib/Others/PromptDiffModal.svelte'

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await sleep(20)
        flushSync()
    }
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountModal(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PromptDiffModal, { target, props: { firstPresetId: 0, secondPresetId: 1 } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle()
    return target
}

function plain(name: string, text: string) {
    return { type: 'plain', type2: 'normal', role: 'system', name, text }
}

type PresetFixture = { promptTemplate?: unknown }

function useDb(): PresetFixture[] {
    const botPresets: PresetFixture[] = [
        { promptTemplate: [plain('Main', 'first body')] },
        { promptTemplate: [plain('Main', 'first body'), plain('Extra', 'added body')] },
    ]
    dbBox.db = {
        promptDiffPrefs: {
            diffStyle: 'line',
            formatStyle: 'card',
            viewStyle: 'unified',
            isGrouped: false,
            showOnlyChanges: false,
            contextRadius: 1,
        },
        botPresets,
    } as unknown as Database
    return botPresets
}

const textOf = (target: HTMLElement) => (target.textContent ?? '').replace(/\s+/g, ' ')

afterEach(async () => {
    for (const m of mounted) {
        await unmount(m.app as never)
        m.target.remove()
    }
    mounted = []
})

describe('a preset without a prompt template in card format', { timeout: 30_000 }, () => {
    test('guard: with both templates present the second preset\'s extra card is shown (passes before and after)', async () => {
        useDb()
        expect(textOf(await mountModal())).toContain('added body')
    })

    test('regression reproducer: a null template on the first preset is shown as empty, so the second preset\'s cards still render', async () => {
        useDb()[0].promptTemplate = null
        expect(textOf(await mountModal())).toContain('added body')
    })

    test('regression reproducer: a first preset saved without the template key is shown as empty, so the second preset\'s cards still render', async () => {
        delete useDb()[0].promptTemplate
        expect(textOf(await mountModal())).toContain('added body')
    })
})
