/**
 * The focus-survival scenarios of `RecentStrip.svelte`, registered by `RecentStrip.svelte.test.ts`, which runs
 * under the async scheduler the app ships.
 *
 * Keyboard focus on an avatar follows its character when the strip reorders or the character's slot object is
 * replaced, and focus that went elsewhere is never taken back. The DOM is made to drop focus on a node move or
 * removal the way Chromium does: a bubbling focusout with no related target, then focus falls to the body.
 * happy-dom drops focus but fires no focusout.
 *
 * The caller owns the module mocks (`localforage`, `src/ts/characters`, `src/ts/stores.svelte`): `vi.mock` is
 * file-scoped and the component graph needs them before it is imported.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from '../../../ts/storage/database.svelte'
import RecentStrip from './RecentStrip.svelte'
import { recentCharacters } from 'src/ts/chatShell/recentCharacters'

type Entry = Database['characters'][number]

function character(chaId: string, extra: Record<string, unknown> = {}): Entry {
    return { type: 'character', chaId, name: `Name ${chaId}`, image: '', chats: [], chatPage: 0, ...extra } as unknown as Entry
}

//#region Chromium focus model -- a node that holds focus fires a bubbling focusout with no related
// target when it is moved or removed, then focus falls to the body unless a listener moved it.

type Insert = (this: ChildNode, ...nodes: Array<Node | string>) => void
const patched: Array<{ proto: object, own: PropertyDescriptor | undefined, method: 'before' | 'remove' }> = []
let moves = 0
let removals = 0

function loseFocusFrom(node: Node): boolean {
    const active = document.activeElement
    if (!active || active === document.body || !node.contains(active)) {
        return false
    }
    active.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
    const still = document.activeElement
    if (still instanceof HTMLElement && node.contains(still)) {
        still.blur()
    }
    return true
}

function emulateChromium(): void {
    for (const ctor of [Element, Comment, Text]) {
        const proto = ctor.prototype as unknown as { before: Insert, remove: () => void }
        const before = proto.before
        const remove = proto.remove
        patched.push({ proto, own: Object.getOwnPropertyDescriptor(proto, 'before'), method: 'before' })
        patched.push({ proto, own: Object.getOwnPropertyDescriptor(proto, 'remove'), method: 'remove' })
        proto.before = function (this: ChildNode, ...nodes: Array<Node | string>) {
            for (const node of nodes) {
                if (typeof node !== 'string' && node.isConnected && loseFocusFrom(node)) {
                    moves++
                }
            }
            before.apply(this, nodes)
        }
        proto.remove = function (this: ChildNode) {
            if (loseFocusFrom(this)) {
                removals++
            }
            remove.call(this)
        }
    }
}

function restoreDom(): void {
    for (const { proto, own, method } of patched.splice(0).reverse()) {
        if (own) {
            Object.defineProperty(proto, method, own)
        } else {
            delete (proto as Record<string, unknown>)[method]
        }
    }
}

//#endregion

function recentEntry(chaId: string, lastInteraction: number, extra: Record<string, unknown> = {}): Entry {
    return character(chaId, { lastInteraction, ...extra })
}

export function registerRecentStripFocusSuite(): void {
    let mounted: Array<Record<string, unknown>> = []
    let target: HTMLElement

    const avatars = () => Array.from(target.querySelectorAll<HTMLButtonElement>('[data-part="strip-avatar"]'))

    // The sidebar's own wiring: the strip receives `recentCharacters` over the live list and the
    // selected slot as `current`.
    function renderLive(list: Entry[], selected = 0) {
        const db = $state({ characters: list, selected })
        const recent = $derived(recentCharacters(db.characters))
        target = document.createElement('div')
        document.body.append(target)
        mounted.push(mount(RecentStrip, {
            target,
            props: { get characters() { return recent }, get current() { return db.characters[db.selected] }, layout: 'docked', onpick: () => {}, onall: () => {} },
        }) as Record<string, unknown>)
        flushSync()
        return db
    }

    const avatarOf = (name: string) => avatars().find((b) => b.getAttribute('aria-label') === name)!
    const focusedName = () => document.activeElement?.getAttribute('aria-label')

    describe('focus on a strip avatar survives a strip update', () => {
        const errors: unknown[] = []
        const onError = (ev: ErrorEvent): void => { errors.push(ev.error ?? ev.message); ev.preventDefault() }

        beforeEach(() => {
            moves = 0
            removals = 0
            errors.length = 0
            window.addEventListener('error', onError)
            emulateChromium()
        })

        afterEach(() => {
            restoreDom()
            window.removeEventListener('error', onError)
            for (const app of mounted) {
                unmount(app)
            }
            mounted = []
            flushSync()
            target?.remove()
        })

        test('an archived avatar whose slot the restore replaces, then bumps, keeps focus', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30, { coldstorage: 'unit-b' }), recentEntry('c', 20)])
            avatarOf('Name b').focus()
            db.characters[1] = recentEntry('b', 50)
            flushSync()
            expect(removals).toBeGreaterThan(0)
            expect(focusedName()).toBe('Name b')
            expect(avatars()[0]).toBe(document.activeElement)
        })

        test('an archived avatar replaced in place, without a bump, keeps focus', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30, { coldstorage: 'unit-b' }), recentEntry('c', 20)])
            avatarOf('Name b').focus()
            db.characters[1] = recentEntry('b', 30)
            flushSync()
            expect(removals).toBeGreaterThan(0)
            expect(focusedName()).toBe('Name b')
            expect(avatars()[1]).toBe(document.activeElement)
        })

        test('an archived avatar in the third place, restored and bumped, keeps focus', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('x', 20, { coldstorage: 'unit-x' }), recentEntry('d', 10)])
            avatarOf('Name x').focus()
            db.characters[2] = recentEntry('x', 50)
            flushSync()
            expect(focusedName()).toBe('Name x')
        })

        test('an install and then the landing bump, as two updates, keep focus each time', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('x', 20, { coldstorage: 'unit-x' }), recentEntry('d', 10)])
            avatarOf('Name x').focus()
            db.characters[2] = recentEntry('x', 20)
            flushSync()
            expect(focusedName()).toBe('Name x')
            db.characters[2].lastInteraction = 60
            db.selected = 2
            flushSync()
            expect(focusedName()).toBe('Name x')
            expect(avatars()[0]).toBe(document.activeElement)
        })

        test('a warm avatar in the third place, bumped in place, keeps focus on the same button', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('w', 20), recentEntry('d', 10)])
            const button = avatarOf('Name w')
            button.focus()
            db.characters[2].lastInteraction = 50
            flushSync()
            expect(moves).toBeGreaterThan(0)
            expect(document.activeElement).toBe(button)
        })

        test('a warm avatar in the fourth place, bumped in place, keeps focus', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('c', 20), recentEntry('w', 10)])
            avatarOf('Name w').focus()
            db.characters[3].lastInteraction = 50
            flushSync()
            expect(focusedName()).toBe('Name w')
        })

        test('a warm switch that bumps and selects in one update keeps focus on the now current avatar', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('c', 20), recentEntry('w', 10)])
            avatarOf('Name w').focus()
            db.characters[3].lastInteraction = 50
            db.selected = 3
            flushSync()
            expect(focusedName()).toBe('Name w')
            expect(document.activeElement?.getAttribute('aria-current')).toBe('true')
        })

        test('the refocus does not scroll the sidebar', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('w', 20), recentEntry('d', 10)])
            avatarOf('Name w').focus()
            const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
            try {
                db.characters[2].lastInteraction = 50
                flushSync()
                expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true })
            } finally {
                focusSpy.mockRestore()
            }
            expect(focusedName()).toBe('Name w')
        })

        test('guard: focus a listener moved out of the strip during the update is not taken back', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('w', 20), recentEntry('d', 10)])
            const outside = document.createElement('button')
            document.body.append(outside)
            const steal = (ev: Event) => { if (target.contains(ev.target as Node)) outside.focus() }
            document.addEventListener('focusout', steal)
            try {
                avatarOf('Name w').focus()
                db.characters[2].lastInteraction = 50
                flushSync()
                expect(document.activeElement).toBe(outside)
            } finally {
                document.removeEventListener('focusout', steal)
                outside.remove()
            }
        })

        test('guard: after focus left the strip for the body, a later update does not refocus', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('w', 20), recentEntry('d', 10)])
            const button = avatarOf('Name w')
            button.focus()
            db.characters[3].lastInteraction = 15
            flushSync()
            expect(document.activeElement).toBe(button)
            button.blur()
            db.characters[2].lastInteraction = 50
            flushSync()
            expect(document.activeElement).toBe(document.body)
        })

        test('guard: an avatar that leaves the strip leaves focus on the body without an error', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('c', 20), recentEntry('w', 10)])
            avatarOf('Name w').focus()
            db.characters.push(recentEntry('n', 50))
            flushSync()
            expect(avatars().some((b) => b.getAttribute('aria-label') === 'Name w')).toBe(false)
            expect(document.activeElement).toBe(document.body)
            expect(errors).toEqual([])
        })

        test('guard: two entries sharing a chaId render and reorder without an error', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('dup', 20), recentEntry('dup', 10)])
            expect(avatars().length).toBe(4)
            db.characters[3].lastInteraction = 50
            flushSync()
            expect(avatars().length).toBe(4)
            expect(errors).toEqual([])
        })

        test('guard: an update that moves no focused node leaves focus where it was', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('c', 20), recentEntry('d', 10)])
            const button = avatarOf('Name b')
            button.focus()
            db.characters[1].lastInteraction = 50
            flushSync()
            expect(document.activeElement).toBe(button)
        })

        test('guard: focus on All characters is untouched by a reorder', () => {
            const db = renderLive([recentEntry('a', 40), recentEntry('b', 30), recentEntry('w', 20), recentEntry('d', 10)])
            const all = target.querySelector<HTMLButtonElement>('[data-part="strip-all"]')!
            all.focus()
            db.characters[2].lastInteraction = 50
            flushSync()
            expect(document.activeElement).toBe(all)
        })
    })
}
