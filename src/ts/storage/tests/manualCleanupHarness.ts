/**
 * Test-only builders for the manual clean-up suite: a save-file composer that
 * writes real `RisuSaveEncoder` blocks in a chosen order (so a test can drop,
 * corrupt or point at a block), and an in-memory stand-in for the self-hosted
 * Node server's file API that enforces the same request-header ceiling and the
 * same revision rules as `server/node/server.cjs`.
 *
 * Nothing here imports application modules at runtime; the encoder is passed
 * in by the caller so it comes from the same module graph as the code under
 * test.
 */

/** Numeric values of the save-file block types (`RisuSaveType` in risuSave.ts). */
export const BLOCK = {
    CONFIG: 0,
    ROOT: 1,
    CHARACTER_WITH_CHAT: 2,
    BOTPRESET: 4,
    MODULES: 5,
    REMOTE: 6,
    PLUGINS: 9,
    LOADOUTS: 10,
    PLUGIN_STORAGE: 11,
} as const

/** The part of `RisuSaveEncoder` this composer uses. */
export interface BlockEncoder {
    encodeBlock(arg: { compression: boolean, data: string, type: number, name: string }): Promise<Uint8Array>
}

export interface SavePart {
    name: string
    type: number
    /** The block payload exactly as it is written; deliberately not required to be valid JSON. */
    data: string
}

export interface ComposedBlock {
    name: string
    start: number
    dataStart: number
    dataEnd: number
}

export interface ComposedSave {
    bytes: Uint8Array
    blocks: ComposedBlock[]
}

const SAVE_HEADER = new TextEncoder().encode('RISUSAVE\x01')

/** Concatenates the save header and one encoded block per part, in the given order. */
export async function composeSave(encoder: BlockEncoder, parts: SavePart[]): Promise<ComposedSave> {
    const encoded: Uint8Array[] = []
    for (const part of parts) {
        encoded.push(await encoder.encodeBlock({ compression: false, data: part.data, type: part.type, name: part.name }))
    }
    const total = SAVE_HEADER.length + encoded.reduce((sum, block) => sum + block.length, 0)
    const bytes = new Uint8Array(total)
    bytes.set(SAVE_HEADER, 0)
    const blocks: ComposedBlock[] = []
    let offset = SAVE_HEADER.length
    encoded.forEach((block, i) => {
        const nameLength = new TextEncoder().encode(parts[i].name).length
        // type + compression + name length byte + name + 4-byte length + 4-byte header checksum
        const dataStart = offset + 3 + nameLength + 4 + 4
        blocks.push({ name: parts[i].name, start: offset, dataStart, dataEnd: offset + block.length - 4 })
        bytes.set(block, offset)
        offset += block.length
    })
    return { bytes, blocks }
}

/** Flips one payload byte of the named block, leaving its stored checksum stale. */
export function corruptBlockPayload(save: ComposedSave, name: string): Uint8Array {
    const block = save.blocks.find((b) => b.name === name)
    if (!block) {
        throw new Error(`no block named ${name}`)
    }
    const copy = save.bytes.slice()
    copy[block.dataStart] = copy[block.dataStart] ^ 0xff
    return copy
}

//#region Node server stand-in

const HEADER_CEILING_BYTES = 16384
/** Method, path, protocol and the headers a browser adds on its own. */
const FIXED_REQUEST_OVERHEAD_BYTES = 220

export interface RecordedRequest {
    path: string
    method: string
    headers: Record<string, string>
}

interface ServerFile {
    bytes: Uint8Array
}

function hexToKey(hex: string): string {
    return Buffer.from(hex, 'hex').toString('utf-8')
}

function keyToHex(key: string): string {
    return Buffer.from(key, 'utf-8').toString('hex')
}

function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/**
 * A stand-in for the self-hosted Node server's file API, mounted behind a
 * `fetch` replacement. Mirrors the parts of `server/node/server.cjs` that the
 * clean-up depends on: per-key revisions that keep advancing after a delete,
 * the `if-match-revision` precondition on `/api/write` and `/api/remove`, and
 * the HTTP request-header ceiling (431 beyond it).
 */
export class FakeNodeServer {
    files = new Map<string, ServerFile>()
    revisions = new Map<string, number>()
    requests: RecordedRequest[] = []
    /** Called with the path before a request is answered. */
    beforeRequest?: (path: string, headers: Record<string, string>) => void
    /** Called with the path after a request has been answered. */
    afterRequest?: (path: string) => void
    /** When it returns a response for `/api/remove`, that response is sent instead and nothing is deleted. */
    removeOverride?: (keys: string[]) => Response | undefined
    /** Keys whose `/api/read` is answered with a 500 instead of the file. */
    readFailures = new Set<string>()
    /**
     * The largest request body `/api/write` accepts, in bytes; a larger body is
     * refused with a 413 and nothing is stored, as the real server's raw body
     * parser does (a body of exactly this length is accepted). Unset: no limit.
     */
    bodyLimit?: number

