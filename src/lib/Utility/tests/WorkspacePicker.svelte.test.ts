// @vitest-environment jsdom

/**
 * The workspace picker of the Utility screen. (R) = regression reproducer; (G) = guard.
 *
 * REAL: the picker, the conversation accessor pair and its lock rule, the workspace model. MOCKED: `DBState` (a `$state`
 * object), the model request, the desktop probe and the tool grant store.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'

const h = vi.hoisted(() => ({ request: vi.fn(), setSpy: vi.fn(), getSpy: vi.fn() }))

// The real accessor pair, wrapped so a test can see that the picker goes through it.
vi.mock('src/ts/process/utility/utilityConversation.svelte', async (importOriginal) => {
    const actual = await importOriginal<typeof import('src/ts/process/utility/utilityConversation.svelte')>()
    h.setSpy.mockImplementation(actual.setUtilityWorkspace)
    h.getSpy.mockImplementation(actual.getUtilityWorkspace)
    return { ...actual, setUtilityWorkspace: h.setSpy, getUtilityWorkspace: h.getSpy }
})

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    return { DBState: state, selIdState: { selId: -1 } } as unknown as typeof import('src/ts/stores.svelte')
})
vi.mock('src/ts/process/request/request', () => ({ requestChatDataMain: h.request }))
vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    isDesktopTransport: () => true,
}))
vi.mock('src/ts/process/mcp/toolGrants', () => ({ removeWorkspaceToolGrants: vi.fn() }))

import { language } from 'src/lang'
import { setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { LLMFormat } from 'src/ts/model/types'
import {
    getUtilityWorkspace, newUtilityConversation, sendUtility, utilityConversation,
} from 'src/ts/process/utility/utilityConversation.svelte'
import { DBState } from 'src/ts/stores.svelte'
import WorkspacePicker from '../WorkspacePicker.svelte'

const text = language.utility.workspaces
const mounted: Array<{ instance: object, target: HTMLElement }> = []

function open(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    const instance = mount(WorkspacePicker, { target, props: {} })
    mounted.push({ instance, target })
    flushSync()
    return target
}

function choose(root: HTMLElement, value: string): void {
    const select = root.querySelector<HTMLSelectElement>('select')!
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
}

beforeEach(async () => {
    h.request.mockReset()
    h.setSpy.mockClear()
    h.request.mockResolvedValue({ type: 'success', result: 'done' })
    DBState.db = {
        customAPIFormat: LLMFormat.OpenAICompatible,
        useInstructPrompt: false,
        taskPresets: [{ id: 'p1', name: 'Fixer', instructions: 'Fix it.', model: 'gpt4o' }],
        utilityWorkspaces: [
            { id: 'w1', name: 'Notes', createdAt: 1, files: [] },
            { id: 'w2', name: 'Docs', createdAt: 2, files: [] },
        ],
    } as unknown as Database
    setPageStorageMode({ kind: 'store2' })
    await newUtilityConversation(async () => true)
})

afterEach(async () => {
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
})

describe('the workspace picker', () => {
    test('(G) lists no workspace first, then every workspace by name', () => {
        const root = open()
        const options = Array.from(root.querySelectorAll('option')).map((option) => [option.value, option.textContent?.trim()])
        expect(options).toEqual([['', text.pickerNone], ['w1', 'Notes'], ['w2', 'Docs']])
        expect(getUtilityWorkspace()).toBeNull()
    })

    test('(R) picking a workspace sets the conversation choice through the accessor, and none clears it', () => {
        const root = open()

        choose(root, 'w2')
        expect(h.setSpy).toHaveBeenLastCalledWith('w2')
        expect(getUtilityWorkspace()).toBe('w2')
        expect(utilityConversation.workspaceId).toBe('w2')

        choose(root, '')
        expect(h.setSpy).toHaveBeenLastCalledWith(null)
        expect(getUtilityWorkspace()).toBeNull()
    })

    test('(R) once the conversation has turns the choice is shown fixed with the reason and cannot change', async () => {
        const root = open()
        choose(root, 'w1')
        await sendUtility('p1', 'go')
        flushSync()

        expect(root.querySelector('select')).toBeNull()
        expect(root.querySelector('[data-testid="workspace-picker-fixed"]')?.textContent?.trim()).toBe('Notes')
        expect(root.querySelector('[data-testid="workspace-picker-locked"]')?.textContent).toBe(text.pickerLocked)
    })

    test('(R) a live run locks the choice before it ends', async () => {
        let release!: () => void
        h.request.mockImplementation(() => new Promise((resolve) => {
            release = () => resolve({ type: 'success', result: 'done' })
        }))
        const root = open()
        const sending = sendUtility('p1', 'go')
        flushSync()

        expect(root.querySelector('select')).toBeNull()
        expect(root.querySelector('[data-testid="workspace-picker-fixed"]')?.textContent?.trim()).toBe(text.pickerNone)

        await vi.waitFor(() => expect(h.request).toHaveBeenCalled())
        release()
        await sending
    })

    test('(R) New resets the choice to none and unlocks the picker', async () => {
        const root = open()
        choose(root, 'w1')
        await sendUtility('p1', 'go')
        flushSync()
        expect(root.querySelector('select')).toBeNull()

        await newUtilityConversation(async () => true)
        flushSync()

        expect(getUtilityWorkspace()).toBeNull()
        expect(root.querySelector<HTMLSelectElement>('select')?.value).toBe('')
    })

    test('(G) a bound workspace that was deleted shows as gone instead of silently clearing', () => {
        const root = open()
        choose(root, 'w1')
        DBState.db.utilityWorkspaces = DBState.db.utilityWorkspaces!.filter((workspace) => workspace.id !== 'w1')
        flushSync()

        const select = root.querySelector<HTMLSelectElement>('select')!
        expect(select.value).toBe('w1')
        expect(select.selectedOptions[0].textContent?.trim()).toBe(text.pickerGone)
    })
})
