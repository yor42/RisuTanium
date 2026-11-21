/**
 * The restore of a password-encrypted `.rtb` (CHORE-128 S10, E2-R): `verifyAndConfirm` over the committed sealed golden with
 * the password given through its `password` dep, and the error contract of a damaged chunk across the phases that read the
 * file: the verification (V), the copy (C), the re-read before the commit (I0) and the side restore after the commit (S.1).
 *
 * Fixtures: the sealed golden and its unencrypted twin are frozen files of the real producer (`runRtbExportGuarded` with a
 * password). The phase tests seal a writer file (`writeRtbFile`, incompressible asset, inlay and side data) with the engine at
 * 4096-byte chunks, then flip one ciphertext byte of a chosen chunk; the chunk comes from the file's directory.
 *
 * Labels: T30 and T31 are regression reproducers, demonstrated on 6ce5a07b0: there `verifyAndConfirm` ends nothing-replaced
 * (encrypted) without asking for a password. The others are compatibility guards of the new contract; each names the scratch
 * mutants it turns red on. Real Argon2id runs with small explicit parameters; a fake restore store says nothing about a
 * native store.
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import { language } from 'src/lang'
import { importSourceOfBytes } from 'src/ts/importSource'
import { beginBusy } from 'src/ts/process/memory/busyActions'
import { RtbCouldNotReadError } from 'src/ts/drive/rtb/rangeSource'
import { readDirectory } from 'src/ts/drive/rtb/zip64Reader'
import { verifyRtb } from 'src/ts/drive/rtb/rtbVerify'
import { openSealedRtb, type AskReason, type DecryptingRangeSource } from 'src/ts/drive/rtb/sealed/decryptingSource'
import { RtbSealedAuthError } from 'src/ts/drive/rtb/sealed/errors'
import { prepareSeal } from 'src/ts/drive/rtb/sealed/sealWriter'
import { GOOGLE_SEARCH_STORE, HYPA_VECTOR_STORE, IRIS_STORE, MCP_TOOL_CALLS_STORE } from 'src/ts/drive/rtb/sideStoreConfig'
import type { SideInput, SideRecord } from 'src/ts/drive/rtb/rtbWriter'
import { copyRtbEntries, withCopiedKept, type RtbCopyPlan } from 'src/ts/drive/rtbRestoreCopy'
import { finishRtbRestore, type RtbFinishLanded, type RtbFinishPlan } from 'src/ts/drive/rtbRestoreFinish'
import { rereadUnits } from 'src/ts/drive/rtbRestoreInstall'
import { verifyAndConfirm, type PickedRtb, type RtbVerifyDeps } from 'src/ts/drive/rtbRestorePlan'
import { askRtbPassword, sealedVerdict } from 'src/ts/drive/rtbSealedOpen'
import { rtbWorld, type RtbWorld } from 'src/ts/storage/tests/store2/rtbFixtures'
import { seededBytes } from './sealed/sealedReference'
import { dataRangeOf, inlayFixture, writeRtbFile } from './rtbRestoreFixtures'
import { finishPlanOf, MemoryByteStore, planOfBytes, sideFakes } from './rtbInstallFixtures'
import { rangeSourceOfBytes } from './sparseSource'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))
// The world fixture's Node-server helper resolves a file URL that the DOM environment's URL class refuses; this file never starts a server.
vi.mock('src/ts/storage/tests/nodeServerFixture', () => ({ startNodeServer: vi.fn() }))
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return {
        DBState: { db: {} },
        selectedCharID: writable(-1),
        selIdState: { selId: -1 },
        alertStore: writable({ type: 'none', msg: '' }),
        MobileGUI: writable(false),
        botMakerMode: writable(false),
        loadedStore: writable(false),
        LoadingStatusState: { text: '' },
        ReloadGUIPointer: writable(0),
        bodyIntercepterStore: writable(null),
        savingStoppedReason: writable(''),
        frozenSaveKeysStore: writable([]),
    } as unknown as typeof import('src/ts/stores.svelte')
})

// The real password question is tested with the prompt and the alert clear replaced; every other alert call keeps its real body.
const prompt = vi.hoisted(() => ({ ask: vi.fn(), clear: vi.fn() }))
vi.mock('src/ts/passwordPrompt', () => ({ askPassword: prompt.ask }))
vi.mock('src/ts/alert', async (importOriginal) => ({ ...await importOriginal<typeof import('src/ts/alert')>(), alertClear: prompt.clear }))

// The key derivation is the engine's own; a test makes it fail by setting `fail`.
const kdfControl = vi.hoisted(() => ({ fail: null as Error | null }))
vi.mock('src/ts/drive/rtb/sealed/kdf', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/drive/rtb/sealed/kdf')>()
    return {
        ...original,
        deriveKek: async (...args: Parameters<typeof original.deriveKek>) => {
            if (kdfControl.fail !== null) {
                throw kdfControl.fail
            }
            return await original.deriveKek(...args)
        },
    }
})

const GOLDEN_DIR = path.resolve(process.env.RTB_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/rtbGoldens'))
const GOLDEN_PASSWORD = 'rtb-golden-pw'
const CHUNK = 4096
const TAG = 16
const SEAL = { m: 256, t: 2, chunkSize: CHUNK }

const goldenSealed = (): Uint8Array => fs.readFileSync(path.join(GOLDEN_DIR, 'v1-sealed-small.rtb'))
const goldenPlain = (): Uint8Array => fs.readFileSync(path.join(GOLDEN_DIR, 'v1-sealed-small.plain.rtb'))

let world: RtbWorld

beforeAll(async () => {
    world = await rtbWorld({ layout: 1 })
})

beforeEach(() => {
    kdfControl.fail = null
    prompt.ask.mockReset()
    prompt.clear.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    kdfControl.fail = null
    vi.restoreAllMocks()
})

async function sealBytes(plain: Uint8Array, password: string): Promise<Uint8Array> {
    const parts: Uint8Array[] = []
    const seal = await prepareSeal(password, SEAL)
    const sink = seal.sink((chunk) => { parts.push(chunk.slice()) })
    await sink.write(plain)
    await sink.finish()
    const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
        out.set(part, at)
        at += part.length
    }
    return out
}

function pickedOf(bytes: Uint8Array): PickedRtb {
    return { name: 'backup.rtb', size: bytes.length, lastModified: 1_700_000_000_000, source: importSourceOfBytes('backup.rtb', bytes) }
}

interface Calls {
    asked: AskReason[]
    errors: string[]
    waits: string[]
    deps: RtbVerifyDeps
}

/** The deps of `verifyAndConfirm`: the real verification, the password answers in order (the last one repeats), the alerts collected. */
function depsOf(answers: readonly (string | null)[], over: Partial<RtbVerifyDeps> = {}): Calls {
    const calls: Calls = {
        asked: [],
        errors: [],
        waits: [],
        deps: {
            verify: verifyRtb,
            password: async (reason) => {
                const answer = answers[Math.min(calls.asked.length, answers.length - 1)]
                calls.asked.push(reason)
                return answer
            },
            assetDeps: () => ({
                isNodeStore: () => false,
                probePieceStore: async () => { },
                assetLimit: () => Number.MAX_SAFE_INTEGER,
                inlayLimit: () => Number.MAX_SAFE_INTEGER,
                rule: async () => ({ kind: 'tauri', platform: 'posix' }),
                sizedListing: async () => null,
            }),
            confirmScale: async () => true,
            confirm: async () => true,
            error: (text) => { calls.errors.push(text) },
            wait: (text) => { calls.waits.push(text) },
            ...over,
        },
    }
    return calls
}

