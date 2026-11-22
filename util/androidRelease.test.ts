// @vitest-environment node
/**
 * util/androidRelease.mjs (#590 S1): the dispatch guard and the identity rules applied to an unsigned and a signed
 * APK. Rule tests use real `aapt2 dump xmltree` output captured from synthetic manifests (the fixture JSON), ZIP bytes
 * built here, and an injected tool runner, so they need no SDK. Guard tests run the CLI against an in-process HTTP
 * server with a dummy token. A one-change row changes one thing in a passing input and asserts its rule id; a row for a
 * real failure shape may meet several conditions and proves only that the shape is refused. Every printed line is fixed
 * text, never a value taken from an APK, a tool or an exception.
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { checkLibraries, checkManifestDump, guard, inspect, main, readCentralDirectory, releaseVersion } from './androidRelease.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const contractPath = path.join('src-tauri', 'gen', 'android', 'app', 'src', 'test', 'resources', 'app-update-v1', 'contract.properties')
const contractText = readFileSync(path.join(root, contractPath), 'utf8')
const confText = readFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), 'utf8')

interface FixtureCase {
  status: number
  stdout: string
}
const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures', 'androidReleaseInspect.json'), 'utf8')) as { buildTools: string; aapt2Version: string; cases: Record<string, FixtureCase> }
const dump = (id: string) => fixture.cases[id].stdout
const EXPECT = { version: '0.1.0', code: 1000 }

const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  scratch.push(dir)
  return dir
}

/** The refusal text of a call that must throw, as the script would print it. */
function refusal(fn: () => unknown): string {
  try {
    fn()
  } catch (error) {
    const line = (error as { line?: unknown }).line
    if (typeof line === 'string') return line
    throw error
  }
  throw new Error('expected a refusal')
}
const ruleOf = (line: string) => /^::error::(inspect(?: K\d)?|guard)\b/.exec(line)?.[0].replace('::error::', '')

// ---------------------------------------------------------------- guard: version rule (G-5)

describe('G-5: the version rule', () => {
  const conf = (version: unknown) => JSON.stringify({ version })
  test.each([
    ['0.0.1', 1],
    ['0.1.0', 1000],
    ['2.3.4', 2003004],
    ['2100.0.0', 2100000000],
    ['0.999.999', 999999],
  ])('%s passes with code %d', (version, code) => {
    expect(releaseVersion(conf(version), contractText)).toEqual({ version, code })
  })
  test.each(['0.0.0', '2100.0.1', '0.1000.0', '0.0.1000', '1.2.3-rc.1', '1.2.3+5', '01.2.3', '1.02.3', '1.2.03', '1.2', '1.2.3.4', '', ' 1.2.3', 'v1.2.3', '1.2.3\n', '9999999999.0.0'])('%j is refused', version => {
    expect(refusal(() => releaseVersion(conf(version), contractText))).toMatch(/^::error::guard: src-tauri\/tauri\.conf\.json version must be MAJOR\.MINOR\.PATCH/)
  })
  test('a non-string or missing version, and unreadable JSON, are refused', () => {
    for (const bad of [conf(1), conf(null), '{}', 'not json']) expect(refusal(() => releaseVersion(bad, contractText))).toMatch(/^::error::guard: /)
  })
  test('the real configuration passes with the contract bounds', () => {
    expect(contractText).toMatch(/versionCodeMax=2100000000/)
    const result = releaseVersion(confText, contractText)
    expect(result.code).toBe(Number(result.version.split('.')[0]) * 1000000 + Number(result.version.split('.')[1]) * 1000 + Number(result.version.split('.')[2]))
  })
})

// ---------------------------------------------------------------- guard CLI against a mock API (G-1..G-4)

interface Route {
  status: number
  body: string
  headers?: Record<string, string>
  hang?: boolean
}
const API = '/repos/owner/repo/environments/android-release'
const POLICY_PATH = `${API}/deployment-branch-policies?per_page=100`
const goodEnvironment = (over: object = {}) => JSON.stringify({ name: 'android-release', deployment_branch_policy: { protected_branches: false, custom_branch_policies: true }, ...over })
const goodPolicies = (list: object[] = [{ id: 1, node_id: 'x', name: 'main', type: 'branch' }]) => JSON.stringify({ total_count: list.length, branch_policies: list })

let server: Server
let baseUrl = ''
let routes: Record<string, Route> = {}
let requests: string[] = []
const sockets = new Set<import('node:net').Socket>()
beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(`${req.method} ${req.url}`)
    const route = req.method === 'GET' && req.headers.authorization === 'Bearer dummy-token' ? routes[req.url ?? ''] : undefined
    if (!route) {
      res.writeHead(599).end('unexpected request')
      return
    }
    if (route.hang) return
    res.writeHead(route.status, { 'content-type': 'application/json', ...route.headers }).end(route.body)
  })
  server.on('connection', socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  for (const socket of sockets) socket.destroy()
  await new Promise<void>(resolve => server.close(() => resolve()))
})
const serve = (environment: Route | null, policies: Route | null) => {
  routes = {}
  requests = []
  if (environment) routes[API] = environment
  if (policies) routes[POLICY_PATH] = policies
}
const ok = (body: string): Route => ({ status: 200, body })

