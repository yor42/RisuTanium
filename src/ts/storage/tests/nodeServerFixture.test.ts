// @vitest-environment node
/**
 * The launch handling of the Node server fixture itself, on the real
 * `server/node/server.cjs`: a first launch takes a new port when the offered one
 * is held, a socket that answers on the port without being the server is
 * detected, and a restart waits out a port another process holds.
 *
 * Squatters bind OS-chosen ports; the fixture is offered ports through its
 * `portSource` seam. Cases 1 to 3 are compatibility guards of the retry rules
 * (they pass with only the seam added and fail under the rule mutants: retry on
 * any early exit, a single attempt, retry although the caller chose the port).
 * Cases 4 and 5 are regression reproducers: without the identity check or the
 * restart retry they fail. Case 5 releases the port on an observed relaunch
 * count, not on a clock.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture | undefined
let scratchDirs: string[] = []
let closers: Array<() => Promise<void>> = []

afterEach(async () => {
    await fixture?.stop()
    fixture = undefined
    for (const close of closers) {
        await close()
    }
    closers = []
    for (const dir of scratchDirs) {
        await rm(dir, { recursive: true, force: true })
    }
    scratchDirs = []
}, 30_000)

function listen(server: Server, host: string | undefined): Promise<number> {
    return new Promise((resolve, reject) => {
        server.once('error', reject)
        const onListening = () => {
            const address = server.address()
            resolve(typeof address === 'object' && address !== null ? address.port : 0)
        }
        if (host === undefined) {
            server.listen(0, onListening)
        } else {
            server.listen(0, host, onListening)
        }
    })
}

/** Holds an OS-chosen port on all interfaces, as the server binds it. */
async function holdPort(): Promise<number> {
    const holder = createServer()
    const port = await listen(holder, undefined)
    closers.push(() => new Promise((resolve) => holder.close(() => resolve())))
    return port
}

/** Holds a port on `127.0.0.1` alone and answers every request with a 200 that is not the server's JSON. */
async function squatLoopback(): Promise<number> {
    const squatter = createHttpServer((request, response) => {
        request.resume()
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.end('not the node server')
    })
    const port = await listen(squatter, '127.0.0.1')
    closers.push(() => new Promise((resolve) => {
        squatter.closeAllConnections()
        squatter.close(() => resolve())
    }))
    return port
}

async function unusedPort(): Promise<number> {
    const probe = createServer()
    const port = await listen(probe, undefined)
    await new Promise<void>((resolve) => probe.close(() => resolve()))
    return port
}

/** A port source that offers `ports` in order and records how often it was asked. */
function portsInOrder(ports: number[]): { source: () => Promise<number>, calls: () => number } {
    let asked = 0
    return {
        source: async () => {
            const port = ports[asked]
            asked++
            if (port === undefined) {
                throw new Error(`The fixture asked for port number ${asked}; only ${ports.length} were offered.`)
            }
            return port
        },
        calls: () => asked,
    }
}

async function scratchDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'risu-fixture-test-'))
    scratchDirs.push(dir)
    return dir
}

/** A `--require` script that appends one line to `LAUNCH_LOG` per server launch, then exits with `exitCode` when it is given. */
async function launchScript(dir: string, name: string, exitCode?: number): Promise<string> {
    const path = join(dir, name)
    const exitLine = exitCode === undefined ? '' : `process.exit(${exitCode})\n`
    await writeFile(path, `require('node:fs').appendFileSync(process.env.LAUNCH_LOG, 'launch\\n')\n${exitLine}`)
    return path
}

async function launchCount(log: string): Promise<number> {
    try {
        return (await readFile(log, 'utf-8')).split('\n').filter((line) => line !== '').length
    } catch {
        return 0
    }
}