async function restoreOf(bytes: Uint8Array, calls: Calls) {
    return await verifyAndConfirm(pickedOf(bytes), calls.deps, { newerBase: null })
}

function okOf(end: Awaited<ReturnType<typeof restoreOf>>) {
    if (end.kind !== 'ok') {
        throw new Error(`the restore ended ${end.kind === 'ended' ? `${end.outcome} (${end.cause})` : end.kind}`)
    }
    return end.verified
}

describe('the sealed golden through verifyAndConfirm (T30, T31)', () => {
    test('T30 the right password opens it: ok, the plaintext size, and the plan of its unencrypted twin (regression reproducer, demonstrated on 6ce5a07b0: ends nothing-replaced (encrypted) without asking; a restore that ignores the sealed source fails it)', async () => {
        const plain = goldenPlain()
        const calls = depsOf([GOLDEN_PASSWORD])
        const sealed = okOf(await restoreOf(goldenSealed(), calls))
        expect(calls.asked).toEqual(['first'])
        expect(sealed.source.size).toBe(plain.length)
        expect(sealed.file.size).toBe(goldenSealed().length)
        const twin = okOf(await restoreOf(plain, depsOf([])))
        expect({ assets: sealed.assets, inlays: sealed.inlays, manifest: sealed.manifest, rows: sealed.rows, side: sealed.side, notice: sealed.notice, store2: sealed.store2 })
            .toEqual({ assets: twin.assets, inlays: twin.inlays, manifest: twin.manifest, rows: twin.rows, side: twin.side, notice: twin.notice, store2: twin.store2 })
        expect(calls.errors).toEqual([])
        expect(calls.waits).toContain(language.rtbRestorePasswordChecking)
    })

    test('T31 a wrong password asks again with the wrong reason, the right one opens it (regression reproducer, demonstrated on 6ce5a07b0: ends nothing-replaced (encrypted) without asking; M26 fails it)', async () => {
        const calls = depsOf(['not-the-password', GOLDEN_PASSWORD])
        okOf(await restoreOf(goldenSealed(), calls))
        expect(calls.asked).toEqual(['first', 'wrong'])
        expect(calls.errors).toEqual([])
    })

    test('T31 an unusable password asks again with the unusable reason (regression reproducer, demonstrated on 6ce5a07b0: ends nothing-replaced (encrypted) without asking; M39 (ends the restore) fails it)', async () => {
        const calls = depsOf(['', GOLDEN_PASSWORD])
        okOf(await restoreOf(goldenSealed(), calls))
        expect(calls.asked).toEqual(['first', 'unusable'])
    })

    test('T31 Cancel at the first prompt ends declined, nothing replaced, no message and no listing (regression reproducer, demonstrated on 6ce5a07b0: ends nothing-replaced (encrypted) without asking; X3 fails it)', async () => {
        const planned = vi.fn()
        const calls = depsOf([null], { assetDeps: () => { planned(); throw new Error('the asset plan must not run') } })
        const end = await restoreOf(goldenSealed(), calls)
        expect(end).toEqual({ kind: 'ended', outcome: 'canceled', cause: 'declined' })
        expect(calls.asked).toEqual(['first'])
        expect(calls.errors).toEqual([])
        expect(planned).not.toHaveBeenCalled()
    })
})

