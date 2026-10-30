import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

//#region module mocks — keep the unit under test isolated from the rest of
// the app's (heavy, side-effecting) dependency graph, matching the pattern
// used in src/ts/storage/tests/risuSave.test.ts and
// src/ts/process/files/tests/inlays.test.ts.

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
    invoke: invokeMock,
}))

const appDataDirMock = vi.fn(async () => '/fake/appdata')
const pathJoinMock = vi.fn(async (...parts: string[]) => parts.join('/'))
vi.mock('@tauri-apps/api/path', () => ({
    appDataDir: appDataDirMock,
    join: pathJoinMock,
}))

const existsMock = vi.fn(async () => false)
const readTextFileMock = vi.fn(async () => 'fake-key')
vi.mock('@tauri-apps/plugin-fs', () => ({
    exists: existsMock,
    readTextFile: readTextFileMock,
}))

const alertClearMock = vi.fn()
const alertErrorMock = vi.fn()
const alertWaitMock = vi.fn()
const alertConfirmMock = vi.fn(async (_msg: string) => true)
vi.mock(
    import('src/ts/alert'),
    () =>
        ({
            alertClear: alertClearMock,
            alertError: alertErrorMock,
            alertWait: alertWaitMock,
            alertConfirm: alertConfirmMock,
        }) as unknown as typeof import('src/ts/alert'),
)

// The native side announces each dependency through this event while the single
// install_py_dependencies invoke is pending.
type DependencyHandler = (event: { payload: string }) => void
const unlistenMock = vi.fn()
let dependencyHandler: DependencyHandler | undefined
const listenMock = vi.fn(async (_name: string, handler: DependencyHandler) => {
    dependencyHandler = handler
    return unlistenMock
})
vi.mock('@tauri-apps/api/event', () => ({
    listen: listenMock,
}))

function announceDependencies(names: string[]) {
    for (const name of names) {
        dependencyHandler?.({ payload: name })
    }
}

const getDatabaseMock = vi.fn(() => ({ aiModel: 'local_test-model.gguf', maxContext: 4096 }))
vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: getDatabaseMock,
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

const sleepMock = vi.fn(async (_ms: number) => {})
vi.mock(
    import('src/ts/util'),
    () =>
        ({
            sleep: sleepMock,
        }) as unknown as typeof import('src/ts/util'),
)

//#endregion

const LOCAL_KEY_URL = 'http://localhost:10026/'
const TOKENIZE_URL = 'http://localhost:10026/llamacpp/tokenize'

/** Matches the module's own detection of a CORS/connection-refused failure. */
function networkError(): TypeError {
    return new TypeError('Failed to fetch')
}

function jsonResponse(body: unknown): Response {
    return { json: async () => body } as Response
}

