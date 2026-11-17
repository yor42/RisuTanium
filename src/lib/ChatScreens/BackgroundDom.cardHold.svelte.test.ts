// @vitest-environment jsdom

/**
 * While the page is hidden, the infinite animations of the card background and of card rows are held, including nodes
 * added while hidden, and a show releases only what the hidden hold took. The real `BackgroundDom.svelte` renders the
 * real parser's sanitized card; the row is a `.chattext` host (the hidden hold reaches rows by that class alone, and
 * the row action's own wiring is covered by the Chat and ShellMessage rows). `getAnimations` is a browser-shaped
 * stand-in.
 *
 * Labels: R = regression reproducer (the base renders no background mark, so the background is never in scope).
 */
import { flushSync, mount, tick, unmount } from 'svelte'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { FakeIntersectionObserver, installAnimationWorld, type AnimationWorld } from 'src/ts/gui/tests/realAnimationShape'

const h = vi.hoisted(() => ({ html: '' }))

vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    const DBState = $state({ db: { characters: [] as Array<Record<string, unknown>>, globalChatVariables: {}, templateDefaultVariables: '' } })
    const selIdState = $state({ selId: 0 })
    return {
        DBState,
        selIdState,
        selectedCharID: writable(0),
        ReloadGUIPointer: writable(0),
        moduleBackgroundEmbedding: writable(''),
    }
})
vi.mock('src/ts/process/moduleEnsure', async (importOriginal) => {
    const { writable } = await import('svelte/store')
    return {
        ...(await importOriginal<typeof import('src/ts/process/moduleEnsure')>()),
        selectedModulesPending: () => false,
        moduleRunVersion: writable(0),
    }
})
vi.mock('src/ts/parser/parser.svelte', () => ({
    risuChatParser: vi.fn((text: string) => text),
    ParseMarkdown: vi.fn(async () => h.html),
}))
vi.mock('src/ts/storage/database.svelte', async () => {
    const stores = await import('src/ts/stores.svelte')
    const owner = () => (stores.DBState as unknown as { db: { characters: Array<Record<string, unknown>> } }).db.characters[0]
    return {
        appVer: '1234.5.67',
        getDatabase: () => ({}),
        getCurrentCharacter: () => owner(),
        getCurrentChat: () => (owner()?.chats as Array<unknown> | undefined)?.[0],
    }
})
vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))
vi.mock('src/ts/globalApi.svelte', () => ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: async () => '',
    readImage: async () => undefined,
}))
vi.mock('src/lib/ChatScreens/chatSurface.svelte', () => ({ isChatSurfaceInstalled: () => false, chatSurface: {} }))

import BackgroundDom from 'src/lib/ChatScreens/BackgroundDom.svelte'
import { clearChatBodyRenderCache } from 'src/lib/ChatScreens/chatBodyRenderCache'
import { DBState, selIdState } from 'src/ts/stores.svelte'
import { CARD_BACKGROUND_ATTR, cardAnimationHold, installCardAnimationVisibilityHold } from 'src/ts/gui/cardAnimationHold'

const BACKGROUND = '<style>.bgglow{animation:pulse 1s infinite}.bgreveal{animation:fade 1s forwards}</style><div class="bgglow">G</div><div class="bgreveal">R</div>'
const FAR = '100% 0px'

let world: AnimationWorld
let uninstall: () => void
const mounted: Array<{ instance: object, target: HTMLElement }> = []

function setVisibility(state: 'hidden' | 'visible') {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
    document.dispatchEvent(new Event('visibilitychange'))
}

const settle = async () => { flushSync(); await tick(); await Promise.resolve(); await Promise.resolve(); flushSync() }

beforeEach(async () => {
    const parser = await vi.importActual<typeof import('src/ts/parser/parser.svelte')>('src/ts/parser/parser.svelte')
    h.html = await parser.ParseMarkdown(BACKGROUND, null, 'back')
    FakeIntersectionObserver.instances.length = 0
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    world = installAnimationWorld()
    world.rule('.x-risu-bgglow', 'selfLoopInfinite')
    world.rule('.x-risu-bgreveal', 'finiteFillForwardsRunning')
    world.rule('.rowglow', 'selfLoopInfinite')
    world.rule('.rowglow', 'beforeLoopInfinite')
    clearChatBodyRenderCache()
    selIdState.selId = 0
    DBState.db.characters = [{ chaId: 'c0', chatPage: 0, chats: [{ id: 'chat0' }], backgroundHTML: 'CARD' }] as never
    uninstall = installCardAnimationVisibilityHold()
})

