// T1-TY (type-level diagnostic, checked by `pnpm check`): probe spec tables run through `MissingHolderPropertyOf`. The
// valid probe must pass; each `@ts-expect-error` probe must fail, so a weakened check leaves an unused directive that
// `pnpm check` reports.
import { describe, expect, test } from 'vitest'
import type { MissingHolderPropertyOf } from '../fieldRegistry'

type Fact = { readonly value: 'text'; readonly holders: readonly ['character']; readonly absent: 'keep'; readonly editWhenAbsent: boolean }
type Facts2 = { readonly value: 'text'; readonly holders: readonly ['character', 'module']; readonly absent: 'keep'; readonly editWhenAbsent: boolean }

const fact: Fact = { value: 'text', holders: ['character'], absent: 'keep', editWhenAbsent: true }
const fact2: Facts2 = { value: 'text', holders: ['character', 'module'], absent: 'keep', editWhenAbsent: true }

const validSpecs = { 'depth_prompt.prompt': fact, nickname: fact } as const
const badKey = { 'depth_prompt.nope': fact } as const
const badHolders = { 'additionalData.creator': fact2 } as const
const badFlat = { 'nickname.x': fact } as const

const valid: [MissingHolderPropertyOf<typeof validSpecs>] extends [never] ? true : never = true
// @ts-expect-error a dotted path naming a key the container does not have
const invalidKey: [MissingHolderPropertyOf<typeof badKey>] extends [never] ? true : never = true
// @ts-expect-error a dotted path held by a module as well
const invalidHolders: [MissingHolderPropertyOf<typeof badHolders>] extends [never] ? true : never = true
// @ts-expect-error a flat path that is not a character property
const invalidFlat: [MissingHolderPropertyOf<typeof badFlat>] extends [never] ? true : never = true

describe('T1-TY: the compile-time registry check', () => {
    test('the probes exist (the checks themselves run in pnpm check)', () => {
        expect([valid, invalidKey, invalidHolders, invalidFlat]).toHaveLength(4)
    })
})