/** A copy of the script beside the same two relative files, so it also proves the script has no dependency. */
function scriptCopy(version = '0.1.0'): string {
  const dir = tempDir('risu590-script-')
  mkdirSync(path.join(dir, 'util'), { recursive: true })
  mkdirSync(path.join(dir, 'src-tauri'), { recursive: true })
  mkdirSync(path.dirname(path.join(dir, contractPath)), { recursive: true })
  copyFileSync(path.join(here, 'androidRelease.mjs'), path.join(dir, 'util', 'androidRelease.mjs'))
  writeFileSync(path.join(dir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version }))
  writeFileSync(path.join(dir, contractPath), contractText)
  return path.join(dir, 'util', 'androidRelease.mjs')
}
interface CliResult {
  code: number | null
  out: string
}
/** Spawned asynchronously: the in-process mock server must keep answering while the child runs. */
function runCli(script: string, args: string[], env: Record<string, string>, extra: { cwd?: string; timeoutMs?: number } = {}): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { env, cwd: extra.cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (out += d))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`child timed out: ${out}`))
    }, extra.timeoutMs ?? 20000)
    child.on('close', code => {
      clearTimeout(timer)
      resolve({ code, out })
    })
  })
}
const baseEnv = (): Record<string, string> => (process.platform === 'win32' ? { SYSTEMROOT: process.env.SystemRoot ?? 'C:\\Windows' } : {})
const guardEnv = (over: Record<string, string> = {}): Record<string, string> => ({
  ...baseEnv(),
  GITHUB_REF: 'refs/heads/main',
  ABI: 'aarch64',
  GITHUB_API_URL: baseUrl,
  GITHUB_REPOSITORY: 'owner/repo',
  GITHUB_TOKEN: 'dummy-token',
  REPO_HAS_ANDROID_KEYSTORE_BASE64: 'false',
  REPO_HAS_ANDROID_KEYSTORE_PASSWORD: 'false',
  REPO_HAS_ANDROID_KEY_ALIAS: 'false',
  REPO_HAS_ANDROID_KEY_PASSWORD: 'false',
  REPO_HAS_ANDROID_RELEASE_CERT_SHA256: 'false',
  ...over,
})
const goodApi = () => serve(ok(goodEnvironment()), ok(goodPolicies()))
const guardCli = (env: Record<string, string>) => runCli(scriptCopy(), ['guard'], env)

