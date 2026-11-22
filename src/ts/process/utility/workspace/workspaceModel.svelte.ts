import type { UtilityWorkspace, UtilityWorkspaceFile } from '../../../storage/database.svelte'
import { DBState } from '../../../stores.svelte'
import { removeWorkspaceToolGrants } from '../../mcp/toolGrants'
import { normalizeWorkspacePath, workspacePathKey, type WorkspacePathRefusal } from './paths'
import { checkWorkspaceText, utf8ByteLength, type TextGuardRefusal } from './textGuard'

const MIB = 1024 * 1024

/** The caps every write meets (MC-3373, MC-3414). The encoder never re-checks them; this model is the only gate. */
export const WORKSPACE_LIMITS = {
    fileBytes: MIB,
    workspaceBytes: 25 * MIB,
    workspaceFiles: 500,
    totalBytes: 100 * MIB,
} as const

export type WorkspaceOp =
    | { kind: 'write', path: string, text: string }
    | { kind: 'delete', path: string }
    | { kind: 'move', from: string, to: string }

export type WorkspaceChangeError =
    | { code: 'no-workspace', detail: string }
    | { code: 'bad-path', path: string, reason: WorkspacePathRefusal, detail: string }
    | { code: 'bad-text', path: string, reason: TextGuardRefusal, detail: string }
    | { code: 'not-found', path: string, detail: string }
    | { code: 'collision', path: string, existing: string, detail: string }
    | { code: 'same-path', path: string, detail: string }
    | { code: 'file-too-large', path: string, detail: string }
    | { code: 'workspace-too-large', detail: string }
    | { code: 'too-many-files', detail: string }
    | { code: 'total-too-large', detail: string }

export type WorkspaceChangeResult = { ok: true } | { ok: false, error: WorkspaceChangeError }

export interface WorkspaceEnv {
    now: () => number
    newId: () => string
}

const defaultEnv: WorkspaceEnv = {
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
}

export interface WorkspaceSummary {
    id: string
    name: string
    createdAt: number
    fileCount: number
    bytes: number
}

export interface WorkspaceFileInfo {
    id: string
    path: string
    size: number
    mtime: number
    /** True when the file's text could not be read at boot: only its record is known. */
    placeholder: boolean
}

export type ReadTextResult = { state: 'ok', text: string } | { state: 'damaged' } | { state: 'missing' }

function allWorkspaces(): UtilityWorkspace[] {
    return DBState.db.utilityWorkspaces ?? []
}

function findWorkspace(workspaceId: string): UtilityWorkspace | undefined {
    return allWorkspaces().find(candidate => candidate.id === workspaceId)
}

/** A placeholder counts its record `size`, so a damaged file still holds its share of the caps. */
function bytesOf(files: readonly UtilityWorkspaceFile[]): number {
    let total = 0
    for (const file of files) {
        total += file.size
    }
    return total
}

function totalBytes(): number {
    let total = 0
    for (const workspace of allWorkspaces()) {
        total += bytesOf(workspace.files)
    }
    return total
}

export function listWorkspaces(): WorkspaceSummary[] {
    return allWorkspaces().map(workspace => ({
        id: workspace.id,
        name: workspace.name,
        createdAt: workspace.createdAt,
        fileCount: workspace.files.length,
        bytes: bytesOf(workspace.files),
    }))
}

export function hasWorkspace(workspaceId: string): boolean {
    return findWorkspace(workspaceId) !== undefined
}

function infoOf(file: UtilityWorkspaceFile): WorkspaceFileInfo {
    return { id: file.id, path: file.path, size: file.size, mtime: file.mtime, placeholder: typeof file.text !== 'string' }
}

export function listFiles(workspaceId: string): WorkspaceFileInfo[] {
    return (findWorkspace(workspaceId)?.files ?? []).map(infoOf)
}

export function statFile(workspaceId: string, path: string): WorkspaceFileInfo | undefined {
    const file = findWorkspace(workspaceId)?.files.find(candidate => candidate.path === path)
    return file === undefined ? undefined : infoOf(file)
}

/**
 * The one way to read a file's text. A placeholder (the unit could not be read at boot) answers `damaged`, never an empty
 * string, so a caller cannot mistake lost content for an empty file.
 */
export function readText(workspaceId: string, path: string): ReadTextResult {
    const file = findWorkspace(workspaceId)?.files.find(candidate => candidate.path === path)
    if (file === undefined) {
        return { state: 'missing' }
    }
    return typeof file.text === 'string' ? { state: 'ok', text: file.text } : { state: 'damaged' }
}

export function createWorkspace(name: string, env: WorkspaceEnv = defaultEnv): string {
    const workspace: UtilityWorkspace = { id: env.newId(), name, createdAt: env.now(), files: [] }
    DBState.db.utilityWorkspaces = [...allWorkspaces(), workspace]
    return workspace.id
}

export function renameWorkspace(workspaceId: string, name: string): boolean {
    const workspace = findWorkspace(workspaceId)
    if (workspace === undefined) {
        return false
    }
    workspace.name = name
    return true
}

