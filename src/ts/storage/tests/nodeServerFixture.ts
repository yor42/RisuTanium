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

const SERVER_SCRIPT = fileURLToPath(new URL('../../../../server/node/server.cjs', import.meta.url))
const READY_TIMEOUT_MS = 20_000
const EXIT_TIMEOUT_MS = 5_000
const READY_LINE = 'HTTP server is running'

export interface NodeServerFixture {
    baseUrl: string
    /** The server's `save/` directory; every key is one hex-named file in it. */
    saveDir: string
    /** A fresh `risu-auth` header value for the logged-in key pair. */
    authHeader(): Promise<string>
    /** Removes every stored key. The server's own files (names starting with `__`) stay. */
    clearKeys(): Promise<void>
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

export interface NodeServerOptions {
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

    const killChild = () => {
        if (child !== undefined && child.exitCode === null && child.signalCode === null) {
            child.kill()
        }
    }
    process.once('exit', killChild)

    const stop = async () => {
        if (stopped) {
            return
        }
        stopped = true
        process.removeListener('exit', killChild)
        killChild()
        if (exited !== undefined) {
            await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, EXIT_TIMEOUT_MS))])
        }
        await rm(workDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }

    try {
        child = spawn(process.execPath, [SERVER_SCRIPT], {
            cwd: workDir,
            env: { ...process.env, PORT: String(port) },
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

        const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
        const publicJwk = await crypto.subtle.exportKey('jwk', publicKey)

        const authHeader = async (): Promise<string> => {
            const issuedAt = Math.floor(Date.now() / 1000)
            const head = base64url({ alg: 'ES256', typ: 'JWT' })
            const payload = base64url({ iat: issuedAt, exp: issuedAt + 300, pub: publicJwk })
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
            async clearKeys() {
                for (const name of await readdir(saveDir)) {
                    if (!name.startsWith('__')) {
                        await rm(join(saveDir, name), { force: true })
                    }
                }
            },
            stop,
        }
    } catch (error) {
        await stop()
        throw error
    }
}
