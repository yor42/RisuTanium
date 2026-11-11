// @vitest-environment jsdom

/**
 * The notification deep link and the launch order (`./launchTarget`), with the REAL last-character restore,
 * recorder, `readAt` origin resolution and target validation over a fake pick. The fake pick behaves like
 * `changeChar`: it counts itself in the generation synchronously, selects at once for a warm character, and
 * for an archived one waits for the test and then selects only while it still holds the latest generation.
 * A passing test says nothing about the Kotlin side or the real `changeChar` (the svelte test beside this).
 */
import { get } from 'svelte/store'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Database } from 'src/ts/storage/database.svelte'
import type { ChangeCharOutcome } from 'src/ts/characters'

//#region module mocks

const world = vi.hoisted(() => ({ generation: 0, restoring: false, busy: [] as string[] }))
const pickMock = vi.hoisted(() => vi.fn())
const openChatMock = vi.hoisted(() => vi.fn())

vi.mock(import('src/ts/stores.svelte'), async () => {
    const { writable: makeWritable } = await import('svelte/store')
    // A store that can drop every subscriber, so a recorder or watcher armed by an earlier test cannot
    // answer a later test's selection.
    const stores: Array<{ dropSubscribers(): void }> = []
    function makeStore<T>(initial: T) {
        let value = initial
        const subscribers = new Set<(next: T) => void>()
        const store = {
            subscribe(run: (next: T) => void): () => void {
                subscribers.add(run)
                run(value)
                return () => { subscribers.delete(run) }
            },
            set(next: T): void {
                value = next
                for (const run of [...subscribers]) {
                    run(next)
                }
            },
            update(change: (current: T) => T): void {
                store.set(change(value))
            },
            dropSubscribers(): void {
                subscribers.clear()
            },
        }
        stores.push(store)
        return store
    }
    return {
        DBState: { db: { characters: [] } as unknown as Database },
        selIdState: { selId: -1 },
        selectedCharID: makeStore(-1),
        settingsOpen: makeStore(false),
        OpenRealmStore: makeStore(false),
        botMakerMode: makeStore(false),
        PlaygroundStore: makeStore(0),
        CustomGUISettingMenuStore: makeStore(false),
        alertStore: makeWritable({ type: 'none', msg: '' }),
        dropStoreSubscribersForTest: () => { for (const store of stores) { store.dropSubscribers() } },
    } as unknown as typeof import('src/ts/stores.svelte')
})

vi.mock(import('src/ts/characters'), () => ({
    changeCharGeneration: () => world.generation,
    supersedeChangeChar: () => { world.generation++ },
}) as unknown as typeof import('src/ts/characters'))

vi.mock(import('src/ts/characterPick'), () => ({
    changeCharOrAlert: pickMock,
}) as unknown as typeof import('src/ts/characterPick'))

vi.mock(import('src/ts/storage/database.svelte'), async () => {
    const { DBState } = await import('src/ts/stores.svelte')
    return { getDatabase: () => DBState.db } as unknown as typeof import('src/ts/storage/database.svelte')
})

vi.mock(import('src/ts/drive/restoreInProgress'), () => ({
    restoreInProgress: () => world.restoring,
}) as unknown as typeof import('src/ts/drive/restoreInProgress'))

vi.mock(import('src/ts/process/memory/busyActions'), () => ({
    busyKinds: () => world.busy,
}) as unknown as typeof import('src/ts/process/memory/busyActions'))

vi.mock(import('src/ts/studio/studioOpen'), async () => {
    const { writable: makeWritable } = await import('svelte/store')
    return { studioOpen: makeWritable(false) } as unknown as typeof import('src/ts/studio/studioOpen')
})

vi.mock(import('src/lib/Utility/utilityGate'), async () => {
    const { writable: makeWritable } = await import('svelte/store')
    return { utilityOpen: makeWritable(false) } as unknown as typeof import('src/lib/Utility/utilityGate')
})

vi.mock(import('src/lib/UI/Home/homeView.svelte'), () => ({
    homeView: { view: 'landing' },
}) as unknown as typeof import('src/lib/UI/Home/homeView.svelte'))

