// @vitest-environment node
/**
 * util/androidPublish.mjs (#590 S2): the release-check and publish rules of release-desktop.yml. The network is an
 * injected fake that serves releases, pages and uploads the way the REST API does (a server page size below the
 * requested one, embedded asset lists left empty), so no token or real release is involved. Every printed line must be
 * fixed text: release notes and API strings never reach the log.
 *
 * T1 release-check rows, T2 latest-android.json bytes, T3 the APK URL, T4 the publish order, T5 the draft choice,
 * T6 the re-run rule, T7 the file rules, T8 the upload answers, T9 release and upload address checks, T10 log hygiene,
 * T11 the source has no write verb besides POST.
 */
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, afterEach, describe, expect, test, vi } from 'vitest'
import { parseAndroidRelease } from '../src/ts/android/appUpdateRelease'
import { androidAssetNames, apkUrl, buildLatestJson, deleteCommands, githubApi, isAndroidAsset, main, selectDraft, tagReleases } from './androidPublish.mjs'
import { releaseVersion } from './androidRelease.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const contractText = readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'test', 'resources', 'app-update-v1', 'contract.properties'), 'utf8')
const urlsText = readFileSync(path.join(root, 'src-tauri', 'gen', 'android', 'app', 'src', 'test', 'resources', 'app-update-v1', 'urls.txt'), 'utf8')

const SHA = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const REPO = 'yor42/RisuTanium'
const VERSION = '0.2.0'
const APK = androidAssetNames(VERSION)[0]
const JSON_NAME = 'latest-android.json'
const MARKER = 'NOTES-MARKER ::error::${{ secrets.X }} \r\n"quoted"'

const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

// ---------------------------------------------------------------- the fake API
interface FakeAsset {
  id: number
  name: string
  size: number
  state: string
  digest: string | null
}
interface FakeRelease {
  id: number
  tag_name: string
  draft: boolean
  target_commitish: string
  upload_url: string
  assets: FakeAsset[]
}
interface Call {
  method: string
  url: string
  kind: string
  contentType?: string
  body?: Buffer
}
interface Reply {
  status: number
  body: unknown
}
const uploadUrl = (id: number) => `https://uploads.github.com/repos/${REPO}/releases/${id}/assets{?name,label}`
const asset = (id: number, name: string, over: Partial<FakeAsset> = {}): FakeAsset => ({ id, name, size: 10, state: 'uploaded', digest: null, ...over })
const release = (id: number, over: Partial<FakeRelease> = {}): FakeRelease => ({
  id,
  tag_name: `v${VERSION}`,
  draft: true,
  target_commitish: SHA,
  upload_url: uploadUrl(id),
  assets: [],
  ...over,
})
const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')

class Fake {
  calls: Call[] = []
  nextAsset = 9000
  getCount = new Map<number, number>()
  /** The server's page size: it is below the requested 100, so a client that stops at a short page misses the rest. */
  pageSize = 30
  uploadReply: ((name: string, body: Buffer) => Reply | null) | null = null
  getReply: ((id: number, count: number, current: FakeRelease) => FakeRelease) | null = null
  constructor(public releases: FakeRelease[]) {}

  get uploads() {
    return this.calls.filter(c => c.method === 'POST')
  }
  kinds() {
    return this.calls.map(c => c.kind)
  }

