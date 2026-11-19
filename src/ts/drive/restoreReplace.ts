import { language } from "src/lang";
import type { Database } from "../storage/database.svelte";
import { DBState } from "../stores.svelte";
import { readColdStorageItem } from "../process/coldstorage.svelte";

/** Helpers the `.bin` import and the export share. */

/**
 * The character an archived character's unit holds, or null when the unit
 * cannot supply one: it is missing, cannot be read, or holds no character.
 */
export async function readArchivedUnitCharacter(stub: Record<string, unknown>): Promise<unknown> {
    const key = stub.coldstorage
    if (typeof key !== 'string' || key === '') {
        return null
    }
    try {
        const read = await readColdStorageItem(key)
        if (read.status !== 'ok') {
            return null
        }
        const value = read.value as { character?: unknown } | null | undefined
        return value?.character ?? null
    } catch (error) {
        console.error(error)
        return null
    }
}

/** The display names of the live profile's characters by chaId, for naming what a restore leaves out. */
export function currentCharacterNames(): Map<string, string> {
    const names = new Map<string, string>()
    for (const character of (DBState.db as Database | undefined)?.characters ?? []) {
        if (character?.chaId !== undefined && typeof character.name === 'string' && character.name !== '') {
            names.set(String(character.chaId), character.name)
        }
    }
    return names
}

/** The confirm text of a restore that leaves blocks out. */
export function leftOutQuestion(lines: readonly string[]): string {
    return language.restoreLeftOutConfirm(lines.map((line) => `- ${line}`).join('\n'))
}
