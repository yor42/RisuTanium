/**
 * The Node server's asset limit and the client's copy of it are one number, and the other bodies keep the body
 * limit. The client has no endpoint that reports either, so the two modules are pinned to each other here.
 */
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { NODE_ASSET_LIMIT_BYTES, NODE_BODY_LIMIT_BYTES, WEB_ASSET_LIMIT_BYTES } from 'src/ts/storage/nodeBodyLimit'

const requireFromHere = createRequire(import.meta.url)
const server = requireFromHere('../../../../server/node/bodyLimit.cjs') as {
    NODE_BODY_LIMIT_BYTES: number
    NODE_ASSET_LIMIT_BYTES: number
}

describe('the Node limits the client and the server both hold', () => {
    test('the asset limit is 1 GiB on the server and on the client', () => {
        expect(server.NODE_ASSET_LIMIT_BYTES).toBe(1024 * 1024 * 1024)
        expect(NODE_ASSET_LIMIT_BYTES).toBe(server.NODE_ASSET_LIMIT_BYTES)
    })

    test('the other bodies stay at 100 MiB on the server and on the client (guard)', () => {
        expect(server.NODE_BODY_LIMIT_BYTES).toBe(100 * 1024 * 1024)
        expect(NODE_BODY_LIMIT_BYTES).toBe(server.NODE_BODY_LIMIT_BYTES)
    })

    test('the browser store keeps 200 MiB until it holds large values in pieces (guard)', () => {
        expect(WEB_ASSET_LIMIT_BYTES).toBe(200 * 1024 * 1024)
    })
})