describe('the messages of a sealed file that does not open (T32)', () => {
    test('a header cut inside the last chunk is damaged and nothing is asked (guard)', async () => {
        const sealed = goldenSealed()
        const plain = goldenPlain()
        const chunks = Math.ceil(plain.length / CHUNK)
        const lastLen = plain.length - (chunks - 1) * CHUNK
        const cut = sealed.slice(0, sealed.length - (lastLen + TAG) + 8)
        const calls = depsOf([GOLDEN_PASSWORD])
        expect(await restoreOf(cut, calls)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'damaged' })
        expect(calls.errors).toEqual([language.rtbRestoreDamaged])
        expect(calls.asked).toEqual([])
    })

    test('a later envelope version is newer, in the words of the encryption format, and nothing is asked (guard)', async () => {
        const bytes = goldenSealed().slice()
        bytes[8] = 2
        const calls = depsOf([GOLDEN_PASSWORD])
        expect(await restoreOf(bytes, calls)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'newer' })
        expect(calls.errors).toEqual([language.rtbRestoreNewer('the encryption format')])
        expect(calls.asked).toEqual([])
    })

    test('a header read that fails is could-not-read with the unreadable-file message (guard; M23 fails it)', async () => {
        const bytes = goldenSealed()
        const source = importSourceOfBytes('backup.rtb', bytes)
        const picked: PickedRtb = {
            ...pickedOf(bytes),
            source: { ...source, read: async (start, end) => {
                if (start > 0) {
                    throw new Error('the file went away')
                }
                return await source.read(start, end)
            } },
        }
        const calls = depsOf([GOLDEN_PASSWORD])
        expect(await verifyAndConfirm(picked, calls.deps, { newerBase: null })).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'could-not-read' })
        expect(calls.errors).toEqual([language.backupFileUnreadable])
        expect(calls.asked).toEqual([])
    })

    test('a key derivation that cannot run says so and replaces nothing (guard)', async () => {
        kdfControl.fail = new RangeError('out of memory')
        const calls = depsOf([GOLDEN_PASSWORD])
        expect(await restoreOf(goldenSealed(), calls)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'could-not-read' })
        expect(calls.errors).toEqual([language.rtbRestoreUnlockFailed])
        expect(calls.asked).toEqual(['first'])
    })
})