afterEach(async () => {
    setVisibility('visible')
    uninstall()
    for (const { instance, target } of mounted.splice(0)) {
        await unmount(instance as never).catch(() => {})
        target.remove()
    }
    document.body.replaceChildren()
    world.restore()
    vi.unstubAllGlobals()
    delete (document as { visibilityState?: unknown }).visibilityState
})

async function mountBackground() {
    const target = document.createElement('div')
    document.body.append(target)
    const instance = mount(BackgroundDom, { target })
    mounted.push({ instance, target })
    await settle()
    await settle()
    return target
}

function addRow(): HTMLElement {
    const row = document.createElement('span')
    row.className = 'chattext'
    row.innerHTML = '<div class="rowglow">row</div>'
    document.body.append(row)
    return row
}

describe('the hidden hold reaches the card background and card rows', () => {
    test('R T2.5: hidden holds both, a node added while hidden is held, visible releases them', async () => {
        const target = await mountBackground()
        const wrapper = target.querySelector(`[${CARD_BACKGROUND_ATTR}]`)
        expect(wrapper).not.toBeNull()
        const glow = wrapper!.querySelector('.x-risu-bgglow')
        const reveal = wrapper!.querySelector('.x-risu-bgreveal')
        const row = addRow()
        const rowGlow = row.querySelector('.rowglow')!
        expect(glow!.hasAttribute('data-risu-anim-hold')).toBe(false)

        setVisibility('hidden')
        expect(glow!.getAttribute('data-risu-anim-hold')).toBe('self')
        expect(rowGlow.getAttribute('data-risu-anim-hold')).toBe('self before')
        expect(reveal!.hasAttribute('data-risu-anim-hold')).toBe(false)
        // The wrapper and the row are roots of their scopes and are never held themselves.
        expect(wrapper!.hasAttribute('data-risu-anim-hold')).toBe(false)
        expect(row.hasAttribute('data-risu-anim-hold')).toBe(false)

        const late = document.createElement('div')
        late.className = 'rowglow'
        row.append(late)
        const lateBackground = document.createElement('div')
        lateBackground.className = 'x-risu-bgglow'
        wrapper!.append(lateBackground)
        await settle()
        expect(late.getAttribute('data-risu-anim-hold')).toBe('self before')
        expect(lateBackground.getAttribute('data-risu-anim-hold')).toBe('self')

        setVisibility('visible')
        expect(glow!.hasAttribute('data-risu-anim-hold')).toBe(false)
        expect(rowGlow.hasAttribute('data-risu-anim-hold')).toBe(false)
        expect(late.hasAttribute('data-risu-anim-hold')).toBe(false)
        expect(lateBackground.hasAttribute('data-risu-anim-hold')).toBe(false)

        // A node added after the show is not held: the body observer is gone.
        const after = document.createElement('div')
        after.className = 'rowglow'
        row.append(after)
        await settle()
        expect(after.hasAttribute('data-risu-anim-hold')).toBe(false)
    })

    test('G T2.5: a show releases the hidden reason only; an off-screen hold survives it', async () => {
        const row = addRow()
        const rowGlow = row.querySelector('.rowglow')!
        const action = cardAnimationHold(row)
        FakeIntersectionObserver.send(FAR, row, false)
        expect(rowGlow.getAttribute('data-risu-anim-hold')).toBe('self before')

        setVisibility('hidden')
        expect(rowGlow.getAttribute('data-risu-anim-hold')).toBe('self before')
        setVisibility('visible')
        // Still held by the row being off-screen.
        expect(rowGlow.getAttribute('data-risu-anim-hold')).toBe('self before')

        FakeIntersectionObserver.send('50% 0px', row, true)
        expect(rowGlow.hasAttribute('data-risu-anim-hold')).toBe(false)
        action.destroy()
    })

    test('G T2.5: no animation is ever paused, played or finished through script', async () => {
        const target = await mountBackground()
        const glow = target.querySelector('.x-risu-bgglow')!
        setVisibility('hidden')
        expect(glow.getAttribute('data-risu-anim-hold')).toBe('self')
        setVisibility('visible')
        const issued = world.handedOut()
        expect(issued.length).toBeGreaterThan(0)
        for (const animation of issued) {
            expect(animation.pause).not.toHaveBeenCalled()
            expect(animation.play).not.toHaveBeenCalled()
            expect(animation.finish).not.toHaveBeenCalled()
        }
    })
})
