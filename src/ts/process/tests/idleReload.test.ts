/**
 * The idle reload's controller (`../memory/idleReload`) over fake dependencies:
 * the web path's single synchronous task, the abort paths, the withdrawal of a
 * reload the browser did not carry out, and the desktop path's re-check after
 * its awaited write. A mocked `relaunch` shows only that the controller calls
 * it at the right moment, not that the native relaunch works.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
    HOLD_MS,
    IDLE_MS,
    POLL_MS,
    RESTORED_BYTES_THRESHOLD,
    SELECTION_WITHDRAW_MS,
    type IdleSignals,
} from '../memory/idleGate'
import {
    buildSelectionPart,
    createFileMedium,
    createStorageMedium,
    draftsVersions,
    takeDraftsPart,
    type DraftsPart,
    type HandoffFiles,
    type HandoffMedium,
    type SyncHandoffMedium,
} from '../memory/idleHandoff'
import {
    createIdleReloadController,
    type DesktopIdleReloadDeps,
    type WebIdleReloadDeps,
} from '../memory/idleReload'
import { resetComposerDraftsForTests, write } from '../composerDrafts.svelte'
import { draftContentOrphanGate } from '../../draftContentOrphanGate'

function openSignals(): IdleSignals {
    return {
        platformEnabled: true,
        archivingOn: true,
        canArchive: true,
        v21PluginEnabled: false,
        breaker: 'none',
        tooLarge: false,
        formatOk: true,
        restoredBytesOutside: RESTORED_BYTES_THRESHOLD,
        otherTabOpen: false,
        saveClean: true,
        busyAction: false,
        chokePointInFlight: false,
        workInProgress: false,
        startupCleanupPending: false,
        pluginDevMode: false,
        idleMs: IDLE_MS,
        windowFocused: true,
        pageVisible: true,
        ttsPlaying: false,
        mediaPlaying: false,
        pluginPanelOpen: false,
        realmOpen: false,
        alertOpen: false,
        promptOpen: false,
        modalOpen: false,
        composerDraftOnScreen: false,
        editorOpen: false,
        rateLimited: false,
        historyUnreadable: false,
    }
}

class MemoryStorage {
    private items = new Map<string, string>()
    failWrites = false
    dropWrites = false
    getItem(key: string): string | null { return this.items.get(key) ?? null }
    setItem(key: string, value: string): void {
        if (this.failWrites) {
            throw new DOMException('full', 'QuotaExceededError')
        }
        if (!this.dropWrites) {
            this.items.set(key, value)
        }
    }
    removeItem(key: string): void { this.items.delete(key) }
}

interface World {
    now: number
    signals: IdleSignals
    saveMarks: number
    events: string[]
    recordOk: boolean
    carryThrows: boolean
}

function createWorld(): World {
    return { now: 1_000_000, signals: openSignals(), saveMarks: 0, events: [], recordOk: true, carryThrows: false }
}

function baseDeps(world: World) {
    return {
        now: () => world.now,
        collectSignals: () => {
            world.events.push('collect')
            return { ...world.signals }
        },
        epoch: () => [world.saveMarks, ...draftsVersions()],
        buildCarry: (now: number) => {
            world.events.push('carry')
            if (world.carryThrows) {
                throw new Error('no record')
            }
            return {
                selection: buildSelectionPart({ chaId: 'a', members: ['m'], now }),
                drafts: takeDraftsPart(now),
            }
        },
        recordReload: () => {
            world.events.push('history')
            return world.recordOk
        },
        markAppInitiatedReload: () => { world.events.push('mark') },
    }
}

function webDeps(world: World, medium: SyncHandoffMedium): WebIdleReloadDeps {
    return {
        ...baseDeps(world),
        platform: 'web',
        medium,
        reloadPage: () => { world.events.push('reload') },
    }
}

/** Looks once per poll interval until `count` looks have been made. */
function lookRepeatedly(world: World, controller: { look(): void }, count: number): void {
    for (let i = 0; i < count; i++) {
        controller.look()
        world.now += POLL_MS
    }
}

