/**
 * Test-only: what the save-loop suites (`globalApi.save*.svelte.test.ts`,
 * `globalApi.nodeSave*.svelte.test.ts`) share: a small database, a fake store
 * that a test can hold, close or fault, and filters over the operations the
 * store recorded. No application module is imported, so a suite may reset its
 * module graph between worlds without this file being reloaded under it.
 */
import { createFakeStore, type FakeStore, type FakeStoreOptions, type StoreOp } from './blockStoreHarness'

export const MAIN_FILE_KEY = 'database/database.bin'
export const BACKUP_PREFIX = 'database/dbbackup-'
export const FINGERPRINT_KEY = 'database/backupfingerprint'
export const HEAD_KEY = 'blocks/head'

export const isBlockKey = (key: string) => key.startsWith('blocks/')
export const isRootKey = (key: string) => /^blocks\/[^/]+\/root$/.test(key)
export const isBackupKey = (key: string) => key.startsWith(BACKUP_PREFIX)
export const isPreBlocksKey = (key: string) => key.startsWith('database/database.pre-blocks')

export interface CharacterOptions {
    name?: string
    /** Set on an archived character: its block is the stub in the pack. */
    coldstorage?: string
}

export function makeCharacter(chaId: string, options: CharacterOptions = {}): Record<string, unknown> {
    return {
        chaId,
        name: options.name ?? chaId,
        type: 'character',
        chatPage: 0,
        chats: [{ id: `${chaId}-chat`, message: [], note: '', name: '', localLore: [] }],
        ...(options.coldstorage === undefined ? {} : { coldstorage: options.coldstorage }),
    }
}

export function makeDb(prompt: string, chaIds: readonly string[] = ['skip-cha']): Record<string, unknown> {
    return {
        formatversion: 5,
        botPresetsId: 0,
        // The strict decode fills an empty list from the preset template; starting from that list keeps encode(decode(x)) equal to x.
        botPresets: [{ name: 'test-preset' }],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt: prompt,
        characters: chaIds.map((chaId) => makeCharacter(chaId)),
    }
}

/** Text that does not shrink under any compression, so a block made of it is as long as asked. */
export function incompressible(length: number): string {
    let state = 12345
    let out = ''
    while (out.length < length) {
        state = (state * 1103515245 + 12345) & 0x7fffffff
        out += state.toString(36)
    }
    return out.slice(0, length)
}

/** A store a test can hold (`gate`) or close (`dead`, as a closed tab does: every call hangs). */
export interface HeldStore extends FakeStore {
    gate: null | ((key: string) => Promise<void>)
    dead: boolean
    /** A key this answers `true` for reads as absent, whatever the store holds. */
    hideReads: null | ((key: string) => boolean)
}

export function makeHeldStore(options: Partial<FakeStoreOptions> = {}): HeldStore {
    const state = { dead: false }
    const inner = createFakeStore({
        versioned: false,
        ...options,
        gate: async () => {
            if (state.dead) {
                await new Promise<never>(() => { })
            }
        },
    })
    const held: HeldStore = {
        ...inner,
        gate: null,
        hideReads: null,
        get dead() {
            return state.dead
        },
        set dead(value: boolean) {
            state.dead = value
        },
        write: async (key, bytes, condition) => {
            if (held.gate) {
                await held.gate(key)
            }
            return inner.write(key, bytes, condition)
        },
        read: async (key) => {
            const result = await inner.read(key)
            return held.hideReads?.(key) ? { bytes: null, version: result.version } : result
        },
    }
    return held
}

export const writesTo = (store: FakeStore, predicate: (key: string) => boolean): StoreOp[] =>
    store.ops.filter((op) => op.kind === 'write' && predicate(op.key))

export const mutationsOf = (store: FakeStore, predicate: (key: string) => boolean): StoreOp[] =>
    store.ops.filter((op) => (op.kind === 'write' || op.kind === 'delete') && predicate(op.key))

/** Every write or delete of the legacy main file: the save loop makes none. */
export const mainFileMutations = (store: FakeStore) => mutationsOf(store, (key) => key === MAIN_FILE_KEY)

export const rootWrites = (store: FakeStore) => writesTo(store, isRootKey)

export const backupWrites = (store: FakeStore) => writesTo(store, isBackupKey)

export const fingerprintWrites = (store: FakeStore) => writesTo(store, (key) => key === FINGERPRINT_KEY)

/** The condition a recorded write or delete carried. */
export const conditionOf = (op: StoreOp) => ('condition' in op ? op.condition : undefined)

export const sameBytes =(a: Uint8Array | null | undefined, b: Uint8Array | null | undefined) =>
    !!a && !!b && a.length === b.length && a.every((value, i) => value === b[i])

export const textOf = (bytes: Uint8Array | null | undefined) => (bytes ? new TextDecoder().decode(bytes) : '')