  api = async (request: { method: string; url: string; body?: Buffer; contentType?: string }): Promise<Reply> => {
    const { method, url } = request
    const page = (items: unknown[], n: number) => items.slice((n - 1) * this.pageSize, n * this.pageSize)
    const list = new RegExp(`^https://api\\.github\\.com/repos/${REPO}/releases\\?per_page=100&page=(\\d+)$`).exec(url)
    const assets = new RegExp(`^https://api\\.github\\.com/repos/${REPO}/releases/(\\d+)/assets\\?per_page=100&page=(\\d+)$`).exec(url)
    const one = new RegExp(`^https://api\\.github\\.com/repos/${REPO}/releases/(\\d+)$`).exec(url)
    const up = new RegExp(`^https://uploads\\.github\\.com/repos/${REPO}/releases/(\\d+)/assets\\?name=(.+)$`).exec(url)
    const record = (kind: string) => this.calls.push({ method, url, kind, contentType: request.contentType, body: request.body })
    if (method === 'GET' && list) {
      record('list')
      return { status: 200, body: page(this.releases.map(r => ({ ...r, assets: [] })), Number(list[1])) }
    }
    if (method === 'GET' && assets) {
      record('assets')
      const found = this.releases.find(r => r.id === Number(assets[1]))
      return found ? { status: 200, body: page(found.assets, Number(assets[2])) } : { status: 404, body: null }
    }
    if (method === 'GET' && one) {
      record('get')
      const id = Number(one[1])
      const found = this.releases.find(r => r.id === id)
      if (!found) return { status: 404, body: null }
      const count = (this.getCount.get(id) ?? 0) + 1
      this.getCount.set(id, count)
      return { status: 200, body: this.getReply ? this.getReply(id, count, found) : found }
    }
    if (method === 'POST' && up) {
      const name = decodeURIComponent(up[2])
      record(`upload:${name === APK ? 'apk' : name === JSON_NAME ? 'json' : name}`)
      const body = request.body as Buffer
      const custom = this.uploadReply?.(name, body)
      if (custom) return custom
      const id = this.nextAsset++
      this.releases.find(r => r.id === Number(up[1]))?.assets.push(asset(id, name, { size: body.length }))
      return { status: 201, body: asset(id, name, { size: body.length, digest: `sha256:${sha256(body)}` }) }
    }
    record(`unexpected:${method}`)
    return { status: 500, body: null }
  }
}

// ---------------------------------------------------------------- helpers
const baseEnv = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  INCLUDE_ANDROID: 'true',
  GITHUB_REPOSITORY: REPO,
  GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: SHA,
  RELEASE_NOTES: '',
  ...over,
})
const readConf = (version = VERSION) => () => ({ confText: JSON.stringify({ version }), contractText })

async function run(argv: string[], env: Record<string, string | undefined>, fake: Fake, version = VERSION) {
  const lines: string[] = []
  const code = await main(argv, env as NodeJS.ProcessEnv, line => lines.push(line), { api: fake.api, readConf: readConf(version) })
  return { code, lines, text: lines.join('\n') }
}
const check = (env: Record<string, string | undefined>, fake: Fake, version?: string) => run(['check'], env, fake, version)

function makeApk(bytes: string | Buffer = 'signed-apk-bytes') {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'risu590-pub-'))
  scratch.push(dir)
  writeFileSync(path.join(dir, 'app-release.apk'), bytes)
  return { dir, sha: sha256(bytes), size: Buffer.byteLength(bytes) }
}
const publishEnv = (apk: { dir: string; sha: string }, over: Record<string, string | undefined> = {}) =>
  baseEnv({ APK_DIR: apk.dir, SIGNED_SHA256: apk.sha, ...over })
const publish = (env: Record<string, string | undefined>, fake: Fake) => run(['publish'], env, fake)
const deleteLine = (id: number) => `gh api -X DELETE repos/${REPO}/releases/assets/${id}`

/** A bulk of other releases and assets, so the wanted entries sit beyond the first server page. */
const filler = (count: number, from = 100): FakeRelease[] => Array.from({ length: count }, (_, i) => release(from + i, { tag_name: `v9.9.${i}`, draft: false }))
const fillerAssets = (count: number): FakeAsset[] => Array.from({ length: count }, (_, i) => asset(500 + i, `RisuTanium_${VERSION}_installer_${i}.msi`))

