// @vitest-environment jsdom

/**
 * `HomeStoryShelf.svelte` mounted alone: the card structure, the accessible names, the plain-text
 * snippet, the ordinary character-pick open path with its busy cover and its cancel on leaving, and the
 * time tick.
 *
 * REAL: the shelf, `homeStories` (freeze and resolve), `storySnippet`, `storyTime`, `CharListAvatar`,
 * `buildColdStub` and the language table. MOCKED: `stores.svelte` (a rune `DBState` and a writable
 * `selectedCharID`), `src/ts/characters` (the helpers the shelf imports), `characterPick` (a spy) and
 * `globalApi.svelte` (the version and link helpers the Source tag module imports). The generation counter
 * is a mutable stand-in that the open spy bumps, as the real `changeChar` does.
 */

import { flushSync, mount, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { buildColdStub } from 'src/ts/process/coldCharacter'
import { controlDescription, controlName, exposedIcons, paletteClasses } from 'src/lib/a11yNames.test-helpers'

//#region module mocks

const h = vi.hoisted(() => ({
    generation: 0,
    pick: vi.fn(),
    supersede: vi.fn(),
    switchImported: vi.fn(),
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({ db: { characters: [], hideAllImages: false } as unknown as Record<string, unknown> })
    return {
        DBState: state,
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('src/ts/characters', () => ({
    getCharImage: vi.fn(async () => ''),
    archivedMemberIds: () => [],
    changeCharGeneration: () => h.generation,
    supersedeChangeChar: () => h.supersede(),
}))

vi.mock('src/ts/characterPick', () => ({
    changeCharOrAlert: (site: string, index: number) => h.pick(site, index),
}))

vi.mock('src/ts/chatShell/switchTarget.svelte', () => {
    h.switchImported()
    return { switchCharacter: vi.fn() }
})

//#endregion

import HomeStoryShelf from './HomeStoryShelf.svelte'
import { freezeStories, resolveFrozen, type ShelfStory } from './homeStories'
import type { HomeBand } from './homeLayout'
import { DBState, selectedCharID } from 'src/ts/stores.svelte'

type Entry = ShelfStory['entry']

function warm(chaId: string, lastInteraction: number, extra: Record<string, unknown> = {}, lastLine = `Line ${chaId}`): Entry {
    return {
        type: 'character', chaId, name: chaId, image: '', chatPage: 0, lastInteraction,
        chats: [{ id: `c-${chaId}`, name: `Chat-${chaId}`, message: [{ role: 'char', data: lastLine, time: 1 }], note: '', localLore: [] }],
        ...extra,
    } as unknown as Entry
}

function setCharacters(characters: Entry[]): void {
    DBState.db = { characters, hideAllImages: false } as unknown as typeof DBState.db
}

function storiesOf(): ShelfStory[] {
    const characters = DBState.db.characters as unknown as Entry[]
    return resolveFrozen(freezeStories(characters, 'UNNAMED'), characters)
}

const instances: unknown[] = []
const targets: HTMLElement[] = []

function mountShelf(stories: ShelfStory[], band: HomeBand = 'wide'): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    instances.push(mount(HomeStoryShelf, { target, props: { stories, band } }))
    flushSync()
    return target
}

const cards = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLButtonElement>('[data-part="home-story"]'))
const lead = (root: ParentNode) => root.querySelector<HTMLButtonElement>('[data-part="home-story"][data-lead]')!
const part = (card: Element, name: string) => card.querySelector(`[data-part="${name}"]`)

function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
    let resolve: (value: T) => void = () => {}
    const promise = new Promise<T>((r) => {
        resolve = r
    })
    return { promise, resolve }
}

beforeEach(() => {
    h.generation = 0
    h.pick.mockReset()
    h.supersede.mockReset()
    selectedCharID.set(-1)
})

afterEach(async () => {
    vi.useRealTimers()
    for (const instance of instances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    targets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
})

describe('structure', () => {
    test('S3b-U1: lead and rows carry the radius, clamp and grid classes; the phone band swaps the lead portrait', () => {
        setCharacters([warm('a', 6000), warm('b', 5000), warm('c', 4000)])
        const root = mountShelf(storiesOf())
        const leadCard = lead(root)
        expect(leadCard.className).toContain('rounded-[var(--home-card-radius)]')
        expect(part(leadCard, 'home-story-snippet')!.className).toContain('line-clamp-2')
        const rowCards = cards(root).filter((c) => c !== leadCard)
        expect(rowCards.length).toBe(2)
        for (const card of rowCards) {
            expect(card.className).toContain('rounded-[var(--home-radius-5)]')
            expect(part(card, 'home-story-snippet')!.className).toContain('line-clamp-1')
        }
        const shelf = root.querySelector('[data-part="home-shelf"]')!
        expect(shelf.className).toContain('@min-[1000px]:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]')
        const list = root.querySelector('[data-part="home-story-rows"]')!
        expect(list.className).toContain('@min-[768px]:grid-cols-2')
        expect(list.className).toContain('@min-[1000px]:grid-cols-1')
        expect(leadCard.querySelector('div.ico')!.className).toContain('w-[var(--home-lead-portrait)]!')
        expect(leadCard.querySelector('div.ico')!.className).not.toContain('portrait-phone')

        const phoneRoot = mountShelf(storiesOf(), 'phone')
        expect(lead(phoneRoot).querySelector('div.ico')!.className).toContain('w-[var(--home-lead-portrait-phone)]!')
    })

    test('S3b-U1: a lone story has no row list and no two-column track', () => {
        setCharacters([warm('a', 6000)])
        const root = mountShelf(storiesOf())
        expect(root.querySelector('[data-part="home-story-rows"]')).toBeNull()
        expect(root.querySelector('[data-part="home-shelf"]')!.className).not.toContain('1.6fr')
    })
})

describe('accessible names', () => {
    test('S3b-U2: a card is named by its name, chat and time, and described by the snippet', () => {
        setCharacters([warm('S1', 6000), warm('G', 5000, { type: 'group' }), buildColdStub(warm('Arch', 4000) as never, 'unit-arch', []) as unknown as Entry])
        const root = mountShelf(storiesOf())
        const [first, group, archived] = cards(root)
        const timeOf = (card: Element) => part(card, 'home-story-time')!.textContent!
        expect(controlName(first)).toBe(`S1 Chat-S1 ${timeOf(first)}`)
        expect(controlDescription(first)).toBe('Line S1')
        expect(controlName(group).startsWith(language.chatShellGroupName('G'))).toBe(true)
        expect(controlName(archived)).toBe(`Arch ${language.homeStoryArchived} ${timeOf(archived)}`)
        expect(controlDescription(archived)).toBe('')
        expect(exposedIcons(root)).toEqual([])
        expect(paletteClasses(root)).toEqual([])
    })
})

describe('snippet', () => {
    test('S3b-R3: markup and macros in the last message render as plain words, never as elements', () => {
        const raw = '<img src=x onerror=alert(1)><a href="javascript:x">l</a>{{char}} *hi*'
        setCharacters([warm('a', 6000, {}, raw)])
        const root = mountShelf(storiesOf())
        const section = root.querySelector('[data-part="home-shelf-section"]')!
        expect(section.querySelector('img')).toBeNull()
        expect(section.querySelector('a')).toBeNull()
        expect(part(lead(root), 'home-story-snippet')!.textContent).toBe('l hi')
        expect(section.querySelector('[onerror]')).toBeNull()
    })
})

describe('open path', () => {
    function archivedPair(): void {
        setCharacters([warm('warm', 6000), buildColdStub(warm('cold', 5000) as never, 'unit-cold', []) as unknown as Entry])
    }
    const card = (root: ParentNode, chaId: string) => cards(root).find((c) => c.dataset.chaId === chaId)!
    const covered = (c: Element) => c.querySelector('[data-charlist-opening]') !== null

    test('S3b-U3: a warm tap opens through the ordinary pick path and shows no cover', () => {
        archivedPair()
        const root = mountShelf(storiesOf())
        h.pick.mockResolvedValue('selected')
        card(root, 'warm').click()
        expect(h.pick).toHaveBeenCalledTimes(1)
        expect(h.pick).toHaveBeenCalledWith('home.story', 0)
        expect(covered(card(root, 'warm'))).toBe(false)
        expect(h.switchImported).not.toHaveBeenCalled()
    })

    test('S3b-U3: an archived tap shows the cover once, a repeat tap does nothing, a failed open clears it', async () => {
        archivedPair()
        const root = mountShelf(storiesOf())
        const run = deferred<unknown>()
        h.pick.mockImplementation(() => {
            h.generation++
            return run.promise
        })
        card(root, 'cold').click()
        flushSync()
        expect(h.pick).toHaveBeenCalledWith('home.story', 1)
        expect(covered(card(root, 'cold'))).toBe(true)
        expect(card(root, 'cold').getAttribute('aria-busy')).toBe('true')
        card(root, 'cold').click()
        expect(h.pick).toHaveBeenCalledTimes(1)

        run.resolve({ failed: 'missing' })
        await vi.waitFor(() => {
            flushSync()
            expect(covered(card(root, 'cold'))).toBe(false)
        })
    })

    test('S3b-U3: unmount while the open is pending and nothing is selected supersedes it once', async () => {
        archivedPair()
        const root = mountShelf(storiesOf())
        h.pick.mockImplementation(() => {
            h.generation++
            return new Promise(() => {})
        })
        card(root, 'cold').click()
        flushSync()
        await unmount(instances.pop() as never)
        expect(h.supersede).toHaveBeenCalledTimes(1)
    })

    test('S3b-U3: unmount after the open selected does not supersede', async () => {
        archivedPair()
        const root = mountShelf(storiesOf())
        h.pick.mockImplementation(() => {
            h.generation++
            selectedCharID.set(0)
            return new Promise(() => {})
        })
        card(root, 'cold').click()
        flushSync()
        await unmount(instances.pop() as never)
        expect(get(selectedCharID)).toBe(0)
        expect(h.supersede).not.toHaveBeenCalled()
    })

    test('S3b-U3: unmount after another pick moved the generation does not supersede', async () => {
        archivedPair()
        const root = mountShelf(storiesOf())
        h.pick.mockImplementation(() => {
            h.generation++
            return new Promise(() => {})
        })
        card(root, 'cold').click()
        flushSync()
        h.generation++
        await unmount(instances.pop() as never)
        expect(h.supersede).not.toHaveBeenCalled()
    })

    test('S3b-U3: unmount with no open pending never supersedes', async () => {
        archivedPair()
        mountShelf(storiesOf())
        await unmount(instances.pop() as never)
        expect(h.supersede).not.toHaveBeenCalled()
    })
})

describe('time tick', () => {
    test('S3b-U4: the label moves on the minute tick and on visibilitychange; the timer is cleared on unmount', async () => {
        vi.useFakeTimers()
        const T = Date.UTC(2026, 10, 21, 12)
        vi.setSystemTime(T)
        setCharacters([warm('a', T - 30_000)])
        const before = vi.getTimerCount()
        const root = mountShelf(storiesOf())
        const label = () => part(lead(root), 'home-story-time')!.textContent
        expect(label()).toBe(language.homeStoryJustNow)
        expect(vi.getTimerCount()).toBe(before + 1)

        vi.advanceTimersByTime(60_000)
        flushSync()
        expect(label()).toBe('1 minute ago')

        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
        vi.setSystemTime(T + 5 * 60_000 + 60_000)
        document.dispatchEvent(new Event('visibilitychange'))
        flushSync()
        expect(label()).toBe('6 minutes ago')

        await unmount(instances.pop() as never)
        expect(vi.getTimerCount()).toBe(before)
    })
})
