/**
 * `tokenizeGGUFModel` reports a local-key failure in the active UI language, read when the error is
 * thrown, and keeps the raw underlying error inside the thrown text so the network hint of
 * `alertError` still matches on it. Tauri, the filesystem and the network are mocked, so nothing
 * here says anything about the native sidecar.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
}))
vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: vi.fn(async () => '/fake/appdata'),
    join: vi.fn(async (...parts: string[]) => parts.join('/')),
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
    exists: vi.fn(async () => false),
    readTextFile: vi.fn(async () => 'fake-key'),
}))
vi.mock(
    import('src/ts/alert'),
    () =>
        ({
            alertClear: vi.fn(),
            alertError: vi.fn(),
            alertWait: vi.fn(),
        }) as unknown as typeof import('src/ts/alert'),
)
vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: () => ({ aiModel: 'local_test-model.gguf', maxContext: 4096 }),
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)
vi.mock(
    import('src/ts/util'),
    () =>
        ({
            sleep: async (_ms: number) => {},
        }) as unknown as typeof import('src/ts/util'),
)

import { languageEnglish } from 'src/lang/en'
import { languageKorean } from 'src/lang/ko'

const realFetch = globalThis.fetch

beforeEach(() => {
    // A pristine module keeps its private install latch at the initial value.
    vi.resetModules()
    invokeMock.mockReset()
    invokeMock.mockImplementation(async (cmd: string) =>
        cmd === 'local_inference_unsupported_reason' ? null : true)
    // The key endpoint never answers, before or after the install attempt.
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
})

afterEach(() => {
    // Only the stubs made here are undone; the setup file's global helpers stay.
    globalThis.fetch = realFetch
})

/**
 * The language module is imported after the registry reset so that it is the instance local.ts reads;
 * each test gets a fresh one that starts in English.
 */
async function failure(lang: string): Promise<unknown> {
    const { changeLanguage } = await import('src/lang')
    changeLanguage(lang)
    const { tokenizeGGUFModel } = await import('../local')
    try {
        await tokenizeGGUFModel('hello')
    } catch (e) {
        return e
    }
    throw new Error('tokenizeGGUFModel did not throw')
}

describe('tokenizeGGUFModel: local key failure text', () => {
    test('compatibility guard: English throws the exact English text and keeps the raw error', async () => {
        expect(await failure('en')).toBe('Error when getting local key: TypeError: Failed to fetch')
    })

    test('regression reproducer: Korean throws the Korean prefix with the raw error intact', async () => {
        const template = languageKorean.errors.localKeyFailed
        expect(template).not.toBe(languageEnglish.errors.localKeyFailed)
        const thrown = await failure('ko')
        expect(thrown).toBe(template.replace('{error}', 'TypeError: Failed to fetch'))
        // alertError appends its network hint when the text contains this marker.
        expect(String(thrown)).toContain('Failed to fetch')
    })
})
