/**
 * Runs the real `server/node/server.cjs` as a child process for tests of the
 * Node adapter: its own temp working directory (the server keeps its `save/`
 * directory under the working directory), its own free port, one login per
 * fixture. Import it only from a test that runs in the Vitest `node`
 * environment; it needs a real network stack and Web Crypto.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// RISU_NODE_SERVER_SCRIPT points the fixture at another build of the server,
// for running a test against an earlier version of server.cjs.
const SERVER_SCRIPT = process.env.RISU_NODE_SERVER_SCRIPT ?? fileURLToPath(new URL('../../../../server/node/server.cjs', import.meta.url))
if (process.env.RISU_NODE_SERVER_SCRIPT !== undefined) {
    console.warn(`nodeServerFixture: running the Node server from RISU_NODE_SERVER_SCRIPT=${SERVER_SCRIPT}`)
}
const READY_TIMEOUT_MS = 20_000
const EXIT_TIMEOUT_MS = 5_000
const READY_LINE = 'HTTP server is running'

export interface NodeServerFixture {
    baseUrl: string
    /** The server's `save/` directory; every key is one hex-named file in it. */
    saveDir: string
    /** A fresh `risu-auth` header value for the logged-in key pair. */
    authHeader(): Promise<string>
    /**
     * A token signed by the logged-in key pair over exactly `claims` (its public
     * key is added as `pub` unless `claims` carries one): the way to make a token
     * with an audience, with no expiry or with a past one.
     */
    signToken(claims: Record<string, unknown>): Promise<string>
    /** Removes every stored key. The server's own files (names starting with `__`) stay. */
    clearKeys(): Promise<void>
    /**
     * Ends the server process and keeps the working directory. `hard` sends
     * SIGKILL (no shutdown handlers run); otherwise the default termination
     * signal. Safe to call when the process is already gone.
     */
    halt(mode?: 'graceful' | 'hard'): Promise<void>
    /**
     * Starts the server again on the same working directory and port (ending
     * a running process first). Each of `env` and `nodeArgs` replaces the one
     * the previous run used; an omitted field keeps the previous value. The login
     * survives: the server keeps the fixture's key hash on disk.
     */
    restart(options?: NodeServerLaunchOptions): Promise<void>
    /** Stops the server and removes its working directory. Safe to call twice. */
    stop(): Promise<void>
}

export function hexOfKey(key: string): string {
    return Buffer.from(key, 'utf-8').toString('hex')
}

function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const probe = createServer()
        probe.once('error', reject)
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address()
            const port = typeof address === 'object' && address !== null ? address.port : 0
            probe.close(() => resolve(port))
        })
    })
}

function base64url(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
}

export interface NodeServerLaunchOptions {
    /** Extra environment variables for the server process. */
    env?: Record<string, string>
    /** Extra Node arguments placed before the server script, such as `--require <file>`. */
    nodeArgs?: string[]
}

export interface NodeServerOptions extends NodeServerLaunchOptions {
    /**
     * Set a password and register the fixture's key pair (the default). `false`
     * leaves a fresh server with no password, as a first run finds it; the
     * fixture's own `authHeader` then belongs to a key pair the server does not
     * know.
     */
    provisioned?: boolean
}

export async function startNodeServer(options: NodeServerOptions = {}): Promise<NodeServerFixture> {
    const workDir = await mkdtemp(join(tmpdir(), 'risu-node-store-'))
    const port = await freePort()
    const baseUrl = `http://127.0.0.1:${port}`
    let child: ChildProcess | undefined
    let exited: Promise<void> | undefined
    let stopped = false
    let output = ''

    let launchOptions: NodeServerLaunchOptions = { env: options.env, nodeArgs: options.nodeArgs }

    const killChild = (signal?: NodeJS.Signals) => {
        if (child !== undefined && child.exitCode === null && child.signalCode === null) {
            child.kill(signal)
        }
    }
    const exitHook = () => killChild()
    process.once('exit', exitHook)

    const halt = async (mode: 'graceful' | 'hard' = 'graceful') => {
        killChild(mode === 'hard' ? 'SIGKILL' : undefined)
        if (exited !== undefined) {
            await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, EXIT_TIMEOUT_MS))])
        }
    }

    const stop = async () => {
        if (stopped) {
            return
        }
        stopped = true
        process.removeListener('exit', exitHook)
        await halt()
        await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }

    const launch = async () => {
        output = ''
        child = spawn(process.execPath, [...(launchOptions.nodeArgs ?? []), SERVER_SCRIPT], {
            cwd: workDir,
            env: { ...process.env, PORT: String(port), ...launchOptions.env },
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        const running = child
        exited = new Promise<void>((resolve) => running.once('exit', () => resolve()))
        await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`The Node server did not start within ${READY_TIMEOUT_MS} ms.\n${output}`)), READY_TIMEOUT_MS)
            const onData = (chunk: Buffer) => {
                output += chunk.toString('utf-8')
                if (output.includes(READY_LINE)) {
                    clearTimeout(timer)
                    resolve()
                }
            }
            running.stdout.on('data', onData)
            running.stderr.on('data', onData)
            running.once('error', (error) => {
                clearTimeout(timer)
                reject(error)
            })
            running.once('exit', (code) => {
                clearTimeout(timer)
                reject(new Error(`The Node server exited with code ${code} before it was ready.\n${output}`))
            })
        })
    }

    try {
        await launch()

        const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
        const publicJwk = await crypto.subtle.exportKey('jwk', publicKey)

        const authHeader = async (): Promise<string> => {
            const issuedAt = Math.floor(Date.now() / 1000)
            const head = base64url({ alg: 'ES256', typ: 'JWT' })
            const payload = base64url({ iat: issuedAt, exp: issuedAt + 300, pub: publicJwk })
            const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(`${head}.${payload}`))
            return `${head}.${payload}.${Buffer.from(signature).toString('base64url')}`
        }

        const signToken = async (claims: Record<string, unknown>): Promise<string> => {
            const head = base64url({ alg: 'ES256', typ: 'JWT' })
            const payload = base64url({ pub: publicJwk, ...claims })
            const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(`${head}.${payload}`))
            return `${head}.${payload}.${Buffer.from(signature).toString('base64url')}`
        }

        // A fresh server has no password: set one, then register this key pair.
        // The login limiter allows only a few logins per window, so this runs
        // once per fixture.
        const jsonPost = (path: string, body: unknown) => fetch(`${baseUrl}${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        })
        if (options.provisioned !== false) {
            const digest = await (await jsonPost('/api/crypto', { data: 'fixture-password' })).text()
            const setResponse = await jsonPost('/api/set_password', { password: digest })
            const loginResponse = await jsonPost('/api/login', { password: digest, publicKey: publicJwk })
            if (!setResponse.ok || !loginResponse.ok) {
                throw new Error(`The Node server refused the fixture login (${setResponse.status}, ${loginResponse.status}).`)
            }
        }

        const saveDir = join(workDir, 'save')
        return {
            baseUrl,
            saveDir,
            authHeader,
            signToken,
            async clearKeys() {
                for (const name of await readdir(saveDir)) {
                    if (!name.startsWith('__')) {
                        await rm(join(saveDir, name), { force: true })
                    }
                }
            },
            halt,
            async restart(restartOptions) {
                await halt()
                launchOptions = {
                    env: restartOptions?.env ?? launchOptions.env,
                    nodeArgs: restartOptions?.nodeArgs ?? launchOptions.nodeArgs,
                }
                await launch()
            },
            stop,
        }
    } catch (error) {
        await stop()
        throw error
    }
}
