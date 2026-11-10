/**
 * The restore's decisions and the recorder, with every source and the pick injected: which starting
 * conditions refuse a restore, which arrivals cancel a pending one, what each way the restore ends leaves
 * in the memory, and what a later selection records. The real `changeChar` is `lastCharacterRestore.changeChar.svelte.test.ts`.
 *
 * The fake pick behaves like `changeChar`: it counts itself in the generation synchronously, and when it
 * lands it selects only while it still holds the latest generation.
 */
import { get, writable, readable, type Writable } from 'svelte/store'
import { describe, expect, test, vi } from 'vitest'
import type { ChangeCharOutcome } from './characters'
import { startLastCharacterRestore, type RestoreDeps, type RestoreEnd, type RestorePickOptions } from './lastCharacterRestore'

// Every dependency is injected, so the production sources are never read; they are stubbed to keep the
// app's store effects out of this unit.
vi.mock(import('src/ts/stores.svelte'), () => ({}) as unknown as typeof import('src/ts/stores.svelte'))
vi.mock(import('src/ts/characters'), () => ({}) as unknown as typeof import('src/ts/characters'))
vi.mock(import('src/ts/characterPick'), () => ({}) as unknown as typeof import('src/ts/characterPick'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/drive/restoreInProgress'), () => ({}) as unknown as typeof import('src/ts/drive/restoreInProgress'))
vi.mock(import('src/ts/process/memory/busyActions'), () => ({}) as unknown as typeof import('src/ts/process/memory/busyActions'))
vi.mock(import('src/ts/studio/studioOpen'), () => ({}) as unknown as typeof import('src/ts/studio/studioOpen'))
vi.mock(import('src/lib/Utility/utilityGate'), () => ({}) as unknown as typeof import('src/lib/Utility/utilityGate'))
vi.mock(import('src/lib/UI/Home/homeView.svelte'), () => ({}) as unknown as typeof import('src/lib/UI/Home/homeView.svelte'))

interface PickCall {
    index: number
    options: RestorePickOptions
    generation: number
    land: (outcome?: ChangeCharOutcome | 'error') => void
}

interface World {
    deps: RestoreDeps
    picks: PickCall[]
    writes: Array<string | null>
    supersedes: { count: number }
    characters: unknown[]
    state: {
        stored: string | null
        generation: number
        readOnly: boolean
        didFirstSetup: boolean
        botSettingAtStart: boolean
        restoring: boolean
        busy: string[]
        alertType: string
        realmUrl: boolean
    }
    selected: Writable<number>
    settings: Writable<boolean>
    studio: Writable<boolean>
    customGui: Writable<boolean>
    botMaker: Writable<boolean>
    playground: Writable<number>
    utility: Writable<boolean>
    realm: Writable<boolean>
    library: Writable<boolean>
}

function makeWorld(options: { characters?: unknown[], stored?: string | null } = {}): World {
    const characters = options.characters ?? [{ chaId: 'c0' }, { chaId: 'c1' }, { chaId: 'c2' }]
    const state: World['state'] = {
        stored: options.stored === undefined ? 'c1' : options.stored,
        generation: 0,
        readOnly: false,
        didFirstSetup: true,
        botSettingAtStart: false,
        restoring: false,
        busy: [],
        alertType: 'none',
        realmUrl: false,
    }
    const picks: PickCall[] = []
    const writes: Array<string | null> = []
    const supersedes = { count: 0 }
    const selected = writable(-1)
    const settings = writable(false)
    const studio = writable(false)
    const customGui = writable(false)
    const botMaker = writable(false)
    const playground = writable(0)
    const utility = writable(false)
    const realm = writable(false)
    const library = writable(false)
    const deps: RestoreDeps = {
        readOnlyPage: () => state.readOnly,
        storedChaId: () => state.stored,
        characters: () => characters,
        characterAt: (index) => characters[index],
        didFirstSetup: () => state.didFirstSetup,
        botSettingAtStart: () => state.botSettingAtStart,
        botMakerMode: botMaker,
        selectedCharID: selected,
        settingsOpen: settings,
        studioOpen: studio,
        customGuiMenu: customGui,
        playground,
        utilityOpen: utility,
        realmStore: realm,
        library: { isOpen: () => get(library), watch: () => library },
        restoreInProgress: () => state.restoring,
        busyKinds: () => state.busy,
        alertType: () => state.alertType,
        realmLinkInUrl: () => state.realmUrl,
        pick: (index, pickOptions) => {
            const generation = ++state.generation
            return new Promise((resolve) => {
                picks.push({
                    index,
                    options: pickOptions,
                    generation,
                    land: (outcome = 'selected') => {
                        if (outcome === 'selected') {
                            if (generation !== state.generation) {
                                resolve('superseded')
                                return
                            }
                            selected.set(index)
                        }
                        resolve(outcome)
                    },
                })
            })
        },
        generation: () => state.generation,
        supersede: () => {
            supersedes.count++
            state.generation++
        },
        write: (chaId) => { writes.push(chaId) },
    }
    return { deps, picks, writes, supersedes, characters, state, selected, settings, studio, customGui, botMaker, playground, utility, realm, library }
}

/** A user pick: it counts itself in the generation, as `changeChar` does, and selects at once. */
function userPick(world: World, index: number): void {
    world.state.generation++
    world.selected.set(index)
}

describe('the start of a restore', () => {
    test('O1: a remembered live character is picked with keepInteraction and quiet, once', async () => {
        const world = makeWorld()
        const end = startLastCharacterRestore(world.deps)

        expect(world.picks).toHaveLength(1)
        expect(world.picks[0].index).toBe(1)
        expect(world.picks[0].options).toEqual({ keepInteraction: true, quiet: true })
        world.picks[0].land()

        expect(await end).toBe('selected')
        expect(get(world.selected)).toBe(1)
    })

    test('O1: an archived stub and a group are picked like any character', async () => {
        const world = makeWorld({ characters: [{ chaId: 'c0' }, { chaId: 'cold', coldstorage: 'u' }, { chaId: 'team', type: 'group' }], stored: 'team' })
        startLastCharacterRestore(world.deps)

        expect(world.picks.map((pick) => pick.index)).toEqual([2])
    })

    test('a toast and no alert are both quiet enough; an unrelated busy kind does not stop it', () => {
        for (const alertType of ['none', 'toast']) {
            const world = makeWorld()
            world.state.alertType = alertType
            world.state.busy = ['export', 'cleanup']
            startLastCharacterRestore(world.deps)

            expect(world.picks, alertType).toHaveLength(1)
        }
    })

    const refusals: Array<[string, (world: World) => void]> = [
        ['nothing remembered', (world) => { world.state.stored = null }],
        ['a remembered id that is not in the list', (world) => { world.state.stored = 'gone' }],
        ['a remembered trashed character', (world) => { world.characters[1] = { chaId: 'c1', trashTime: 5 } }],
        ['a remembered hidden character', (world) => { world.characters[1] = { chaId: '§playground' }; world.state.stored = '§playground' }],
        ['first setup not done', (world) => { world.state.didFirstSetup = false }],
        ['bot setting at start', (world) => { world.state.botSettingAtStart = true }],
        ['bot-maker mode', (world) => { world.botMaker.set(true) }],
        ['a character already selected', (world) => { world.selected.set(0) }],
        ['Settings open', (world) => { world.settings.set(true) }],
        ['Studio open', (world) => { world.studio.set(true) }],
        ['the Custom GUI menu open', (world) => { world.customGui.set(true) }],
        ['the playground open', (world) => { world.playground.set(2) }],
        ['a backup restore under way', (world) => { world.state.restoring = true }],
        ['an import under way', (world) => { world.state.busy = ['import'] }],
        ['a backup load under way', (world) => { world.state.busy = ['export', 'backupLoad'] }],
        ['a waiting alert', (world) => { world.state.alertType = 'wait' }],
        ['a normal alert', (world) => { world.state.alertType = 'normal' }],
        ['a realm link in the address', (world) => { world.state.realmUrl = true }],
        ['Utility open', (world) => { world.utility.set(true) }],
        ['the Hub open', (world) => { world.realm.set(true) }],
        ['the Home library open', (world) => { world.library.set(true) }],
    ]

    test.each(refusals)('O2: no pick when there is %s', async (_name, arrange) => {
        const world = makeWorld()
        arrange(world)

        const end = await startLastCharacterRestore(world.deps)

        expect(world.picks).toHaveLength(0)
        expect(end).toBe('skipped')
        expect(world.supersedes.count).toBe(0)
    })

    test('S7: a read-only page neither restores nor remembers', async () => {
        const world = makeWorld()
        world.state.readOnly = true

        const end = await startLastCharacterRestore(world.deps)
        world.selected.set(2)
        world.selected.set(-1)

        expect(end).toBe('read-only')
        expect(world.picks).toHaveLength(0)
        expect(world.writes).toEqual([])
    })
})

describe('a restore that waits', () => {
    const arrivals: Array<[string, (world: World) => void]> = [
        ['Settings', (world) => world.settings.set(true)],
        ['Studio', (world) => world.studio.set(true)],
        ['the Custom GUI menu', (world) => world.customGui.set(true)],
        ['bot-maker mode', (world) => world.botMaker.set(true)],
        ['the playground', (world) => world.playground.set(2)],
        ['Utility', (world) => world.utility.set(true)],
        ['the Hub', (world) => world.realm.set(true)],
        ['the Home library', (world) => world.library.set(true)],
    ]

    test.each(arrivals)('O3: %s opening while the pick waits supersedes it, and the selection never lands', async (_name, open) => {
        const world = makeWorld()
        const end = startLastCharacterRestore(world.deps)

        open(world)
        world.picks[0].land()

        expect(await end).toBe('superseded')
        expect(get(world.selected)).toBe(-1)
        expect(world.supersedes.count).toBe(1)
    })

    test('O3: the restore is superseded once; a second surface opening after the first adds nothing', async () => {
        const world = makeWorld()
        const end = startLastCharacterRestore(world.deps)

        world.settings.set(true)
        world.studio.set(true)
        world.settings.set(false)
        world.picks[0].land()
        await end

        expect(world.supersedes.count).toBe(1)
    })

    test('O3: the watchers ignore the value the stores already held when they were armed', async () => {
        const world = makeWorld()
        const end = startLastCharacterRestore(world.deps)
        world.picks[0].land()

        expect(await end).toBe('selected')
        expect(world.supersedes.count).toBe(0)
    })

    test.each(arrivals)('O4: after the user picked, %s opening does not supersede anything', async (_name, open) => {
        const world = makeWorld()
        const end = startLastCharacterRestore(world.deps)

        userPick(world, 0)
        open(world)
        world.picks[0].land()

        expect(await end).toBe('superseded')
        expect(world.supersedes.count).toBe(0)
        expect(get(world.selected)).toBe(0)
    })

    test('S6: a user pick during a pending restore wins and is recorded', async () => {
        const world = makeWorld()
        const end = startLastCharacterRestore(world.deps)

        userPick(world, 2)
        world.picks[0].land()
        await end

        expect(get(world.selected)).toBe(2)
        expect(world.writes).toEqual(['c2'])
    })

    test('O8: once the restore has ended, no surface opening supersedes anything and the watchers are released', async () => {
        const world = makeWorld()
        const live = { settings: 0, library: 0 }
        const watched = (name: keyof typeof live, store: Writable<boolean>) => readable(false, (set) => {
            live[name]++
            const stop = store.subscribe(set)
            return () => { live[name]--; stop() }
        })
        const deps: RestoreDeps = {
            ...world.deps,
            settingsOpen: watched('settings', world.settings),
            library: { isOpen: () => get(world.library), watch: () => watched('library', world.library) },
        }
        const end = startLastCharacterRestore(deps)

        expect(live).toEqual({ settings: 1, library: 1 })
        world.picks[0].land()
        await end

        world.settings.set(true)
        world.utility.set(true)
        world.realm.set(true)
        world.library.set(true)
        world.studio.set(true)
        world.customGui.set(true)
        world.botMaker.set(true)
        world.playground.set(1)

        expect(world.supersedes.count).toBe(0)
        expect(live).toEqual({ settings: 0, library: 0 })
    })
})

describe('how a restore ends', () => {
    const endings: Array<[string, ChangeCharOutcome | 'error', RestoreEnd]> = [
        ['a refused restore', { failed: 'missing' } as unknown as ChangeCharOutcome, 'failed'],
        ['a character no longer in the list', 'gone', 'gone'],
        ['a thrown pick', 'error', 'error'],
        ['a superseded pick', 'superseded', 'superseded'],
    ]

    test.each(endings)('O5: %s leaves the memory untouched and the app on Home', async (_name, outcome, expected) => {
        const world = makeWorld()
        const end = startLastCharacterRestore(world.deps)
        world.picks[0].land(outcome)

        expect(await end).toBe(expected)
        expect(world.writes).toEqual([])
        expect(get(world.selected)).toBe(-1)
    })

    test('O5: a pick that rejects ends as an error without a rejection', async () => {
        const world = makeWorld()
        world.deps.pick = () => Promise.reject(new Error('boom'))

        await expect(startLastCharacterRestore(world.deps)).resolves.toBe('error')
        expect(world.writes).toEqual([])
    })
})

describe('the recorder', () => {
    test('O6: the store\'s current Home is not a selection, with or without a restore', async () => {
        const failing = makeWorld()
        const end = startLastCharacterRestore(failing.deps)
        failing.picks[0].land({ failed: 'missing' } as unknown as ChangeCharOutcome)
        await end
        const skipped = makeWorld({ stored: null })
        await startLastCharacterRestore(skipped.deps)

        expect(failing.writes).toEqual([])
        expect(skipped.writes).toEqual([])
    })

    test('R3: a later selection is recorded by chaId and Home forgets it', async () => {
        const world = makeWorld({ stored: null })
        await startLastCharacterRestore(world.deps)

        world.selected.set(2)
        world.selected.set(-1)

        expect(world.writes).toEqual(['c2', null])
    })

    test('a repeated selection of the same character writes once; Home in between lets it write again', async () => {
        const world = makeWorld({ stored: null })
        await startLastCharacterRestore(world.deps)

        world.selected.set(1)
        world.selected.set(2)
        world.selected.set(2)
        world.selected.set(-1)
        world.selected.set(2)

        expect(world.writes).toEqual(['c1', 'c2', null, 'c2'])
    })

    test('a selection that moves to another index holding the same character (a reorder) writes once', async () => {
        const world = makeWorld({ stored: null })
        await startLastCharacterRestore(world.deps)

        world.selected.set(1)
        world.characters.unshift(world.characters.splice(1, 1)[0])
        world.selected.set(0)

        expect(world.writes).toEqual(['c1'])
    })

    test('a restore that selects after the recorder is armed records the restored character', async () => {
        const world = makeWorld()
        const end = startLastCharacterRestore(world.deps)
        world.picks[0].land()
        await end

        expect(world.writes).toEqual(['c1'])
    })

    test('O6b: a hidden or trashed selection records Home, a missing entry keeps the memory', async () => {
        const world = makeWorld({ stored: null, characters: [{ chaId: 'c0' }, { chaId: '§playground' }, { chaId: 'c2', trashTime: 9 }] })
        await startLastCharacterRestore(world.deps)

        world.selected.set(0)
        world.selected.set(1)
        world.selected.set(0)
        world.selected.set(2)
        world.selected.set(0)
        world.selected.set(7)

        expect(world.writes).toEqual(['c0', null, 'c0', null, 'c0'])
    })

    test('O7: a recorder write that throws does not stop a later subscriber of the same store', async () => {
        const world = makeWorld({ stored: null })
        world.deps.write = () => { throw new Error('storage full') }
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
        await startLastCharacterRestore(world.deps)
        const later: number[] = []
        world.selected.subscribe((value) => { later.push(value) })

        expect(() => world.selected.set(1)).not.toThrow()

        expect(later).toEqual([-1, 1])
        errorSpy.mockRestore()
    })
})

describe('a restore that cannot run', () => {
    test('O7: a source that throws ends as an error and never throws or rejects', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
        const sources: Array<(world: World) => void> = [
            (world) => { world.deps.readOnlyPage = () => { throw new Error('mode') } },
            (world) => { world.deps.storedChaId = () => { throw new Error('storage') } },
            (world) => { world.deps.characters = () => { throw new Error('db') } },
            (world) => { world.deps.alertType = () => { throw new Error('alert') } },
            (world) => { world.deps.pick = () => { throw new Error('pick') } },
        ]
        for (const arrange of sources) {
            const world = makeWorld()
            arrange(world)
            let end: Promise<RestoreEnd> | undefined
            expect(() => { end = startLastCharacterRestore(world.deps) }).not.toThrow()
            await expect(end).resolves.toBe('error')
        }
        errorSpy.mockRestore()
    })

    test('O7: a recorder that cannot arm does not undo the restore', async () => {
        const world = makeWorld()
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
        world.deps.selectedCharID = {
            subscribe: (run: (value: number) => void) => {
                run(-1)
                throw new Error('subscribe')
            },
        }

        let end: Promise<RestoreEnd> | undefined
        expect(() => { end = startLastCharacterRestore(world.deps) }).not.toThrow()

        await expect(end).resolves.toBe('error')
        errorSpy.mockRestore()
    })
})