vi.mock(import('src/ts/chatShell/chatOpen'), () => ({
    openChatOf: openChatMock,
}) as unknown as typeof import('src/ts/chatShell/chatOpen'))

vi.mock(import('src/ts/process/generationOwnership.svelte'), () => ({
    bumpReplyVersion: vi.fn(),
    isComposerWindowOpen: vi.fn(() => false),
    readReplyVersion: vi.fn(() => 0),
}) as unknown as typeof import('src/ts/process/generationOwnership.svelte'))

vi.mock(import('src/ts/storage/characterSaveMarks'), () => ({
    markCharacterForSave: vi.fn(),
}) as unknown as typeof import('src/ts/storage/characterSaveMarks'))

vi.mock(import('src/ts/storage/tauriByteTransport'), () => ({
    isAndroidTransport: () => true,
}) as unknown as typeof import('src/ts/storage/tauriByteTransport'))

//#endregion

import * as appStores from 'src/ts/stores.svelte'
import { DBState, selectedCharID, settingsOpen, OpenRealmStore } from 'src/ts/stores.svelte'
import { studioOpen } from 'src/ts/studio/studioOpen'
import { utilityOpen } from 'src/lib/Utility/utilityGate'
import { homeView } from 'src/lib/UI/Home/homeView.svelte'
import { LAST_CHARACTER_KEY, writeLastChaId } from 'src/ts/lastCharacterMemory'
import { startKeepAliveService } from './keepAliveService'
import { installLaunchTarget, resetLaunchTargetForTests, startLaunchNavigation } from './launchTarget'

//#region fixtures

interface PendingPick {
    index: number
    land: (outcome?: ChangeCharOutcome) => void
}

let archived: Set<number>
let pending: PendingPick[]

/** Warm character: selects before the first await. Archived: waits for `land`, and loses to a later pick. */
function fakePick(_site: string, index: number): Promise<ChangeCharOutcome | 'error'> {
    const generation = ++world.generation
    if (!archived.has(index)) {
        selectedCharID.set(index)
        return Promise.resolve('selected')
    }
    return new Promise((resolve) => {
        pending.push({
            index,
            land: (outcome = 'selected') => {
                if (outcome === 'selected') {
                    if (generation !== world.generation) {
                        resolve('superseded')
                        return
                    }
                    selectedCharID.set(index)
                }
                resolve(outcome)
            },
        })
    })
}

function chat(id: string): Record<string, unknown> {
    return { id, message: [], note: '', name: id, localLore: [] }
}

function person(chaId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { type: 'character', chaId, name: `${chaId} name`, chats: [chat(`${chaId}-chat`), chat(`${chaId}-chat2`)], ...extra }
}

/** 0 zero (warm), 1 alpha (warm), 2 gamma (archived), 3 beta (trashed), 4 and 5 twins, 6 dup (a chat id twice), 7 hidden. */
function installCharacters(): void {
    DBState.db = {
        didFirstSetup: true,
        characters: [
            person('zero'),
            person('alpha'),
            person('gamma', { coldstorage: 'unit-gamma', chats: [] }),
            person('beta', { trashTime: 5 }),
            person('twin'),
            person('twin'),
            person('dup', { chats: [chat('d'), chat('d')] }),
            person('§playground'),
        ],
    } as unknown as Database
    archived = new Set([2])
}

const characterAt = (index: number): unknown => DBState.db.characters[index]

function hostWith(requestOpenTarget: () => void): { requestOpenTarget: typeof requestOpenTarget } {
    return { requestOpenTarget }
}

/** The host's answer: what `MainActivity` runs in the page. */
function answer(value: unknown): void {
    window.__risuTaniumLaunchTarget?.(value)
}

const remembered = (): string | null => localStorage.getItem(LAST_CHARACTER_KEY)
const sites = (): string[] => pickMock.mock.calls.map((call) => call[0] as string)
const restorePicks = (): number[] => pickMock.mock.calls.filter((call) => call[0] === 'boot.restoreLast').map((call) => call[1] as number)
const openPicks = (): number[] => pickMock.mock.calls.filter((call) => call[0] === 'notification.openChat').map((call) => call[1] as number)

