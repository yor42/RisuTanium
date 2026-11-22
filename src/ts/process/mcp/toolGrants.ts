import type { ByteStore } from 'src/ts/storage/store/contract'

/**
 * "Always for this workspace" grants (MC-3371, MC-3409): one mutating workspace tool in one workspace. They live only
 * in this byte-store key, on this device: never in the database, a `.bin` or a `.rtb`. A restore clears them
 * (`clearToolGrantsForRestore`, MC-3415), so a restored workspace asks again.
 */
export const WORKSPACE_TOOL_GRANTS_KEY = 'consent/workspace-tool-grants.json'

const FORMAT_VERSION = 1

/** The page's byte store, loaded on demand: a model-level importer of this file (the workspace model) must not pull in the storage layer. */
async function getAppStore(): Promise<ByteStore> {
    return (await import('src/ts/storage/store/appStore')).getAppStore()
}

type Grants = Record<string, Record<string, { at: number }>>

/**
 * `loaded`: the stored value was absent or readable; grants are persisted.
 * `unwritable`: it could not be read (it threw, did not parse, or is a newer format). The stored bytes are kept as
 * they are and are not written again (except by a restore clear); grants hold in memory only, with one notice.
 */
type GrantState = {
    mode: 'loaded' | 'unwritable'
    grants: Grants
    noticeShown: boolean
}

let statePromise: Promise<GrantState> | null = null
/** Every write is a step of this one chain, so a revoke and an add never interleave their read and write. */
let chain: Promise<void> = Promise.resolve()
/** While a restore holds the clear, nothing matches, no grant is offered and no delta is accepted. */
let sealed = false