beforeEach(async () => {
    // Every test needs a pristine copy of local.ts so the module-private
    // `initPython` latch starts at its initial value.
    vi.resetModules()
    vi.clearAllMocks()
    existsMock.mockResolvedValue(false)
    alertConfirmMock.mockResolvedValue(true)
    dependencyHandler = undefined
    appDataDirMock.mockResolvedValue('/fake/appdata')
    readTextFileMock.mockResolvedValue('fake-key')
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('tokenizeGGUFModel — bundled Python sidecar install flow', () => {
    test('install succeeds: proceeds through dependencies + run_py_server, then retries and returns tokens', async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })

        let fetchCallCount = 0
        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            fetchCallCount++
            if (url === LOCAL_KEY_URL) {
                // First probe fails (sidecar not up yet), the retry after
                // install succeeds.
                if (fetchCallCount === 1) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([1, 2, 3])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')
        const result = await tokenizeGGUFModel('hello world')

        expect(result).toEqual([1, 2, 3])

        // Full sequence: install_python -> install_pip -> post_py_install ->
        // one install_py_dependencies -> run_py_server.
        expect(invokeMock).toHaveBeenCalledWith('install_python')
        expect(invokeMock).toHaveBeenCalledWith('install_pip')
        expect(invokeMock).toHaveBeenCalledWith('post_py_install')
        expect(invokeMock).toHaveBeenCalledWith('run_py_server')
        const dependencyCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'install_py_dependencies')
        expect(dependencyCalls).toEqual([['install_py_dependencies']])

        // The success path sleeps 4s before declaring the server ready — must
        // not actually be waited on by the test.
        expect(sleepMock).toHaveBeenCalledWith(4000)

        // A retry fetch was attempted after the failed probe, and it succeeded.
        expect(fetchCallCount).toBe(3)
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('definitive failure: alertError fires, no retry fetch, error propagates, and the latch resets for a later attempt', async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return false
            }
            return undefined
        })

        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                throw networkError()
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
            /local inference sidecar could not be started/,
        )

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to install the bundled Python runtime'),
        )
        // Only the initial probe fetch happened — no retry after a definitive
        // install failure.
        expect(fetchMock).toHaveBeenCalledTimes(1)
        // Only the support-gate check and install_python were attempted;
        // the dependency loop and run_py_server must not run when install
        // itself failed. Asserted as the exact ordered call sequence
        // (rather than a raw call count) so this stays correct if another
        // leading gate check is ever added.
        expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
            'local_inference_unsupported_reason',
            'install_python',
        ])
        expect(invokeMock).toHaveBeenCalledWith('install_python')

        // The module-private latch must have been reset on failure: a later
        // call should do real work again, not silently no-op.
        invokeMock.mockClear()
        fetchMock.mockClear()
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })
        readTextFileMock.mockResolvedValue('fake-key-2')

        let secondFetchCount = 0
        fetchMock.mockImplementation(async (url: string) => {
            secondFetchCount++
            if (url === LOCAL_KEY_URL) {
                if (secondFetchCount === 1) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key2.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([9])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })

        const secondResult = await tokenizeGGUFModel('again')

        expect(secondResult).toEqual([9])
        expect(invokeMock).toHaveBeenCalledWith('install_python')
        expect(invokeMock).toHaveBeenCalledWith('run_py_server')
        expect(sleepMock).toHaveBeenCalledWith(4000)
    })

    test('dependency install rejects (llama-cpp-python): alertError identifies the dependency, run_py_server is skipped, no retry fetch, error propagates, and the latch resets for a later attempt', async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            if (cmd === 'install_py_dependencies') {
                announceDependencies(['pydantic', 'scikit-build', 'scikit-build-core', 'pyproject_metadata', 'pathspec', 'llama-cpp-python'])
                throw new Error('native build failed')
            }
            return undefined
        })

        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                throw networkError()
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
            /local inference sidecar could not be started/,
        )

        // run_py_server must never be reached once a dependency install
        // rejects mid-loop.
        expect(invokeMock).not.toHaveBeenCalledWith('run_py_server')

        // One native call installs the whole list; the last announced name is
        // the one that failed, and the listener was released.
        const dependencyCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'install_py_dependencies')
        expect(dependencyCalls).toHaveLength(1)
        expect(unlistenMock).toHaveBeenCalledTimes(1)

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('llama-cpp-python'),
        )

        // Only the initial probe fetch happened — no retry after a
        // dependency install failure.
        expect(fetchMock).toHaveBeenCalledTimes(1)

        // The module-private latch must have been reset on failure: a
        // later call should do real work again with fresh invokes, not
        // silently no-op forever with the UI stuck on the "Installing
        // Python Dependencies (llama-cpp-python)" spinner.
        invokeMock.mockClear()
        fetchMock.mockClear()
        alertErrorMock.mockClear()
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })
        readTextFileMock.mockResolvedValue('fake-key-2')

        let secondFetchCount = 0
        fetchMock.mockImplementation(async (url: string) => {
            secondFetchCount++
            if (url === LOCAL_KEY_URL) {
                if (secondFetchCount === 1) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key2.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([9])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })

        const secondResult = await tokenizeGGUFModel('again')

        expect(secondResult).toEqual([9])
        const secondDependencyCalls = invokeMock.mock.calls.filter(
            ([cmd]) => cmd === 'install_py_dependencies',
        )
        expect(secondDependencyCalls).toHaveLength(1)
        expect(invokeMock).toHaveBeenCalledWith('run_py_server')
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('run_py_server invoke rejects: alertError fires, no retry fetch, error propagates, and the latch resets for a later attempt', async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            if (cmd === 'run_py_server') {
                throw new Error('sidecar port already in use')
            }
            return undefined
        })

        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                throw networkError()
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
            /local inference sidecar could not be started/,
        )

        // The full dependency loop ran (nothing there rejected) before
        // run_py_server was attempted and rejected.
        const dependencyCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'install_py_dependencies')
        expect(dependencyCalls).toHaveLength(1)
        expect(invokeMock).toHaveBeenCalledWith('run_py_server')

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to start the local inference server'),
        )

        // Only the initial probe fetch happened — no retry after
        // run_py_server failed.
        expect(fetchMock).toHaveBeenCalledTimes(1)

        // The module-private latch must have been reset on failure: a
        // later call should do real work again with fresh invokes, not
        // silently no-op forever with the UI stuck on a stale spinner.
        invokeMock.mockClear()
        fetchMock.mockClear()
        alertErrorMock.mockClear()
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })
        readTextFileMock.mockResolvedValue('fake-key-2')

        let secondFetchCount = 0
        fetchMock.mockImplementation(async (url: string) => {
            secondFetchCount++
            if (url === LOCAL_KEY_URL) {
                if (secondFetchCount === 1) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key2.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([9])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })

        const secondResult = await tokenizeGGUFModel('again')

        expect(secondResult).toEqual([9])
        expect(invokeMock).toHaveBeenCalledWith('run_py_server')
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('re-entrancy: a second call arriving mid-install does not start a second install sequence', async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })
        readTextFileMock.mockResolvedValue('fake-key')

        let probeCount = 0
        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                probeCount++
                // Both callers' first probe (before any install has
                // happened) fails; every probe after that succeeds.
                if (probeCount <= 2) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([7])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        const [resultA, resultB] = await Promise.all([
            tokenizeGGUFModel('first'),
            tokenizeGGUFModel('second'),
        ])

        expect(resultA).toEqual([7])
        expect(resultB).toEqual([7])

        // Exactly one install sequence must have run, no matter how many
        // overlapping callers raced into installPython().
        const installPythonCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'install_python')
        const runServerCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'run_py_server')
        expect(installPythonCalls).toHaveLength(1)
        expect(runServerCalls).toHaveLength(1)
        expect(sleepMock).toHaveBeenCalledTimes(1)
    })

    test('install_pip resolves false: alertError identifies pip, post_py_install is never invoked, dependencies/run_py_server are skipped, no retry fetch, error propagates, and the latch resets for a later attempt', async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return false
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })

        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                throw networkError()
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
            /local inference sidecar could not be started/,
        )

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to install Pip'),
        )

        // Writing completed.txt (post_py_install) after a false-returning
        // pip install is exactly what permanently bricks local inference —
        // it must never be reached.
        expect(invokeMock).not.toHaveBeenCalledWith('post_py_install')
        expect(invokeMock).not.toHaveBeenCalledWith('install_py_dependencies')
        expect(invokeMock).not.toHaveBeenCalledWith('run_py_server')
        // Asserted as the exact ordered call sequence (rather than a raw
        // call count) so this stays correct if another leading gate check
        // is ever added.
        expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
            'local_inference_unsupported_reason',
            'install_python',
            'install_pip',
        ])
        expect(invokeMock).toHaveBeenCalledWith('install_python')
        expect(invokeMock).toHaveBeenCalledWith('install_pip')

        // Only the initial probe fetch happened — no retry after a
        // definitive pip install failure.
        expect(fetchMock).toHaveBeenCalledTimes(1)

        // The module-private latch must have been reset on failure: a
        // later call should do real work again, not silently no-op.
        invokeMock.mockClear()
        fetchMock.mockClear()
        alertErrorMock.mockClear()
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })
        readTextFileMock.mockResolvedValue('fake-key-2')

        let secondFetchCount = 0
        fetchMock.mockImplementation(async (url: string) => {
            secondFetchCount++
            if (url === LOCAL_KEY_URL) {
                if (secondFetchCount === 1) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key2.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([9])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })

        const secondResult = await tokenizeGGUFModel('again')

        expect(secondResult).toEqual([9])
        expect(invokeMock).toHaveBeenCalledWith('post_py_install')
        expect(invokeMock).toHaveBeenCalledWith('run_py_server')
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('post_py_install resolves false: alertError identifies the finalize step, dependencies/run_py_server are skipped, no retry fetch, error propagates, and the latch resets for a later attempt', async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return false
            }
            return undefined
        })

        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                throw networkError()
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
            /local inference sidecar could not be started/,
        )

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to finalize the bundled Python runtime installation'),
        )

        expect(invokeMock).not.toHaveBeenCalledWith('install_py_dependencies')
        expect(invokeMock).not.toHaveBeenCalledWith('run_py_server')
        // Asserted as the exact ordered call sequence (rather than a raw
        // call count) so this stays correct if another leading gate check
        // is ever added.
        expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
            'local_inference_unsupported_reason',
            'install_python',
            'install_pip',
            'post_py_install',
        ])
        expect(invokeMock).toHaveBeenCalledWith('install_python')
        expect(invokeMock).toHaveBeenCalledWith('install_pip')
        expect(invokeMock).toHaveBeenCalledWith('post_py_install')

        // Only the initial probe fetch happened — no retry after a
        // definitive finalize-install failure.
        expect(fetchMock).toHaveBeenCalledTimes(1)

        // The module-private latch must have been reset on failure: a
        // later call should do real work again, not silently no-op.
        invokeMock.mockClear()
        fetchMock.mockClear()
        alertErrorMock.mockClear()
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })
        readTextFileMock.mockResolvedValue('fake-key-2')

        let secondFetchCount = 0
        fetchMock.mockImplementation(async (url: string) => {
            secondFetchCount++
            if (url === LOCAL_KEY_URL) {
                if (secondFetchCount === 1) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key2.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([9])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })

        const secondResult = await tokenizeGGUFModel('again')

        expect(secondResult).toEqual([9])
        expect(invokeMock).toHaveBeenCalledWith('run_py_server')
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('install_pip invoke rejects: alertError identifies pip, post_py_install is never invoked, dependencies/run_py_server are skipped, no retry fetch, error propagates, and the latch resets for a later attempt', async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                throw new Error('pip network reset')
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })

        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                throw networkError()
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
            /local inference sidecar could not be started/,
        )

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to install Pip'),
        )

        expect(invokeMock).not.toHaveBeenCalledWith('post_py_install')
        expect(invokeMock).not.toHaveBeenCalledWith('install_py_dependencies')
        expect(invokeMock).not.toHaveBeenCalledWith('run_py_server')
        // Asserted as the exact ordered call sequence (rather than a raw
        // call count) so this stays correct if another leading gate check
        // is ever added.
        expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
            'local_inference_unsupported_reason',
            'install_python',
            'install_pip',
        ])

        // Only the initial probe fetch happened — no retry after a pip
        // install that throws.
        expect(fetchMock).toHaveBeenCalledTimes(1)

        // The module-private latch must have been reset on failure: a
        // later call should do real work again, not silently no-op.
        invokeMock.mockClear()
        fetchMock.mockClear()
        alertErrorMock.mockClear()
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })
        readTextFileMock.mockResolvedValue('fake-key-2')

        let secondFetchCount = 0
        fetchMock.mockImplementation(async (url: string) => {
            secondFetchCount++
            if (url === LOCAL_KEY_URL) {
                if (secondFetchCount === 1) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key2.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([9])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })

        const secondResult = await tokenizeGGUFModel('again')

        expect(secondResult).toEqual([9])
        expect(invokeMock).toHaveBeenCalledWith('post_py_install')
        expect(invokeMock).toHaveBeenCalledWith('run_py_server')
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('post_py_install invoke rejects: alertError identifies the finalize step, dependencies/run_py_server are skipped, no retry fetch, error propagates, and the latch resets for a later attempt', async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                throw new Error('disk full while rewriting python311._pth')
            }
            return undefined
        })

        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                throw networkError()
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
            /local inference sidecar could not be started/,
        )

        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to finalize the bundled Python runtime installation'),
        )

        expect(invokeMock).not.toHaveBeenCalledWith('install_py_dependencies')
        expect(invokeMock).not.toHaveBeenCalledWith('run_py_server')
        // Asserted as the exact ordered call sequence (rather than a raw
        // call count) so this stays correct if another leading gate check
        // is ever added.
        expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
            'local_inference_unsupported_reason',
            'install_python',
            'install_pip',
            'post_py_install',
        ])

        // Only the initial probe fetch happened — no retry after a
        // finalize step that throws.
        expect(fetchMock).toHaveBeenCalledTimes(1)

        // The module-private latch must have been reset on failure: a
        // later call should do real work again, not silently no-op.
        invokeMock.mockClear()
        fetchMock.mockClear()
        alertErrorMock.mockClear()
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })
        readTextFileMock.mockResolvedValue('fake-key-2')

        let secondFetchCount = 0
        fetchMock.mockImplementation(async (url: string) => {
            secondFetchCount++
            if (url === LOCAL_KEY_URL) {
                if (secondFetchCount === 1) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key2.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([9])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })

        const secondResult = await tokenizeGGUFModel('again')

        expect(secondResult).toEqual([9])
        expect(invokeMock).toHaveBeenCalledWith('run_py_server')
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('regression guard: when install_pip fails, post_py_install (which writes completed.txt) must never be invoked', async () => {
        // post_py_install (and its completed.txt write) must never run when
        // install_pip did not actually succeed, or local inference is
        // permanently bricked on every future launch.
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return false
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })

        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                throw networkError()
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
            /local inference sidecar could not be started/,
        )

        expect(invokeMock).not.toHaveBeenCalledWith('post_py_install')
    })

    test('unsupported platform: gate resolves a reason string, bails before any download even when completed.txt already exists, and does not latch initPython off for a later call', async () => {
        const reason = 'Local inference is not supported on ARM64 Windows.'
        // completed.txt already exists (e.g. from a previous install on a
        // different machine/architecture, or a synced app-data folder).
        // The gate must win regardless — a gate placed after this check
        // would let an ARM user with a stale prior install slip straight
        // through to run_py_server.
        existsMock.mockResolvedValue(true)
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return reason
            }
            // Any other command firing here is exactly the bug this test
            // guards against: the gate must refuse before anything else
            // is ever invoked.
            throw new Error(`unexpected invoke: ${cmd}`)
        })

        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                throw networkError()
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
            /local inference sidecar could not be started/,
        )

        expect(alertClearMock).toHaveBeenCalled()
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(reason)
        // The UI must never even flash an "Installing..." spinner for a
        // platform that was refused up front.
        expect(alertWaitMock).not.toHaveBeenCalled()

        // The whole point of the gate: refuse before any download begins.
        // No other invoke happens at all.
        expect(invokeMock).toHaveBeenCalledTimes(1)
        expect(invokeMock).toHaveBeenCalledWith('local_inference_unsupported_reason')
        expect(invokeMock).not.toHaveBeenCalledWith('install_python')
        expect(invokeMock).not.toHaveBeenCalledWith('install_pip')
        expect(invokeMock).not.toHaveBeenCalledWith('post_py_install')
        expect(invokeMock).not.toHaveBeenCalledWith('install_py_dependencies')
        expect(invokeMock).not.toHaveBeenCalledWith('run_py_server')

        // No retry fetch was performed — only the initial probe.
        expect(fetchMock).toHaveBeenCalledTimes(1)

        // The module-private `initPython` latch must never have been set
        // on this refused path: a later call, once the gate reports the
        // platform as supported, must do real work rather than being
        // permanently no-op'd off.
        existsMock.mockResolvedValue(false)
        invokeMock.mockClear()
        fetchMock.mockClear()
        alertErrorMock.mockClear()
        alertClearMock.mockClear()
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })
        readTextFileMock.mockResolvedValue('fake-key-2')

        let secondFetchCount = 0
        fetchMock.mockImplementation(async (url: string) => {
            secondFetchCount++
            if (url === LOCAL_KEY_URL) {
                if (secondFetchCount === 1) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key2.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([9])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })

        const secondResult = await tokenizeGGUFModel('again')

        expect(secondResult).toEqual([9])
        expect(invokeMock).toHaveBeenCalledWith('install_python')
        expect(invokeMock).toHaveBeenCalledWith('run_py_server')
        expect(alertErrorMock).not.toHaveBeenCalled()
    })

    test('unsupported-reason check rejects: alertError fires with a clean-failure message, no other invoke happens, and the error propagates', async () => {
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                throw new Error('IPC channel closed')
            }
            throw new Error(`unexpected invoke: ${cmd}`)
        })

        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                throw networkError()
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
            /local inference sidecar could not be started/,
        )

        expect(alertClearMock).toHaveBeenCalled()
        expect(alertErrorMock).toHaveBeenCalledTimes(1)
        expect(alertErrorMock).toHaveBeenCalledWith(
            expect.stringContaining('Failed to check local inference support'),
        )
        expect(alertWaitMock).not.toHaveBeenCalled()

        expect(invokeMock).toHaveBeenCalledTimes(1)
        expect(invokeMock).toHaveBeenCalledWith('local_inference_unsupported_reason')
        expect(invokeMock).not.toHaveBeenCalledWith('install_python')
        expect(invokeMock).not.toHaveBeenCalledWith('install_pip')
        expect(invokeMock).not.toHaveBeenCalledWith('post_py_install')
        expect(invokeMock).not.toHaveBeenCalledWith('install_py_dependencies')
        expect(invokeMock).not.toHaveBeenCalledWith('run_py_server')

        // No retry fetch after a definitive gate-check failure.
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    test('placement invariant: two concurrent calls each hit the support-gate check, but still produce exactly one install_python and one run_py_server', async () => {
        // The support-gate invoke is a deliberate `await` placed BEFORE
        // the re-entrancy guard (`if(initPython){...}; initPython = true`),
        // never between that check and that set. If it were ever moved
        // into that gap, two concurrent callers could both observe
        // `initPython === false` and both start a duplicate install (and
        // duplicate run_py_server, racing for port 10026). This test
        // fails if the gate call is ever relocated into that gap.
        invokeMock.mockImplementation(async (cmd: string) => {
            if (cmd === 'local_inference_unsupported_reason') {
                return null
            }
            if (cmd === 'install_python') {
                return true
            }
            if (cmd === 'install_pip') {
                return true
            }
            if (cmd === 'post_py_install') {
                return true
            }
            return undefined
        })
        readTextFileMock.mockResolvedValue('fake-key')

        let probeCount = 0
        const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
            if (url === LOCAL_KEY_URL) {
                probeCount++
                // Both callers' first probe (before any install has
                // happened) fails; every probe after that succeeds.
                if (probeCount <= 2) {
                    throw networkError()
                }
                return jsonResponse({ dir: '/fake/appdata/key.txt' })
            }
            if (url === TOKENIZE_URL) {
                return jsonResponse([7])
            }
            throw new Error(`unexpected fetch url: ${url}`)
        })
        vi.stubGlobal('fetch', fetchMock)

        const { tokenizeGGUFModel } = await import('../local')

        const [resultA, resultB] = await Promise.all([
            tokenizeGGUFModel('first'),
            tokenizeGGUFModel('second'),
        ])

        expect(resultA).toEqual([7])
        expect(resultB).toEqual([7])

        // Both overlapping callers reach the gate check — it runs
        // unconditionally on every call, ahead of the latch guard.
        const gateCalls = invokeMock.mock.calls.filter(
            ([cmd]) => cmd === 'local_inference_unsupported_reason',
        )
        expect(gateCalls).toHaveLength(2)

        // ...but exactly one install sequence and one server start must
        // have run, no matter how many overlapping callers raced into
        // installPython() after the gate.
        const installPythonCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'install_python')
        const runServerCalls = invokeMock.mock.calls.filter(([cmd]) => cmd === 'run_py_server')
        expect(installPythonCalls).toHaveLength(1)
        expect(runServerCalls).toHaveLength(1)
        expect(sleepMock).toHaveBeenCalledTimes(1)
    })

    describe('consent before installing (MC-879) and the fixed native commands', () => {
        function stubProbeFailingThenWorking() {
            let probes = 0
            const fetchMock = vi.fn<(url: string) => Promise<Response>>(async (url) => {
                if (url === LOCAL_KEY_URL) {
                    probes++
                    if (probes === 1) {
                        throw networkError()
                    }
                    return jsonResponse({ dir: '/fake/appdata/key.txt' })
                }
                if (url === TOKENIZE_URL) {
                    return jsonResponse([5])
                }
                throw new Error(`unexpected fetch url: ${url}`)
            })
            vi.stubGlobal('fetch', fetchMock)
            return fetchMock
        }

        function stubAlwaysFailingProbe() {
            const fetchMock = vi.fn<(url: string) => Promise<Response>>(async () => {
                throw networkError()
            })
            vi.stubGlobal('fetch', fetchMock)
            return fetchMock
        }

        function installSucceeds(onDependencies?: () => void) {
            invokeMock.mockImplementation(async (cmd: string) => {
                if (cmd === 'local_inference_unsupported_reason') {
                    return null
                }
                if (cmd === 'install_python' || cmd === 'install_pip' || cmd === 'post_py_install') {
                    return true
                }
                if (cmd === 'install_py_dependencies') {
                    onDependencies?.()
                }
                return undefined
            })
        }

        test('P1: declining the consent installs nothing, names everything in the prompt, shows the sidecar error and asks again next time', async () => {
            installSucceeds()
            alertConfirmMock.mockResolvedValue(false)
            stubAlwaysFailingProbe()

            const { tokenizeGGUFModel } = await import('../local')
            await expect(tokenizeGGUFModel('hello')).rejects.toMatch(
                /local inference sidecar could not be started/,
            )

            expect(alertConfirmMock).toHaveBeenCalledTimes(1)
            const prompt = alertConfirmMock.mock.calls[0][0]
            for (const needle of [
                'Python 3.11.7',
                'python.org',
                'get-pip.py',
                'bootstrap.pypa.io',
                'PyPI',
                'pydantic',
                'scikit-build',
                'scikit-build-core',
                'pyproject_metadata',
                'pathspec',
                'llama-cpp-python',
                'uvicorn[standard]',
                'fastapi',
                'app data folder',
            ]) {
                expect(prompt).toContain(needle)
            }
            expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual(['local_inference_unsupported_reason'])
            expect(alertErrorMock).not.toHaveBeenCalled()
            expect(alertClearMock).toHaveBeenCalled()

            await expect(tokenizeGGUFModel('again')).rejects.toMatch(
                /local inference sidecar could not be started/,
            )
            expect(alertConfirmMock).toHaveBeenCalledTimes(2)
            expect(invokeMock).not.toHaveBeenCalledWith('install_python')
        })

        test('P2/P2b: an existing install is not asked about, skips the installers and the dependencies, and starts the server', async () => {
            existsMock.mockResolvedValue(true)
            installSucceeds()
            stubProbeFailingThenWorking()

            const { tokenizeGGUFModel } = await import('../local')
            expect(await tokenizeGGUFModel('hello')).toEqual([5])

            expect(alertConfirmMock).not.toHaveBeenCalled()
            expect(invokeMock.mock.calls.map(([cmd]) => cmd)).toEqual([
                'local_inference_unsupported_reason',
                'run_py_server',
            ])
            expect(listenMock).not.toHaveBeenCalled()
        })

        test('P3: no python command carries a path, pyPath or dependency argument', async () => {
            installSucceeds()
            stubProbeFailingThenWorking()

            const { tokenizeGGUFModel } = await import('../local')
            await tokenizeGGUFModel('hello')

            const pythonCalls = invokeMock.mock.calls.filter(([cmd]) => cmd !== 'local_inference_unsupported_reason')
            expect(pythonCalls.map(([cmd]) => cmd)).toEqual([
                'install_python',
                'install_pip',
                'post_py_install',
                'install_py_dependencies',
                'run_py_server',
            ])
            for (const call of pythonCalls) {
                expect(call).toHaveLength(1)
            }
        })

        test('P4: each announced dependency is shown and the listener is released once', async () => {
            installSucceeds(() => announceDependencies(['pydantic', 'scikit-build']))
            stubProbeFailingThenWorking()

            const { tokenizeGGUFModel } = await import('../local')
            await tokenizeGGUFModel('hello')

            expect(listenMock).toHaveBeenCalledWith('py_dependency_installing', expect.any(Function))
            expect(alertWaitMock).toHaveBeenCalledWith('Installing Python Dependencies (pydantic)')
            expect(alertWaitMock).toHaveBeenCalledWith('Installing Python Dependencies (scikit-build)')
            expect(unlistenMock).toHaveBeenCalledTimes(1)
        })

        test('P6: a failed dependency install leaves no completed.txt, so the next fallback asks for consent again', async () => {
            let failDependencies = true
            installSucceeds(() => {
                if (failDependencies) {
                    throw new Error('native build failed')
                }
            })
            stubAlwaysFailingProbe()

            const { tokenizeGGUFModel } = await import('../local')
            await expect(tokenizeGGUFModel('hello')).rejects.toMatch(/sidecar could not be started/)
            expect(alertConfirmMock).toHaveBeenCalledTimes(1)

            failDependencies = false
            stubProbeFailingThenWorking()
            expect(await tokenizeGGUFModel('again')).toEqual([5])
            expect(alertConfirmMock).toHaveBeenCalledTimes(2)
        })
    })
})