beforeEach(() => {
    vi.useRealTimers()
    ;(appStores as unknown as { dropStoreSubscribersForTest(): void }).dropStoreSubscribersForTest()
    resetLaunchTargetForTests()
    world.generation = 0
    world.restoring = false
    world.busy = []
    pickMock.mockReset()
    pickMock.mockImplementation(fakePick)
    openChatMock.mockReset()
    pending = []
    localStorage.clear()
    settingsOpen.set(false)
    studioOpen.set(false)
    utilityOpen.set(false)
    OpenRealmStore.set(false)
    homeView.view = 'landing'
    selectedCharID.set(-1)
    installCharacters()
})

afterEach(() => {
    vi.useRealTimers()
    resetLaunchTargetForTests()
    localStorage.clear()
})

//#endregion

describe('the target a tap opens', () => {
    test('L1: a valid target selects its character through an ordinary pick and opens its chat', async () => {
        installLaunchTarget(hostWith(vi.fn()))
        answer({ chaId: 'alpha', chatId: 'alpha-chat2' })

        await startLaunchNavigation()
        await vi.waitFor(() => expect(openChatMock).toHaveBeenCalledTimes(1))

        expect(pickMock).toHaveBeenCalledWith('notification.openChat', 1)
        expect(pickMock.mock.calls[0]).toHaveLength(2)
        const [owner, openedChat] = openChatMock.mock.calls[0] as [unknown, { id: string }]
        expect(owner).toBe(characterAt(1))
        expect(openedChat.id).toBe('alpha-chat2')
    })

    test('MC-1374: a chat that is gone leaves its character selected on its current chat', async () => {
        installLaunchTarget(hostWith(vi.fn()))
        answer({ chaId: 'alpha', chatId: 'deleted-chat' })

        await startLaunchNavigation()
        await vi.waitFor(() => expect(get(selectedCharID)).toBe(1))
        await Promise.resolve()

        expect(openChatMock).not.toHaveBeenCalled()
    })

    test('MC-1374: a chat id held twice, and a character id held twice, open nothing more', async () => {
        installLaunchTarget(hostWith(vi.fn()))
        answer({ chaId: 'dup', chatId: 'd' })
        await startLaunchNavigation()
        await vi.waitFor(() => expect(get(selectedCharID)).toBe(6))
        await Promise.resolve()
        expect(openChatMock).not.toHaveBeenCalled()

        answer({ chaId: 'twin', chatId: 'twin-chat' })
        await vi.waitFor(() => expect(get(selectedCharID)).toBe(4))
        await Promise.resolve()
        expect(openChatMock).not.toHaveBeenCalled()
    })

    test('MC-1376: a warm tap with Settings, Studio, Utility, the Realm and the library open closes none of them', async () => {
        installLaunchTarget(hostWith(vi.fn()))
        answer(null)
        await startLaunchNavigation()
        settingsOpen.set(true)
        studioOpen.set(true)
        utilityOpen.set(true)
        OpenRealmStore.set(true)
        homeView.view = 'library'

        answer({ chaId: 'alpha', chatId: 'alpha-chat' })
        await vi.waitFor(() => expect(openChatMock).toHaveBeenCalledTimes(1))

        expect(get(selectedCharID)).toBe(1)
        expect(get(settingsOpen)).toBe(true)
        expect(get(studioOpen)).toBe(true)
        expect(get(utilityOpen)).toBe(true)
        expect(get(OpenRealmStore)).toBe(true)
        expect(homeView.view).toBe('library')
    })
})

