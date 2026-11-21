// @vitest-environment jsdom

/**
 * The story shelf inside the real `HomeShell` landing: which characters it shows and in what order, the
 * snapshot of the chat label and last line taken when the shell is created, the live archived and
 * trashed states, the hidden states, and a time no Date can hold.
 *
 * REAL: `HomeShell`, `MainMenu`, `HomeStoryShelf`, `homeStories`, `storySnippet`, `storyTime`,
 * `buildColdStub`. MOCKED: the module set of `HomeShell.empties.svelte.test.ts`, with `stores.svelte`
 * extended by `selectedCharID`, `src/ts/characters` extended by the helpers the shelf imports, and
 * `characterPick` replaced by a spy. Elements are found by `data-part`; fixture text is the assertion.
 */

import { flushSync, mount, unmount } from 'svelte'
import { writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { buildColdStub } from 'src/ts/process/coldCharacter'

//#region module mocks

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: vi.fn(() => new Promise(() => {})),
    importCharacter: vi.fn(),
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock('src/ts/characters', () => ({
    createNewCharacter: vi.fn(),
    changeChar: vi.fn(),
    getCharImage: vi.fn(async () => ''),
    archivedMemberIds: () => [],
    changeCharGeneration: () => 0,
    supersedeChangeChar: vi.fn(),
}))

vi.mock('src/ts/characterPick', () => ({
    changeCharOrAlert: vi.fn(async () => 'selected'),
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    getVersionString: vi.fn(() => 'test-version'),
    openURL: vi.fn(),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/stores.svelte'), () => {
    const state = $state({
        db: {
            hideRealm: false,
            realmDirectOpen: false,
            hideAllImages: false,
            characters: [],
            username: 'User',
            personas: [],
            selectedPersona: 0,
        } as unknown as Record<string, unknown>,
    })
    return {
        DBState: state,
        OpenRealmStore: writable(false),
        RealmInitialOpenChar: writable(null),
        alertStore: writable({ type: 'none', msg: '' }),
        SettingsMenuIndex: writable(-1),
        settingsOpen: writable(false),
        sideBarStore: writable(false),
        selectedCharID: writable(-1),
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock('../Realm/RealmMain.svelte', () => ({
    default: (_target: unknown) => ({ destroy: () => {} }),
}))

vi.mock('src/ts/alert', () => ({ alertError: vi.fn() }))

vi.mock('./HomeLibrary.svelte', () => ({ default: (_anchor: Comment) => {} }))

//#endregion

import HomeShell from './HomeShell.svelte'
import { showHomeLanding } from './homeView.svelte'
import { DBState, OpenRealmStore } from 'src/ts/stores.svelte'

type Slot = Record<string, unknown>

function warm(name: string, lastInteraction: number | undefined, extra: Slot = {}): Slot {
    return {
        type: 'character', chaId: name, name, image: '', chatPage: 0, lastInteraction,
        chats: [{ id: `c-${name}`, name: `Chat-${name}`, message: [{ role: 'char', data: `Line ${name}`, time: 1 }], note: '', localLore: [] }],
        ...extra,
    }
}

function setCharacters(characters: Slot[]): void {
    DBState.db = {
        hideRealm: false,
        realmDirectOpen: false,
        hideAllImages: false,
        characters,
        username: 'Juno',
        personas: [{ name: 'Juno' }],
        selectedPersona: 0,
    } as unknown as typeof DBState.db
}

const slots = (): Slot[] => DBState.db.characters as unknown as Slot[]

const instances: unknown[] = []
const targets: HTMLElement[] = []

function mountShell(): { root: HTMLElement, instance: unknown } {
    const target = document.createElement('div')
    document.body.appendChild(target)
    targets.push(target)
    const instance = mount(HomeShell, { target })
    instances.push(instance)
    flushSync()
    return { root: target, instance }
}

const cards = (root: ParentNode) => Array.from(root.querySelectorAll<HTMLElement>('[data-part="home-story"]'))
const order = (root: ParentNode) => cards(root).map((c) => c.dataset.chaId)
const cardOf = (root: ParentNode, chaId: string) => cards(root).find((c) => c.dataset.chaId === chaId)!
const part = (card: Element, name: string) => card.querySelector(`[data-part="${name}"]`)

/** An archive stub from the real producer whose placeholder chats fail loudly when read. */
function archivedStub(source: Slot, unitKey: string): Slot {
    const stub = buildColdStub(source as never, unitKey, []) as unknown as Slot
    Object.defineProperty(stub, 'chats', { get: () => { throw new Error('stub chats read') }, configurable: true })
    return stub
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    showHomeLanding()
    setCharacters([])
})

afterEach(async () => {
    OpenRealmStore.set(false)
    for (const instance of instances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    targets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetBackHandlersForTests()
    showHomeLanding()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

describe('the shelf on the landing', () => {
    test('S3b-R1: lead plus five rows, most recent first, the heading first in the main column', () => {
        setCharacters(Array.from({ length: 8 }, (_, i) => warm(`S${i + 1}`, (8 - i) * 1000)))
        const { root } = mountShell()
        const stage = root.querySelector('[data-part="home-stage"]')!
        expect(stage.textContent).toContain('S1')
        expect(stage.textContent).toContain('Chat-S1')
        expect(stage.textContent).toContain('Line S1')
        expect(order(root)).toEqual(['S1', 'S2', 'S3', 'S4', 'S5', 'S6'])
        expect(stage.textContent).not.toContain('S7')
        expect(stage.textContent).not.toContain('S8')
        expect(stage.parentElement!.firstElementChild).toBe(stage)
        const heading = root.querySelector('[data-part="home-shelf-section"] h2')!
        expect(heading.textContent).toBe(language.homeStoriesHeading)
        const side = root.querySelector('aside[data-part="home-side"]')!
        expect(heading.compareDocumentPosition(side) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        expect(part(cardOf(root, 'S1'), 'home-story-snippet')!.className).toContain('line-clamp-2')
    })

    test('S3b-R2: an archived card shows the name, the tag and the time, reads no chats and shows no text', () => {
        setCharacters([
            archivedStub(warm('Arch', 9000), 'unit-arch'),
            warm('S1', 1000),
        ])
        // The probe fires through the reactive proxy: a read of the stub's chats throws.
        expect(() => (slots()[0] as { chats: unknown }).chats).toThrow('stub chats read')
        const { root } = mountShell()
        const first = cards(root)[0]
        expect(first.dataset.chaId).toBe('Arch')
        expect(first.textContent).toContain('Arch')
        expect(first.textContent).not.toContain(language.settingsPage.unnamed)
        expect(part(first, 'home-story-archived')).not.toBeNull()
        expect(part(first, 'home-story-chat')).toBeNull()
        expect(part(first, 'home-story-snippet')).toBeNull()
        expect(part(first, 'home-story-time')).not.toBeNull()
    })

    test('S3b-R8: a warm card archived while Home is shown gains the tag and loses its text; the order holds', () => {
        const s1 = warm('S1', 9000)
        setCharacters([s1, warm('S2', 1000)])
        const { root } = mountShell()
        expect(cardOf(root, 'S1').textContent).toContain('Chat-S1')
        expect(cardOf(root, 'S1').textContent).toContain('Line S1')
        expect(part(cardOf(root, 'S1'), 'home-story-archived')).toBeNull()

        slots()[0] = buildColdStub(s1 as never, 'unit-s1', []) as unknown as Slot
        flushSync()
        const after = cardOf(root, 'S1')
        expect(part(after, 'home-story-archived')).not.toBeNull()
        expect(part(after, 'home-story-chat')).toBeNull()
        expect(part(after, 'home-story-snippet')).toBeNull()
        expect(after.textContent).not.toContain('Chat-S1')
        expect(after.textContent).not.toContain('Line S1')
        expect(order(root)).toEqual(['S1', 'S2'])
    })

    test('S3b-R9: a time no Date can hold reads just now with no datetime attribute and does not throw', () => {
        setCharacters([warm('X', Infinity), warm('Y', 8.7e15), warm('Z', 1000)])
        const { root } = mountShell()
        expect(order(root)).toEqual(['X', 'Y', 'Z'])
        for (const id of ['X', 'Y']) {
            const time = part(cardOf(root, id), 'home-story-time')!
            expect(time.textContent).toBe(language.homeStoryJustNow)
            expect(time.hasAttribute('datetime')).toBe(false)
        }
        expect(part(cardOf(root, 'Z'), 'home-story-time')!.getAttribute('datetime')).toBe(new Date(1000).toISOString())
    })

    test('S3b-R7: an empty current chat shows its label and no last line, never the first message', () => {
        const entry = warm('E', 5000, { firstMessage: 'FM-MARKER' })
        ;(entry.chats as { message: unknown[] }[])[0].message = []
        setCharacters([entry])
        const { root } = mountShell()
        const card = cardOf(root, 'E')
        expect(part(card, 'home-story-chat')!.textContent).toBe('Chat-E')
        expect(part(card, 'home-story-snippet')).toBeNull()
        expect(card.textContent).not.toContain('FM-MARKER')
    })
})

describe('the snapshot', () => {
    test('S3b-R4: the order is fixed while the shell lives, a trashed story leaves at once, the next shell re-sorts', () => {
        setCharacters([warm('S1', 3000), warm('S2', 2000), warm('S3', 1000)])
        const first = mountShell()
        expect(order(first.root)).toEqual(['S1', 'S2', 'S3'])

        slots()[2].lastInteraction = 9000
        flushSync()
        expect(order(first.root)).toEqual(['S1', 'S2', 'S3'])

        OpenRealmStore.set(true)
        flushSync()
        OpenRealmStore.set(false)
        flushSync()
        expect(order(first.root)).toEqual(['S1', 'S2', 'S3'])

        slots()[1].trashTime = 7
        flushSync()
        expect(order(first.root)).toEqual(['S1', 'S3'])

        const second = mountShell()
        expect(order(second.root)).toEqual(['S3', 'S1'])
    })

    test('S3b-R5: a new last line and a renamed chat do not reach the card; a renamed character does', () => {
        setCharacters([warm('S1', 3000)])
        const { root } = mountShell()
        const chats = slots()[0].chats as { name: string, message: { role: string, data: string, time: number }[] }[]
        chats[0].message.push({ role: 'user', data: 'New line', time: 2 })
        chats[0].name = 'Renamed chat'
        slots()[0].name = 'S1b'
        flushSync()
        const card = cardOf(root, 'S1')
        expect(card.textContent).toContain('S1b')
        expect(card.textContent).toContain('Line S1')
        expect(card.textContent).toContain('Chat-S1')
        expect(card.textContent).not.toContain('New line')
        expect(card.textContent).not.toContain('Renamed chat')

        const next = mountShell()
        expect(cardOf(next.root, 'S1').textContent).toContain('New line')
        expect(cardOf(next.root, 'S1').textContent).toContain('Renamed chat')
    })
})

describe('hidden states', () => {
    test('S3b-R6: zero characters render no shelf section, no heading and no stage', () => {
        setCharacters([])
        const { root } = mountShell()
        expect(root.querySelector('[data-part="home-shelf-section"]')).toBeNull()
        expect(root.textContent).not.toContain(language.homeStoriesHeading)
        expect(root.querySelector('[data-part="home-stage"]')).toBeNull()
        const columns = root.querySelector('[data-part="home-columns"]')!
        expect(columns.firstElementChild!.getAttribute('data-part')).toBe('home-side')
    })

    const withLibrary: [string, () => Slot[]][] = [
        ['only never-opened characters', () => [warm('a', 0), warm('b', undefined), warm('c', 0)]],
        ['only trashed characters', () => [warm('a', 5000, { trashTime: 3 }), warm('b', 4000, { trashTime: 3 })]],
    ]
    test.each(withLibrary)('S3b-R6 (S4a-G3): %s render no shelf section and no shelf heading; the stage holds exactly the library section', (_name, build) => {
        setCharacters(build())
        const { root } = mountShell()
        expect(root.querySelector('[data-part="home-shelf-section"]')).toBeNull()
        expect(root.textContent).not.toContain(language.homeStoriesHeading)
        const stage = root.querySelector('[data-part="home-stage"]')!
        expect(stage).not.toBeNull()
        expect(Array.from(stage.children).map((c) => c.getAttribute('data-part'))).toEqual(['home-library'])
        const columns = root.querySelector('[data-part="home-columns"]')!
        expect(columns.firstElementChild).toBe(stage)
    })
})