describe('G-1: ref and ABI', () => {
  test('main passes and asks the API exactly twice', async () => {
    goodApi()
    const r = await guardCli(guardEnv())
    expect(r.code, r.out).toBe(0)
    expect(requests).toEqual([`GET ${API}`, `GET ${POLICY_PATH}`])
  })
  test.each(['refs/heads/feature', 'refs/tags/main', 'refs/heads/main2', 'main', ''])('ref %j is refused before any API call', async ref => {
    goodApi()
    const r = await guardCli(guardEnv({ GITHUB_REF: ref }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('::error::guard: release builds run only from the main branch')
    expect(requests).toEqual([])
  })
  test.each(['x86', '', 'ALL', 'all '])('ABI %j is refused', async abi => {
    goodApi()
    const r = await guardCli(guardEnv({ ABI: abi }))
    expect(r.code).toBe(1)
    expect(r.out).toContain('::error::guard: the ABI must be aarch64 or all.')
    expect(requests).toEqual([])
  })
  test('the all ABI passes', async () => {
    goodApi()
    expect((await guardCli(guardEnv({ ABI: 'all' }))).code).toBe(0)
  })
  test('a version the rule refuses stops the dispatch before any API call', async () => {
    goodApi()
    const r = await runCli(scriptCopy('0.0.0'), ['guard'], guardEnv())
    expect(r.code).toBe(1)
    expect(r.out).toContain('::error::guard: src-tauri/tauri.conf.json version must be')
    expect(requests).toEqual([])
  })
})

describe('G-2: repository-level copies', () => {
  const names = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD', 'ANDROID_RELEASE_CERT_SHA256']
  test.each(names)('%s: true or absent is refused by name', async name => {
    for (const value of ['true', undefined, '', 'False']) {
      goodApi()
      const env = guardEnv()
      if (value === undefined) delete env[`REPO_HAS_${name}`]
      else env[`REPO_HAS_${name}`] = value
      const r = await guardCli(env)
      expect(r.code, `${name}=${String(value)}`).toBe(1)
      expect(r.out).toContain(name)
      expect(r.out).toContain('Delete it at repository level')
      expect(requests).toEqual([])
    }
  })
})

describe('G-3: the API answers', () => {
  test('a mock that serves only the two exact paths proves the paths and the token header', async () => {
    goodApi()
    expect((await guardCli(guardEnv())).code).toBe(0)
    expect(requests.every(r => r.startsWith('GET /repos/owner/repo/environments/android-release'))).toBe(true)
  })
  test.each([
    ['environment 404', { status: 404, body: '{}' }, null],
    ['environment 403', { status: 403, body: '{}' }, null],
    ['environment 500', { status: 500, body: '{}' }, null],
    ['environment bad JSON', ok('not json'), null],
    ['environment empty body', ok(''), null],
    ['environment redirect', { status: 302, body: '', headers: { location: '/elsewhere' } }, null],
    ['policies 404', ok(goodEnvironment()), { status: 404, body: '{}' }],
    ['policies 500', ok(goodEnvironment()), { status: 500, body: '{}' }],
    ['policies bad JSON', ok(goodEnvironment()), ok('not json')],
    ['policies redirect', ok(goodEnvironment()), { status: 301, body: '', headers: { location: '/elsewhere' } }],
  ] as [string, Route, Route | null][])('%s is refused', async (_, environment, policies) => {
    serve(environment, policies)
    const r = await guardCli(guardEnv())
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('::error::guard: environment android-release could not be read')
  })
  const callLine: Record<string, string> = {
    environment: '::error::guard: environment android-release could not be read, or it does not restrict deployments to selected branches',
    policies: '::error::guard: environment android-release could not be read, or its deployment branch rules are not exactly one rule',
  }
  test.each([
    ['environment', 404], ['environment', 403], ['environment', 500],
    ['policies', 404], ['policies', 403], ['policies', 500],
  ] as const)('%s %i with the good body is refused', async (which, status) => {
    if (which === 'environment') serve({ status, body: goodEnvironment() }, ok(goodPolicies()))
    else serve(ok(goodEnvironment()), { status, body: goodPolicies() })
    const r = await guardCli(guardEnv())
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain(callLine[which])
  })
  test.each(['environment', 'policies'] as const)('%s redirect to the good body is refused', async which => {
    const moved: Route = { status: 302, body: '', headers: { location: '/moved' } }
    if (which === 'environment') serve(moved, ok(goodPolicies()))
    else serve(ok(goodEnvironment()), moved)
    routes['/moved'] = ok(which === 'environment' ? goodEnvironment() : goodPolicies())
    const r = await guardCli(guardEnv())
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain(callLine[which])
    expect(requests).not.toContain('GET /moved')
  })
  test('a token the server does not accept is refused', async () => {
    goodApi()
    expect((await guardCli(guardEnv({ GITHUB_TOKEN: 'another-token' }))).code).toBe(1)
  })
  test('a missing API address, repository or token is refused without a request', async () => {
    goodApi()
    for (const key of ['GITHUB_API_URL', 'GITHUB_REPOSITORY', 'GITHUB_TOKEN']) {
      const env = guardEnv()
      delete env[key]
      const r = await guardCli(env)
      expect(r.code, key).toBe(1)
    }
    expect((await guardCli(guardEnv({ GITHUB_REPOSITORY: 'owner/repo/../x' }))).code).toBe(1)
    expect(requests).toEqual([])
  })
  test('a hanging answer is refused when the injected timeout passes, not after 15 seconds', async () => {
    serve({ status: 200, body: '', hang: true }, null)
    const started = Date.now()
    const lines = await guard(guardEnv(), { timeoutMs: 300, config: EXPECT })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('environment android-release could not be read')
    expect(Date.now() - started).toBeLessThan(5000)
  })
  test('the mock refuses a request to any other path, so a mistyped path cannot pass', async () => {
    serve(ok(goodEnvironment()), ok(goodPolicies()))
    const wrong = await fetch(`${baseUrl}/repos/owner/repo/environments/android-releas`, { headers: { Authorization: 'Bearer dummy-token' } })
    expect(wrong.status).toBe(599)
  })
})

describe('G-4: the branch rules are exactly one rule, the branch main', () => {
  const policyCases: [string, string][] = [
    ['zero rules', goodPolicies([])],
    ['two rules', goodPolicies([{ id: 1, name: 'main', type: 'branch' }, { id: 2, name: 'release', type: 'branch' }])],
    ['contains main', goodPolicies([{ id: 1, name: 'main', type: 'branch' }, { id: 2, name: 'main', type: 'branch' }])],
    ['wildcard', goodPolicies([{ id: 1, name: '*', type: 'branch' }])],
    ['main with a wildcard', goodPolicies([{ id: 1, name: 'main*', type: 'branch' }])],
    ['a tag named main', goodPolicies([{ id: 1, name: 'main', type: 'tag' }])],
    ['another branch', goodPolicies([{ id: 1, name: 'develop', type: 'branch' }])],
    ['not a list', JSON.stringify({ branch_policies: 'main' })],
    ['no list', '{}'],
  ]
  test.each(policyCases)('rules: %s', async (_, body) => {
    serve(ok(goodEnvironment()), ok(body))
    const r = await guardCli(guardEnv())
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('its deployment branch rules are not exactly one rule')
  })
  test.each([
    ['null policy', goodEnvironment({ deployment_branch_policy: null })],
    ['protected branches', goodEnvironment({ deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } })],
    ['both on', goodEnvironment({ deployment_branch_policy: { protected_branches: true, custom_branch_policies: true } })],
    ['custom off', goodEnvironment({ deployment_branch_policy: { protected_branches: false, custom_branch_policies: false } })],
    ['no policy key', JSON.stringify({ name: 'android-release' })],
  ])('environment: %s', async (_, body) => {
    serve(ok(body), ok(goodPolicies()))
    const r = await guardCli(guardEnv())
    expect(r.code, r.out).toBe(1)
    expect(r.out).toContain('does not restrict deployments to selected branches')
  })
})

// ---------------------------------------------------------------- manifest rules (IN-1, IN-2)

describe('IN-1: identity rules on captured aapt2 dumps', () => {
  test('the fixture records the tool version', () => {
    expect(fixture.buildTools).toBe('36.0.0')
    expect(fixture.aapt2Version).toMatch(/^Android Asset Packaging Tool \(aapt\) \d/)
    for (const c of Object.values(fixture.cases)) expect(c.status).toBe(0)
  })
  test('a good manifest passes', () => {
    expect(() => checkManifestDump(dump('ok'), EXPECT)).not.toThrow()
  })
  test.each([
    ['codeMajor', 'K1'],
    ['wrongCode', 'K1'],
    ['debugLiteral', 'K2'],
    ['testOnlyLiteral', 'K2'],
    ['debugRefTrue', 'K2'],
    ['debugRefConfig', 'K2'],
    ['dbg_v26', 'K2'],
    ['dbg_v10000', 'K2'],
    ['quoteName', 'K3'],
    ['newlineName', 'K3'],
    ['wrongName', 'K3'],
    ['wrongPackage', 'K3'],
    ['split', 'K3'],
    ['packageWithId', 'K3'],
  ])('%s is refused by %s', (id, rule) => {
    const line = refusal(() => checkManifestDump(dump(id), EXPECT))
    expect(ruleOf(line)).toBe(`inspect ${rule}`)
  })
  const selectors: [string, string, string][] = [
    ...['versionCode', '0x0101021b', '0x01010576'].map(t => [t, 'K1', `A: probe ${t}`] as [string, string, string]),
    ...['debuggable', '0x0101000f', 'testOnly', '0x01010272'].map(t => [t, 'K2', `A: probe ${t}`] as [string, string, string]),
    ...['versionName', '0x0101021c'].map(t => [t, 'K3', `A: probe ${t}`] as [string, string, string]),
    ['A: package', 'K3', 'A: packageX'],
    ['A: split', 'K3', 'A: splitX'],
  ]
  test.each(selectors)('selector %s alone is refused by %s', (_, rule, extra) => {
    expect(ruleOf(refusal(() => checkManifestDump(`${dump('ok')}\n${extra}`, EXPECT)))).toBe(`inspect ${rule}`)
  })
  // The three exact identity lines of the good dump. K3 is a key and identity rule: it holds the version name, the
  // package and the split refusals, so each of these one-change rows is needed for the key and identity group.
  describe('the three identity lines', () => {
    const lineOf = (marker: string) => dump('ok').split('\r\n').find(l => l.includes(marker)) as string
    const identity: { name: string; marker: string; rule: string; good: string; longer: string; shorter: string; other: string }[] = [
      { name: 'package', marker: 'A: package=', rule: 'K3', good: 'io.github.yor42.risutanium', longer: 'io.github.yor42.risutanium.debug', shorter: 'io.github.yor42.risutaniu', other: 'io.github.yor42.other' },
      { name: 'version name', marker: 'versionName(0x0101021c)', rule: 'K3', good: '0.1.0', longer: '0.1.0.1', shorter: '0.1', other: '0.1.1' },
      { name: 'version code', marker: 'versionCode(0x0101021b)', rule: 'K1', good: '=1000', longer: '=10000', shorter: '=100', other: '=1001' },
    ]
    test('the good dump passes and holds each identity line once', () => {
      for (const { marker, good } of identity) {
        expect(dump('ok').split('\r\n').filter(l => l.includes(marker))).toHaveLength(1)
        expect(lineOf(marker)).toContain(good)
      }
      expect(() => checkManifestDump(dump('ok'), EXPECT)).not.toThrow()
    })
    const rows = identity.flatMap(i => {
      const edit = (to: string) => dump('ok').replace(lineOf(i.marker), lineOf(i.marker).replaceAll(i.good, to))
      return [
        [i.name, 'a longer value', i.rule, edit(i.longer)],
        [i.name, 'a shorter value', i.rule, edit(i.shorter)],
        [i.name, 'another value', i.rule, edit(i.other)],
        [i.name, 'an absent line', i.rule, dump('ok').replace(`${lineOf(i.marker)}\r\n`, '')],
        [i.name, 'a doubled line', i.rule, dump('ok').replace(lineOf(i.marker), `${lineOf(i.marker)}\r\n${lineOf(i.marker)}`)],
      ] as [string, string, string, string][]
    })
    test.each(rows)('identity line %s: %s is refused by %s', (_line, _change, rule, text) => {
      expect(text).not.toBe(dump('ok'))
      expect(ruleOf(refusal(() => checkManifestDump(text, EXPECT)))).toBe(`inspect ${rule}`)
    })
  })
  test('packageWithId is refused by the package rule alone', () => {
    const text = dump('packageWithId')
    expect(text).not.toContain('versionCodeMajor')
    expect(text).toContain('A: package(0x01010573)=')
    expect(refusal(() => checkManifestDump(text, EXPECT))).toContain('one package line')
  })
  test('a code taken from another version is refused even when the rest is good', () => {
    expect(ruleOf(refusal(() => checkManifestDump(dump('ok'), { version: '0.1.0', code: 1001 })))).toBe('inspect K1')
    expect(ruleOf(refusal(() => checkManifestDump(dump('ok'), { version: '0.1.1', code: 1000 })))).toBe('inspect K3')
  })
  test('the dump is normalised only by LF split, one trailing CR and leading spaces', () => {
    expect(() => checkManifestDump(dump('ok').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), EXPECT)).not.toThrow()
    expect(ruleOf(refusal(() => checkManifestDump(dump('ok').replace('A: package=', 'A:  package=').replace(/\r\n/g, '\n'), EXPECT)))).toBe('inspect K3')
  })
  test('hostile name text is never echoed', () => {
    for (const id of ['quoteName', 'newlineName']) {
      const line = refusal(() => checkManifestDump(dump(id), EXPECT))
      expect(line).not.toContain('not-the-version')
      expect(line).not.toContain('text-chosen-by-the-apk')
    }
  })
})

