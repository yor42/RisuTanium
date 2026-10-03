/**
 * A stand-in for the two Tauri modules that turn a key into a web view URL:
 * `@tauri-apps/api/path` (`appDataDir`, `join`) and `@tauri-apps/api/core`
 * (`convertFileSrc`), shaped like the native ones where the URL depends on it:
 *
 * - `join` goes through the host's path rules: on Windows both `/` and `\`
 *   separate segments and the result is joined with `\`, on POSIX only `/`
 *   separates and the result is joined with `/`.
 * - `convertFileSrc` percent-encodes the whole path, and the origin is
 *   `http://asset.localhost/` on Windows and `asset://localhost/` elsewhere.
 *
 * A pass says nothing about the native modules; it pins how a caller composes
 * them. Use it from a mock factory loaded with a dynamic import inside
 * `vi.hoisted`.
 */

export type FakePathPlatform = 'windows' | 'posix'

const APP_DATA_DIRECTORY: Record<FakePathPlatform, string> = {
    windows: 'C:\\Users\\tester\\AppData\\Roaming\\com.risuai.app',
    posix: '/home/tester/.local/share/com.risuai.app',
}

export function createFakeTauriPaths(initial: FakePathPlatform = 'posix') {
    let platform: FakePathPlatform = initial
    const calls = { appDataDir: 0, join: 0, convertFileSrc: 0 }

    async function appDataDir(): Promise<string> {
        calls.appDataDir++
        return APP_DATA_DIRECTORY[platform]
    }

    async function join(...paths: string[]): Promise<string> {
        calls.join++
        const separator = platform === 'windows' ? '\\' : '/'
        const segments = paths
            .flatMap((path) => path.split(platform === 'windows' ? /[\\/]/ : '/'))
            .filter((segment, index) => segment !== '' || index === 0)
        return segments.join(separator)
    }

    function convertFileSrc(filePath: string, protocol = 'asset'): string {
        calls.convertFileSrc++
        const encoded = encodeURIComponent(filePath)
        return platform === 'windows' ? `http://${protocol}.localhost/${encoded}` : `${protocol}://localhost/${encoded}`
    }

    return {
        calls,
        setPlatform(next: FakePathPlatform): void {
            platform = next
        },
        reset(): void {
            platform = initial
            calls.appDataDir = 0
            calls.join = 0
            calls.convertFileSrc = 0
        },
        /** The directory `appDataDir` answers on `forPlatform`. */
        appDataDirectory(forPlatform: FakePathPlatform): string {
            return APP_DATA_DIRECTORY[forPlatform]
        },
        /** The module shape a `vi.mock('@tauri-apps/api/path', ...)` factory returns. */
        pathModule: { appDataDir, join },
        /** The module shape a `vi.mock('@tauri-apps/api/core', ...)` factory returns. */
        coreModule: { convertFileSrc, invoke: async (): Promise<undefined> => undefined },
    }
}

export type FakeTauriPaths = ReturnType<typeof createFakeTauriPaths>
