import { get, toStore, type Readable } from 'svelte/store'
import { utilityOpen } from '../lib/Utility/utilityGate'
import { homeView } from '../lib/UI/Home/homeView.svelte'
import { restoreInProgress } from './drive/restoreInProgress'
import { getDatabase } from './storage/database.svelte'
import { getPageStorageMode } from './storage/pageStorageMode'
import { botMakerMode, CustomGUISettingMenuStore, OpenRealmStore, PlaygroundStore, selectedCharID, settingsOpen, alertStore } from './stores.svelte'
import { studioOpen } from './studio/studioOpen'
import { busyKinds } from './process/memory/busyActions'
import { changeCharGeneration, supersedeChangeChar, type ChangeCharOutcome } from './characters'
import { changeCharOrAlert } from './characterPick'
import { readLastChaId, recordDecision, resolveRestoreIndex, writeLastChaId } from './lastCharacterMemory'

/**
 * Opens the character this device was last left in, once, at the end of boot, and keeps the memory of
 * where the user is. The restore is the ordinary pick path (`changeCharOrAlert` with `keepInteraction` and
 * `quiet`), so an archived character or group is restored first and a refused restore stays silent: every
 * way the restore can end other than a selection leaves the memory untouched and the app on Home.
 *
 * A restore never wins over the user. It starts only when nothing has taken the app off Home, and while it
 * waits (an archived character is read first) it is superseded through `changeChar`'s own generation the
 * moment a Home-level surface opens. That rule is "every Home surface opened without a selection change":
 * adding such a surface means adding it to `armWatchers` and to `guardHolds`.
 */

export type RestoreEnd = 'skipped' | 'read-only' | 'selected' | 'superseded' | 'gone' | 'failed' | 'error'

export interface RestorePickOptions {
    keepInteraction: boolean
    quiet: boolean
}

/** Everything the restore reads or does, so a test can drive each guard clause and each arrival. */
export interface RestoreDeps {
    readOnlyPage(): boolean
    storedChaId(): string | null
    characters(): readonly unknown[] | undefined
    characterAt(index: number): unknown
    didFirstSetup(): boolean
    botSettingAtStart(): boolean
    botMakerMode: Readable<boolean>
    selectedCharID: Readable<number>
    settingsOpen: Readable<boolean>
    studioOpen: Readable<boolean>
    customGuiMenu: Readable<boolean>
    playground: Readable<number>
    utilityOpen: Readable<boolean>
    realmStore: Readable<boolean>
    /** The Home library: `isOpen` is the plain answer, `watch` the readable that follows it. */
    library: { isOpen(): boolean, watch(): Readable<boolean> }
    restoreInProgress(): boolean
    busyKinds(): readonly string[]
    alertType(): string
    realmLinkInUrl(): boolean
    pick(index: number, options: RestorePickOptions): Promise<ChangeCharOutcome | 'error'>
    generation(): number
    supersede(): void
    write(chaId: string | null): void
}

/** The alert types a restore may start under: none, or a toast that sits beside the screen. */
const QUIET_ALERT_TYPES: ReadonlySet<string> = new Set(['none', 'toast'])

/** The sources are read when used, so a harness that mocks only part of a module is untouched until a restore is due. */
function productionDeps(): RestoreDeps {
    return {
        readOnlyPage: () => getPageStorageMode().kind === 'read-only',
        storedChaId: () => readLastChaId(),
        characters: () => getDatabase().characters,
        characterAt: (index) => getDatabase().characters?.[index],
        didFirstSetup: () => getDatabase().didFirstSetup === true,
        botSettingAtStart: () => !!getDatabase().botSettingAtStart,
        get botMakerMode() { return botMakerMode },
        get selectedCharID() { return selectedCharID },
        get settingsOpen() { return settingsOpen },
        get studioOpen() { return studioOpen },
        get customGuiMenu() { return CustomGUISettingMenuStore },
        get playground() { return PlaygroundStore },
        get utilityOpen() { return utilityOpen },
        get realmStore() { return OpenRealmStore },
        library: {
            isOpen: () => homeView.view === 'library',
            // `homeView` is rune state, not a store: the readable follows it through a microtask flush.
            watch: () => toStore(() => homeView.view === 'library'),
        },
        restoreInProgress: () => restoreInProgress(),
        busyKinds: () => busyKinds(),
        alertType: () => get(alertStore).type,
        realmLinkInUrl: () => new URLSearchParams(location.search).has('realm'),
        pick: (index, options) => changeCharOrAlert('boot.restoreLast', index, options),
        generation: () => changeCharGeneration(),
        supersede: () => supersedeChangeChar(),
        write: (chaId) => writeLastChaId(chaId),
    }
}