describe('a target that is refused', () => {
    const refused: Array<[string, unknown]> = [
        ['an unknown character', { chaId: 'nobody', chatId: 'x' }],
        ['a trashed character', { chaId: 'beta', chatId: 'beta-chat' }],
        ['a hidden system character', { chaId: '§playground', chatId: '§playground-chat' }],
        ['a 201-character character id', { chaId: 'a'.repeat(201), chatId: 'x' }],
        ['a 201-character chat id', { chaId: 'zero', chatId: 'c'.repeat(201) }],
        ['an empty character id', { chaId: '', chatId: 'x' }],
        ['an empty chat id', { chaId: 'zero', chatId: '' }],
        ['a control character in the character id', { chaId: 'ze\u0000ro', chatId: 'zero-chat' }],
        ['a control character in the chat id', { chaId: 'zero', chatId: 'zero\u0007chat' }],
        ['a DEL character', { chaId: 'zero', chatId: 'zero\u007fchat' }],
        ['a number for the character id', { chaId: 7, chatId: 'x' }],
        ['a missing chat id', { chaId: 'zero' }],
        ['a string', 'zero/zero-chat'],
        ['a number', 7],
        ['an array', ['zero', 'zero-chat']],
    ]

    test.each(refused)('L7: %s selects nothing, raises nothing and leaves the restore to run', async (_name, value) => {
        writeLastChaId('zero')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        installLaunchTarget(hostWith(vi.fn()))
        answer(value)

        await startLaunchNavigation()

        expect(openPicks()).toEqual([])
        expect(restorePicks()).toEqual([0])
        expect(openChatMock).not.toHaveBeenCalled()
        warn.mockRestore()
    })

    test('a target is refused while a backup restore or an import runs', async () => {
        writeLastChaId('zero')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        for (const arrange of [() => { world.restoring = true }, () => { world.busy = ['import'] }, () => { world.busy = ['backupLoad'] }]) {
            world.restoring = false
            world.busy = []
            pickMock.mockClear()
            selectedCharID.set(-1)
            resetLaunchTargetForTests()
            arrange()
            installLaunchTarget(hostWith(vi.fn()))
            answer({ chaId: 'alpha', chatId: 'alpha-chat' })

            await startLaunchNavigation()

            expect(openPicks()).toEqual([])
        }
        warn.mockRestore()
    })

    test('a warm target that is refused opens nothing', async () => {
        installLaunchTarget(hostWith(vi.fn()))
        answer(null)
        await startLaunchNavigation()
        pickMock.mockClear()
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })

        answer({ chaId: 'beta', chatId: 'beta-chat' })
        answer({ chaId: 'nobody', chatId: 'x' })
        answer(undefined)
        await Promise.resolve()

        expect(pickMock).not.toHaveBeenCalled()
        warn.mockRestore()
    })
})