describe('a sealed file inside a sealed file (T34)', () => {
    test('is damaged after one prompt and the inner file is never decrypted (guard: nested sealed is refused by two layers, R4 at open and sealedVerdict; each layer\'s mutant (M32, M46) is caught by its own unit test, and this end-to-end case fails only if both fail)', async () => {
        const nested = await sealBytes(goldenSealed(), 'outer-password')
        const calls = depsOf(['outer-password'])
        expect(await restoreOf(nested, calls)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'damaged' })
        expect(calls.errors).toEqual([language.rtbRestoreDamaged])
        expect(calls.asked).toEqual(['first'])
    })
})

describe('the verdict a sealed restore acts on', () => {
    const plainOpen = { kind: 'open' as const, source: rangeSourceOfBytes(new Uint8Array(1)), sealed: null }

    test('an encrypted verdict can only come from a sealed file inside a sealed file and is damaged, never passed on (guard; M46 fails it)', () => {
        expect(sealedVerdict(plainOpen, { kind: 'encrypted' })).toMatchObject({ kind: 'damaged' })
    })

    test('a could-not-read verdict is damaged only when the decrypting source remembers an authentication failure (guard; M27 fails it)', async () => {
        const file = await sealedFixture()
        const source = await decrypting(damaged(file, 1))
        const read = { kind: 'could-not-read' as const, message: 'sealed chunk 1 failed authentication' }
        expect(sealedVerdict({ kind: 'open', source, sealed: source }, read)).toEqual(read)
        await source.read(CHUNK, 10).catch(() => undefined)
        expect(sealedVerdict({ kind: 'open', source, sealed: source }, read)).toMatchObject({ kind: 'damaged' })
        expect(sealedVerdict(plainOpen, read)).toEqual(read)
    })
})

describe('the password question (askRtbPassword)', () => {
    test.each([
        ['first', language.rtbRestorePasswordPrompt],
        ['wrong', language.rtbRestorePasswordWrong],
        ['unusable', language.rtbRestorePasswordUnusable],
    ] as const)('the %s reason asks with its own text, after clearing any alert, and returns the answer (guard; swapped texts and a missing alertClear fail it)', async (reason, message) => {
        prompt.ask.mockImplementation(async () => {
            expect(prompt.clear).toHaveBeenCalledTimes(1)
            return 'typed'
        })
        expect(await askRtbPassword(reason)).toBe('typed')
        expect(prompt.ask).toHaveBeenCalledWith({ message })
    })

    test('the three texts differ, so the mapping above is distinguishable', () => {
        expect(new Set([language.rtbRestorePasswordPrompt, language.rtbRestorePasswordWrong, language.rtbRestorePasswordUnusable]).size).toBe(3)
    })
})

describe('the password text (T39)', () => {
    test('a Hangul password sealed in NFD opens when typed in NFC (guard; M9 fails it)', async () => {
        const nfd = '한글 비밀번호'.normalize('NFD')
        const nfc = nfd.normalize('NFC')
        expect(nfd).not.toBe(nfc)
        const bytes = await sealBytes(goldenPlain(), nfd)
        const calls = depsOf([nfc])
        okOf(await restoreOf(bytes, calls))
        expect(calls.asked).toEqual(['first'])
    })
})

// ---- a damaged chunk in each phase ----

const INLAY = '0123abcd-0123-4123-a123-0123456789ab'
const ASSET = `${'a1'.repeat(32)}.png`

async function* iterate<T>(items: readonly T[]): AsyncGenerator<T> {
    for (const item of items) {
        yield item
    }
}