    /** Places a file on the server, bumping its revision as a write would. */
    seed(key: string, bytes: Uint8Array): number {
        return this.commit(key, bytes)
    }

    /** Another device saving `key`: identical to a write with no precondition. */
    peerWrite(key: string, bytes: Uint8Array): number {
        return this.commit(key, bytes)
    }

    revisionOf(key: string): number {
        return this.revisions.get(key) ?? 0
    }

    keysWithPrefix(prefix: string): string[] {
        return Array.from(this.files.keys()).filter((k) => k.startsWith(prefix))
    }

    requestsTo(path: string): RecordedRequest[] {
        return this.requests.filter((r) => r.path === path)
    }

    private commit(key: string, bytes: Uint8Array): number {
        const next = this.revisionOf(key) + 1
        this.revisions.set(key, next)
        this.files.set(key, { bytes: bytes.slice() })
        return next
    }

    private headerBytes(path: string, headers: Record<string, string>): number {
        let total = FIXED_REQUEST_OVERHEAD_BYTES + path.length
        for (const [name, value] of Object.entries(headers)) {
            total += name.length + value.length + 4
        }
        return total
    }

    /** The `fetch` replacement to install with `vi.stubGlobal('fetch', server.fetch)`. */
    fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const path = String(input)
        const headers: Record<string, string> = {}
        const given = (init?.headers ?? {}) as Record<string, string>
        for (const [name, value] of Object.entries(given)) {
            headers[name.toLowerCase()] = String(value)
        }
        this.requests.push({ path, method: init?.method ?? 'GET', headers })
        this.beforeRequest?.(path, headers)
        try {
            if (this.headerBytes(path, headers) > HEADER_CEILING_BYTES) {
                return new Response('Request Header Fields Too Large', { status: 431 })
            }
            return await this.route(path, headers, init)
        } finally {
            this.afterRequest?.(path)
        }
    }

    private async route(path: string, headers: Record<string, string>, init?: RequestInit): Promise<Response> {
        if (path === '/api/test_auth') {
            return json(200, { status: 'good' })
        }
        if (path === '/api/list') {
            return json(200, { success: true, content: Array.from(this.files.keys()) })
        }
        if (path === '/api/read') {
            const key = hexToKey(headers['file-path'] ?? '')
            if (this.readFailures.has(key)) {
                return new Response('Internal Server Error', { status: 500 })
            }
            const file = this.files.get(key)
            const responseHeaders = { 'x-risu-revision': String(this.revisionOf(key)) }
            if (!file) {
                return new Response(new Uint8Array(0), { status: 200, headers: responseHeaders })
            }
            return new Response(file.bytes.slice(), { status: 200, headers: responseHeaders })
        }
        if (path === '/api/write') {
            const key = hexToKey(headers['file-path'] ?? '')
            if (this.bodyLimit !== undefined && ((init?.body as Uint8Array | undefined)?.length ?? 0) > this.bodyLimit) {
                return new Response('Payload Too Large', { status: 413 })
            }
            const expected = headers['if-match-revision']
            if (expected !== undefined && Number.parseInt(expected, 10) !== this.revisionOf(key)) {
                return json(409, { error: 'Revision conflict', currentRevision: this.revisionOf(key) })
            }
            const body = init?.body as Uint8Array
            const revision = this.commit(key, new Uint8Array(body))
            return json(200, { success: true, revision })
        }
        if (path === '/api/remove') {
            const hexKeys = (headers['file-path'] ?? '').split('$$')
            const keys = hexKeys.map(hexToKey)
            const override = this.removeOverride?.(keys)
            if (override) {
                return override
            }
            const expected = headers['if-match-revision'] === undefined ? undefined : headers['if-match-revision'].split('$$')
            if (expected) {
                for (let i = 0; i < keys.length; i++) {
                    if (expected[i] && Number.parseInt(expected[i], 10) !== this.revisionOf(keys[i])) {
                        return json(409, { success: false, error: 'Revision conflict', currentRevision: this.revisionOf(keys[i]) })
                    }
                }
            }
            const revisions: Record<string, number> = {}
            for (const key of keys) {
                const next = this.revisionOf(key) + 1
                this.revisions.set(key, next)
                this.files.delete(key)
                revisions[keyToHex(key)] = next
            }
            return json(200, { success: true, revisions })
        }
        return new Response('not found', { status: 404 })
    }
}

//#endregion
