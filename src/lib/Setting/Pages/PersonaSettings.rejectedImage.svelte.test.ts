// @vitest-environment happy-dom

/**
 * What `PersonaSettings.svelte` shows when a persona or user icon promise from
 * `getCharImage` rejects.
 *
 * Invariants pinned here:
 *  - a rejection raises no unhandled rejection and is logged with `console.warn`;
 *  - the persona button keeps its placeholder box (the pending branch's markup);
 *  - the large user icon keeps its placeholder box.
 *
 * Every test is a regression reproducer: without a rejection branch on the
 * `{#await}` blocks, Svelte rethrows the rejection as an unhandled rejection and
 * the box disappears.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    getCharImage: vi.fn<(...args: unknown[]) => Promise<string>>(),
}))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Record<string, unknown> })
    const selId = $state({ selId: 0 })
    return { DBState: state, selIdState: selId } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    getCharImage: mocks.getCharImage,
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/persona'), () => ({
    changeUserPersona: vi.fn(),
    exportUserPersona: vi.fn(),
    importUserPersona: vi.fn(),
    saveUserPersona: vi.fn(),
    selectUserImg: vi.fn(),
}) as unknown as typeof import('src/ts/persona'))

vi.mock(import('src/ts/alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertSelect: vi.fn(async () => '0'),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    sleep: vi.fn(async () => {}),
    sortableOptions: {},
}) as unknown as typeof import('src/ts/util'))

vi.mock('sortablejs/modular/sortable.core.esm.js', () => ({
    default: { create: vi.fn(() => ({ destroy: () => {} })) },
}))

import { DBState } from 'src/ts/stores.svelte'
import PersonaSettings from './PersonaSettings.svelte'

function setupDb() {
    DBState.db = {
        username: 'me',
        userNote: '',
        personaNote: false,
        personaPrompt: '',
        userIcon: 'user.png',
        selectedPersona: 0,
        personas: [
            { name: 'one', icon: 'one.png', personaPrompt: '', note: '' },
            { name: 'two', icon: 'two.png', personaPrompt: '', note: '' },
        ],
    } as never
}

async function settle() {
    for (let i = 0; i < 6; i++) await Promise.resolve()
    await tick()
    await new Promise((resolve) => setTimeout(resolve, 20))
    flushSync()
}

const mountedTargets: HTMLElement[] = []
const mountedInstances: unknown[] = []

function mountPage() {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(PersonaSettings, { target }))
    flushSync()
    return target
}

const unhandled: unknown[] = []
const onUnhandled = (reason: unknown) => {
    unhandled.push(reason)
}
let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    setupDb()
    unhandled.length = 0
    process.on('unhandledRejection', onUnhandled)
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(async () => {
    process.off('unhandledRejection', onUnhandled)
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    warn.mockRestore()
    mocks.getCharImage.mockReset()
})

describe('PersonaSettings: a rejected icon', () => {
    test('regression reproducer: rejected persona and user icons keep their placeholder boxes, warn, and raise no unhandled rejection', async () => {
        mocks.getCharImage.mockImplementation(() => Promise.reject(new Error('boom')))
        const target = mountPage()
        await settle()

        expect(unhandled).toEqual([])
        expect(warn).toHaveBeenCalled()
        expect(target.querySelectorAll('button[data-risu-idx] .bg-textcolor2')).toHaveLength(2)
        expect(target.querySelectorAll('.h-28.w-28.bg-textcolor2')).toHaveLength(1)
    })

    test('regression reproducer: icons that reject later keep their placeholder boxes', async () => {
        let rejectAll!: (e: unknown) => void
        const gate = new Promise<string>((_, rej) => {
            rejectAll = rej
        })
        mocks.getCharImage.mockImplementation(() => gate)
        const target = mountPage()
        await settle()
        expect(target.querySelectorAll('button[data-risu-idx] .bg-textcolor2')).toHaveLength(2)

        rejectAll(new Error('late'))
        await settle()

        expect(unhandled).toEqual([])
        expect(target.querySelectorAll('button[data-risu-idx] .bg-textcolor2')).toHaveLength(2)
        expect(target.querySelectorAll('.h-28.w-28.bg-textcolor2')).toHaveLength(1)
    })

    test('regression reproducer: after a rejection, a resolving icon replaces the placeholder with its style', async () => {
        mocks.getCharImage.mockImplementation(() => Promise.reject(new Error('boom')))
        const target = mountPage()
        await settle()

        mocks.getCharImage.mockImplementation(async () => 'color: blue;')
        DBState.db.userIcon = 'other.png'
        flushSync()
        await settle()

        expect(unhandled).toEqual([])
        expect(target.querySelector('.h-28.w-28.bg-textcolor2')!.getAttribute('style')).toContain('color: blue;')
    })
})
