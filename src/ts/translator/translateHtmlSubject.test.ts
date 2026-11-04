// @vitest-environment jsdom
/**
 * translateHTML forwards an optional trailing run subject to the editdisplay pass
 * (processScriptFull's send-subject argument). A caller that passes no subject leaves
 * that argument undefined, so every existing caller keeps its selection-based behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RunSubject } from '../process/chatOrigin'

const db = {
  translatorType: 'deepl',
  deeplOptions: { freeApi: true, key: 'k' },
  combineTranslation: true,
  translator: 'ko',
  aiModel: 'gpt',
  presetRegex: [],
  characters: [],
}

const scriptMock = vi.hoisted(() => ({
  calls: [] as unknown[][],
}))

vi.mock('../storage/database.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../storage/database.svelte')>()),
  getDatabase: () => db,
}))

vi.mock('../process/modules', () => ({
  getModuleRegexScripts: () => [],
  moduleUpdate: () => {},
}))

vi.mock('../globalApi.svelte', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../globalApi.svelte')>()),
  globalFetch: async (_url: string, init: { body: { text: string[] } }) => ({
    ok: true,
    data: { translations: [{ text: init.body.text[0] }] },
  }),
}))

vi.mock('../secretRef', () => ({
  resolveSecret: async (value: string) => value,
  SecretRefError: class SecretRefError extends Error {},
}))

vi.mock('../process/scripts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../process/scripts')>()),
  processScriptFull: async (...args: unknown[]) => {
    scriptMock.calls.push(args)
    return { data: args[1] as string }
  },
}))

vi.mock('../parser/parser.svelte', () => ({
  applyMarkdownToNode: () => {},
  risuChatParser: (data: string) => data,
}))

import { translateHTML } from './translator'

beforeEach(() => {
  scriptMock.calls = []
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('translateHTML run subject', () => {
  // Regression reproducer: fails before the fix because the subject is not forwarded.
  it('forwards the subject as the send-subject argument of the editdisplay pass', async () => {
    const subject = { origin: { ownerId: 'a', chatId: 'c2' }, resolve: () => null } as unknown as RunSubject
    await translateHTML('<p>plain</p>', false, '', -1, false, subject)

    expect(scriptMock.calls.length).toBeGreaterThan(0)
    for (const call of scriptMock.calls) {
      expect(call[2]).toBe('editdisplay')
      expect(call[6]).toBe(subject)
    }
  })

  // Compatibility guard: passes before and after the fix.
  it('passes no subject to the display pass when the caller gives none', async () => {
    await translateHTML('<p>plain</p>', false, '', -1)

    expect(scriptMock.calls.length).toBeGreaterThan(0)
    for (const call of scriptMock.calls) {
      expect(call[2]).toBe('editdisplay')
      expect(call[6]).toBeUndefined()
    }
  })
})
