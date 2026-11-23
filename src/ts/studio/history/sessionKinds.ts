// The session owner kinds: owners whose history lives in memory only and whose live data belongs to an
// adapter (see sessionAdapters.ts). A session kind never has a stored key: the store, the claim port and
// the stored-key type know nothing about it. A kind that must persist is a stored kind and extends
// `StoredOwnerKey` instead. This table is pure data: the helpers and the adapters live elsewhere so that a
// test that replaces this module still runs their real bodies.

import type { SetPath } from './fieldRegistry'

export interface SessionOwnerKindSpec {
    // Any registered path; the kind needs no holder membership for them.
    readonly setPaths: readonly SetPath[]
}

export const SESSION_OWNER_KINDS = {
    // A bot preset's toggle text, by the preset's stable id (see presetTarget.ts).
    preset: { setPaths: ['customModuleToggle'] },
} as const satisfies Record<string, SessionOwnerKindSpec>

export type SessionOwnerKind = keyof typeof SESSION_OWNER_KINDS

// A session kind name is the text before the first ':' of its keys, so it can hold none and cannot be a
// stored kind's name.
type BadSessionKindName<K extends string> = K extends 'character' | 'chat' | 'module'
    ? K
    : K extends `${string}:${string}`
      ? K
      : K extends ''
        ? K
        : never
export const SESSION_KIND_NAMES_VALID: [BadSessionKindName<SessionOwnerKind>] extends [never] ? true : never = true

export function isValidSessionKindName(name: string): boolean {
    return name !== '' && name !== 'character' && name !== 'chat' && name !== 'module' && !name.includes(':')
}