const HOLD_LOOKS = HOLD_MS / POLL_MS

beforeEach(() => {
    resetComposerDraftsForTests()
    draftContentOrphanGate.clear()
})

afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
})

describe('the web idle reload', () => {
    test('reloads once the gate has held for the hold time and not before', () => {
        const world = createWorld()
        const controller = createIdleReloadController(webDeps(world, createStorageMedium(new MemoryStorage() as unknown as Storage)))
        lookRepeatedly(world, controller, HOLD_LOOKS)
        expect(world.events).not.toContain('reload')
        controller.look()
        expect(world.events).toContain('reload')
    })

    test('takes the record, records the history, writes and reloads in the very task of the last look', () => {
        const world = createWorld()
        const medium = createStorageMedium(new MemoryStorage() as unknown as Storage)
        const controller = createIdleReloadController(webDeps(world, medium))
        lookRepeatedly(world, controller, HOLD_LOOKS)
        world.events.length = 0
        controller.look()
        expect(world.events).toEqual(['collect', 'carry', 'history', 'mark', 'reload'])
        expect(medium.read('selection')).not.toBeNull()
        expect(medium.read('drafts')).not.toBeNull()
    })

    test('carries the off-screen drafts and the selection in the record it leaves', () => {
        const world = createWorld()
        const medium = createStorageMedium(new MemoryStorage() as unknown as Storage)
        write({ chaId: 'b', chatId: 'chat' }, (record) => { record.messageInput = 'unsent elsewhere' })
        // The write above moved the draft counters; the hold only starts after it.
        const controller = createIdleReloadController(webDeps(world, medium))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        const drafts = JSON.parse(medium.read('drafts') ?? '{}') as DraftsPart
        expect(drafts.composer.map((record) => [record.key, record.messageInput])).toEqual([['b::chat', 'unsent elsewhere']])
        expect(JSON.parse(medium.read('selection') ?? '{}')).toMatchObject({ chaId: 'a', keepInline: ['a', 'm'] })
    })

    test.each([
        ['an unsaved change', { saveClean: false }],
        ['an open alert', { alertOpen: true }],
        ['text in the composer on screen', { composerDraftOnScreen: true }],
        ['an unfinished action', { busyAction: true }],
    ] as [string, Partial<IdleSignals>][])('%s at the last look prevents the reload', (_title, change) => {
        const world = createWorld()
        const controller = createIdleReloadController(webDeps(world, createStorageMedium(new MemoryStorage() as unknown as Storage)))
        lookRepeatedly(world, controller, HOLD_LOOKS)
        Object.assign(world.signals, change)
        controller.look()
        expect(world.events).not.toContain('reload')
    })

    test('replaces a drafts part left by an earlier record with the drafts of the live page', () => {
        const world = createWorld()
        const medium = createStorageMedium(new MemoryStorage() as unknown as Storage)
        medium.write('drafts', JSON.stringify({
            v: 1, at: 1,
            composer: [{ key: 'stale::chat', messageInput: 'stale', messageInputTranslate: '', fileInput: [] }],
            durable: [],
        }))
        write({ chaId: 'live', chatId: 'chat' }, (record) => { record.messageInput = 'live text' })
        const controller = createIdleReloadController(webDeps(world, medium))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        const drafts = JSON.parse(medium.read('drafts') ?? '{}') as DraftsPart
        expect(drafts.composer.map((record) => record.key)).toEqual(['live::chat'])
    })

    test('a gate that closes for one look just before the hold time ends restarts the hold', () => {
        const world = createWorld()
        const controller = createIdleReloadController(webDeps(world, createStorageMedium(new MemoryStorage() as unknown as Storage)))
        lookRepeatedly(world, controller, HOLD_LOOKS)
        world.signals.alertOpen = true
        controller.look()
        world.now += POLL_MS
        world.signals.alertOpen = false
        lookRepeatedly(world, controller, HOLD_LOOKS)
        expect(world.events).not.toContain('reload')
        controller.look()
        expect(world.events).toContain('reload')
    })

    test('a change that was made and undone between two looks still restarts the hold', () => {
        const world = createWorld()
        const controller = createIdleReloadController(webDeps(world, createStorageMedium(new MemoryStorage() as unknown as Storage)))
        lookRepeatedly(world, controller, HOLD_LOOKS - 1)
        world.saveMarks += 1
        lookRepeatedly(world, controller, 2)
        expect(world.events).not.toContain('reload')
        lookRepeatedly(world, controller, HOLD_LOOKS)
        expect(world.events).toContain('reload')
    })

    test('does not reload when the history cannot be recorded, and writes no record', () => {
        const world = createWorld()
        world.recordOk = false
        const medium = createStorageMedium(new MemoryStorage() as unknown as Storage)
        const controller = createIdleReloadController(webDeps(world, medium))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        expect(world.events).not.toContain('reload')
        expect(medium.read('selection')).toBeNull()
        expect(medium.read('drafts')).toBeNull()
    })

    test('does not reload when the record cannot be written, and withdraws what was written', () => {
        const world = createWorld()
        const memory = new MemoryStorage()
        const base = createStorageMedium(memory as unknown as Storage)
        const medium: SyncHandoffMedium = {
            ...base,
            write: (part, text) => {
                if (part === 'selection') {
                    memory.failWrites = true
                }
                return base.write(part, text)
            },
        }
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const controller = createIdleReloadController(webDeps(world, medium))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        expect(world.events).not.toContain('reload')
        expect(world.events).not.toContain('mark')
        expect(base.read('selection')).toBeNull()
        expect(base.read('drafts')).toBeNull()
    })

    test('does not reload when the record does not read back whole', () => {
        const world = createWorld()
        const memory = new MemoryStorage()
        memory.dropWrites = true
        const controller = createIdleReloadController(webDeps(world, createStorageMedium(memory as unknown as Storage)))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        expect(world.events).not.toContain('reload')
    })

    test('does not reload when the record cannot be taken', () => {
        const world = createWorld()
        world.carryThrows = true
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const controller = createIdleReloadController(webDeps(world, createStorageMedium(new MemoryStorage() as unknown as Storage)))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        expect(world.events).not.toContain('reload')
        expect(world.events).not.toContain('history')
    })

    test('a reload the browser did not carry out gives up its selection after the time bound and keeps the drafts', () => {
        vi.useFakeTimers()
        const world = createWorld()
        const medium = createStorageMedium(new MemoryStorage() as unknown as Storage)
        const controller = createIdleReloadController(webDeps(world, medium))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        expect(world.events).toContain('reload')
        vi.advanceTimersByTime(SELECTION_WITHDRAW_MS - 1)
        expect(medium.read('selection')).not.toBeNull()
        vi.advanceTimersByTime(1)
        expect(medium.read('selection')).toBeNull()
        expect(medium.read('drafts')).not.toBeNull()
    })
})