/** One side section whose single record is `size` incompressible bytes as hex. */
function sideOf(key: string, size: number, seed: number): SideInput {
    return { records: iterate<SideRecord>([{ key, value: seededBytes(size, seed).toString('hex') }]) }
}

interface Sealed {
    plain: Uint8Array
    sealed: Uint8Array
    headerLen: number
}

async function sealedFixture(irisBytes = 6 * CHUNK): Promise<Sealed> {
    const fixture = inlayFixture(INLAY, 'x')
    const body = seededBytes(6 * CHUNK + 300, 31)
    const built = await writeRtbFile({
        world,
        assets: { [ASSET]: seededBytes(6 * CHUNK + 100, 32) },
        inlays: [{ ...fixture, body, record: { ...fixture.record, len: body.length } }],
        sides: {
            'side.iris': sideOf('k-iris', irisBytes, 41),
            'side.google-search': sideOf('k-google', 6 * CHUNK, 44),
            'side.hypa-vector': sideOf('k-hypa', 6 * CHUNK, 42),
            'side.mcp-tool-calls': sideOf('k-mcp', 6 * CHUNK, 43),
        },
    })
    const sealed = await sealBytes(built.bytes, GOLDEN_PASSWORD)
    const chunks = Math.ceil(built.bytes.length / CHUNK)
    return { plain: built.bytes, sealed, headerLen: sealed.length - built.bytes.length - chunks * TAG }
}

/** The sealed bytes with one ciphertext byte of plaintext chunk `chunk` flipped. */
function damaged(file: Sealed, chunk: number): Uint8Array {
    const bytes = file.sealed.slice()
    bytes[file.headerLen + chunk * (CHUNK + TAG) + 5] ^= 0xFF
    return bytes
}

async function decrypting(bytes: Uint8Array): Promise<DecryptingRangeSource> {
    const opened = await openSealedRtb(rangeSourceOfBytes(bytes), { askPassword: async () => GOLDEN_PASSWORD })
    if (opened.kind !== 'open') {
        throw new Error(`the fixture did not open: ${opened.detail}`)
    }
    return opened.source
}

/** The first chunk that lies wholly inside the data of entry `name`. */
async function chunkInside(file: Sealed, name: string): Promise<number> {
    const { start, end } = await dataRangeOf(file.plain, name)
    const chunk = Math.ceil(start / CHUNK)
    if ((chunk + 1) * CHUNK > end) {
        throw new Error(`no whole chunk inside ${name}`)
    }
    return chunk
}

async function unitBlockName(plain: Uint8Array): Promise<string> {
    const walked = await readDirectory(rangeSourceOfBytes(plain))
    const index = walked.index!
    for (let i = 0; i < index.count; i++) {
        if (index.entry(i).name.startsWith('u/')) {
            return index.entry(i).name
        }
    }
    throw new Error('the fixture has no unit block')
}

describe('V: a damaged chunk met by the verification (T33)', () => {
    test('a chunk in a unit block ends damaged, not could-not-read (guard; M27 and M22 fail it)', async () => {
        const file = await sealedFixture()
        const chunk = Math.floor((await dataRangeOf(file.plain, await unitBlockName(file.plain))).start / CHUNK)
        const calls = depsOf([GOLDEN_PASSWORD])
        expect(await restoreOf(damaged(file, chunk), calls)).toEqual({ kind: 'ended', outcome: 'nothing-replaced', cause: 'damaged' })
        expect(calls.errors).toEqual([language.rtbRestoreDamaged])
    })

    test('the same file undamaged restores, so the failure above is the chunk (guard)', async () => {
        const file = await sealedFixture()
        okOf(await restoreOf(file.sealed, depsOf([GOLDEN_PASSWORD])))
    })
})