/** True when nothing has taken the app off Home or is about to; evaluated once, synchronously, at the start. */
function guardHolds(deps: RestoreDeps): boolean {
    return deps.didFirstSetup()
        && !deps.botSettingAtStart()
        && !get(deps.botMakerMode)
        && get(deps.selectedCharID) === -1
        && !get(deps.settingsOpen)
        && !get(deps.studioOpen)
        && !get(deps.customGuiMenu)
        && get(deps.playground) === 0
        && !deps.restoreInProgress()
        && !deps.busyKinds().some((kind) => kind === 'import' || kind === 'backupLoad')
        && QUIET_ALERT_TYPES.has(deps.alertType())
        && !deps.realmLinkInUrl()
        && !get(deps.utilityOpen)
        && !get(deps.realmStore)
        && !deps.library.isOpen()
}

/**
 * While the restore waits, supersedes it when a surface opens over Home. Only a restore that still holds
 * the latest generation is superseded, so a later user pick (which has bumped it) is never cancelled by a
 * surface that opens after. Returns the teardown for every subscription.
 */
function armWatchers(deps: RestoreDeps, ownGeneration: number): () => void {
    const stops: Array<() => void> = []
    const watch = <T>(source: Readable<T>, opensSurface: (value: T) => boolean): void => {
        let initial = true
        stops.push(source.subscribe((value) => {
            if (initial) {
                initial = false
                return
            }
            try {
                if (opensSurface(value) && deps.generation() === ownGeneration) {
                    deps.supersede()
                }
            } catch (error) {
                console.error(error)
            }
        }))
    }
    const stopAll = (): void => {
        for (const stop of stops.splice(0)) {
            try {
                stop()
            } catch (error) {
                console.error(error)
            }
        }
    }
    const isTrue = (value: boolean): boolean => value
    try {
        watch(deps.settingsOpen, isTrue)
        watch(deps.studioOpen, isTrue)
        watch(deps.customGuiMenu, isTrue)
        watch(deps.botMakerMode, isTrue)
        watch(deps.playground, (value) => value !== 0)
        watch(deps.utilityOpen, isTrue)
        watch(deps.realmStore, isTrue)
        watch(deps.library.watch(), isTrue)
    } catch (error) {
        stopAll()
        throw error
    }
    return stopAll
}

/**
 * Remembers the selection from now on. The store's current value (the boot's own Home) is skipped, and
 * the recorder is armed after the restore decision, so the boot never clears the memory. A selection of
 * Home forgets it; a character is remembered; a hidden or trashed one counts as Home; a missing or
 * malformed entry changes nothing.
 */
function armRecorder(deps: RestoreDeps): void {
    let initial = true
    let lastWritten: string | null | undefined
    deps.selectedCharID.subscribe((index) => {
        if (initial) {
            initial = false
            return
        }
        // A throwing subscriber would stop the store's later notifications.
        try {
            if (index < 0) {
                deps.write(null)
                lastWritten = null
                return
            }
            const decision = recordDecision(deps.characterAt(index))
            if (decision.kind === 'home') {
                deps.write(null)
                lastWritten = null
            } else if (decision.kind === 'record' && decision.chaId !== lastWritten) {
                deps.write(decision.chaId)
                lastWritten = decision.chaId
            }
        } catch (error) {
            console.error(error)
        }
    })
}

function endOf(outcome: ChangeCharOutcome | 'error'): RestoreEnd {
    if (outcome === 'selected' || outcome === 'superseded' || outcome === 'gone' || outcome === 'error') {
        return outcome
    }
    return 'failed'
}

/**
 * Starts the restore and the recorder. Synchronous up to the pick; the returned promise ends when the
 * restore does and is for tests, the boot discards it. Never throws and never rejects.
 */
export function startLastCharacterRestore(deps?: RestoreDeps): Promise<RestoreEnd> {
    let live: RestoreDeps
    try {
        live = deps ?? productionDeps()
        // A read-only page writes nothing this load, so it neither restores nor remembers.
        if (live.readOnlyPage()) {
            return Promise.resolve('read-only')
        }
    } catch (error) {
        console.error(error)
        return Promise.resolve('error')
    }

    let end: Promise<RestoreEnd> = Promise.resolve('skipped')
    let stopWatchers: () => void = () => { }
    try {
        const chaId = live.storedChaId()
        const index = chaId ? resolveRestoreIndex(live.characters(), chaId) : null
        if (index !== null && guardHolds(live)) {
            const pending = live.pick(index, { keepInteraction: true, quiet: true })
            // The pick has already counted itself, so this is the generation it must still hold to select.
            const ownGeneration = live.generation()
            end = pending.then(endOf, (): RestoreEnd => 'error')
            stopWatchers = armWatchers(live, ownGeneration)
        }
    } catch (error) {
        console.error(error)
        end = Promise.resolve('error')
    }
    try {
        armRecorder(live)
    } catch (error) {
        console.error(error)
    }
    return end.finally(stopWatchers)
}