function fakeFiles() {
    const files = new Map<string, Uint8Array>()
    const api: HandoffFiles = {
        read: async (path) => files.get(path) ?? null,
        writeAtomic: async (path, bytes) => {
            await Promise.resolve()
            files.set(path, bytes)
        },
        remove: async (path) => { files.delete(path) },
    }
    return { api, files }
}

function desktopDeps(world: World, medium: HandoffMedium, relaunch: () => Promise<void>): DesktopIdleReloadDeps {
    return { ...baseDeps(world), platform: 'desktop', medium, relaunch }
}

async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
}

describe('the desktop idle reload', () => {
    test('relaunches once the record is on disk and the gate and the counters still hold', async () => {
        const world = createWorld()
        const { api, files } = fakeFiles()
        const relaunch = vi.fn(async () => { world.events.push('relaunch') })
        const controller = createIdleReloadController(desktopDeps(world, createFileMedium(api), relaunch))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        await settle()
        expect(relaunch).toHaveBeenCalledTimes(1)
        expect(files.size).toBe(1)
        expect(world.events.slice(-4)).toEqual(['collect', 'history', 'mark', 'relaunch'])
    })

    test('abandons the relaunch and withdraws the record when a draft changes during the write', async () => {
        const world = createWorld()
        const { api, files } = fakeFiles()
        const base = createFileMedium(api)
        const medium: HandoffMedium = {
            ...base,
            write: async (part, text) => {
                const written = await base.write(part, text)
                write({ chaId: 'b', chatId: 'late' }, (record) => { record.messageInput = 'typed during the write' })
                return written
            },
        }
        const relaunch = vi.fn(async () => { })
        const controller = createIdleReloadController(desktopDeps(world, medium, relaunch))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        await settle()
        expect(relaunch).not.toHaveBeenCalled()
        expect(files.size).toBe(0)
    })

    test('abandons the relaunch when a save is requested during the write', async () => {
        const world = createWorld()
        const { api, files } = fakeFiles()
        const base = createFileMedium(api)
        const medium: HandoffMedium = {
            ...base,
            write: async (part, text) => {
                const written = await base.write(part, text)
                world.saveMarks += 1
                return written
            },
        }
        const relaunch = vi.fn(async () => { })
        const controller = createIdleReloadController(desktopDeps(world, medium, relaunch))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        await settle()
        expect(relaunch).not.toHaveBeenCalled()
        expect(files.size).toBe(0)
    })

    test('abandons the relaunch when the gate closes during the write', async () => {
        const world = createWorld()
        const { api } = fakeFiles()
        const base = createFileMedium(api)
        const medium: HandoffMedium = {
            ...base,
            write: async (part, text) => {
                const written = await base.write(part, text)
                world.signals.modalOpen = true
                return written
            },
        }
        const relaunch = vi.fn(async () => { })
        const controller = createIdleReloadController(desktopDeps(world, medium, relaunch))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        await settle()
        expect(relaunch).not.toHaveBeenCalled()
    })

    test('does not relaunch when the record does not read back from disk', async () => {
        const world = createWorld()
        const relaunch = vi.fn(async () => { })
        const medium: HandoffMedium = { read: async () => null, write: async () => false, remove: async () => { } }
        const controller = createIdleReloadController(desktopDeps(world, medium, relaunch))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        await settle()
        expect(relaunch).not.toHaveBeenCalled()
    })

    test('does not start a second record while one is being written', async () => {
        const world = createWorld()
        let releaseWrite: () => void = () => { }
        const gate = new Promise<void>((resolve) => { releaseWrite = resolve })
        const writes: string[] = []
        const medium: HandoffMedium = {
            read: async () => null,
            write: async (part) => { writes.push(part); await gate; return true },
            remove: async () => { },
        }
        const relaunch = vi.fn(async () => { })
        const controller = createIdleReloadController(desktopDeps(world, medium, relaunch))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        lookRepeatedly(world, controller, 5)
        expect(writes).toEqual(['drafts'])
        releaseWrite()
        await settle()
    })

    test('withdraws the record when the relaunch itself fails', async () => {
        const world = createWorld()
        const { api, files } = fakeFiles()
        vi.spyOn(console, 'error').mockImplementation(() => { })
        const relaunch = vi.fn(async () => { throw new Error('no relaunch') })
        const controller = createIdleReloadController(desktopDeps(world, createFileMedium(api), relaunch))
        lookRepeatedly(world, controller, HOLD_LOOKS + 1)
        await settle()
        expect(relaunch).toHaveBeenCalledTimes(1)
        expect(files.size).toBe(0)
    })
})