// ---------------------------------------------------------------- T1
describe('T1: release-check, Android on', () => {
  test('a clean tag passes and prints the one success line', async () => {
    const fake = new Fake([release(1, { tag_name: 'v0.1.0', draft: false })])
    const r = await check(baseEnv(), fake)
    expect(r.code, r.text).toBe(0)
    expect(r.lines).toEqual([`release-check: v${VERSION}: no conflicting release (Android on).`])
  })
  test('a draft of this commit without Android assets passes, even with many other assets', async () => {
    const fake = new Fake([release(1, { assets: [...fillerAssets(45), asset(7, 'latest.json')] })])
    expect((await check(baseEnv(), fake)).code).toBe(0)
  })
  test('C3: a published release of the tag is refused with its id', async () => {
    const r = await check(baseEnv(), new Fake([release(41, { draft: false })]))
    expect(r.code).toBe(1)
    expect(r.text).toContain('already published (release id 41)')
  })
  test('C3 reads every page: the published release sits on page 3', async () => {
    const r = await check(baseEnv(), new Fake([...filler(70), release(42, { draft: false })]))
    expect(r.code).toBe(1)
    expect(r.text).toContain('release id 42')
  })
  test('C4: a draft from another commit is refused by id', async () => {
    const r = await check(baseEnv(), new Fake([release(5, { target_commitish: OTHER })]))
    expect(r.code).toBe(1)
    expect(r.text).toContain('another commit exists (release id 5)')
  })
  test('C5: two drafts of this commit are refused with both ids', async () => {
    const r = await check(baseEnv(), new Fake([release(5), release(6)]))
    expect(r.code).toBe(1)
    expect(r.text).toContain('2 drafts of v0.2.0 from this commit exist (release ids 5, 6)')
  })
  test.each([
    ['the APK', [APK], [9001]],
    ['the description', [JSON_NAME], [9002]],
    ['both', [APK, JSON_NAME], [9001, 9002]],
  ])('C6: a draft of this commit holding %s is refused with the delete commands', async (_label, names, ids) => {
    const assets = names.map((name, i) => asset(ids[i], name))
    const fake = new Fake([release(5, { assets })])
    const r = await check(baseEnv(), fake)
    expect(r.code).toBe(1)
    expect(r.lines.filter(l => l.startsWith('gh api'))).toEqual(ids.map(deleteLine))
    expect(fake.uploads).toHaveLength(0)
  })
  test('C6 reads the paged asset list: the APK is on page 2, never in the embedded list', async () => {
    const fake = new Fake([release(5, { assets: [...fillerAssets(40), asset(9100, APK)] })])
    const r = await check(baseEnv(), fake)
    expect(r.code).toBe(1)
    expect(r.lines).toContain(deleteLine(9100))
    expect(fake.calls.filter(c => c.kind === 'assets').length).toBeGreaterThanOrEqual(2)
  })
  test('C1: a non-main ref or another repository is refused before any API call', async () => {
    for (const over of [{ GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REF: 'refs/tags/v0.2.0' }, { GITHUB_REPOSITORY: 'someone/RisuTanium' }]) {
      const fake = new Fake([])
      const r = await check(baseEnv(over), fake)
      expect(r.code, JSON.stringify(over)).toBe(1)
      expect(r.text).toContain('runs only from the main branch')
      expect(fake.calls).toHaveLength(0)
    }
  })
  test('C0: a version outside the release rule is refused with the fixed text', async () => {
    for (const version of ['0.1000.0', '01.2.3', 'x', '0.2']) {
      const fake = new Fake([])
      const r = await check(baseEnv(), fake, version)
      expect(r.code, version).toBe(1)
      expect(r.text).toContain('version must be MAJOR.MINOR.PATCH')
      expect(fake.calls).toHaveLength(0)
    }
  })
  test('C2: notes that do not fit latest-android.json are refused before any API call', async () => {
    const fake = new Fake([])
    const r = await check(baseEnv({ RELEASE_NOTES: 'x'.repeat(262144) }), fake)
    expect(r.code).toBe(1)
    expect(r.text).toContain('release notes are too long for latest-android.json')
    expect(fake.calls).toHaveLength(0)
    expect((await check(baseEnv({ RELEASE_NOTES: 'x'.repeat(200000) }), new Fake([]))).code).toBe(0)
  })
  test('a malformed commit id is refused', async () => {
    for (const sha of ['', 'A'.repeat(40), 'a'.repeat(39), undefined]) {
      expect((await check(baseEnv({ GITHUB_SHA: sha }), new Fake([]))).code, String(sha)).toBe(1)
    }
  })
  test('strict mode: only the exact words true and false are accepted', async () => {
    for (const mode of ['', 'True', 'TRUE', '1', 'yes', 'false ', undefined]) {
      const fake = new Fake([])
      const r = await check(baseEnv({ INCLUDE_ANDROID: mode }), fake)
      expect(r.code, String(mode)).toBe(1)
      expect(r.text).toContain('INCLUDE_ANDROID must be exactly true or false')
      expect(fake.calls).toHaveLength(0)
    }
  })
  test('the API failing or answering in a strange shape fails closed', async () => {
    const broken = new Fake([])
    broken.api = async () => ({ status: 500, body: null })
    expect((await check(baseEnv(), broken)).code).toBe(1)
    const odd = new Fake([])
    odd.api = async () => ({ status: 200, body: { not: 'a list' } })
    expect((await check(baseEnv(), odd)).code).toBe(1)
    const bad = new Fake([])
    bad.api = async () => ({ status: 200, body: [{ tag_name: `v${VERSION}`, id: 'x', draft: true, target_commitish: SHA }] })
    expect((await check(baseEnv(), bad)).code).toBe(1)
  })
  test('too many releases are refused instead of silently ignored', async () => {
    const r = await check(baseEnv(), new Fake(filler(400)))
    expect(r.code).toBe(1)
    expect(r.text).toContain('more releases or assets than this script checks')
  })
})

