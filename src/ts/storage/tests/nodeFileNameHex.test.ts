// @vitest-environment node
/**
 * The file-name check of `/api/remove` on the real `server/node/server.cjs`:
 * every `$$`-separated segment of `file-path` must be plain hex, so a segment
 * padded with whitespace is refused instead of being trimmed into a valid name.
 */
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fixture: NodeServerFixture

beforeAll(async () => {
    fixture = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fixture?.stop()
}, 30_000)

async function remove(filePath: string): Promise<Response> {
    return await fetch(`${fixture.baseUrl}/api/remove`, {
        headers: { 'risu-auth': await fixture.authHeader(), 'file-path': filePath },
    })
}

describe('/api/remove file-path segments', () => {
    test('a segment padded with whitespace answers 400 Invaild Path', async () => {
        for (const filePath of ['41$$ 42', '41$$\t42']) {
            const response = await remove(filePath)
            expect(response.status, filePath).toBe(400)
            expect(await response.json(), filePath).toMatchObject({ error: 'Invaild Path' })
        }
    })

    test('unpadded hex segments are still accepted', async () => {
        const response = await remove(`${hexOfKey('hex/a')}$$${hexOfKey('hex/b')}`)
        expect(response.status).toBe(200)
    })
})
