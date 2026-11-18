// @vitest-environment node

import { describe, expect, test } from 'vitest'
import { countLuaScripts } from './luaScriptCount'
import type { triggerscript } from '../storage/database.svelte'

function lua(...codes: string[]): triggerscript {
  return {
    comment: 'c',
    type: 'manual',
    conditions: [],
    effect: codes.map((code) => ({ type: 'triggerlua', code })),
  } as unknown as triggerscript
}

describe('countLuaScripts', () => {
  test('an empty list has no scripts', () => {
    expect(countLuaScripts([])).toBe(0)
  })

  test('only triggerlua effects count', () => {
    const list = [
      {
        comment: 'c',
        type: 'manual',
        conditions: [],
        effect: [{ type: 'triggercode', code: 'x' }, { type: 'setvar', var: 'a', value: '1', operator: '=' }],
      },
      lua('a'),
    ] as unknown as triggerscript[]
    expect(countLuaScripts(list)).toBe(1)
  })

  test('every triggerlua effect of one trigger counts, not only the first', () => {
    expect(countLuaScripts([lua('a', 'b')])).toBe(2)
  })

  test('the same code in two triggers counts once', () => {
    expect(countLuaScripts([lua('a'), lua('a')])).toBe(1)
  })

  test('malformed entries are skipped without throwing', () => {
    const list = [
      null,
      {},
      { effect: null },
      { effect: [null] },
      lua('a'),
    ] as unknown as triggerscript[]
    expect(countLuaScripts(list)).toBe(1)
  })
})