describe('T1: release-check, Android off', () => {
  const off = (over: Record<string, string | undefined> = {}) => baseEnv({ INCLUDE_ANDROID: 'false', ...over })
  test('a clean tag passes; a published release or a non-main ref does not matter', async () => {
    const r = await check(off({ GITHUB_REF: 'refs/heads/feature' }), new Fake([release(1, { draft: false })]))
    expect(r.code, r.text).toBe(0)
    expect(r.lines).toEqual([`release-check: v${VERSION}: no conflicting release (Android off).`])
  })
  test('C7: a draft from another commit holding an APK or the description is refused', async () => {
    for (const name of [APK, 'hand-attached.APK', JSON_NAME]) {
      const r = await check(off(), new Fake([release(5, { target_commitish: OTHER, assets: [asset(9100, name)] })]))
      expect(r.code, name).toBe(1)
      expect(r.text).toContain('release id 5')
      expect(r.text).toContain('asset id 9100')
    }
  })
  test('C7 reads the paged asset list: the APK is on page 2', async () => {
    const r = await check(off(), new Fake([release(5, { target_commitish: OTHER, assets: [...fillerAssets(40), asset(9100, APK)] })]))
    expect(r.code).toBe(1)
  })
  test('a draft from another commit without Android files passes; so does this commit\'s draft with one', async () => {
    const fake = new Fake([release(5, { target_commitish: OTHER, assets: fillerAssets(5) }), release(6, { assets: [asset(9100, APK)] })])
    expect((await check(off(), fake)).code).toBe(0)
  })
  test('C0\': an unusable version is refused without the Android rule', async () => {
    expect((await check(off(), new Fake([]), '1.2')).code).toBe(0)
    expect((await check(off(), new Fake([]), 'v 1')).code).toBe(1)
    expect((await check(off(), new Fake([]), 'a'.repeat(65))).code).toBe(1)
  })
})

// ---------------------------------------------------------------- T2, T3
describe('T2: latest-android.json bytes', () => {
  const notes = 'line one\r\n"quoted" ::error::x ${{ y }} é☃'
  test('exact bytes, key order and trailing newline', () => {
    const text = buildLatestJson({ version: VERSION, code: 2000, notes, size: 1234 })
    const expected = `${JSON.stringify({
      version: VERSION,
      versionCode: 2000,
      notes,
      url: `https://github.com/${REPO}/releases/download/v${VERSION}/RisuTanium_${VERSION}_android-universal.apk`,
      size: 1234,
    })}\n`
    expect(text).toBe(expected)
    expect(text.startsWith('{"version":"0.2.0","versionCode":2000,"notes":"line one\\r\\n\\"quoted\\"')).toBe(true)
    expect(text.endsWith(',"size":1234}\n')).toBe(true)
    expect(Object.keys(JSON.parse(text))).toEqual(['version', 'versionCode', 'notes', 'url', 'size'])
  })
  test('the client parser accepts it and returns the same values', () => {
    const { version, code } = releaseVersion(JSON.stringify({ version: '1.2.3' }), contractText)
    expect(code).toBe(1002003)
    const parsed = parseAndroidRelease(buildLatestJson({ version, code, notes, size: 280_000_000 }))
    expect(parsed).toEqual({ version: '1.2.3', versionCode: 1002003, notes, url: apkUrl('1.2.3'), size: 280_000_000 })
  })
  test('the version code is the one the release rule computes', () => {
    for (const version of ['0.2.0', '1.2.3', '0.999.999']) {
      const code = releaseVersion(JSON.stringify({ version }), contractText).code
      const parsed = parseAndroidRelease(buildLatestJson({ version, code, notes: '', size: 5 }))
      expect(parsed?.versionCode).toBe(code)
      const [major, minor, patch] = version.split('.').map(Number)
      expect(code).toBe(major * 1000000 + minor * 1000 + patch)
    }
  })
  test('size and byte limits', () => {
    for (const size of [0, -1, 2000000001, 1.5, Number.NaN]) expect(() => buildLatestJson({ version: VERSION, code: 2000, notes: '', size }), String(size)).toThrow()
    expect(() => buildLatestJson({ version: VERSION, code: 2000, notes: 'x'.repeat(262144), size: 5 })).toThrow()
    expect(Buffer.byteLength(buildLatestJson({ version: VERSION, code: 2000, notes: '☃'.repeat(80000), size: 5 }))).toBeLessThanOrEqual(262144)
    expect(() => buildLatestJson({ version: VERSION, code: 2000, notes: '☃'.repeat(90000), size: 5 })).toThrow()
  })
})

describe('T3: the APK URL', () => {
  test('equals the shared fixture row for the same version and file name', () => {
    const accepted = urlsText.split('\n').filter(l => l.startsWith('accept ')).map(l => l.slice(7).trim())
    expect(accepted).toContain(apkUrl(VERSION))
    expect(apkUrl(VERSION)).toBe(`https://github.com/${REPO}/releases/download/v0.2.0/RisuTanium_0.2.0_android-universal.apk`)
    expect(apkUrl('1.2.3')).toBe(`https://github.com/${REPO}/releases/download/v1.2.3/RisuTanium_1.2.3_android-universal.apk`)
  })
})

