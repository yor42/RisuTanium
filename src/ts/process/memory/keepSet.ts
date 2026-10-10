/**
 * The characters that must stay as they are in memory: the one on screen and,
 * for a group, its members. The idle reload leaves them inline and the put-back
 * leaves them loaded (`characterPutBack.ts` adds the previous selection).
 */

import { get } from 'svelte/store'
import { DBState, selectedCharID } from '../../stores.svelte'

/** Adds the members of `cha` to `keep` when it is a group. */
export function addGroupMembers(keep: Set<string>, cha: { type?: string, characters?: unknown } | null | undefined): void {
    if (cha?.type === 'group' && Array.isArray(cha.characters)) {
        for (const member of cha.characters) {
            if (typeof member === 'string') {
                keep.add(member)
            }
        }
    }
}

/** The selected character and, for a group, its members: the characters the idle reload must leave inline. */
export function baseKeepInline(): Set<string> {
    const keep = new Set<string>()
    const selected = DBState.db?.characters?.[get(selectedCharID)]
    if (selected) {
        if (typeof selected.chaId === 'string' && selected.chaId !== '') {
            keep.add(selected.chaId)
        }
        addGroupMembers(keep, selected)
    }
    return keep
}
