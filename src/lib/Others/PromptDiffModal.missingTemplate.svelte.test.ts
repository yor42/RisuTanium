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

// The card diff is computed asynchronously after a lazy `import('diff')`, so how long the expected text takes
// to appear depends on module-load time under machine load. Wait on the condition itself, with a generous
// deadline, instead of a fixed number of ticks; the final assertion still decides pass or fail.
async function settle(
    target: HTMLElement,
    expectedText: string,
    flush: () => void = flushSync,
    deadlineMs = 20_000,
): Promise<void> {
    const deadline = Date.now() + deadlineMs
    do {
        await sleep(20)
        flush()
    } while (!textOf(target).includes(expectedText) && Date.now() < deadline)
}

let mounted: Array<{ target: HTMLElement, app: Record<string, unknown> }> = []

async function mountModal(): Promise<HTMLElement> {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const app = mount(PromptDiffModal, { target, props: { firstPresetId: 0, secondPresetId: 1 } }) as unknown as Record<string, unknown>
    mounted.push({ target, app })
    await settle(target, 'added body')
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

describe('a slow lazy diff module import', { timeout: 30_000 }, () => {
    // Mechanism reproducer: the diff module resolves 300 ms late, so a fixed short settle shows the
    // "No diff computed yet" placeholder; waiting on the rendered text shows the cards.
    test('mechanism reproducer: the card diff still renders once a delayed diff module resolves', async () => {
        useDb()
        vi.resetModules()
        vi.doMock('diff', async () => {
            await sleep(300)
            return await vi.importActual<typeof import('diff')>('diff')
        })
        const fresh = await import('svelte')
        const { default: FreshModal } = await import('src/lib/Others/PromptDiffModal.svelte')
        const target = document.createElement('div')
        document.body.appendChild(target)
        const app = fresh.mount(FreshModal, { target, props: { firstPresetId: 0, secondPresetId: 1 } }) as unknown as Record<string, unknown>
        try {
            await settle(target, 'added body', fresh.flushSync)
            expect(textOf(target)).toContain('added body')
        } finally {
            await fresh.unmount(app as never)
            target.remove()
            vi.doUnmock('diff')
            vi.resetModules()
        }
    })
})
