// @vitest-environment node
/**
 * The guarded routes of the real `server/node/server.cjs` (`/api/write-checked`,
 * `/api/remove-checked`, `/api/caps`), driven with raw requests. A guarded
 * request names keys that are only compared (check-only keys): their revision
 * must match before anything is written or removed, and they are never changed.
 *
 * New-behaviour tests are red on a server without these routes (they answer 404).
 * Cases marked as guards use only the original routes and pass on both.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { hexOfKey, startNodeServer, type NodeServerFixture } from './nodeServerFixture'

let fx: NodeServerFixture

beforeAll(async () => {
    fx = await startNodeServer()
}, 60_000)

afterAll(async () => {
    await fx?.stop()
}, 30_000)

type CheckOnly = Array<[key: string, revision: number]>

interface Reply {
    status: number
    headers: Headers
    json: Record<string, unknown> | null
    text: string
}

async function send(route: string, method: 'GET' | 'POST', headers: Record<string, string>, body?: Uint8Array, authed = true): Promise<Reply> {
    const all: Record<string, string> = { ...headers }
    if (authed) {
        all['risu-auth'] = await fx.authHeader()
    }
    if (method === 'POST') {
        all['content-type'] = 'application/octet-stream'
    }
    const response = await fetch(`${fx.baseUrl}${route}`, { method, headers: all, body: method === 'POST' ? (body as Uint8Array<ArrayBuffer>) : undefined })
    const text = await response.text()
    let json: Record<string, unknown> | null = null
    try {
        json = JSON.parse(text)
    } catch {
        json = null
    }
    return { status: response.status, headers: response.headers, json, text }
}

function checkHeaders(checkOnly: CheckOnly, raw: Record<string, string | null> = {}): Record<string, string> {
    const headers: Record<string, string> = {}
    if (checkOnly.length > 0) {
        headers['check-only-path'] = checkOnly.map(([key]) => hexOfKey(key)).join('$$')
        headers['check-only-revision'] = checkOnly.map(([, revision]) => String(revision)).join('$$')
    }
    headers['check-only-count'] = String(checkOnly.length)
    for (const [name, value] of Object.entries(raw)) {
        if (value === null) {
            delete headers[name]
        } else {
            headers[name] = value
        }
    }
    return headers
}

function applyRaw(headers: Record<string, string>, raw: Record<string, string | null> = {}): void {
    for (const [name, value] of Object.entries(raw)) {
        if (value === null) {
            delete headers[name]
        } else {
            headers[name] = value
        }
    }
}

function writeChecked(key: string, text: string, options: { ifMatch?: number, checkOnly?: CheckOnly, raw?: Record<string, string | null> } = {}): Promise<Reply> {
    const headers: Record<string, string> = {
        'file-path': hexOfKey(key),
        'own-condition-count': options.ifMatch === undefined ? '0' : '1',
        ...checkHeaders(options.checkOnly ?? [], options.raw),
    }
    if (options.ifMatch !== undefined) {
        headers['if-match-revision'] = String(options.ifMatch)
    }
    applyRaw(headers, options.raw)
    return send('/api/write-checked', 'POST', headers, new TextEncoder().encode(text))
}

interface RemoveOptions {
    revisions?: Array<number | null>
    checkOnly?: CheckOnly
    retire?: boolean
    raw?: Record<string, string | null>
}

function removeChecked(keys: string[], options: RemoveOptions = {}): Promise<Reply> {
    const headers: Record<string, string> = {
        'file-path': keys.map(hexOfKey).join('$$'),
        ...checkHeaders(options.checkOnly ?? [], options.raw),
        'retire-count': options.retire === true ? String(keys.length) : '0',
        'own-condition-count': String((options.revisions ?? []).filter((revision) => revision !== null).length),
    }
    if (options.retire === true) {
        headers.retire = '1'
    }
    if (options.revisions !== undefined) {
        headers['if-match-revision'] = options.revisions.map((revision) => revision === null ? '' : String(revision)).join('$$')
    }
    for (const [name, value] of Object.entries(options.raw ?? {})) {
        if (value === null) {
            delete headers[name]
        } else {
            headers[name] = value
        }
    }
    return send('/api/remove-checked', 'GET', headers)
}

function plainWrite(key: string, text: string, ifMatch?: number): Promise<Reply> {
    const headers: Record<string, string> = { 'file-path': hexOfKey(key) }
    if (ifMatch !== undefined) {
        headers['if-match-revision'] = String(ifMatch)
    }
    return send('/api/write', 'POST', headers, new TextEncoder().encode(text))
}

async function readKey(key: string): Promise<{ text: string, revision: number, exists: boolean }> {
    const response = await fetch(`${fx.baseUrl}/api/read`, { headers: { 'file-path': hexOfKey(key), 'risu-auth': await fx.authHeader() } })
    const text = await response.text()
    return { text, revision: Number(response.headers.get('x-risu-revision')), exists: response.headers.get('x-risu-exists') === '1' }
}

function revisionOf(reply: Reply): number {
    return reply.json?.revision as number
}

let counter = 0
function fresh(label: string): string {
    counter++
    return `${label}/${counter}`
}

describe('capabilities', () => {
    test('/api/caps answers the three capabilities with the marker, no-store and an authenticated caller', async () => {
        const reply = await send('/api/caps', 'GET', {})
        expect(reply.status).toBe(200)
        expect(reply.json).toEqual({ checkOnly: true, retire: true, pieces: true, listPrefix: true })
        expect(reply.headers.get('risu-storage-guarded')).toBe('1')
        expect(reply.headers.get('cache-control')).toMatch(/no-store/)
    })

    test('/api/caps refuses an unauthenticated caller', async () => {
        const reply = await send('/api/caps', 'GET', {}, undefined, false)
        expect(reply.status).toBe(400)
        expect(reply.headers.get('risu-storage-guarded')).toBe('1')
    })
})

describe('write-checked', () => {
    test('a matching check-only key lets the write through and the answer carries the marker, a numeric revision and the echo', async () => {
        const unit = fresh('u')
        const unitRevision = revisionOf(await plainWrite(unit, 'unit'))
        const commit = fresh('commit')
        const reply = await writeChecked(commit, 'v1', { ifMatch: 0, checkOnly: [[unit, unitRevision]] })
        expect(reply.status).toBe(200)
        expect(reply.json).toEqual({ success: true, revision: 1, checkOnly: 1, ownCondition: 1 })
        expect(reply.headers.get('risu-storage-guarded')).toBe('1')
        expect(reply.headers.get('cache-control')).toMatch(/no-store/)
        expect((await readKey(commit)).text).toBe('v1')
    })

    test('a mismatching check-only key answers 409 naming it and writes nothing', async () => {
        const unit = fresh('u')
        const unitRevision = revisionOf(await plainWrite(unit, 'unit'))
        const commit = fresh('commit')
        await writeChecked(commit, 'v1', { checkOnly: [[unit, unitRevision]] })
        const bad = await writeChecked(commit, 'SHOULD-NOT-LAND', { ifMatch: 1, checkOnly: [[unit, unitRevision + 1]] })
        expect(bad.status).toBe(409)
        expect(bad.json).toEqual({ error: 'Revision conflict', filePath: hexOfKey(unit), currentRevision: unitRevision })
        expect(bad.headers.get('risu-storage-guarded')).toBe('1')
        expect(await readKey(commit)).toEqual({ text: 'v1', revision: 1, exists: true })
    })

    test('a mismatch of the written key itself keeps the original body shape, without filePath', async () => {
        const unit = fresh('u')
        const unitRevision = revisionOf(await plainWrite(unit, 'unit'))
        const commit = fresh('commit')
        await writeChecked(commit, 'v1')
        const bad = await writeChecked(commit, 'x', { ifMatch: 0, checkOnly: [[unit, unitRevision]] })
        expect(bad.status).toBe(409)
        expect(bad.json).toEqual({ error: 'Revision conflict', currentRevision: 1 })
    })

    test('an absent check-only key compares as revision 0: it passes at 0 and fails at 1 or more', async () => {
        const never = fresh('never')
        const passes = await writeChecked(fresh('commit'), 'a', { checkOnly: [[never, 0]] })
        expect(passes.status).toBe(200)
        const commit = fresh('commit')
        const fails = await writeChecked(commit, 'b', { checkOnly: [[never, 1]] })
        expect(fails.status).toBe(409)
        expect(fails.json?.filePath).toBe(hexOfKey(never))
        expect(fails.json?.currentRevision).toBe(0)
        expect((await readKey(commit)).exists).toBe(false)
    })

    test('a request without check-only keys is accepted with the count 0 and echoes 0', async () => {
        const reply = await writeChecked(fresh('commit'), 'a')
        expect(reply.status).toBe(200)
        expect(reply.json?.checkOnly).toBe(0)
    })

    test('uppercase hex of a check-only path is canonicalised', async () => {
        const unit = fresh('u')
        const unitRevision = revisionOf(await plainWrite(unit, 'unit'))
        const reply = await writeChecked(fresh('commit'), 'a', {
            checkOnly: [[unit, unitRevision]],
            raw: { 'check-only-path': hexOfKey(unit).toUpperCase() },
        })
        expect(reply.status).toBe(200)
    })

    describe('refusals that write nothing and still carry the marker', () => {
        const unit = 'refuse/unit'
        let unitRevision = 0

        beforeAll(async () => {
            unitRevision = revisionOf(await plainWrite(unit, 'unit'))
        })

        const cases: Array<[label: string, make: (commit: string) => Promise<Reply>]> = [
            ['a check-only key equal to the written key', (commit) => writeChecked(commit, 'x', { checkOnly: [[commit, 1]] })],
            ['a duplicated check-only key', (commit) => writeChecked(commit, 'x', { checkOnly: [[unit, unitRevision], [unit, unitRevision]] })],
            ['a revision count that differs from the path count', (commit) => writeChecked(commit, 'x', { checkOnly: [[unit, unitRevision]], raw: { 'check-only-revision': '1$$2' } })],
            ['only the path header', (commit) => writeChecked(commit, 'x', { checkOnly: [[unit, unitRevision]], raw: { 'check-only-revision': null } })],
            ['only the revision header', (commit) => writeChecked(commit, 'x', { checkOnly: [[unit, unitRevision]], raw: { 'check-only-path': null } })],
            ['a non-hex check-only path', (commit) => writeChecked(commit, 'x', { checkOnly: [[unit, unitRevision]], raw: { 'check-only-path': 'zz' } })],
            ['an odd-length check-only path', (commit) => writeChecked(commit, 'x', { checkOnly: [[unit, unitRevision]], raw: { 'check-only-path': 'abc' } })],
            ['an empty check-only revision', (commit) => writeChecked(commit, 'x', { checkOnly: [[unit, unitRevision]], raw: { 'check-only-revision': '' } })],
            ['a non-numeric check-only revision', (commit) => writeChecked(commit, 'x', { checkOnly: [[unit, unitRevision]], raw: { 'check-only-revision': '1.5' } })],
        ]
        test.each(cases)('%s', async (_label, make) => {
            const commit = fresh('commit')
            const reply = await make(commit)
            expect(reply.status).toBe(400)
            expect(reply.headers.get('risu-storage-guarded')).toBe('1')
            expect((await readKey(commit)).exists).toBe(false)
            expect((await readKey(unit)).revision).toBe(unitRevision)
        })

        test('the password file name and an odd-length own key are refused', async () => {
            for (const path of ['__password', 'abc']) {
                const reply = await send('/api/write-checked', 'POST', { 'file-path': path, 'check-only-count': '0', 'own-condition-count': '0' }, new TextEncoder().encode('x'))
                expect(reply.status, path).toBe(400)
                expect(reply.headers.get('risu-storage-guarded')).toBe('1')
            }
        })
    })

    describe('count headers', () => {
        const unit = 'count/unit'
        let unitRevision = 0

        beforeAll(async () => {
            unitRevision = revisionOf(await plainWrite(unit, 'unit'))
        })

        const cases: Array<[label: string, checkOnly: CheckOnly, raw: Record<string, string | null>]> = [
            ['check-only-count missing', [[unit, unitRevision]], { 'check-only-count': null }],
            ['check-only-count missing with no list', [], { 'check-only-count': null }],
            ['check-only-count not a number', [[unit, unitRevision]], { 'check-only-count': 'x' }],
            ['check-only-count negative', [[unit, unitRevision]], { 'check-only-count': '-1' }],
            ['check-only-count fractional', [[unit, unitRevision]], { 'check-only-count': '1.5' }],
            ['check-only-count empty', [[unit, unitRevision]], { 'check-only-count': '' }],
            ['check-only-count lower than the list', [[unit, unitRevision], ['count/other', 0]], { 'check-only-count': '1' }],
            ['check-only-count higher than the list', [[unit, unitRevision]], { 'check-only-count': '2' }],
            ['a list with count 0', [[unit, unitRevision]], { 'check-only-count': '0' }],
            ['no list with a count above 0', [], { 'check-only-count': '1' }],
        ]
        test.each(cases)('write-checked: %s answers 400 guarded-count and writes nothing', async (_label, checkOnly, raw) => {
            const commit = fresh('commit')
            const reply = await writeChecked(commit, 'x', { checkOnly, raw })
            expect(reply.status).toBe(400)
            expect(reply.json?.code).toBe('guarded-count')
            expect(reply.headers.get('risu-storage-guarded')).toBe('1')
            expect((await readKey(commit)).exists).toBe(false)
        })

        test.each(cases)('remove-checked: %s answers 400 guarded-count and removes nothing', async (_label, checkOnly, raw) => {
            const victim = fresh('count/victim')
            const victimRevision = revisionOf(await plainWrite(victim, 'v'))
            const reply = await removeChecked([victim], { checkOnly, raw, revisions: [victimRevision] })
            expect(reply.status).toBe(400)
            expect(reply.json?.code).toBe('guarded-count')
            expect((await readKey(victim)).exists).toBe(true)
        })

        test('remove-checked: retire-count missing, non-zero without retire, or not matching the retire request is refused', async () => {
            const victim = `store2/${fresh('count-retire')}`
            const victimRevision = revisionOf(await plainWrite(victim, 'v'))
            const guard: CheckOnly = [['count/commit', 0]]
            const attempts: Array<Record<string, string | null>> = [
                { 'retire-count': null },
                { 'retire-count': '1' },
                { retire: '1', 'retire-count': '0' },
                { retire: '1', 'retire-count': '2' },
                { retire: '1', 'retire-count': 'x' },
            ]
            for (const raw of attempts) {
                const reply = await removeChecked([victim], { checkOnly: guard, revisions: [victimRevision], raw })
                expect(reply.status, JSON.stringify(raw)).toBe(400)
                expect(reply.json?.code, JSON.stringify(raw)).toBe('guarded-count')
                expect((await readKey(victim)).exists).toBe(true)
            }
            const ok = await removeChecked([victim], { checkOnly: guard, revisions: [victimRevision], retire: true })
            expect(ok.status).toBe(200)
        })
    })

    test('a write racing plain writes of the same key keeps strictly increasing revisions', async () => {
        const key = fresh('race')
        const replies = await Promise.all([
            plainWrite(key, 'a'),
            writeChecked(key, 'b'),
            plainWrite(key, 'c'),
            writeChecked(key, 'd'),
        ])
        expect(replies.map(revisionOf).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    })
})

describe('remove-checked', () => {
    test('a stale commit-key check answers 409 naming the commit key and removes nothing', async () => {
        const commit = fresh('commit')
        await writeChecked(commit, 'v1')
        const victim = fresh('victim')
        const victimRevision = revisionOf(await plainWrite(victim, 'v'))
        const bad = await removeChecked([victim], { revisions: [victimRevision], checkOnly: [[commit, 0]] })
        expect(bad.status).toBe(409)
        expect(bad.json).toEqual({ success: false, error: 'Revision conflict', filePath: hexOfKey(commit), currentRevision: 1 })
        expect(bad.headers.get('risu-storage-guarded')).toBe('1')
        expect((await readKey(victim)).exists).toBe(true)
    })

    test('a passing check removes the key, keeps the response shape, adds the numeric revision and echoes, and does not bump the check-only key', async () => {
        const commit = fresh('commit')
        await writeChecked(commit, 'v1')
        const victim = fresh('victim')
        const victimRevision = revisionOf(await plainWrite(victim, 'v'))
        const ok = await removeChecked([victim], { revisions: [victimRevision], checkOnly: [[commit, 1]] })
        expect(ok.status).toBe(200)
        expect(ok.json).toEqual({
            success: true,
            revisions: { [hexOfKey(victim)]: victimRevision + 1 },
            revision: victimRevision + 1,
            checkOnly: 1,
            retired: 0,
            ownCondition: 1,
        })
        expect(ok.headers.get('cache-control')).toMatch(/no-store/)
        expect((await readKey(victim)).exists).toBe(false)
        expect((await readKey(commit)).revision).toBe(1)
    })

    test('the revision is the largest bumped revision of the batch', async () => {
        const a = fresh('victim')
        const b = fresh('victim')
        await plainWrite(a, 'a')
        await plainWrite(b, 'b')
        await plainWrite(b, 'b2')
        const ok = await removeChecked([a, b], { checkOnly: [] })
        expect(ok.json?.revisions).toEqual({ [hexOfKey(a)]: 2, [hexOfKey(b)]: 3 })
        expect(ok.json?.revision).toBe(3)
    })

    test('a stale revision of a removed key answers 409 naming that key', async () => {
        const victim = fresh('victim')
        const victimRevision = revisionOf(await plainWrite(victim, 'v'))
        const bad = await removeChecked([victim], { revisions: [victimRevision + 3] })
        expect(bad.status).toBe(409)
        expect(bad.json?.filePath).toBe(hexOfKey(victim))
    })

    test('a check-only key equal to a removed key, or listed twice, is refused', async () => {
        const commit = fresh('commit')
        await writeChecked(commit, 'v1')
        const equal = await removeChecked([commit], { checkOnly: [[commit, 1]] })
        expect(equal.status).toBe(400)
        const duplicate = await removeChecked([fresh('victim')], { checkOnly: [[commit, 1], [commit, 1]] })
        expect(duplicate.status).toBe(400)
        expect((await readKey(commit)).exists).toBe(true)
    })
})

describe('own-condition-count', () => {
    const countCases: Array<[label: string, value: string | null]> = [
        ['missing', null],
        ['empty', ''],
        ['not a number', 'x'],
        ['negative', '-1'],
        ['fractional', '1.5'],
    ]

    test.each([...countCases, ['too low', '0'], ['too high', '2']] as Array<[string, string | null]>)('write-checked: a conditional write with the count %s answers 400 guarded-count and writes nothing', async (_label, value) => {
        const key = fresh('own')
        const base = revisionOf(await plainWrite(key, 'base'))
        const reply = await writeChecked(key, 'SHOULD-NOT-LAND', { ifMatch: base, raw: { 'own-condition-count': value } })
        expect(reply.status).toBe(400)
        expect(reply.json?.code).toBe('guarded-count')
        expect(reply.headers.get('risu-storage-guarded')).toBe('1')
        expect(await readKey(key)).toEqual({ text: 'base', revision: base, exists: true })
    })

    test('write-checked: an unconditional write must state the count 0, and a count above 0 without a condition is refused', async () => {
        const key = fresh('own')
        const noCount = await writeChecked(key, 'x', { raw: { 'own-condition-count': null } })
        expect(noCount.status).toBe(400)
        const tooHigh = await writeChecked(key, 'x', { raw: { 'own-condition-count': '1' } })
        expect(tooHigh.status).toBe(400)
        expect(tooHigh.json?.code).toBe('guarded-count')
        expect((await readKey(key)).exists).toBe(false)
        const ok = await writeChecked(key, 'x')
        expect(ok.status).toBe(200)
        expect(ok.json?.ownCondition).toBe(0)
    })

    test('write-checked: a proxy that strips if-match-revision and keeps the count is refused, and so is one that strips both', async () => {
        const key = fresh('own')
        const base = revisionOf(await plainWrite(key, 'base'))
        const stale = base + 5
        for (const raw of [{ 'if-match-revision': null }, { 'if-match-revision': null, 'own-condition-count': null }]) {
            const reply = await writeChecked(key, 'SHOULD-NOT-LAND', { ifMatch: stale, raw })
            expect(reply.status, JSON.stringify(raw)).toBe(400)
            expect(reply.json?.code ?? null, JSON.stringify(raw)).toBe('guarded-count')
            expect(await readKey(key)).toEqual({ text: 'base', revision: base, exists: true })
        }
    })

    test('write-checked: a create-only write (version 0) counts as a condition, echoes 1, and a stripped one is refused', async () => {
        const key = fresh('own')
        const stripped = await writeChecked(key, 'x', { ifMatch: 0, raw: { 'if-match-revision': null } })
        expect(stripped.status).toBe(400)
        expect((await readKey(key)).exists).toBe(false)
        const created = await writeChecked(key, 'first', { ifMatch: 0 })
        expect(created.status).toBe(200)
        expect(created.json?.ownCondition).toBe(1)
        const again = await writeChecked(key, 'second', { ifMatch: 0 })
        expect(again.status).toBe(409)
        expect((await readKey(key)).text).toBe('first')
    })

    test('remove-checked: a batch with mixed empty and non-empty segments counts only the non-empty ones and echoes it', async () => {
        const a = fresh('own')
        const b = fresh('own')
        const c = fresh('own')
        const ra = revisionOf(await plainWrite(a, 'a'))
        revisionOf(await plainWrite(b, 'b'))
        const rc = revisionOf(await plainWrite(c, 'c'))
        for (const value of ['0', '1', '3', null]) {
            const refused = await removeChecked([a, b, c], { revisions: [ra, null, rc], raw: { 'own-condition-count': value } })
            expect(refused.status, String(value)).toBe(400)
            expect(refused.json?.code, String(value)).toBe('guarded-count')
        }
        for (const key of [a, b, c]) {
            expect((await readKey(key)).exists).toBe(true)
        }
        const ok = await removeChecked([a, b, c], { revisions: [ra, null, rc] })
        expect(ok.status).toBe(200)
        expect(ok.json?.ownCondition).toBe(2)
    })

    test('remove-checked: a proxy that strips if-match-revision and keeps the count is refused, and so is one that strips both', async () => {
        const victim = fresh('own')
        const revision = revisionOf(await plainWrite(victim, 'v'))
        for (const raw of [{ 'if-match-revision': null }, { 'if-match-revision': null, 'own-condition-count': null }]) {
            const reply = await removeChecked([victim], { revisions: [revision + 5], raw })
            expect(reply.status, JSON.stringify(raw)).toBe(400)
            expect(reply.json?.code, JSON.stringify(raw)).toBe('guarded-count')
            expect((await readKey(victim)).exists, JSON.stringify(raw)).toBe(true)
        }
    })

    test('remove-checked: a request with no condition states 0 and echoes 0', async () => {
        const victim = fresh('own')
        await plainWrite(victim, 'v')
        const missing = await removeChecked([victim], { raw: { 'own-condition-count': null } })
        expect(missing.status).toBe(400)
        const ok = await removeChecked([victim])
        expect(ok.status).toBe(200)
        expect(ok.json?.ownCondition).toBe(0)
    })
})

describe('the guards of the original design stay observable', () => {
    test('S0-5a ordering A: a GC delete conditioned on an unchanged commit key passes, then the writer CAS naming the deleted unit conflicts and the commit key is unchanged', async () => {
        const commit = fresh('commit')
        const base = revisionOf(await writeChecked(commit, 'base'))
        const unit = fresh('u')
        const unitRevision = revisionOf(await plainWrite(unit, 'unit'))
        const gc = await removeChecked([unit], { revisions: [unitRevision], checkOnly: [[commit, base]] })
        expect(gc.status).toBe(200)
        const cas = await writeChecked(commit, 'names-the-unit', { ifMatch: base, checkOnly: [[unit, unitRevision]] })
        expect(cas.status).toBe(409)
        expect(cas.json?.filePath).toBe(hexOfKey(unit))
        expect((await readKey(commit)).revision).toBe(base)
    })

    test('S0-5a ordering B: after the commit lands, a GC remove with the stale commit key conflicts and the unit survives', async () => {
        const commit = fresh('commit')
        const base = revisionOf(await writeChecked(commit, 'base'))
        const unit = fresh('u')
        const unitRevision = revisionOf(await plainWrite(unit, 'unit'))
        expect((await writeChecked(commit, 'names-the-unit', { ifMatch: base, checkOnly: [[unit, unitRevision]] })).status).toBe(200)
        const gc = await removeChecked([unit], { revisions: [unitRevision], checkOnly: [[commit, base]] })
        expect(gc.status).toBe(409)
        expect(gc.json?.filePath).toBe(hexOfKey(commit))
        expect((await readKey(unit)).exists).toBe(true)
    })

    test('guard (both servers): without check-only keys the same sequences leave the holes open, which is what the check-only keys close', async () => {
        const commit = fresh('commit')
        const base = revisionOf(await plainWrite(commit, 'base'))
        const unit = fresh('u')
        const unitRevision = revisionOf(await plainWrite(unit, 'unit'))
        expect((await send('/api/remove', 'GET', { 'file-path': hexOfKey(unit), 'if-match-revision': String(unitRevision) })).status).toBe(200)
        expect((await plainWrite(commit, 'dangling', base)).status).toBe(200)
        const commit2 = fresh('commit')
        const base2 = revisionOf(await plainWrite(commit2, 'base'))
        const unit2 = fresh('u')
        const unit2Revision = revisionOf(await plainWrite(unit2, 'unit'))
        await plainWrite(commit2, 'names-the-unit', base2)
        expect((await send('/api/remove', 'GET', { 'file-path': hexOfKey(unit2), 'if-match-revision': String(unit2Revision) })).status).toBe(200)
        expect((await readKey(unit2)).exists).toBe(false)
    })

    test('bulk marker sequence: a GC that read the commit key before the marker conflicts, a re-read GC skips the staged prefix, and the owner restarts after a peer commit', async () => {
        const commit = fresh('commit')
        const marker = (current: string, staging: { owner: string, prefix: string } | null) => JSON.stringify({ current, retained: [], staging })
        const base = revisionOf(await plainWrite(commit, marker('v0', null)))
        const m1 = revisionOf(await writeChecked(commit, marker('v-bulk', { owner: 'A', prefix: 'stg/p1/' }), { ifMatch: base }))
        const units: Array<[string, number]> = []
        for (const name of ['stg/p1/1', 'stg/p1/2', 'stg/p1/3']) {
            units.push([name, revisionOf(await plainWrite(`${name}-${commit}`, name))])
        }
        const garbage = fresh('garbage')
        const garbageRevision = revisionOf(await plainWrite(garbage, 'g'))
        const stale = await removeChecked([...units.map(([name]) => `${name}-${commit}`), garbage], {
            revisions: [...units.map(([, revision]) => revision), garbageRevision],
            checkOnly: [[commit, base]],
        })
        expect(stale.status).toBe(409)
        expect(stale.json?.filePath).toBe(hexOfKey(commit))
        expect((await readKey(garbage)).exists).toBe(true)
        const reread = await readKey(commit)
        expect(JSON.parse(reread.text).staging.prefix).toBe('stg/p1/')
        expect(reread.revision).toBe(m1)
        const ok = await removeChecked([garbage], { revisions: [garbageRevision], checkOnly: [[commit, m1]] })
        expect(ok.status).toBe(200)
        expect((await readKey(`stg/p1/1-${commit}`)).exists).toBe(true)
        const peer = revisionOf(await writeChecked(commit, reread.text, { ifMatch: m1 }))
        const staleFinal = await writeChecked(commit, marker('v-final', null), { ifMatch: m1 })
        expect(staleFinal.status).toBe(409)
        expect(staleFinal.json?.currentRevision).toBe(peer)
        const m2 = revisionOf(await writeChecked(commit, marker('v-peer', { owner: 'A', prefix: 'stg/p2/' }), { ifMatch: peer }))
        expect((await writeChecked(commit, marker('v-final', null), { ifMatch: m2 })).status).toBe(200)
    })

    test('120 concurrent requests with overlapping check-only sets in opposite order all finish', async () => {
        const a = fresh('lock')
        const b = fresh('lock')
        const ra = revisionOf(await plainWrite(a, 'a'))
        const rb = revisionOf(await plainWrite(b, 'b'))
        const first = fresh('w')
        const second = fresh('w')
        const jobs: Array<Promise<Reply>> = []
        for (let i = 0; i < 40; i++) {
            jobs.push(writeChecked(first, `x${i}`, { checkOnly: [[a, ra], [b, rb]] }))
            jobs.push(writeChecked(second, `y${i}`, { checkOnly: [[b, rb], [a, ra]] }))
            jobs.push(removeChecked([fresh('none')], { checkOnly: [[b, rb], [a, ra], [first, 0]] }))
        }
        const outcome = await Promise.race([
            Promise.all(jobs),
            new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20_000)),
        ])
        expect(outcome).not.toBe('timeout')
        if (outcome !== 'timeout') {
            expect(outcome.every((reply) => reply.status === 200 || reply.status === 409)).toBe(true)
        }
    }, 40_000)
})

describe('the revision log of guarded requests', () => {
    test('a guarded write appends exactly one bump record for the written key and none for a check-only key', async () => {
        const unit = fresh('log-unit')
        const unitRevision = revisionOf(await plainWrite(unit, 'unit'))
        const commit = fresh('log-commit')
        await writeChecked(commit, 'v', { checkOnly: [[unit, unitRevision]] })
        const log = await readFile(join(fx.saveDir, '__revisions.log'), 'utf-8')
        const lines = log.split('\n').filter((line) => line.includes(hexOfKey(commit)))
        expect(lines).toEqual([`{"k":"${hexOfKey(commit)}","r":1}`])
        expect(log.split('\n').filter((line) => line.includes(hexOfKey(unit)))).toEqual([`{"k":"${hexOfKey(unit)}","r":${unitRevision}}`])
    })
})
