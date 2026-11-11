/**
 * The "panel opened at a row" scenarios (R1) of the toggles panel, registered by both
 * `TogglesPanel.layers.svelte.test.ts` (the shipped scheduler) and `TogglesPanel.layers.asyncOrder.svelte.test.ts`
 * (the async scheduler), so each scenario runs under both schedulers with no copy.
 *
 * The REAL ChatShell, ShellSheet, TogglesPanel and ToggleRow run. A star handed over by the + menu aims the opening
 * at that row: the panel's first render marks it and the sheet's one-shot initial focus lands on its text button; an
 * opening with no star focuses the title.
 *
 * The caller owns the module mocks (`vi.mock` is file-scoped and the component graph needs them before it is
 * imported), including the stand-in for the + menu: the `plus` handle receives that menu's props, and the scenarios
 * call its Toggles handler.
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach,beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { dispatchBack, resetBackHandlersForTests } from '../../ts/backHandlers'
import ChatShell from './ChatShell.svelte'
import { DBState, selIdState } from '../../ts/stores.svelte'
import { resetTogglePanelSession } from '../../ts/chatShell/togglePanel'
import { FAVOURITES_KEY } from '../../ts/chatShell/toggleFavourites'
import { syncFavourites } from '../../ts/chatShell/toggleFavouritesStore.svelte'

export type PlusHandle = { props: undefined | { ontoggles?: (row?: { s: string, k: string }) => void, togglesSummary?: () => string | null } }

export function registerTogglesPanelOpenAtSuite(plus: PlusHandle): void {
    let app: ReturnType<typeof mount> | undefined
    let target: HTMLElement

    async function settle(): Promise<void> {
        flushSync()
        await tick()
        flushSync()
    }

    async function show(): Promise<void> {
        target = document.createElement('div')
        document.body.appendChild(target)
        app = mount(ChatShell, { target })
        await vi.waitFor(() => {
            flushSync()
            expect(target.querySelector('[data-part="chat-header-menu"]')).not.toBeNull()
        }, { timeout: 15000 })
    }

    const layers = () => Array.from(target.querySelectorAll<HTMLElement>('[data-part="chat-sheet-layer"]'))
    const summaryRow = () => target.querySelector<HTMLButtonElement>('[data-part="this-chat-toggles"]')
    const menuButton = () => target.querySelector<HTMLButtonElement>('[data-part="chat-header-menu"]')!

    async function openSheet(): Promise<void> {
        menuButton().click()
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(1)
        }, { timeout: 15000 })
    }

    async function openPanel(): Promise<void> {
        await vi.waitFor(() => {
            flushSync()
            expect(summaryRow()).not.toBeNull()
        }, { timeout: 15000 })
        summaryRow()!.click()
        await vi.waitFor(() => {
            flushSync()
            expect(layers()).toHaveLength(2)
        })
    }

    // The shell loads its parts lazily; the first transform of all of them is slow, so it happens before any test clock starts.
    beforeAll(async () => {
        await Promise.all([import('./ShellHeader.svelte'), import('./PersonaSheet.svelte'), import('./ChatDeleteConfirm.svelte'), import('./ThisChatSheet.svelte'), import('./TogglesPanel.svelte')])
    }, 120000)

    describe('the panel opened at a row (R1)', () => {
        beforeEach(() => {
            resetTogglePanelSession()
            DBState.db.characters[0].chats = [
                { id: 'c1', name: 'Harbour night', note: '', localLore: [], message: [{ role: 'user', data: 'a', chatId: 'c1-1', time: 1_000 }] },
                { id: 'c2', name: 'Second', note: '', localLore: [], message: [] },
            ] as never
            DBState.db.characters[0].chatPage = 0
            DBState.db.globalChatVariables = { toggle_on1: '1' }
            selIdState.selId = 0
        })

        afterEach(async () => {
            if (app) await unmount(app)
            app = undefined
            target?.remove()
            document.body.replaceChildren()
            resetBackHandlersForTests()
            localStorage.removeItem(FAVOURITES_KEY)
            syncFavourites()
        })

        const favouriteText = () => target.querySelector<HTMLElement>('[data-part="toggles-favourites"] [data-part="toggle-row"][data-key="say"] [data-part="toggle-text-button"]')

        async function waitForHandler(): Promise<void> {
            await vi.waitFor(() => {
                flushSync()
                expect(plus.props?.ontoggles).toBeTypeOf('function')
            }, { timeout: 15000 })
        }

        async function openWith(row?: { s: string, k: string }): Promise<void> {
            await waitForHandler()
            const before = layers().length
            if (row) plus.props!.ontoggles!(row)
            else plus.props!.ontoggles!()
            await vi.waitFor(() => {
                flushSync()
                expect(layers()).toHaveLength(before + 1)
            })
        }

        test('L1: the star handed by the + menu reaches the panel and focuses that row text button', async () => {
            localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ v: 1, items: [{ s: 'character:char-a', k: 'say' }] }))
            syncFavourites()
            await show()
            await openWith({ s: 'character:char-a', k: 'say' })
            expect(favouriteText()).not.toBeNull()
            expect(document.activeElement).toBe(favouriteText())
            expect(target.querySelectorAll('[data-opened-at]')).toHaveLength(1)
        })

        test('L2: Back from the panel, then an opening with no star or from the summary row, focuses the title', async () => {
            localStorage.setItem(FAVOURITES_KEY, JSON.stringify({ v: 1, items: [{ s: 'character:char-a', k: 'say' }] }))
            syncFavourites()
            await show()
            await openWith({ s: 'character:char-a', k: 'say' })
            expect(dispatchBack()).toBe(true)
            await settle()
            expect(layers()).toHaveLength(0)
            await openWith()
            expect(document.activeElement).toBe(target.querySelector('[data-part="toggles-title"]'))
            expect(target.querySelectorAll('[data-opened-at]')).toHaveLength(0)
            expect(dispatchBack()).toBe(true)
            await settle()
            expect(layers()).toHaveLength(0)
            await openSheet()
            await openPanel()
            expect(document.activeElement).toBe(target.querySelector('[data-part="toggles-title"]'))
            expect(target.querySelectorAll('[data-opened-at]')).toHaveLength(0)
        })
    })
}
