import { normalizeWorkspacePath, workspacePathKey } from 'src/ts/process/utility/workspace/paths'
import { decodeWorkspaceBytes } from 'src/ts/process/utility/workspace/textGuard'
import {
    commitWorkspaceChange, hasWorkspace, listFiles, WORKSPACE_LIMITS,
    type WorkspaceChangeError, type WorkspaceEnv, type WorkspaceOp,
} from 'src/ts/process/utility/workspace/workspaceModel.svelte'
import type { CollisionChoice, ZipRefusedEntry } from 'src/ts/process/utility/workspace/workspaceZip'

/**
 * Plain text files picked one by one go through the same rules as a zip import: the same path rules, the same text guard,
 * one collision question for the whole import (MC-3411), and one commit so a cap overrun leaves the workspace untouched.
 * Nothing here touches the picker or the UI.
 */

export interface PickedFile {
    name: string
    bytes: Uint8Array
}

export interface FileImportPlan {
    accepted: Array<{ path: string, text: string }>
    refused: ZipRefusedEntry[]
    /** Accepted paths that already exist under exactly that spelling. */
    collisions: string[]
}

export function planFileImport(files: readonly PickedFile[], existingPaths: readonly string[]): FileImportPlan {
    const accepted: FileImportPlan['accepted'] = []
    const refused: ZipRefusedEntry[] = []
    const existingByKey = new Map<string, string>()
    for (const path of existingPaths) {
        existingByKey.set(workspacePathKey(path), path)
    }
    const existing = new Set(existingPaths)
    const seen = new Map<string, string>()
    const collisions: string[] = []
    for (const file of files) {
        const refuse = (reason: ZipRefusedEntry['reason'], detail: string): void => {
            refused.push({ name: file.name, reason, detail })
        }
        const normalized = normalizeWorkspacePath(file.name)
        if (normalized.ok === false) {
            refuse('bad-name', `The path is not allowed (${normalized.reason}).`)
            continue
        }
        const path = normalized.path
        const key = workspacePathKey(path)
        const earlier = seen.get(key)
        if (earlier !== undefined) {
            refuse(earlier === path ? 'duplicate' : 'case-collision', `The path repeats "${earlier}".`)
            continue
        }
        seen.set(key, path)
        const present = existingByKey.get(key)
        if (present !== undefined && present !== path) {
            refuse('collides-with-existing', `The path differs from the existing "${present}" only by case or normalization.`)
            continue
        }
        if (file.bytes.length > WORKSPACE_LIMITS.fileBytes) {
            refuse('too-large', `The file holds ${file.bytes.length} bytes; a file holds at most ${WORKSPACE_LIMITS.fileBytes}.`)
            continue
        }
        const decoded = decodeWorkspaceBytes(file.bytes)
        if (decoded.ok === false) {
            refuse('binary', 'Only text files are accepted.')
            continue
        }
        accepted.push({ path, text: decoded.text })
        if (existing.has(path)) {
            collisions.push(path)
        }
    }
    return { accepted, refused, collisions }
}

export type FileImportResult =
    | { ok: true, written: string[], keptExisting: string[], refused: ZipRefusedEntry[] }
    | { ok: false, reason: 'no-workspace' }
    | { ok: false, reason: 'cancelled' }
    | { ok: false, reason: 'changed' }
    | { ok: false, reason: 'caps', error: WorkspaceChangeError, refused: ZipRefusedEntry[] }

/**
 * Imports `files` into a workspace. `askCollision` is called at most once, and the plan is made again after the answer so
 * a path that appeared meanwhile is never replaced without having been asked about.
 */
export async function importPickedFiles(
    workspaceId: string,
    files: readonly PickedFile[],
    askCollision: (collisions: readonly string[]) => Promise<CollisionChoice>,
    env?: WorkspaceEnv,
): Promise<FileImportResult> {
    if (!hasWorkspace(workspaceId)) {
        return { ok: false, reason: 'no-workspace' }
    }
    const plan = planFileImport(files, listFiles(workspaceId).map(file => file.path))
    let choice: CollisionChoice = 'replace'
    let current = plan
    if (plan.collisions.length > 0) {
        choice = await askCollision(plan.collisions)
        if (choice === 'cancel') {
            return { ok: false, reason: 'cancelled' }
        }
        if (!hasWorkspace(workspaceId)) {
            return { ok: false, reason: 'no-workspace' }
        }
        current = planFileImport(files, listFiles(workspaceId).map(file => file.path))
        const asked = new Set(plan.collisions)
        if (current.collisions.some(path => !asked.has(path))) {
            return { ok: false, reason: 'changed' }
        }
    }
    const colliding = new Set(current.collisions)
    const keptExisting = choice === 'keep' ? current.collisions : []
    const writes = current.accepted.filter(file => !(choice === 'keep' && colliding.has(file.path)))
    if (writes.length > 0) {
        const ops: WorkspaceOp[] = writes.map(file => ({ kind: 'write', path: file.path, text: file.text }))
        const result = commitWorkspaceChange(workspaceId, ops, env)
        if (result.ok === false) {
            return { ok: false, reason: 'caps', error: result.error, refused: current.refused }
        }
    }
    return { ok: true, written: writes.map(file => file.path), keptExisting, refused: current.refused }
}

/** A byte count for display: bytes below one KiB, otherwise KiB or MiB with one decimal. */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KiB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