describe('IN-2: the C18 pair, refused by K1', () => {
  test.each(['c18NameWithoutId', 'c18IdWithOtherName'])('%s', id => {
    expect(ruleOf(refusal(() => checkManifestDump(dump(id), EXPECT)))).toBe('inspect K1')
  })
})

// ---------------------------------------------------------------- bytes (IN-3)

interface ZipOptions {
  eocdComment?: Buffer
  entryCountDelta?: number
  zip64?: boolean
  rawNames?: Buffer[]
  entryComment?: boolean
}
/** A minimal ZIP with stored, empty entries: the rules read only the central directory. */
function zipBytes(names: string[], o: ZipOptions = {}): Buffer {
  const raws = o.rawNames ?? names.map(n => Buffer.from(n, 'latin1'))
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const raw of raws) {
    const local = Buffer.alloc(30 + raw.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(raw.length, 26)
    raw.copy(local, 30)
    const comment = o.entryComment ? Buffer.from('c') : Buffer.alloc(0)
    const entry = Buffer.alloc(46 + raw.length + comment.length)
    entry.writeUInt32LE(0x02014b50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(raw.length, 28)
    entry.writeUInt16LE(comment.length, 32)
    entry.writeUInt32LE(offset, 42)
    raw.copy(entry, 46)
    comment.copy(entry, 46 + raw.length)
    locals.push(local)
    central.push(entry)
    offset += local.length
  }
  const directory = Buffer.concat(central)
  const comment = o.eocdComment ?? Buffer.alloc(0)
  const end = Buffer.alloc(22 + comment.length)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(o.zip64 ? 0xffff : raws.length + (o.entryCountDelta ?? 0), 8)
  end.writeUInt16LE(o.zip64 ? 0xffff : raws.length + (o.entryCountDelta ?? 0), 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(comment.length, 20)
  comment.copy(end, 22)
  return Buffer.concat([...locals, directory, end])
}
const ABIS = { aarch64: ['arm64-v8a'], all: ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'] }
const libs = (abis: string[]) => abis.map(a => `lib/${a}/libalib.so`)
const apkNames = (abis: string[]) => ['AndroidManifest.xml', 'classes.dex', ...libs(abis)]

describe('IN-3: central directory and library rules', () => {
  const check = (bytes: Buffer, abis: string[]) => checkLibraries(readCentralDirectory(bytes), abis)
  test.each(Object.entries(ABIS))('the %s set passes', (_, abis) => {
    expect(() => check(zipBytes(apkNames(abis)), abis)).not.toThrow()
  })
  test('central directory names are returned in order', () => {
    expect(readCentralDirectory(zipBytes(['a', 'b/c']))).toEqual(['a', 'b/c'])
  })
  const changed = (base: Buffer, change: (b: Buffer, end: number) => void) => {
    const b = Buffer.from(base)
    change(b, b.length - 22)
    return b
  }
  const k4Good = zipBytes(apkNames(ABIS.aarch64))
  const k4Empty = zipBytes([])
  test('both K4 bases pass', () => {
    expect(() => readCentralDirectory(k4Good)).not.toThrow()
    expect(() => readCentralDirectory(k4Empty)).not.toThrow()
  })
  const k4: [string, Buffer][] = [
    ['a forged newline entry (aarch64)', zipBytes([...apkNames(ABIS.aarch64), 'x\n::error::forged'])],
    ['a control character in a library name', zipBytes([...apkNames(ABIS.aarch64), 'lib/arm64-v8a/\u0001'])],
    ['a DEL character', zipBytes([...apkNames(ABIS.aarch64), 'a\u007fb'])],
    ['a forged x86 entry beside three real ABIs', zipBytes([...apkNames(['arm64-v8a', 'armeabi-v7a', 'x86_64']), 'lib/x86/\nlibalib.so'])],
    ['a duplicate name', zipBytes([...apkNames(ABIS.aarch64), 'classes.dex'])],
    ['an archive comment', zipBytes(apkNames(ABIS.aarch64), { eocdComment: Buffer.from('c') })],
    ['a ZIP64 marker', zipBytes(apkNames(ABIS.aarch64), { zip64: true })],
    ['a count mismatch', zipBytes(apkNames(ABIS.aarch64), { entryCountDelta: 1 })],
    ['a short count', zipBytes(apkNames(ABIS.aarch64), { entryCountDelta: -1 })],
    ['too few bytes', Buffer.alloc(10)],
    ['no end record', Buffer.alloc(64)],
    ['a comment length without a comment', changed(k4Good, (b, end) => b.writeUInt16LE(1, end + 20))],
    ['a ZIP64 size alone', changed(k4Good, (b, end) => b.writeUInt32LE(0xffffffff, end + 12))],
    ['a flipped end signature', changed(k4Good, (b, end) => b.writeUInt8(b[end] ^ 1, end))],
    ['an offset past the end record', changed(k4Empty, (b, end) => b.writeUInt32LE(1, end + 16))],
  ]
  test.each(k4)('K4 refuses %s', (_, bytes) => {
    expect(ruleOf(refusal(() => readCentralDirectory(bytes)))).toBe('inspect K4')
  })
  test('K4 accepts an entry comment, which the rules ignore', () => {
    expect(() => readCentralDirectory(zipBytes(['a'], { entryComment: true }))).not.toThrow()
  })
  test.each([
    ['a missing ABI', ABIS.all, zipBytes(apkNames(['arm64-v8a', 'armeabi-v7a', 'x86']))],
    ['an extra ABI', ABIS.aarch64, zipBytes(apkNames(['arm64-v8a', 'x86']))],
    ['an extra ABI beside all four', ABIS.all, zipBytes(apkNames([...ABIS.all, 'mips']))],
    ['a folder without libalib.so', ABIS.aarch64, zipBytes(['AndroidManifest.xml', 'lib/arm64-v8a/other.so'])],
    ['no library at all', ABIS.aarch64, zipBytes(['AndroidManifest.xml'])],
    ['a library at the top of lib', ABIS.aarch64, zipBytes([...apkNames(ABIS.aarch64), 'lib/libalib.so'])],
  ] as [string, string[], Buffer][])('K5 refuses %s', (_, abis, bytes) => {
    expect(ruleOf(refusal(() => check(bytes, abis)))).toBe('inspect K5')
  })
})

// ---------------------------------------------------------------- inspect with an injected tool (IN-4, IN-5)

interface ToolResult {
  status: number | null
  signal?: string | null
  error?: Error
  stdout?: string | null
}
function apkFolder(name: string, bytes: Buffer): string {
  const dir = tempDir('risu590-apk-')
  writeFileSync(path.join(dir, name), bytes)
  return dir
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')
const goodApk = zipBytes(apkNames(ABIS.aarch64))
function runInspect(mode: 'unsigned' | 'signed', over: { aapt2?: ToolResult; zipalign?: ToolResult; hash?: string; abi?: string; bytes?: Buffer } = {}) {
  const bytes = over.bytes ?? goodApk
  const dir = apkFolder(mode === 'signed' ? 'app-release.apk' : 'app-unsigned.apk', bytes)
  const calls: string[] = []
  const env: Record<string, string> = { ABI: over.abi ?? 'aarch64', APK_DIR: dir, ANDROID_HOME: path.join(dir, 'sdk') }
  if (mode === 'signed') env.EXPECTED_SHA256 = over.hash ?? sha(bytes)
  const tool = (file: string): ToolResult => {
    calls.push(path.basename(file).replace(/\.exe$/, ''))
    if (calls[calls.length - 1] === 'aapt2') return over.aapt2 ?? { status: 0, stdout: dump('ok') }
    return over.zipalign ?? { status: 0, stdout: '' }
  }
  const outcome = () => inspect(mode, env, { tool: tool as never, config: EXPECT })
  return { calls, outcome }
}

describe('IN-4: signed mode compares the hash first and checks alignment', () => {
  test('unsigned: no zipalign, the hash of the bytes read', () => {
    const run = runInspect('unsigned')
    expect(run.outcome().sha256).toBe(sha(goodApk))
    expect(run.calls).toEqual(['aapt2'])
  })
  test('signed: aapt2 then zipalign, after the hash matched', () => {
    const run = runInspect('signed')
    expect(run.outcome().sha256).toBe(sha(goodApk))
    expect(run.calls).toEqual(['aapt2', 'zipalign'])
  })
  test('signed: both tools get exactly these arguments', () => {
    const dir = apkFolder('app-release.apk', goodApk)
    const home = path.join(dir, '..', 'sdk')
    const seen: [string, string[]][] = []
    const tool = (file: string, args: string[]) => (seen.push([file, args]), { status: 0, stdout: dump('ok') })
    inspect('signed', { ABI: 'aarch64', APK_DIR: dir, ANDROID_HOME: home, EXPECTED_SHA256: sha(goodApk) }, { tool: tool as never, config: EXPECT })
    const bin = (name: string) => path.join(home, 'build-tools', '36.0.0', process.platform === 'win32' ? `${name}.exe` : name)
    const apk = path.join(dir, 'app-release.apk')
    expect(seen).toEqual([
      [bin('aapt2'), ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apk]],
      [bin('zipalign'), ['-c', '-P', '16', '4', apk]],
    ])
  })
  test('signed: a hash other than the reported one is refused before any tool runs', () => {
    const run = runInspect('signed', { hash: 'f'.repeat(64) })
    expect(refusal(run.outcome)).toBe('::error::inspect: the signed file is not the file that sign reported.')
    expect(run.calls).toEqual([])
  })
  test.each(['', 'F'.repeat(64), 'f'.repeat(63), 'f'.repeat(65)])('signed: a malformed expected hash %j is refused', hash => {
    const run = runInspect('signed', { hash })
    expect(ruleOf(refusal(run.outcome))).toBe('inspect')
    expect(run.calls).toEqual([])
  })
  test('signed: a failing zipalign is refused by K6', () => {
    for (const zipalign of [{ status: 1, stdout: '' }, { status: null, signal: 'SIGTERM', stdout: '' }, { status: 0, stdout: null }, { status: null, error: new Error('x') }]) {
      expect(ruleOf(refusal(runInspect('signed', { zipalign }).outcome))).toBe('inspect K6')
    }
  })
  test('unsigned: a file that is not alone, or not regular, or misnamed, is refused', () => {
    const wrongName = apkFolder('app-release.apk', goodApk)
    const calls: string[] = []
    const refused = refusal(() => inspect('unsigned', { ABI: 'aarch64', APK_DIR: wrongName, ANDROID_HOME: 'x' }, { tool: (() => (calls.push('t'), { status: 0, stdout: dump('ok') })) as never, config: EXPECT }))
    expect(refused).toContain('exactly one regular file, app-unsigned.apk')
    const two = apkFolder('app-unsigned.apk', goodApk)
    writeFileSync(path.join(two, 'extra'), 'x')
    expect(refusal(() => inspect('unsigned', { ABI: 'aarch64', APK_DIR: two, ANDROID_HOME: 'x' }, { tool: (() => ({ status: 0, stdout: dump('ok') })) as never, config: EXPECT }))).toContain('exactly one regular file')
    const directory = tempDir('risu590-apk-')
    mkdirSync(path.join(directory, 'app-unsigned.apk'))
    expect(refusal(() => inspect('unsigned', { ABI: 'aarch64', APK_DIR: directory, ANDROID_HOME: 'x' }, { tool: (() => (calls.push('t'), { status: 0, stdout: dump('ok') })) as never, config: EXPECT }))).toBe('::error::inspect: the folder must hold exactly one regular file, app-unsigned.apk.')
    expect(calls).toEqual([])
  })
  test('unsigned: a linked file is refused', ctx => {
    const target = path.join(apkFolder('app-unsigned.apk', goodApk), 'app-unsigned.apk')
    const dir = tempDir('risu590-apk-')
    try {
      symlinkSync(target, path.join(dir, 'app-unsigned.apk'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EPERM' && !process.env.CI) {
        ctx.skip()
        return
      }
      throw error
    }
    expect(refusal(() => inspect('unsigned', { ABI: 'aarch64', APK_DIR: dir, ANDROID_HOME: 'x' }, { tool: (() => ({ status: 0, stdout: dump('ok') })) as never, config: EXPECT }))).toBe('::error::inspect: the folder must hold exactly one regular file, app-unsigned.apk.')
  })
  test('an unknown ABI or mode is refused', () => {
    expect(ruleOf(refusal(runInspect('unsigned', { abi: 'x86' }).outcome))).toBe('inspect')
    expect(() => inspect('both' as never, {}, { config: EXPECT })).toThrow()
  })
})

describe('IN-5: a tool failure refuses even with good output', () => {
  const failures: [string, ToolResult][] = [
    ['missing', { status: null, error: new Error('spawn ENOENT') }],
    ['timed out', { status: null, signal: 'SIGTERM', stdout: dump('ok') }],
    ['non-zero with good stdout', { status: 1, stdout: dump('ok') }],
    ['no stdout', { status: 0, stdout: null }],
    ['over the output limit', { status: null, error: new Error('ENOBUFS'), stdout: dump('ok') }],
    ['exit 0 with an error', { status: 0, error: new Error('x'), stdout: dump('ok') }],
    ['exit 0 with a signal', { status: 0, signal: 'SIGTERM', stdout: dump('ok') }],
  ]
  test.each(failures)('aapt2 %s', (_, aapt2) => {
    expect(ruleOf(refusal(runInspect('unsigned', { aapt2 }).outcome))).toBe('inspect K0')
  })
})

// ---------------------------------------------------------------- spawned CLI with a fake aapt2 (IN-5, IN-6)

/** A fake aapt2: on Windows a copy of node.exe that a preload turns into the recorder, elsewhere a shell script. */
function fakeSdk(root_: string, stdout: string, status: number, stderr = ''): Record<string, string> {
  const dir = path.join(root_, 'sdk', 'build-tools', '36.0.0')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(root_, 'fake.out'), stdout, 'latin1')
  writeFileSync(path.join(root_, 'fake.err'), stderr, 'latin1')
  const env: Record<string, string> = { ANDROID_HOME: path.join(root_, 'sdk'), FAKE_OUT: path.join(root_, 'fake.out'), FAKE_ERR: path.join(root_, 'fake.err'), FAKE_STATUS: String(status) }
  if (process.platform === 'win32') {
    copyFileSync(process.execPath, path.join(dir, 'aapt2.exe'))
    writeFileSync(
      path.join(root_, 'preload.cjs'),
      `const fs = require('node:fs'); const path = require('node:path')
if (/^aapt2/i.test(path.basename(process.execPath))) {
  fs.writeSync(1, fs.readFileSync(process.env.FAKE_OUT))
  fs.writeSync(2, fs.readFileSync(process.env.FAKE_ERR))
  process.exit(Number(process.env.FAKE_STATUS))
}
`,
    )
    env.NODE_OPTIONS = `--require ${JSON.stringify(path.join(root_, 'preload.cjs').replace(/\\/g, '/'))}`
  } else {
    writeFileSync(path.join(dir, 'aapt2'), '#!/bin/sh\ncat "$FAKE_OUT"; cat "$FAKE_ERR" >&2; exit "$FAKE_STATUS"\n', { mode: 0o755 })
  }
  return env
}
async function inspectCli(options: { stdout: string; status: number; stderr?: string; bytes?: Buffer; sdk?: boolean }) {
  const dir = tempDir('risu590-cli-')
  const apkDir = path.join(dir, 'apk')
  mkdirSync(apkDir)
  writeFileSync(path.join(apkDir, 'app-unsigned.apk'), options.bytes ?? goodApk)
  const output = path.join(dir, 'github-output')
  writeFileSync(output, '')
  const sdkEnv = options.sdk === false ? { ANDROID_HOME: path.join(dir, 'empty-sdk') } : fakeSdk(dir, options.stdout, options.status, options.stderr)
  const r = await runCli(scriptCopy(), ['inspect', 'unsigned'], { ...baseEnv(), ABI: 'aarch64', APK_DIR: apkDir, GITHUB_OUTPUT: output, ...sdkEnv })
  return { ...r, output: readFileSync(output, 'utf8') }
}
const startsWithCommand = (out: string) => out.split(/\r?\n/).filter(l => l.startsWith('::'))

describe('the spawned CLI', () => {
  test('a good build passes and reports its hash', async () => {
    const r = await inspectCli({ stdout: dump('ok'), status: 0 })
    expect(r.code, r.out).toBe(0)
    expect(r.output).toBe(`sha256=${sha(goodApk)}\n`)
    expect(r.out).toContain(`sha256=${sha(goodApk)}`)
  })
  test.each([
    ['aapt2 missing', { stdout: '', status: 0, sdk: false }],
    ['aapt2 non-zero with good stdout', { stdout: dump('ok'), status: 1 }],
  ])('IN-5 %s: refused by K0 and no hash is written', async (_, options) => {
    const r = await inspectCli(options)
    expect(r.code).toBe(1)
    expect(r.out).toContain('::error::inspect K0:')
    expect(r.output).toBe('')
  })
  test('a rule refusal writes no hash either', async () => {
    const r = await inspectCli({ stdout: dump('codeMajor'), status: 0 })
    expect(r.code).toBe(1)
    expect(r.out).toContain('::error::inspect K1:')
    expect(r.output).toBe('')
  })
})

describe('the CLI run through a directory link', () => {
  test.each([
    [['guard'], 1],
    [['inspect', 'signed'], 1],
    [['bogus'], 2],
  ])('%j still runs and exits %i', async (args, code) => {
    const script = scriptCopy()
    const copyRoot = path.dirname(path.dirname(script))
    const link = path.join(tempDir('risu590-link-'), 'linked')
    symlinkSync(copyRoot, link, 'junction')
    const r = await runCli(path.join(link, 'util', 'androidRelease.mjs'), args, baseEnv())
    expect(r.code, r.out).toBe(code)
    expect(startsWithCommand(r.out).length, r.out).toBeGreaterThan(0)
  })
})

describe('IN-6: nothing untrusted is printed', () => {
  const allowed = /^::error::(inspect K\d|inspect|unexpected failure)/
  const clean = (out: string) => {
    expect(out).not.toContain('pwned')
    for (const line of startsWithCommand(out)) expect(line).toMatch(allowed)
  }
  test('hostile tool stdout and stderr', async () => {
    const hostile = `${dump('newlineName')}\n::error::stdout-pwned\n::set-output name=x::pwned`
    const r = await inspectCli({ stdout: hostile, status: 0, stderr: '::error::stderr-pwned\n' })
    expect(r.code).toBe(1)
    clean(r.out)
    const failing = await inspectCli({ stdout: '::error::stdout-pwned', status: 3, stderr: '::error::stderr-pwned' })
    expect(failing.code).toBe(1)
    clean(failing.out)
  })
  test('a hostile entry name', async () => {
    const r = await inspectCli({ stdout: dump('ok'), status: 0, bytes: zipBytes([...apkNames(ABIS.aarch64), '::error::entry-pwned', 'lib/::error::lib-pwned/libalib.so']) })
    expect(r.code).toBe(1)
    expect(r.out).toContain('::error::inspect K5:')
    clean(r.out)
  })
  test('an exception from the file system prints fixed text only', async () => {
    const lines: string[] = []
    const code = await main(['inspect', 'unsigned'], { ABI: 'aarch64', APK_DIR: path.join(tempDir('risu590-x-'), 'missing-pwned-dir'), ANDROID_HOME: 'x', GITHUB_OUTPUT: path.join(os.tmpdir(), 'unused') }, line => lines.push(line))
    expect(code).toBe(1)
    expect(lines).toEqual(['::error::unexpected failure; nothing was changed'])
  })
  test('an unknown command exits 2 with a fixed usage line', async () => {
    const lines: string[] = []
    expect(await main(['bogus'], {}, line => lines.push(line))).toBe(2)
    expect(await main(['inspect', 'both'], {}, line => lines.push(line))).toBe(2)
    expect(await main(['guard', 'extra'], {}, line => lines.push(line))).toBe(2)
    expect(lines.every(l => l.startsWith('::error::usage:'))).toBe(true)
  })
})