// ---------------------------------------------------------------- T4
describe('T4: publish order and content', () => {
  test('lists, checks the release and its assets, uploads the APK, then the description, then checks again', async () => {
    const apk = makeApk('apk-bytes-1')
    const fake = new Fake([release(5), release(1, { tag_name: 'v0.1.0', draft: false })])
    const r = await publish(publishEnv(apk, { RELEASE_NOTES: 'Fixes\nand "more"' }), fake)
    expect(r.code, r.text).toBe(0)
    expect(fake.kinds()).toEqual(['list', 'list', 'get', 'assets', 'upload:apk', 'upload:json', 'get'])
    const [first, second] = fake.uploads
    expect(first.url).toBe(`https://uploads.github.com/repos/${REPO}/releases/5/assets?name=${APK}`)
    expect(first.contentType).toBe('application/vnd.android.package-archive')
    expect(first.body?.toString()).toBe('apk-bytes-1')
    expect(second.contentType).toBe('application/json')
    expect(second.body?.toString('utf8')).toBe(buildLatestJson({ version: VERSION, code: 2000, notes: 'Fixes\nand "more"', size: apk.size }))
    expect(parseAndroidRelease(second.body?.toString('utf8') ?? '')).toMatchObject({ size: apk.size, versionCode: 2000, notes: 'Fixes\nand "more"' })
    expect(r.lines).toEqual([`publish: attached ${APK} (asset id 9000, ${apk.size} bytes) and ${JSON_NAME} (asset id 9001) to draft release id 5 of v${VERSION}.`])
  })
  test('the description carries the size of the file, not of the text or the artifact', async () => {
    const apk = makeApk(Buffer.alloc(12345, 7))
    const fake = new Fake([release(5)])
    expect((await publish(publishEnv(apk), fake)).code).toBe(0)
    expect(parseAndroidRelease(fake.uploads[1].body?.toString('utf8') ?? '')?.size).toBe(12345)
  })
  test('the description is built before any API call: notes that do not fit refuse with no request', async () => {
    const apk = makeApk()
    const fake = new Fake([release(5)])
    const r = await publish(publishEnv(apk, { RELEASE_NOTES: 'x'.repeat(262144) }), fake)
    expect(r.code).toBe(1)
    expect(fake.calls).toHaveLength(0)
  })
  test('other environment mistakes are refused before any API call', async () => {
    const apk = makeApk()
    for (const over of [{ GITHUB_REPOSITORY: 'someone/RisuTanium' }, { GITHUB_SHA: 'xyz' }, { SIGNED_SHA256: 'A'.repeat(64) }, { SIGNED_SHA256: undefined }, { APK_DIR: undefined }]) {
      const fake = new Fake([release(5)])
      expect((await publish(publishEnv(apk, over), fake)).code, JSON.stringify(over)).toBe(1)
      expect(fake.calls).toHaveLength(0)
    }
  })
  test('the CLI takes exactly check or publish', async () => {
    const fake = new Fake([])
    for (const argv of [[], ['other'], ['check', 'extra'], ['delete']]) expect((await run(argv, baseEnv(), fake)).code).toBe(2)
    expect(fake.calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------- T5
describe('T5: the draft choice', () => {
  const refusedNoUpload = async (releases: FakeRelease[], fragment: string) => {
    const fake = new Fake(releases)
    const r = await publish(publishEnv(makeApk()), fake)
    expect(r.code, r.text).toBe(1)
    expect(r.text).toContain(fragment)
    expect(fake.uploads).toHaveLength(0)
  }
  test('a race: two drafts of this commit name both ids and upload nothing', () => refusedNoUpload([release(5), release(6)], 'race detected, 2 drafts of v0.2.0 from this commit (release ids 5, 6)'))
  test('no draft of this commit', () => refusedNoUpload([release(1, { tag_name: 'v0.1.0' })], 'there is no draft'))
  test('the tag is already published', () => refusedNoUpload([release(5), release(9, { draft: false })], 'already published (release id 9)'))
  test('a draft of another commit next to this one', () => refusedNoUpload([release(5), release(6, { target_commitish: OTHER })], 'another commit exists (release id 6)'))
  test('only another commit\'s draft exists: it is never chosen', () => refusedNoUpload([release(6, { target_commitish: OTHER })], 'another commit exists'))
  test('selectDraft chooses by target commit, not by position', () => {
    const list = tagReleases([release(6, { target_commitish: OTHER }), release(7)], `v${VERSION}`).filter(r => r.id === 7)
    expect(selectDraft(list, SHA, VERSION).id).toBe(7)
  })
  test('the draft is found on a later page of the release list', async () => {
    const apk = makeApk()
    const fake = new Fake([...filler(65), release(5)])
    expect((await publish(publishEnv(apk), fake)).code).toBe(0)
    expect(fake.uploads[0].url).toContain('/releases/5/assets')
  })
})

// ---------------------------------------------------------------- T6
describe('T6: a re-run over existing Android assets uploads nothing and prints the delete commands', () => {
  test.each([
    ['the APK', [APK], [9001]],
    ['the description', [JSON_NAME], [9002]],
    ['both', [APK, JSON_NAME], [9001, 9002]],
  ])('%s', async (_label, names, ids) => {
    const fake = new Fake([release(5, { assets: [asset(77, 'latest.json'), ...names.map((name, i) => asset(ids[i], name))] })])
    const r = await publish(publishEnv(makeApk()), fake)
    expect(r.code).toBe(1)
    expect(r.lines.slice(1)).toEqual(ids.map(deleteLine))
    expect(r.lines).toHaveLength(1 + ids.length)
    expect(fake.uploads).toHaveLength(0)
  })
  test('an asset beyond the first page is still found', async () => {
    const fake = new Fake([release(5, { assets: [...fillerAssets(40), asset(9100, JSON_NAME)] })])
    const r = await publish(publishEnv(makeApk()), fake)
    expect(r.code).toBe(1)
    expect(r.lines).toContain(deleteLine(9100))
    expect(fake.uploads).toHaveLength(0)
  })
  test('deleteCommands is one line per asset id and names no tag', () => {
    expect(deleteCommands([{ id: 3, name: 'x' }])).toEqual(['gh api -X DELETE repos/yor42/RisuTanium/releases/assets/3'])
  })
})

// ---------------------------------------------------------------- T7
describe('T7: the file rules', () => {
  const noCalls = async (env: Record<string, string | undefined>) => {
    const fake = new Fake([release(5)])
    const r = await publish(env, fake)
    expect(r.code, r.text).toBe(1)
    expect(fake.calls).toHaveLength(0)
    return r
  }
  test('a different hash is refused before any API call', async () => {
    const apk = makeApk('one')
    expect((await noCalls(publishEnv(apk, { SIGNED_SHA256: sha256('two') }))).text).toContain('not the file that the signing job reported')
  })
  test('two files, a wrong name, a folder and an empty file are refused', async () => {
    const two = makeApk()
    writeFileSync(path.join(two.dir, 'extra.apk'), 'x')
    await noCalls(publishEnv(two))
    const named = makeApk()
    const wrong = path.join(named.dir, 'wrong')
    mkdirSync(wrong)
    writeFileSync(path.join(wrong, 'other.apk'), 'x')
    await noCalls(publishEnv(named, { APK_DIR: wrong }))
    const dirApk = mkdtempSync(path.join(os.tmpdir(), 'risu590-pub-'))
    scratch.push(dirApk)
    mkdirSync(path.join(dirApk, 'app-release.apk'))
    await noCalls(publishEnv({ dir: dirApk, sha: sha256('') }))
    const empty = makeApk('')
    await noCalls(publishEnv(empty))
  })
  test('a linked file is refused', async ctx => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'risu590-pub-'))
    scratch.push(dir)
    const target = path.join(dir, 'target.apk')
    writeFileSync(target, 'bytes')
    const folder = path.join(dir, 'in')
    mkdirSync(folder)
    try {
      symlinkSync(target, path.join(folder, 'app-release.apk'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM' && !process.env.CI) {
        ctx.skip()
        return
      }
      throw error
    }
    await noCalls(publishEnv({ dir: folder, sha: sha256('bytes') }))
  })
})

// ---------------------------------------------------------------- T8
describe('T8: the upload answers', () => {
  const uploadWith = async (reply: (name: string, body: Buffer) => Reply | null) => {
    const fake = new Fake([release(5)])
    fake.uploadReply = reply
    const r = await publish(publishEnv(makeApk('apk-bytes-8')), fake)
    return { fake, r }
  }
  const good = (name: string, body: Buffer, over: Partial<FakeAsset> = {}, status = 201): Reply => ({
    status,
    body: asset(9500, name, { size: body.length, digest: `sha256:${sha256(body)}`, ...over }),
  })
  test('a null digest passes', async () => {
    const { r } = await uploadWith((name, body) => good(name, body, { digest: null }))
    expect(r.code, r.text).toBe(0)
  })
  test.each([
    ['a wrong digest', (name: string, body: Buffer) => good(name, body, { digest: `sha256:${'0'.repeat(64)}` })],
    ['a wrong size', (name: string, body: Buffer) => good(name, body, { size: body.length + 1 })],
    ['a state other than uploaded', (name: string, body: Buffer) => good(name, body, { state: 'starter' })],
    ['a different name', (name: string, body: Buffer) => good(`${name}.x`, body)],
    ['status 200', (name: string, body: Buffer) => good(name, body, {}, 200)],
    ['status 422', () => ({ status: 422, body: { message: 'x' } })],
  ])('%s after the APK stops everything: no description is uploaded', async (_label, reply) => {
    const { fake, r } = await uploadWith(reply)
    expect(r.code).toBe(1)
    expect(r.text).toContain('did not confirm the upload')
    expect(fake.uploads).toHaveLength(1)
  })
  test('a bad answer for the description is refused after the APK went up', async () => {
    const { fake, r } = await uploadWith((name, body) => (name === JSON_NAME ? good(name, body, { size: 1 }) : null))
    expect(r.code).toBe(1)
    expect(fake.uploads).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- T9
describe('T9: the release and its upload address', () => {
  const refusedAt = async (mutate: (r: FakeRelease) => FakeRelease, fragment = 'the draft changed or does not match') => {
    const fake = new Fake([release(5)])
    fake.getReply = (_id, _count, current) => mutate({ ...current })
    const r = await publish(publishEnv(makeApk()), fake)
    expect(r.code, r.text).toBe(1)
    expect(r.text).toContain(fragment)
    expect(fake.uploads).toHaveLength(0)
  }
  test('an upload address for another release id or another host is refused', async () => {
    await refusedAt(r => ({ ...r, upload_url: uploadUrl(6) }))
    await refusedAt(r => ({ ...r, upload_url: uploadUrl(5).replace('uploads.github.com', 'uploads.example.org') }))
    await refusedAt(r => ({ ...r, upload_url: `${uploadUrl(5)}?x=1` }))
  })
  test('the fetched release must be this draft: id, draft flag, tag and commit', async () => {
    await refusedAt(r => ({ ...r, id: 6 }))
    await refusedAt(r => ({ ...r, draft: false }))
    await refusedAt(r => ({ ...r, tag_name: 'v0.3.0' }))
    await refusedAt(r => ({ ...r, target_commitish: OTHER }))
  })
  test('a release that is published or moved while uploading is refused at the end', async () => {
    for (const mutate of [(r: FakeRelease) => ({ ...r, draft: false }), (r: FakeRelease) => ({ ...r, target_commitish: OTHER })]) {
      const fake = new Fake([release(5)])
      fake.getReply = (_id, count, current) => (count >= 2 ? mutate({ ...current }) : current)
      const r = await publish(publishEnv(makeApk()), fake)
      expect(r.code).toBe(1)
      expect(r.text).toContain('changed during the upload')
      expect(fake.uploads).toHaveLength(2)
    }
  })
})

// ---------------------------------------------------------------- T10
describe('T10: log hygiene', () => {
  test('notes and API strings never reach the log, in any outcome', async () => {
    const apk = makeApk()
    const hostile = '::error::pwned-by-api\nx.apk'
    const outcomes = [
      await publish(publishEnv(apk, { RELEASE_NOTES: MARKER }), new Fake([release(5)])),
      await publish(publishEnv(apk, { RELEASE_NOTES: MARKER }), new Fake([release(5), release(6)])),
      await publish(publishEnv(apk, { RELEASE_NOTES: MARKER }), new Fake([release(5, { assets: [asset(9, APK)] })])),
      await check(baseEnv({ RELEASE_NOTES: MARKER }), new Fake([release(5, { assets: [asset(9, APK)] })])),
      await check(baseEnv({ RELEASE_NOTES: MARKER + 'x'.repeat(300000) }), new Fake([])),
      await check(baseEnv({ INCLUDE_ANDROID: 'false', RELEASE_NOTES: MARKER }), new Fake([release(5, { target_commitish: OTHER, assets: [asset(9, hostile)] })])),
      await check(baseEnv({ RELEASE_NOTES: MARKER }), new Fake([release(5, { draft: false, target_commitish: `${OTHER}\n::error::pwned-by-api` })])),
    ]
    for (const outcome of outcomes) {
      expect(outcome.text).not.toContain('NOTES-MARKER')
      expect(outcome.text).not.toContain('pwned-by-api')
      expect(outcome.text).not.toContain('secrets.X')
    }
    expect(outcomes.map(o => o.code)).toEqual([0, 1, 1, 1, 1, 1, 1])
  })
})

// ---------------------------------------------------------------- T11
describe('T11: the real API function and the source', () => {
  const source = readFileSync(path.join(here, 'androidPublish.mjs'), 'utf8')
  afterEach(() => vi.unstubAllGlobals())

  test('the source names no write verb besides POST and runs no child process', () => {
    expect(source).not.toMatch(/['"`](DELETE|PATCH|PUT)['"`]/)
    expect(source).not.toMatch(/child_process|spawn|exec\(/)
    expect(source).toMatch(/method !== 'GET' && method !== 'POST'/)
    expect(source).toContain("redirect: 'error'")
  })
  test('githubApi refuses other verbs and other hosts without calling fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const api = githubApi('token-value')
    for (const [method, url] of [
      ['DELETE', `https://api.github.com/repos/${REPO}/releases/assets/1`],
      ['PATCH', `https://api.github.com/repos/${REPO}/releases/1`],
      ['PUT', `https://api.github.com/repos/${REPO}/releases/1`],
      ['GET', 'https://example.org/x'],
      ['GET', 'http://api.github.com/x'],
    ]) {
      await expect(api({ method, url }), `${method} ${url}`).rejects.toBeDefined()
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
  test('githubApi sends the token, no redirect following, and returns status and parsed body only for 200 and 201', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([{ id: 1 }]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const answer = await githubApi('token-value')({ method: 'GET', url: `https://api.github.com/repos/${REPO}/releases` })
    expect(answer).toEqual({ status: 200, body: [{ id: 1 }] })
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(init.redirect).toBe('error')
    expect(init.method).toBe('GET')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-value')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>secret text</html>', { status: 404 })))
    expect(await githubApi('t')({ method: 'GET', url: `https://api.github.com/repos/${REPO}/releases` })).toEqual({ status: 404, body: null })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('boom with secret text'))))
    await expect(githubApi('t')({ method: 'GET', url: `https://api.github.com/repos/${REPO}/releases` })).rejects.toMatchObject({ line: expect.not.stringContaining('secret') })
  })
  test('without a token the CLI refuses with fixed text', async () => {
    const lines: string[] = []
    const code = await main(['check'], baseEnv() as NodeJS.ProcessEnv, l => lines.push(l), { readConf: readConf() })
    expect(code).toBe(1)
    expect(lines.join('\n')).toContain('the GitHub token is missing')
  })
  test('name helpers', () => {
    expect(androidAssetNames('1.2.3')).toEqual(['RisuTanium_1.2.3_android-universal.apk', 'latest-android.json'])
    expect([isAndroidAsset('x.apk'), isAndroidAsset('X.APK'), isAndroidAsset('latest-android.json'), isAndroidAsset('latest.json'), isAndroidAsset('x.apk.sig')]).toEqual([true, true, true, false, false])
  })
})