async function waitFor(condition: () => boolean | Promise<boolean>, what: string): Promise<void> {
    const deadline = Date.now() + 15_000
    while (!(await condition())) {
        if (Date.now() > deadline) {
            throw new Error(`Timed out waiting for ${what}.`)
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
    }
}

async function testAuth(baseUrl: string): Promise<unknown> {
    const response = await fetch(`${baseUrl}/api/test_auth`)
    expect(response.status).toBe(200)
    return response.json()
}

function portOf(baseUrl: string): number {
    return Number(new URL(baseUrl).port)
}

// Each test launches a server, whose start alone may take up to the fixture's ready timeout.
describe('compatibility guards: first launch on a held port', { timeout: 60_000 }, () => {
    test('1. a port held on all interfaces: the fixture takes the next port from the source', async () => {
        const held = await holdPort()
        const free = await unusedPort()
        const ports = portsInOrder([held, free])
        fixture = await startNodeServer({ portSource: ports.source })
        expect(ports.calls()).toBe(2)
        expect(portOf(fixture.baseUrl)).toBe(free)
        expect(await testAuth(fixture.baseUrl)).toMatchObject({ status: expect.any(String) })
    })

    test('2. another early exit is not retried', async () => {
        const dir = await scratchDir()
        const script = await launchScript(dir, 'exit3.cjs', 3)
        const ports = portsInOrder([await unusedPort(), await unusedPort()])
        await expect(startNodeServer({
            portSource: ports.source,
            env: { LAUNCH_LOG: join(dir, 'launches.log') },
            nodeArgs: ['--require', script],
        })).rejects.toThrow(/exited with code 3/)
        expect(ports.calls()).toBe(1)
        expect(await launchCount(join(dir, 'launches.log'))).toBe(1)
    })

    test('3. a port chosen by the caller is not replaced', async () => {
        const held = await holdPort()
        const ports = portsInOrder([await unusedPort(), await unusedPort()])
        await expect(startNodeServer({ portSource: ports.source, env: { PORT: String(held) } })).rejects.toThrow(/EADDRINUSE/)
        expect(ports.calls()).toBe(1)
    })
})

describe('regression reproducers: identity and restart', { timeout: 60_000 }, () => {
    test('4. a 127.0.0.1-only squatter on the offered port is not taken for the server', async () => {
        const squatted = await squatLoopback()
        const free = await unusedPort()
        const ports = portsInOrder([squatted, free])
        fixture = await startNodeServer({ portSource: ports.source })
        expect(portOf(fixture.baseUrl)).not.toBe(squatted)
        expect(portOf(fixture.baseUrl)).toBe(free)
        expect(ports.calls()).toBe(2)
        expect(await testAuth(fixture.baseUrl)).toMatchObject({ status: expect.any(String) })
    })

    test('5. a restart waits out a port another socket holds, on the same base URL', async () => {
        const dir = await scratchDir()
        const log = join(dir, 'launches.log')
        const script = await launchScript(dir, 'count.cjs')
        fixture = await startNodeServer({ env: { LAUNCH_LOG: log }, nodeArgs: ['--require', script] })
        const baseUrl = fixture.baseUrl
        const port = portOf(baseUrl)
        await fixture.halt()

        const holder = createServer()
        await new Promise<void>((resolve, reject) => {
            holder.once('error', reject)
            holder.listen(port, resolve)
        })
        let released = false
        const release = () => new Promise<void>((resolve) => {
            if (released) {
                resolve()
                return
            }
            released = true
            holder.close(() => resolve())
        })
        closers.push(release)

        let settled = false
        const restarting = fixture.restart().then(() => undefined, (error: unknown) => error)
        void restarting.then(() => { settled = true })
        // The first launch counted once; a line is written when a relaunch starts, so a third line means one relaunch was refused and a second attempt started.
        await waitFor(async () => settled || (await launchCount(log)) >= 3, 'a refused relaunch and a second attempt started')
        await release()

        expect(await restarting).toBeUndefined()
        expect(fixture.baseUrl).toBe(baseUrl)
        expect(await testAuth(baseUrl)).toMatchObject({ status: expect.any(String) })
    })

    test('5b. a restart whose relaunch exits for another reason rejects at once', async () => {
        const dir = await scratchDir()
        const log = join(dir, 'launches.log')
        const count = await launchScript(dir, 'count.cjs')
        const exit3 = await launchScript(dir, 'exit3.cjs', 3)
        fixture = await startNodeServer({ env: { LAUNCH_LOG: log }, nodeArgs: ['--require', count] })
        expect(await launchCount(log)).toBe(1)
        await expect(fixture.restart({ nodeArgs: ['--require', exit3] })).rejects.toThrow(/exited with code 3/)
        expect(await launchCount(log)).toBe(2)
    })
})

// SIGTERM is forceful on Windows, so a child that ignores it exists only on POSIX.
describe.skipIf(process.platform === 'win32')('diagnostic: stop() ends a child that ignores the graceful signal', { timeout: 60_000 }, () => {
    test('F-D1. the child is killed and the working directory is removed', async () => {
        const dir = await scratchDir()
        const pidFile = join(dir, 'child.pid')
        const script = join(dir, 'ignoreTerm.cjs')
        await writeFile(script, `process.on('SIGTERM', () => {})\nrequire('node:fs').writeFileSync(process.env.PID_FILE, String(process.pid))\n`)
        fixture = await startNodeServer({ env: { PID_FILE: pidFile }, nodeArgs: ['--require', script] })
        const pid = Number(await readFile(pidFile, 'utf-8'))
        const workDir = join(fixture.saveDir, '..')
        await fixture.stop()
        fixture = undefined
        const alive = (() => {
            try {
                process.kill(pid, 0)
                return true
            } catch {
                return false
            }
        })()
        expect(alive).toBe(false)
        expect(existsSync(workDir)).toBe(false)
    })
})
