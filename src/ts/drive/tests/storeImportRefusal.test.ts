/**
 * Every refusal of the page import names its cause (`Store2ImportRefusal`), at each site of `checkStore2Import` and
 * `commitStore2Import`. The library, the alerts and the busy guard are doubles; the language is a table whose every
 * entry reads as its own path, so a test sees which message a site showed. A pass says nothing about a real store.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const named = vi.hoisted(() => {
    const make = (path: string): unknown => new Proxy(function () { }, {
        get: (_target, key) => {
            if (key === Symbol.toPrimitive || key === 'toString') {
                return () => path
            }
            return typeof key === 'symbol' || key === 'then' ? undefined : make(`${path}.${key}`)
        },
        apply: () => path,
    })
    return make
})

const world = vi.hoisted(() => ({
    errors: [] as string[],
    busy: false,
    session: null as unknown,
    classified: null as unknown,
    outcome: null as unknown,
    ready: null as unknown,
}))

const inert = vi.hoisted(() => (): Record<string, unknown> => new Proxy({}, {
    has: () => true,
    get: (_target, name) => name === 'then' ? undefined : (name === 'alertStore' ? {} : () => undefined),
}))
vi.mock('src/ts/alert', () => ({
    alertError: (message: unknown) => { world.errors.push(String(message)) },
    alertConfirm: async () => true,
    alertNormalWait: async () => { },
    alertWait: () => { },
    alertStore: { set: () => { } },
}))
vi.mock('src/lang', () => ({ language: named('language') }))
vi.mock('src/ts/globalApi.svelte', inert)
vi.mock('src/ts/process/coldstorage.svelte', inert)
vi.mock('src/ts/drive/backupWorkGuard', () => ({ refuseBackupLoadWhileBusy: () => world.busy }))
vi.mock('src/ts/drive/restoreReplace', inert)
vi.mock('src/ts/storage/store2/commitKey', () => ({ classifyCommitRead: () => world.classified }))
vi.mock('src/ts/storage/store2/bootActive', () => ({ getStore2BootSession: () => world.session }))
vi.mock('src/ts/storage/store2/lists', inert)
vi.mock('src/ts/storage/store2/saveActive', inert)
vi.mock('src/ts/storage/risuSave', inert)
vi.mock('src/ts/storage/bootBlockLoad', inert)
vi.mock('src/ts/storage/store2/ui/bootText', inert)
vi.mock('src/ts/storage/store2/legacy/storeReader', inert)
vi.mock('src/ts/storage/store2/legacy/importTree', () => ({
    importLegacyTree: async (request: { committer: { commit: (read: unknown, commit: { build: (context: unknown) => unknown }) => Promise<unknown> } }) => {
        if (world.busy) {
            await request.committer.commit({}, { build: () => ({}) })
        }
        return world.outcome
    },
}))

import { BinFileChangedError } from 'src/ts/storage/store2/legacy/binReader'
import { Store2StalePageError } from 'src/ts/storage/store2/backend/errors'
import type { Database } from 'src/ts/storage/database.svelte'
import { checkStore2Import, commitStore2Import, type Store2ImportEnd, type Store2ImportRefusal, type Store2ImportRequest } from '../storeImport'

beforeEach(() => {
    world.errors = []
    world.busy = false
    world.session = null
    world.classified = null
    world.outcome = null
    vi.spyOn(console, 'error').mockImplementation(() => { })
})

const committerWith = (readCommit: () => Promise<unknown>) => ({
    owner: 'this-page',
    readCommit,
    abandonClear: async () => ({ status: 'cleared' }),
    commit: async (_read: unknown, request: { build: (context: unknown) => unknown }) => request.build({}),
})

function requestWith(decode: () => Promise<Database>, readCommit: () => Promise<unknown> = async () => { throw new Error('no commit key') }): Store2ImportRequest {
    return { target: { committer: committerWith(readCommit), backend: {} }, busy: {}, decode, reader: {} } as unknown as Store2ImportRequest
}

const decodes = async () => ({}) as Database

async function refusal(request: Store2ImportRequest): Promise<{ cause: Store2ImportRefusal, shown: string[] }> {
    const end: Store2ImportEnd = await commitStore2Import(request)
    expect(end.kind).toBe('refused')
    return { cause: (end as Extract<Store2ImportEnd, { kind: 'refused' }>).cause, shown: world.errors }
}

describe('commitStore2Import names the cause of each refusal (new behaviour)', () => {
    test('a decode that throws is decode-failed and shows the unreadable-backup message', async () => {
        const result = await refusal(requestWith(async () => { throw new Error('bad bytes') }))
        expect(result).toEqual({ cause: 'decode-failed', shown: ['language.internalBackupUnreadable'] })
    })

    test('the busy guard at the flip is busy and shows nothing', async () => {
        world.busy = true
        const result = await refusal(requestWith(decodes))
        expect(result).toEqual({ cause: 'busy', shown: [] })
    })

    test('a declined confirmation is declined and shows nothing', async () => {
        world.outcome = { status: 'declined' }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'declined', shown: [] })
    })

    test('a changed file is read-failed with the file-changed text, any other read error with the read-failed text', async () => {
        world.outcome = { status: 'read-failed', error: { cause: new BinFileChangedError('length', 'x') } }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'read-failed', shown: ['language.backupFileChangedWhileReading'] })
        world.errors = []
        world.outcome = { status: 'read-failed', error: { cause: new Error('disk') } }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'read-failed', shown: ['language.store2ImportReadFailed'] })
    })

    test('an unrepairable archived id is archived-id', async () => {
        world.outcome = { status: 'repair-refused', refusals: [{ name: 'Alice' }] }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'archived-id', shown: ['language.restoreRefusedArchivedId'] })
    })

    test('an unsavable tree is unsavable', async () => {
        world.outcome = { status: 'unsavable', detail: 'd' }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'unsavable', shown: ['language.restoreRefusedUnsavable'] })
    })

    test('an unreadable base is base-unreadable', async () => {
        world.outcome = { status: 'base-unreadable', detail: 'd' }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'base-unreadable', shown: ['language.store2ImportRefused'] })
    })

    test('a failed write is write-failed, and a failure of a stale page is stale-page', async () => {
        world.outcome = { status: 'failed', cause: new Error('write') }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'write-failed', shown: ['language.internalBackupWriteFailed'] })
        world.errors = []
        world.outcome = { status: 'failed', cause: new Store2StalePageError('stale') }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'stale-page', shown: ['language.restoreNotHappenedNotice'] })
    })

    test('an abandoned commit is abandoned', async () => {
        world.outcome = { status: 'abandoned', reason: 'r', cause: undefined }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'abandoned', shown: ['language.store2ImportAbandoned'] })
    })

    test('a standing marker that cannot be cleared is marker-standing, not a claim about its owner', async () => {
        world.outcome = { status: 'refused', reason: 'marker-present' }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'marker-standing', shown: ['language.store2RestoreBulkMarker'] })
    })

    test('a too-new refusal is too-new and any other library refusal is library-refused', async () => {
        world.outcome = { status: 'refused', reason: 'too-new' }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'too-new', shown: ['language.store2ImportTooNew'] })
        world.errors = []
        world.outcome = { status: 'refused', reason: 'format' }
        expect(await refusal(requestWith(decodes))).toEqual({ cause: 'library-refused', shown: ['language.store2ImportRefused'] })
    })
})

describe('checkStore2Import names the cause of each refusal (new behaviour)', () => {
    const sessionWith = (readCommit: () => Promise<unknown>) => ({ committer: committerWith(readCommit), backend: {} })
    const readsNothing = async () => ({})

    test('a page without a writable session is no-writable-session and shows the read-only refusal', async () => {
        world.session = null
        expect(await checkStore2Import()).toEqual({ kind: 'refused', cause: 'no-writable-session' })
        expect(world.errors).toEqual(['language.store2Boot.readOnlyRefusal'])
    })

    test('a commit key that cannot be read is commit-read-failed', async () => {
        world.session = sessionWith(async () => { throw new Error('read') })
        expect(await checkStore2Import()).toEqual({ kind: 'refused', cause: 'commit-read-failed' })
        expect(world.errors).toEqual(['language.store2ImportReadFailed'])
    })

    test.each([
        ['too-new', { status: 'too-new' }, 'too-new', 'language.store2ImportTooNew'],
        ['absent', { status: 'absent' }, 'commit-key-unusable', 'language.store2ImportRefused'],
        ['damaged', { status: 'damaged' }, 'commit-key-unusable', 'language.store2ImportRefused'],
        ['no current manifest', { status: 'parsed', value: { current: null, staging: null } }, 'no-current-manifest', 'language.store2ImportRefused'],
        ['a foreign marker', { status: 'parsed', value: { current: {}, staging: { owner: 'other-page' } } }, 'foreign-marker', 'language.store2RestoreBulkMarker'],
    ])('%s is its own cause', async (_label, classified, cause, message) => {
        world.session = sessionWith(readsNothing)
        world.classified = classified
        expect(await checkStore2Import()).toEqual({ kind: 'refused', cause })
        expect(world.errors).toEqual([message])
    })

    test('a current manifest with this page\'s own marker is ready, with no message (new result shape; the silence is a guard)', async () => {
        const session = sessionWith(readsNothing)
        world.session = session
        world.classified = { status: 'parsed', value: { current: {}, staging: { owner: 'this-page' } } }
        expect(await checkStore2Import()).toEqual({ kind: 'ready', target: { committer: session.committer, backend: session.backend } })
        expect(world.errors).toEqual([])
    })
})
