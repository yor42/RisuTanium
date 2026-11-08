// @vitest-environment jsdom

/**
 * Home's empty states inside the real `HomeShell` landing: the read-only persona chip and the
 * zero-live-characters hero. The hero follows the unfiltered character list, Create and Import
 * each guard only their own button, a cancelled or non-character import selects nothing, and the
 * chip only opens Settings at Personas.
 *
 * MOCKED: the module set of `HomeShell.svelte.test.ts`, with `stores.svelte` extended by the
 * persona fields and the two Settings stores, and `src/ts/characters` reduced to the two spies
 * the actions call. Elements are found by `data-part` and role, never by the new language keys.
 */

import { flushSync, mount, tick, unmount } from 'svelte'
import { get, writable } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { UPSTREAM_AGREEMENT_KEY, resetUpstreamAgreementForTests } from 'src/ts/upstreamAgreement'
import { resetBackHandlersForTests } from 'src/ts/backHandlers'
import { firstIndexOf } from 'src/ts/settingsShell/settingsPages'

//#region module mocks

const createNewCharacterSpy = vi.hoisted(() => vi.fn())
const changeCharSpy = vi.hoisted(() => vi.fn())
const importCharacterSpy = vi.hoisted(() => vi.fn())
const createCharacterFromHomeSpy = vi.hoisted(() => vi.fn())

// Wraps the real action: every call is counted on entry and then runs unchanged.
vi.mock(import('./homeEmptyActions'), async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        createCharacterFromHome: () => {
            createCharacterFromHomeSpy()
            return actual.createCharacterFromHome()
        },
    }
})

vi.mock(import('src/ts/characterCards'), () => ({
    hubURL: 'https://hub.test',
    getRisuHub: vi.fn(() => new Promise(() => {})),
    importCharacter: importCharacterSpy,
}) as unknown as typeof import('src/ts/characterCards'))