/** A map without a prototype, so a workspace id such as `__proto__` is an ordinary key. */
function emptyMap<T>(): Record<string, T> {
    return Object.create(null) as Record<string, T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The grants of a v1 file, or `null` when the bytes are not a v1 file of the expected shape. */
function decodeGrants(bytes: Uint8Array): Grants | null {
    let data: unknown
    try {
        data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    } catch {
        return null
    }
    if (!isRecord(data) || data.v !== FORMAT_VERSION || !isRecord(data.grants)) {
        return null
    }
    const grants = emptyMap<Grants[string]>()
    for (const [workspaceId, tools] of Object.entries(data.grants)) {
        if (!isRecord(tools)) {
            return null
        }
        const entry = emptyMap<{ at: number }>()
        for (const [tool, meta] of Object.entries(tools)) {
            if (!isRecord(meta)) {
                return null
            }
            entry[tool] = { at: typeof meta.at === 'number' ? meta.at : 0 }
        }
        grants[workspaceId] = entry
    }
    return grants
}

function encodeGrants(grants: Grants): Uint8Array {
    return new TextEncoder().encode(JSON.stringify({ v: FORMAT_VERSION, grants }))
}

function cloneGrants(grants: Grants): Grants {
    const copy = emptyMap<Grants[string]>()
    for (const [workspaceId, tools] of Object.entries(grants)) {
        copy[workspaceId] = Object.assign(emptyMap<{ at: number }>(), tools)
    }
    return copy
}

function loadState(): Promise<GrantState> {
    statePromise ??= (async (): Promise<GrantState> => {
        try {
            const store = await getAppStore()
            const { bytes } = await store.read(WORKSPACE_TOOL_GRANTS_KEY)
            if (bytes === null) {
                return { mode: 'loaded', grants: emptyMap(), noticeShown: false }
            }
            const grants = decodeGrants(bytes)
            if (grants === null) {
                return { mode: 'unwritable', grants: emptyMap(), noticeShown: false }
            }
            return { mode: 'loaded', grants, noticeShown: false }
        } catch (error) {
            console.error('MCP: Failed to read the workspace tool grants:', error)
            return { mode: 'unwritable', grants: emptyMap(), noticeShown: false }
        }
    })()
    return statePromise
}

function validKey(workspaceId: string, tool: string): boolean {
    return typeof workspaceId === 'string' && workspaceId !== '' && typeof tool === 'string' && tool !== ''
}

/**
 * The grants as the byte store holds them now, so a revoke made by another page is honoured here. Unreadable or
 * absent-and-failing reads fall back to nothing granted, never to a stale cache.
 */
async function freshGrants(state: GrantState): Promise<Grants | null> {
    if (state.mode !== 'loaded') {
        return state.grants
    }
    try {
        const store = await getAppStore()
        const { bytes } = await store.read(WORKSPACE_TOOL_GRANTS_KEY)
        if (bytes === null) {
            return emptyMap()
        }
        return decodeGrants(bytes)
    } catch (error) {
        console.error('MCP: Failed to read the workspace tool grants:', error)
        return null
    }
}

/** Whether `tool` is granted for the workspace. Never throws; false while sealed or when the grants cannot be read. */
export async function hasToolGrant(workspaceId: string, tool: string): Promise<boolean> {
    try {
        if (sealed || !validKey(workspaceId, tool)) {
            return false
        }
        const state = await loadState()
        const grants = await freshGrants(state)
        // Sealed again means a restore began while this read was in flight.
        if (sealed || grants === null) {
            return false
        }
        return Object.hasOwn(grants[workspaceId] ?? {}, tool)
    } catch (error) {
        console.error(error)
        return false
    }
}

/** Whether a prompt may offer "always" now: not while a restore holds the clear. */
export function toolGrantsOffered(): boolean {
    return !sealed
}

type Delta = (grants: Grants) => void

/**
 * Applies one delta to the grants as stored now and writes the result, on the shared chain. Resolves true when the
 * delta is in effect (persisted, or held in memory in `unwritable` mode) and false when it was refused or lost.
 */
function applyDelta(delta: Delta): Promise<boolean> {
    if (sealed) {
        return Promise.resolve(false)
    }
    const step = chain.then(async (): Promise<boolean> => {
        try {
            if (sealed) {
                return false
            }
            const state = await loadState()
            if (state.mode === 'loaded') {
                const base = await freshGrants(state)
                if (base === null) {
                    // The stored bytes changed under this page into something unreadable: keep them, hold in memory.
                    state.mode = 'unwritable'
                    // Grants loaded earlier no longer reflect the stored bytes: fail closed rather than keep matching them.
                    state.grants = emptyMap()
                } else {
                    const next = cloneGrants(base)
                    delta(next)
                    const store = await getAppStore()
                    await store.write(WORKSPACE_TOOL_GRANTS_KEY, encodeGrants(next), 'unconditional')
                    state.grants = next
                    return true
                }
            }
            delta(state.grants)
            if (!state.noticeShown) {
                state.noticeShown = true
                // Loaded on demand: a model-level importer of this file must not pull in the platform probe (it reads
                // `window` at load), the alert machinery or the language tables.
                const { isTauri } = await import('src/ts/platform')
                const location = isTauri ? `${WORKSPACE_TOOL_GRANTS_KEY} (app data folder)` : WORKSPACE_TOOL_GRANTS_KEY
                const { queueNotice } = await import('src/ts/alertPrompts')
                const { language } = await import('src/lang')
                queueNotice(language.alerts.workspaceToolGrantsUnreadable(location))
            }
            return true
        } catch (error) {
            console.error('MCP: Failed to save the workspace tool grants:', error)
            return false
        }
    })
    chain = step.then(() => undefined)
    return step
}

/** Records "always" for one tool in one workspace. False when it was not recorded. */
export function addToolGrant(workspaceId: string, tool: string): Promise<boolean> {
    if (!validKey(workspaceId, tool)) {
        return Promise.resolve(false)
    }
    return applyDelta((grants) => {
        (grants[workspaceId] ??= emptyMap<{ at: number }>())[tool] = { at: Date.now() }
    })
}

/** Takes back one tool's grant in one workspace. */
export function revokeToolGrant(workspaceId: string, tool: string): Promise<boolean> {
    if (!validKey(workspaceId, tool)) {
        return Promise.resolve(false)
    }
    return applyDelta((grants) => {
        const tools = grants[workspaceId]
        if (tools === undefined) {
            return
        }
        delete tools[tool]
        if (Object.keys(tools).length === 0) {
            delete grants[workspaceId]
        }
    })
}

/** Drops every grant of a deleted workspace. */
export function removeWorkspaceToolGrants(workspaceId: string): Promise<boolean> {
    if (typeof workspaceId !== 'string' || workspaceId === '') {
        return Promise.resolve(false)
    }
    return applyDelta((grants) => {
        delete grants[workspaceId]
    })
}

/** The granted tool names per workspace, for a settings list. Empty while sealed. */
export async function listToolGrants(): Promise<Array<{ workspaceId: string, tool: string, at: number }>> {
    try {
        if (sealed) {
            return []
        }
        const grants = await freshGrants(await loadState())
        if (grants === null) {
            return []
        }
        return Object.entries(grants).flatMap(([workspaceId, tools]) => Object.entries(tools).map(([tool, meta]) => ({ workspaceId, tool, at: meta.at })))
    } catch (error) {
        console.error(error)
        return []
    }
}

export type ToolGrantsClear = { ok: true, release: () => void } | { ok: false, detail: string }

/**
 * The restore's clear (MC-3415). Seals the grants first, so nothing matches and no delta is accepted from this moment,
 * then writes an empty v1 file on the chain and waits for it, overwriting an unreadable file too. `ok:true` keeps the
 * seal until `release()` (a stopped restore); a landed restore keeps it until the page reloads. `ok:false` releases the
 * seal itself and names the cause. Never rejects.
 */
export async function clearToolGrantsForRestore(): Promise<ToolGrantsClear> {
    sealed = true
    const release = () => { sealed = false }
    const step = chain.then(async (): Promise<ToolGrantsClear> => {
        try {
            const state = await loadState()
            const store = await getAppStore()
            await store.write(WORKSPACE_TOOL_GRANTS_KEY, encodeGrants(emptyMap()), 'unconditional')
            state.grants = emptyMap()
            state.mode = 'loaded'
            return { ok: true, release }
        } catch (error) {
            console.error('MCP: Failed to clear the workspace tool grants:', error)
            return { ok: false, detail: error instanceof Error ? error.message : String(error) }
        }
    })
    chain = step.then(() => undefined)
    const result = await step
    if (!result.ok) {
        release()
    }
    return result
}

/** Forgets the loaded state, the chain and the seal between tests. */
export function resetToolGrantsForTests(): void {
    statePromise = null
    chain = Promise.resolve()
    sealed = false
}