describe('C: a damaged chunk met by the copy (T33)', () => {
    async function copyOver(file: Sealed, chunk: number, chunkMax?: number) {
        const intact = await decrypting(file.sealed)
        const plan: RtbCopyPlan = { ...await planOfBytes(file.plain, { source: () => intact }), source: await decrypting(damaged(file, chunk)) }
        const store = new MemoryByteStore()
        const errors: string[] = []
        const busy = beginBusy('backupLoad')
        try {
            const end = await copyRtbEntries(plan, { busy }, {
                store: async () => store,
                createPipeline: async () => null,
                error: (text) => { errors.push(text) },
                wait: () => { },
                ...(chunkMax === undefined ? {} : { chunkMax }),
            })
            return { end, errors, store }
        } finally {
            busy.end()
        }
    }

    test.each([
        ['a small asset entry', undefined],
        ['a large asset entry', 1000],
    ] as const)('a chunk wholly inside %s halts corrupt-entry with the damaged text and the copied-kept line (guard; M28 fails it)', async (_label, chunkMax) => {
        const file = await sealedFixture()
        const { end, errors } = await copyOver(file, await chunkInside(file, `a/${ASSET}`), chunkMax)
        expect(end).toMatchObject({ kind: 'stopped', outcome: 'nothing-replaced', cause: 'corrupt-entry' })
        expect(errors).toEqual([withCopiedKept(language.rtbRestoreDamaged)])
    })

    test.each([
        ['the body of an inlay', (names: { bodyName: string }) => names.bodyName, true],
        ['the meta of an inlay', (names: { metaName: string }) => names.metaName, false],
    ] as const)('a chunk inside %s halts corrupt-entry with the damaged text (guard; M28 fails it)', async (_label, pick, whole) => {
        const file = await sealedFixture()
        const walked = await readDirectory(rangeSourceOfBytes(file.plain))
        const index = walked.index!
        const names = { bodyName: '', metaName: '' }
        for (let i = 0; i < index.count; i++) {
            const name = index.entry(i).name
            if (name.startsWith('i/') && name.endsWith('.body')) names.bodyName = name
            if (name.startsWith('i/') && name.endsWith('.meta')) names.metaName = name
        }
        const target = (pick as (n: typeof names) => string)(names)
        const chunk = whole ? await chunkInside(file, target) : Math.floor((await dataRangeOf(file.plain, target)).start / CHUNK)
        const { end, errors } = await copyOver(file, chunk)
        expect(end).toMatchObject({ kind: 'stopped', outcome: 'nothing-replaced', cause: 'corrupt-entry' })
        expect(errors).toEqual([withCopiedKept(language.rtbRestoreDamaged)])
    })
})

describe('I0: a damaged chunk met by the re-read of the units before the commit (T33)', () => {
    test('the re-read reports the file as changed, which stops the restore as could-not-read (guard; the subclass keeps this branch)', async () => {
        const file = await sealedFixture()
        const name = await unitBlockName(file.plain)
        const chunk = Math.floor((await dataRangeOf(file.plain, name)).start / CHUNK)
        const intact = await decrypting(file.sealed)
        const verdict = await verifyRtb(intact)
        if (verdict.kind !== 'ok') {
            throw new Error(`the fixture is ${verdict.kind}`)
        }
        const { index, store2 } = verdict.verified
        expect((await rereadUnits({ source: await decrypting(file.sealed), index, store2 })).kind).toBe('ok')
        const reread = await rereadUnits({ source: await decrypting(damaged(file, chunk)), index, store2 })
        expect(reread.kind).toBe('changed')
    })
})