vi.mock('src/ts/characters', () => ({
    createNewCharacter: createNewCharacterSpy,
    changeChar: changeCharSpy,
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
import { DBState, OpenRealmStore, SettingsMenuIndex, settingsOpen } from 'src/ts/stores.svelte'

type Slot = { chaId: string, name: string, type?: string, trashTime?: number }
type PersonaEntry = { name: string }
type HomeDb = {
    characters: Slot[]
    username: string
    personas: PersonaEntry[]
    selectedPersona: number
}

const db = (): HomeDb => DBState.db as unknown as HomeDb

function slot(chaId: string, extra: Partial<Slot> = {}): Slot {
    return { chaId, name: chaId, type: 'character', ...extra }
}

function resetDb(characters: Slot[]): void {
    DBState.db = {
        hideRealm: false,
        realmDirectOpen: false,
        hideAllImages: false,
        characters,
        username: 'Juno',
        personas: [{ name: 'Juno' }, { name: 'Other' }],
        selectedPersona: 1,
    } as unknown as typeof DBState.db
}

const mountedInstances: unknown[] = []
const mountedTargets: HTMLElement[] = []

function mountShell(): HTMLElement {
    const target = document.createElement('div')
    document.body.appendChild(target)
    mountedTargets.push(target)
    mountedInstances.push(mount(HomeShell, { target }))
    flushSync()
    return target
}

const heroOf = (root: HTMLElement): HTMLElement | null => root.querySelector('[data-part="home-empty-hero"]')
const chipOf = (root: HTMLElement): HTMLButtonElement | null => root.querySelector('[data-part="home-persona-chip"]')

function heroButtons(root: HTMLElement): HTMLButtonElement[] {
    const hero = heroOf(root)
    if (!hero) {
        throw new Error('hero not found')
    }
    return Array.from(hero.querySelectorAll('button'))
}

// The hero lists Create first and Import second.
const createButton = (root: HTMLElement): HTMLButtonElement => heroButtons(root)[0]
const importButton = (root: HTMLElement): HTMLButtonElement => heroButtons(root)[1]

// Mirrors `createNewCharacter`: a live blank slot is pushed and its index returned.
function pushLiveSlot(): number {
    db().characters.push(slot(`new-${db().characters.length}`))
    return db().characters.length - 1
}

function holdPromise(): { promise: Promise<void>, release: () => void } {
    let release: () => void = () => {}
    const promise = new Promise<void>((resolve) => {
        release = resolve
    })
    return { promise, release }
}

beforeEach(() => {
    localStorage.setItem(UPSTREAM_AGREEMENT_KEY, 'accepted')
    resetUpstreamAgreementForTests()
    resetBackHandlersForTests()
    showHomeLanding()
    createNewCharacterSpy.mockReset()
    changeCharSpy.mockReset()
    importCharacterSpy.mockReset()
    createCharacterFromHomeSpy.mockReset()
    createNewCharacterSpy.mockImplementation(pushLiveSlot)
    changeCharSpy.mockResolvedValue(undefined)
    importCharacterSpy.mockResolvedValue(undefined)
    SettingsMenuIndex.set(-1)
    settingsOpen.set(false)
    resetDb([slot('§playground'), slot('a', { trashTime: 5 })])
})

afterEach(async () => {
    OpenRealmStore.set(false)
    for (const instance of mountedInstances.splice(0)) {
        await unmount(instance as never).catch(() => {})
    }
    mountedTargets.splice(0).forEach((t) => t.remove())
    document.body.replaceChildren()
    resetBackHandlersForTests()
    showHomeLanding()
    localStorage.removeItem(UPSTREAM_AGREEMENT_KEY)
    resetUpstreamAgreementForTests()
})

describe('Home persona chip and empty hero', () => {
    test('R1: only a hidden system character and a trashed one show the hero; the cards stay', () => {
        const root = mountShell()
        expect(heroOf(root)).not.toBeNull()
        expect(Array.from(root.querySelectorAll('h2')).some((h) => !heroOf(root)!.contains(h))).toBe(true)
    })

    test('R2: the chip shows the username, not the selected persona list entry', () => {
        db().username = 'Juno'
        db().personas = [{ name: 'User' }, { name: 'Other' }]
        db().selectedPersona = 0
        const root = mountShell()
        const chip = chipOf(root)
        expect(chip).not.toBeNull()
        expect(chip!.textContent).toContain(language.homePersonaChip('Juno'))
    })

    test('B3: a live character hides the hero; trashing it, restoring it and a DB swap follow', () => {
        resetDb([slot('a')])
        const root = mountShell()
        expect(heroOf(root)).toBeNull()

        db().characters[0].trashTime = 7
        flushSync()
        expect(heroOf(root)).not.toBeNull()

        db().characters[0].trashTime = undefined
        flushSync()
        expect(heroOf(root)).toBeNull()

        resetDb([slot('§temp')])
        flushSync()
        expect(heroOf(root)).not.toBeNull()

        resetDb([slot('b')])
        flushSync()
        expect(heroOf(root)).toBeNull()
    })

    test('B4a: Create makes one character, then selects its index; a double tap creates once', async () => {
        const root = mountShell()
        const create = createButton(root)
        create.click()
        create.click()

        await vi.waitFor(() => expect(changeCharSpy).toHaveBeenCalledTimes(1))
        // The action entry point is counted before its first await: a second tap that passes the
        // handler guard enters it at once, whereas its dynamic import of the mocked character module
        // may never settle in this runner, so the character spies alone cannot observe it.
        expect(createCharacterFromHomeSpy).toHaveBeenCalledTimes(1)
        expect(createNewCharacterSpy).toHaveBeenCalledTimes(1)
        expect(changeCharSpy).toHaveBeenCalledWith(2)
        expect(createNewCharacterSpy.mock.invocationCallOrder[0]).toBeLessThan(changeCharSpy.mock.invocationCallOrder[0])
    })

    test('B4b: a pending import does not block Create', async () => {
        const held = holdPromise()
        importCharacterSpy.mockReturnValue(held.promise)
        const root = mountShell()
        const create = createButton(root)
        const importing = importButton(root)

        importing.click()
        await vi.waitFor(() => expect(importCharacterSpy).toHaveBeenCalledTimes(1))
        create.click()

        await vi.waitFor(() => expect(createNewCharacterSpy).toHaveBeenCalledTimes(1))
        held.release()
        await tick()
        expect(createNewCharacterSpy).toHaveBeenCalledTimes(1)
    })

    test('B5: an import that adds nothing selects nothing and keeps the hero; one that adds selects the last slot', async () => {
        const root = mountShell()
        importButton(root).click()
        await vi.waitFor(() => expect(importCharacterSpy).toHaveBeenCalledTimes(1))
        await vi.waitFor(() => expect(importButton(root).disabled).toBe(false))
        expect(changeCharSpy).not.toHaveBeenCalled()
        expect(heroOf(root)).not.toBeNull()

        importCharacterSpy.mockImplementation(async () => {
            pushLiveSlot()
        })
        importButton(root).click()
        await vi.waitFor(() => expect(changeCharSpy).toHaveBeenCalledTimes(1))
        expect(changeCharSpy).toHaveBeenCalledWith(db().characters.length - 1)
    })

    test('B5b: after an import that added nothing, Import works again', async () => {
        const root = mountShell()
        importButton(root).click()
        await vi.waitFor(() => expect(importCharacterSpy).toHaveBeenCalledTimes(1))
        await vi.waitFor(() => expect(importButton(root).disabled).toBe(false))

        importButton(root).click()
        await vi.waitFor(() => expect(importCharacterSpy).toHaveBeenCalledTimes(2))
    })

    test('B6: a default or empty name shows the set-up label and not the name', () => {
        for (const name of ['User', '', '  ', ' User ']) {
            db().username = name
            const root = mountShell()
            const chip = chipOf(root)!
            expect(chip.textContent).toContain(language.homePersonaChipUnnamed)
            expect(chip.textContent).not.toContain('User')
        }
    })

    test('B7: the chip opens Settings at Personas and changes no persona field', () => {
        const root = mountShell()
        const before = JSON.stringify({ u: db().username, s: db().selectedPersona, p: db().personas })

        chipOf(root)!.click()

        expect(get(SettingsMenuIndex)).toBe(firstIndexOf('personas'))
        expect(get(settingsOpen)).toBe(true)
        expect(JSON.stringify({ u: db().username, s: db().selectedPersona, p: db().personas })).toBe(before)
        expect(db().selectedPersona).toBe(1)
    })

    test('B8: the chip carries the hint and the Settings-path text in its accessible name', () => {
        const root = mountShell()
        const text = chipOf(root)!.textContent ?? ''
        expect(text).toContain(language.homePersonaChipHint)
        expect(text).toContain(language.homePersonaChipGo)
    })

    test('B9: neither the chip nor the hero renders while the Realm view is open', () => {
        const root = mountShell()
        expect(chipOf(root)).not.toBeNull()
        expect(heroOf(root)).not.toBeNull()

        OpenRealmStore.set(true)
        flushSync()
        expect(chipOf(root)).toBeNull()
        expect(heroOf(root)).toBeNull()

        OpenRealmStore.set(false)
        flushSync()
        expect(chipOf(root)).not.toBeNull()
        expect(heroOf(root)).not.toBeNull()
    })

    test('B10: the hero has exactly two buttons and no link', () => {
        const root = mountShell()
        expect(heroButtons(root).length).toBe(2)
        expect(heroOf(root)!.querySelectorAll('a').length).toBe(0)
    })

    test('B11: the chip comes first, then the hero, then the cards', () => {
        const root = mountShell()
        const chip = chipOf(root)!
        const hero = heroOf(root)!
        expect(chip.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

        // The card headings are the h2s after the version h3 that sit outside the hero.
        const version = root.querySelector('h3')!
        const cardHeadings = Array.from(root.querySelectorAll('h2')).filter(
            (h) => !hero.contains(h) && (version.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        )
        expect(cardHeadings.length).toBeGreaterThan(0)
        for (const heading of cardHeadings) {
            expect(hero.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
        }
    })
})
