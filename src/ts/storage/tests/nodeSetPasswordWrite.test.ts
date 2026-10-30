// @vitest-environment node
/**
 * `POST /api/set_password` of the real `server/node/server.cjs`, run as a child
 * process: the password is accepted only once it is on disk, so a failed write
 * leaves the server without a password and the call can be repeated, and an
 * accepted password survives a restart.
 */
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { startNodeServer, type NodeServerFixture } from './nodeServerFixture'

const DIGEST = 'a'.repeat(64)
let fixture: NodeServerFixture | null = null

afterEach(async () => {
    await fixture?.stop()
    fixture = null
})

function setPassword(baseUrl: string, password: string): Promise<Response> {
    return fetch(`${baseUrl}/api/set_password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password }),
    })
}

describe('set_password persistence', () => {
    test('a failed write leaves the password unset, can be retried, and the retried one survives a restart', async () => {
        fixture = await startNodeServer({ provisioned: false })
        const passwordFile = join(fixture.saveDir, '__password')
        // A directory in the file's place makes the final rename fail.
        await mkdir(passwordFile, { recursive: true })

        const failed = await setPassword(fixture.baseUrl, DIGEST)
        expect(failed.status).toBe(500)
        expect(await failed.json()).toEqual({ error: expect.any(String) })
        expect((await readdir(fixture.saveDir)).filter((name) => name.startsWith('__password'))).toEqual(['__password'])

        await rm(passwordFile, { recursive: true, force: true })
        const retried = await setPassword(fixture.baseUrl, DIGEST)
        expect(retried.status).toBe(200)
        expect(await readFile(passwordFile, 'utf-8')).toBe(DIGEST)

        await fixture.restart()
        const afterRestart = await setPassword(fixture.baseUrl, 'b'.repeat(64))
        expect(afterRestart.status).toBe(400)
        expect(await readFile(passwordFile, 'utf-8')).toBe(DIGEST)
    }, 60_000)

    test('guard: a password is stored once, leaves no temporary file, and a second set is refused', async () => {
        fixture = await startNodeServer({ provisioned: false })

        const first = await setPassword(fixture.baseUrl, DIGEST)
        expect(first.status).toBe(200)
        expect(await first.json()).toEqual({ status: 'success' })
        expect(await readFile(join(fixture.saveDir, '__password'), 'utf-8')).toBe(DIGEST)
        expect((await readdir(fixture.saveDir)).filter((name) => name.startsWith('__password'))).toEqual(['__password'])

        const second = await setPassword(fixture.baseUrl, 'b'.repeat(64))
        expect(second.status).toBe(400)
        expect(await second.text()).toBe('already set')
        expect(await readFile(join(fixture.saveDir, '__password'), 'utf-8')).toBe(DIGEST)
    }, 60_000)
})