describe('the launch order', () => {
    test('L9: with no host the restore runs before startLaunchNavigation returns, with no wait', () => {
        writeLastChaId('zero')

        void startLaunchNavigation()

        expect(restorePicks()).toEqual([0])
    })

    test('L9: a host without requestOpenTarget installs nothing and does not wait either', () => {
        writeLastChaId('zero')
        installLaunchTarget({})

        void startLaunchNavigation()

        expect(window.__risuTaniumLaunchTarget).toBeUndefined()
        expect(restorePicks()).toEqual([0])
    })

    test('L9: a host that refuses the request does not make the launch wait', () => {
        writeLastChaId('zero')
        const error = vi.spyOn(console, 'error').mockImplementation(() => { })
        installLaunchTarget(hostWith(() => { throw new Error('bridge') }))

        void startLaunchNavigation()

        expect(restorePicks()).toEqual([0])
        error.mockRestore()
    })

    test('starting the keep-alive service installs the launch target with its host, so the launch waits for the answer', async () => {
        const request = vi.fn()
        window.__risuTaniumKeepAlive = { requestOpenTarget: request }
        const consumer = startKeepAliveService()
        try {
            expect(request).toHaveBeenCalledTimes(1)
            expect(window.__risuTaniumLaunchTarget).toBeTypeOf('function')
            writeLastChaId('zero')

            const launch = startLaunchNavigation()
            expect(pickMock).not.toHaveBeenCalled()
            window.__risuTaniumLaunchTarget?.(null)
            await launch

            expect(restorePicks()).toEqual([0])
        } finally {
            consumer?.dispose()
            delete window.__risuTaniumKeepAlive
        }
    })

    test('the host is asked once at install, and again whenever it says a tap is ready', () => {
        const request = vi.fn()
        installLaunchTarget(hostWith(request))
        expect(request).toHaveBeenCalledTimes(1)

        window.__risuTaniumLaunchTargetReady?.()

        expect(request).toHaveBeenCalledTimes(2)
    })

    test('L3: an answer after 200 ms opens the target and the restore is never picked', async () => {
        vi.useFakeTimers()
        writeLastChaId('zero')
        installLaunchTarget(hostWith(vi.fn()))

        const launch = startLaunchNavigation()
        await vi.advanceTimersByTimeAsync(200)
        expect(pickMock).not.toHaveBeenCalled()
        answer({ chaId: 'alpha', chatId: 'alpha-chat' })
        await launch

        expect(sites()).toEqual(['notification.openChat'])
        expect(openPicks()).toEqual([1])
    })

    test('L3: an answer that says there is no tap ends the wait at once', async () => {
        vi.useFakeTimers()
        writeLastChaId('zero')
        installLaunchTarget(hostWith(vi.fn()))

        const launch = startLaunchNavigation()
        expect(pickMock).not.toHaveBeenCalled()
        answer(null)
        await launch

        expect(restorePicks()).toEqual([0])
    })

    test('L3: with no answer within 1000 ms the restore runs, and a late answer opens as a warm tap', async () => {
        vi.useFakeTimers()
        writeLastChaId('zero')
        installLaunchTarget(hostWith(vi.fn()))

        const launch = startLaunchNavigation()
        await vi.advanceTimersByTimeAsync(999)
        expect(pickMock).not.toHaveBeenCalled()
        await vi.advanceTimersByTimeAsync(1)
        await launch
        expect(restorePicks()).toEqual([0])

        answer({ chaId: 'alpha', chatId: 'alpha-chat' })
        await vi.advanceTimersByTimeAsync(0)

        expect(openPicks()).toEqual([1])
        expect(openChatMock).toHaveBeenCalledTimes(1)
    })

    test('an answer that arrived before the launch runs the stretch at once', () => {
        writeLastChaId('zero')
        installLaunchTarget(hostWith(vi.fn()))
        answer({ chaId: 'alpha', chatId: 'alpha-chat' })

        void startLaunchNavigation()

        expect(sites()).toEqual(['notification.openChat'])
    })

    test('a later answer of no target does not drop a target that is already held', () => {
        installLaunchTarget(hostWith(vi.fn()))
        answer({ chaId: 'alpha', chatId: 'alpha-chat' })
        answer(null)

        void startLaunchNavigation()

        expect(openPicks()).toEqual([1])
    })

    test('a newer target replaces one that is still held, so only the latest tap opens', () => {
        installLaunchTarget(hostWith(vi.fn()))
        answer({ chaId: 'alpha', chatId: 'alpha-chat' })
        answer({ chaId: 'zero', chatId: 'zero-chat' })

        void startLaunchNavigation()

        expect(openPicks()).toEqual([0])
    })

    test('L6: a cold tap on an unarchived target records it as the remembered character, and the restore never picks', async () => {
        writeLastChaId('zero')
        installLaunchTarget(hostWith(vi.fn()))
        answer({ chaId: 'alpha', chatId: 'alpha-chat' })

        await startLaunchNavigation()

        expect(restorePicks()).toEqual([])
        expect(openPicks()).toEqual([1])
        expect(get(selectedCharID)).toBe(1)
        expect(remembered()).toBe('{"chaId":"alpha"}')
    })

    test('L8: a cold tap on an archived target holds the restore back, and records the target once it lands', async () => {
        writeLastChaId('zero')
        installLaunchTarget(hostWith(vi.fn()))
        answer({ chaId: 'gamma', chatId: 'gamma-chat' })

        await startLaunchNavigation()
        expect(restorePicks()).toEqual([])
        expect(get(selectedCharID)).toBe(-1)
        expect(remembered()).toBe('{"chaId":"zero"}')

        pending[0].land()
        await vi.waitFor(() => expect(remembered()).toBe('{"chaId":"gamma"}'))

        expect(restorePicks()).toEqual([])
        expect(get(selectedCharID)).toBe(2)
    })

    test('L7: an unknown cold target runs the restore for the remembered character and picks no target', async () => {
        writeLastChaId('alpha')
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => { })
        installLaunchTarget(hostWith(vi.fn()))
        answer({ chaId: 'bogus', chatId: 'bogus-chat' })

        await startLaunchNavigation()

        expect(restorePicks()).toEqual([1])
        expect(openPicks()).toEqual([])
        expect(remembered()).toBe('{"chaId":"alpha"}')
        warn.mockRestore()
    })
})
