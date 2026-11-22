/**
 * The reactive state for `bootstrap.packSafeOrder.svelte.test.ts`. `DBState` is a real `$state` object shared by the
 * mocked `getDatabase` and `setDatabase`, and every reset gets a new graph: the caller `vi.doMock`s `stores.svelte` and
 * `database.svelte` from it after each `vi.resetModules()`, so a factory from an earlier graph never serves a later one.
 */
import { writable, type Writable } from 'svelte/store'

export type Plain = Record<string, unknown>

export interface BootGraphState {
    DBState: { db: Plain }
    LoadingStatusState: { text: string }
    MobileGUI: Writable<boolean>
    botMakerMode: Writable<boolean>
    selectedCharID: Writable<number>
    loadedStore: Writable<boolean>
    alertStore: Writable<{ type: string, msg: string }>
    SafeModeStore: Writable<boolean>
    CustomCSSStore: Writable<string>
    getDatabase: () => Plain
    setDatabase: (data: Plain) => void
}

export function createBootGraphState(baseline: () => Plain): BootGraphState {
    const DBState = $state({ db: {} as Plain })
    return {
        DBState,
        LoadingStatusState: { text: '' },
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        selectedCharID: writable(-1),
        loadedStore: writable(false),
        alertStore: writable({ type: 'none', msg: 'n' }),
        SafeModeStore: writable(false),
        CustomCSSStore: writable(''),
        getDatabase: () => DBState.db,
        setDatabase: (data: Plain) => {
            DBState.db = { ...baseline(), ...data }
        },
    }
}

/** A plain copy of a reactive value. */
export function plainCopy<T>(value: T): T {
    return $state.snapshot(value) as T
}