describe('S.1: a damaged chunk met by the side restore after the commit (T33)', () => {
    interface Landed {
        notices: string[]
        releases: boolean[]
        log: string[]
        fakes: ReturnType<typeof sideFakes>
    }

    async function restoreSidesOver(file: Sealed, chunk: number): Promise<Landed> {
        const intact = await decrypting(file.sealed)
        // V ran over the intact file: the damage is first met here, after the commit.
        const plan: RtbFinishPlan = { ...await finishPlanOf(file.plain, { source: () => intact }), source: await decrypting(damaged(file, chunk)) }
        const fakes = sideFakes()
        for (const store of [IRIS_STORE, HYPA_VECTOR_STORE, MCP_TOOL_CALLS_STORE, GOOGLE_SEARCH_STORE]) {
            fakes.forage(store).data.set('old', 1)
        }
        const notices: string[] = []
        const releases: boolean[] = []
        const log: string[] = []
        const landed: RtbFinishLanded = { flushed: true, facts: { assetsWritten: 0, assetsPresent: 0, skippedAssets: [], inlays: { written: 0, skipped: [], changed: false } } }
        await finishRtbRestore(plan, { release: async (keep) => { releases.push(keep) } }, landed, {
            sideBackends: fakes.backends,
            notice: async (text) => { notices.push(text) },
            wait: () => { },
            markReload: () => { log.push('mark') },
            reload: async () => { log.push('reload') },
        })
        return { notices, releases, log, fakes }
    }

    const keys = (landed: Landed, store: Parameters<ReturnType<typeof sideFakes>['forage']>[0]) => [...landed.fakes.forage(store).data.keys()]
    const notRestored = (...names: string[]) => [language.rtbRestoreLeftOut([language.rtbRestoreLineSideNotRestored(names)])]

    test('a chunk in the middle section loses that section only: the sections before and after are restored and it is named (guard; M24b fails it)', async () => {
        const file = await sealedFixture()
        const landed = await restoreSidesOver(file, await chunkInside(file, 's/hypa-vector/data.jsonl'))
        expect(keys(landed, IRIS_STORE)).toEqual(['k-iris'])
        expect(keys(landed, GOOGLE_SEARCH_STORE)).toEqual(['k-google'])
        expect(keys(landed, HYPA_VECTOR_STORE)).toEqual(['old'])
        expect(keys(landed, MCP_TOOL_CALLS_STORE)).toEqual(['k-mcp'])
        expect(landed.notices).toEqual(notRestored(language.rtbRestoreSideNames.hypaVector))
        expect(landed.releases).toEqual([true])
        expect(landed.log).toEqual(['mark', 'reload'])
    })

    test('a chunk in the first applied section loses that section only: every later section is restored (guard; M24b fails it)', async () => {
        const file = await sealedFixture()
        const landed = await restoreSidesOver(file, await chunkInside(file, 's/iris/data.jsonl'))
        expect(keys(landed, IRIS_STORE)).toEqual(['old'])
        expect(keys(landed, GOOGLE_SEARCH_STORE)).toEqual(['k-google'])
        expect(keys(landed, HYPA_VECTOR_STORE)).toEqual(['k-hypa'])
        expect(keys(landed, MCP_TOOL_CALLS_STORE)).toEqual(['k-mcp'])
        expect(landed.notices).toEqual(notRestored(language.rtbRestoreSideNames.iris))
        expect(landed.releases).toEqual([true])
    })

    test('a chunk holding the end of one section and the start of the next loses both and no other (guard)', async () => {
        // The iris size is searched so its data ends in the middle of a chunk that also holds the start of the next section's data.
        let file: Sealed | null = null
        let chunk = -1
        for (let extra = 0; extra < 4000 && chunk < 0; extra += 211) {
            const candidate = await sealedFixture(6 * CHUNK + extra)
            const iris = await dataRangeOf(candidate.plain, 's/iris/data.jsonl')
            const google = await dataRangeOf(candidate.plain, 's/google-search/data.jsonl')
            const holding = Math.floor((iris.end - 1) / CHUNK)
            if (google.start < (holding + 1) * CHUNK && holding * CHUNK > iris.start) {
                file = candidate
                chunk = holding
            }
        }
        if (file === null) {
            throw new Error('no iris size puts the two sections in one chunk')
        }
        const landed = await restoreSidesOver(file, chunk)
        expect(keys(landed, IRIS_STORE)).toEqual(['old'])
        expect(keys(landed, GOOGLE_SEARCH_STORE)).toEqual(['old'])
        expect(keys(landed, HYPA_VECTOR_STORE)).toEqual(['k-hypa'])
        expect(keys(landed, MCP_TOOL_CALLS_STORE)).toEqual(['k-mcp'])
        expect(landed.notices).toEqual(notRestored(language.rtbRestoreSideNames.iris, language.rtbRestoreSideNames.googleSearch))
        expect(landed.releases).toEqual([true])
    })
})

describe('the error type of the decrypting source', () => {
    test('an authentication failure is a could-not-read error with the chunk named (guard; M22 fails it)', async () => {
        const file = await sealedFixture()
        const source = await decrypting(damaged(file, 1))
        const error = await source.read(CHUNK, 10).catch((thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(RtbSealedAuthError)
        expect(error).toBeInstanceOf(RtbCouldNotReadError)
        expect((error as RtbSealedAuthError).chunk).toBe(1)
    })
})