/** Final: the files go with the record, and nothing keeps them (MC-3377). The caller has already confirmed. */
export function deleteWorkspace(workspaceId: string): boolean {
    const list = allWorkspaces()
    if (!list.some(candidate => candidate.id === workspaceId)) {
        return false
    }
    DBState.db.utilityWorkspaces = list.filter(candidate => candidate.id !== workspaceId)
    // The saved "always" approvals of that workspace go with it; the call never rejects.
    void removeWorkspaceToolGrants(workspaceId)
    return true
}

function fail(error: WorkspaceChangeError): WorkspaceChangeResult {
    return { ok: false, error }
}

function normalize(path: string): { ok: true, path: string } | { ok: false, error: WorkspaceChangeError } {
    const result = normalizeWorkspacePath(path)
    if (result.ok === true) {
        return result
    }
    return { ok: false, error: { code: 'bad-path', path, reason: result.reason, detail: `The path "${path}" is not allowed (${result.reason}).` } }
}

/**
 * Applies `ops` in order to a draft copy of the workspace's files and replaces the files list once, or changes nothing.
 * A refused op, or a cap overrun by the final result, leaves the workspace and every other workspace untouched. Replacing
 * the list through the reactive database is what marks it for the save: the generic top-level change effect deep-reads
 * `utilityWorkspaces`. A shrinking change is never refused for a cap the profile already exceeds.
 */
export function commitWorkspaceChange(workspaceId: string, ops: readonly WorkspaceOp[], env: WorkspaceEnv = defaultEnv): WorkspaceChangeResult {
    const workspace = findWorkspace(workspaceId)
    if (workspace === undefined) {
        return fail({ code: 'no-workspace', detail: 'The workspace does not exist.' })
    }
    const before = bytesOf(workspace.files)
    const draft: UtilityWorkspaceFile[] = workspace.files.map(file => ({ ...file }))
    const now = env.now()

    const indexOfPath = (path: string): number => draft.findIndex(file => file.path === path)
    // A different spelling of an existing path (case or normalization) is a collision, not a second file.
    const collidingWith = (path: string, ignore: number): string | undefined => {
        const key = workspacePathKey(path)
        return draft.find((file, index) => index !== ignore && workspacePathKey(file.path) === key)?.path
    }

    for (const op of ops) {
        if (op.kind === 'write') {
            const target = normalize(op.path)
            if (target.ok === false) {
                return fail(target.error)
            }
            const guard = checkWorkspaceText(op.text)
            if (guard.ok === false) {
                return fail({ code: 'bad-text', path: target.path, reason: guard.reason, detail: `"${target.path}" is not text (${guard.reason}).` })
            }
            const size = utf8ByteLength(op.text)
            if (size > WORKSPACE_LIMITS.fileBytes) {
                return fail({ code: 'file-too-large', path: target.path, detail: `"${target.path}" is ${size} bytes; a file holds at most ${WORKSPACE_LIMITS.fileBytes}.` })
            }
            const at = indexOfPath(target.path)
            const other = collidingWith(target.path, at)
            if (other !== undefined) {
                return fail({ code: 'collision', path: target.path, existing: other, detail: `"${target.path}" collides with "${other}".` })
            }
            if (at === -1) {
                draft.push({ id: env.newId(), path: target.path, text: op.text, size, mtime: now })
            } else {
                draft[at] = { ...draft[at], text: op.text, size, mtime: now }
            }
        } else if (op.kind === 'delete') {
            const target = normalize(op.path)
            if (target.ok === false) {
                return fail(target.error)
            }
            const at = indexOfPath(target.path)
            if (at === -1) {
                return fail({ code: 'not-found', path: target.path, detail: `"${target.path}" does not exist.` })
            }
            draft.splice(at, 1)
        } else {
            const from = normalize(op.from)
            if (from.ok === false) {
                return fail(from.error)
            }
            const to = normalize(op.to)
            if (to.ok === false) {
                return fail(to.error)
            }
            const at = indexOfPath(from.path)
            if (at === -1) {
                return fail({ code: 'not-found', path: from.path, detail: `"${from.path}" does not exist.` })
            }
            if (from.path === to.path) {
                return fail({ code: 'same-path', path: from.path, detail: `"${from.path}" is already there.` })
            }
            const other = collidingWith(to.path, at)
            if (other !== undefined) {
                return fail({ code: 'collision', path: to.path, existing: other, detail: `"${to.path}" collides with "${other}".` })
            }
            // The file keeps its id and text; only the record's path moves.
            draft[at] = { ...draft[at], path: to.path, mtime: now }
        }
    }

    const after = bytesOf(draft)
    const grows = after > before
    if (grows && after > WORKSPACE_LIMITS.workspaceBytes) {
        return fail({ code: 'workspace-too-large', detail: `A workspace holds at most ${WORKSPACE_LIMITS.workspaceBytes} bytes.` })
    }
    if (draft.length > workspace.files.length && draft.length > WORKSPACE_LIMITS.workspaceFiles) {
        return fail({ code: 'too-many-files', detail: `A workspace holds at most ${WORKSPACE_LIMITS.workspaceFiles} files.` })
    }
    if (grows && totalBytes() - before + after > WORKSPACE_LIMITS.totalBytes) {
        return fail({ code: 'total-too-large', detail: `All workspaces together hold at most ${WORKSPACE_LIMITS.totalBytes} bytes.` })
    }

    workspace.files = draft
    return { ok: true }
}
