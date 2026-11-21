// @vitest-environment jsdom
/**
 * `hasher` is the SHA-256 hex behind rcc hash checks, persisted V3 permission keys and the Lua
 * `hash` function. It gives the same lowercase hex with and without `crypto.subtle`. The
 * no-subtle halves are regression reproducers; the realCrypto halves are compatibility guards.
 */
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { writable } from 'svelte/store'

vi.mock(import('../storage/database.svelte'), () =>
  ({
    appVer: '1234.5.67',
    getCurrentCharacter: () => ({}),
    getCurrentChat: () => ({}),
    getDatabase: () => ({}),
  } as typeof import('../storage/database.svelte'))
)

vi.mock(import('../globalApi.svelte'), () =>
  ({
    aiWatermarkingLawApplies: () => false,
    getFileSrc: () => Promise.resolve(''),
    readImage: () => Promise.resolve(undefined),
  } as unknown as typeof import('../globalApi.svelte'))
)

vi.mock(import('../stores.svelte'), () =>
  ({
    DBState: { db: { characters: [], globalChatVariables: {}, templateDefaultVariables: '' } },
    selIdState: { selId: 0 },
    selectedCharID: writable(0),
  } as unknown as typeof import('../stores.svelte'))
)

import { hasher } from './parser.svelte'

const realCrypto = globalThis.crypto

afterEach(() => {
  vi.unstubAllGlobals()
})

const BACKENDS: { name: string, install: () => void }[] = [
  {
    name: 'no crypto.subtle',
    install: () => {
      vi.stubGlobal('crypto', { getRandomValues: realCrypto.getRandomValues.bind(realCrypto) })
      expect((globalThis.crypto as { subtle?: unknown }).subtle).toBeUndefined()
    },
  },
  { name: 'realCrypto', install: () => { expect(globalThis.crypto.subtle).toBeDefined() } },
]

describe.each(BACKENDS)('hasher on $name', ({ install }) => {
  it('T8 gives the known lowercase SHA-256 hex of abc', async () => {
    install()
    expect(await hasher(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('T8 matches node createHash for a 5 MiB buffer at an odd byteOffset', async () => {
    install()
    const backing = Buffer.alloc(5 * 1024 * 1024 + 1)
    for (let i = 0; i < backing.length; i += 97) backing[i] = i & 0xff
    const data = backing.subarray(1)
    expect(await hasher(data)).toBe(createHash('sha256').update(data).digest('hex'))
  })
})
