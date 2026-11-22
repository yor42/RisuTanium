// @vitest-environment node
/**
 * The release signing steps against the real Android build tools (#590 S1).
 *
 * The sign job's shell steps, `util/androidRelease.mjs inspect` and the real aapt2, zipalign and apksigner run together
 * on inputs built here: a zip of a synthetic manifest from the fixture JSON and a throwaway RSA key made by keytool at
 * run time. No secret, real key, network or device is involved. Without build-tools 36.0.0 the rows skip with a visible
 * notice; without Java they skip locally and fail in CI.
 */
import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync, zipSync } from 'fflate'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'

type Obj = Record<string, unknown>

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const isWin = process.platform === 'win32'
const fwd = (p: string) => p.replace(/\\/g, '/')
const exe = (name: string) => (isWin ? `${name}.exe` : name)
const BUILD_TOOLS = '36.0.0'
const contractPath = path.join('src-tauri', 'gen', 'android', 'app', 'src', 'test', 'resources', 'app-update-v1', 'contract.properties')

interface FixtureCase {
  manifest: string
  table: string
}
const fixture = JSON.parse(readFileSync(path.join(here, 'fixtures', 'androidReleaseInspect.json'), 'utf8')) as { cases: Record<string, FixtureCase> }

// ---------------------------------------------------------------- tool discovery
function findSdk(): string | undefined {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, isWin && process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : undefined]
  for (const home of candidates) {
    if (home && existsSync(path.join(home, 'build-tools', BUILD_TOOLS, exe('aapt2'))) && existsSync(path.join(home, 'build-tools', BUILD_TOOLS, 'lib', 'apksigner.jar'))) return home
  }
  return undefined
}
function findJava(): { java: string; keytool: string } | undefined {
  const homes = [process.env.JAVA_HOME, isWin ? 'C:\\Program Files\\Android\\Android Studio\\jbr' : undefined]
  for (const home of homes) {
    if (home && existsSync(path.join(home, 'bin', exe('java'))) && existsSync(path.join(home, 'bin', exe('keytool')))) {
      return { java: path.join(home, 'bin', exe('java')), keytool: path.join(home, 'bin', exe('keytool')) }
    }
  }
  const onPath = spawnSync('java', ['-version'], { encoding: 'utf8', timeout: 20000 })
  return onPath.status === 0 ? { java: 'java', keytool: 'keytool' } : undefined
}
const sdk = findSdk()
const jdk = findJava()
const inCi = Boolean(process.env.CI)
const runnable = sdk !== undefined && (jdk !== undefined || inCi)
/** The skip is announced by a passing test, so the notice shows in the run output and the step summary. */
const why = sdk === undefined ? `build-tools ${BUILD_TOOLS} was not found (ANDROID_HOME, ANDROID_SDK_ROOT)` : 'no Java was found'
test.skipIf(runnable)('S-1..S-5 are skipped: the notice is printed', () => {
  const line = `Signing rows S-1..S-5 skipped: ${why}.`
  // The reporter closes a colour after its header line; a workflow command must start its own line.
  console.log(`\n::notice::${line}`)
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${line}\n`)
})

// ---------------------------------------------------------------- shell harness (same shape as the workflow tests)
const gitRoot = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git')
const bashFile = isWin ? path.join(gitRoot, 'bin', 'bash.exe') : 'bash'
const basePath = isWin ? [path.join(gitRoot, 'usr', 'bin'), path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')].join(';') : '/usr/bin:/bin'
const cleanup: string[] = []
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
})
const tempDir = (prefix: string) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  cleanup.push(dir)
  return dir
}
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

interface Ran {
  status: number | null
  all: string
}
function spawnText(file: string, args: string[], env: Record<string, string>, cwd?: string): Ran {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', timeout: 20000, env })
  return { status: result.status, all: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}
const winEnv = (c: string): Record<string, string> => (isWin ? { SYSTEMROOT: process.env.SystemRoot ?? 'C:\\Windows', TEMP: c, TMP: c } : {})

const reusable = parse(readFileSync(path.join(root, '.github', 'workflows', 'android-release-apk.yml'), 'utf8')) as Obj
function signStep(id: string): string {
  const job = (reusable.jobs as Record<string, Obj>).sign
  const step = (job.steps as Obj[]).find(s => s.id === id)
  if (!step) throw new Error(`sign step ${id} is missing`)
  return String(step.run).replace(/\r\n/g, '\n')
}

interface Key {
  file: string
  b64: string
  password: string
  alias: string
  certSha256: string
}
function makeKey(dir: string, name: string): Key {
  const tools = jdk as { java: string; keytool: string }
  const file = path.join(dir, `${name}.p12`)
  const password = `pw-${name}-${randomBytes(6).toString('hex')}`
  const alias = `alias-${name}-${randomBytes(4).toString('hex')}`
  const env = { PATH: process.env.PATH ?? '', ...winEnv(dir) }
  const made = spawnText(tools.keytool, ['-genkeypair', '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '3650', '-storetype', 'PKCS12', '-keystore', file, '-storepass', password, '-keypass', password, '-dname', 'CN=Throwaway Test'], env)
  if (made.status !== 0) throw new Error(`keytool could not make the throwaway key: ${made.all}`)
  const cert = path.join(dir, `${name}.cer`)
  const exported = spawnText(tools.keytool, ['-exportcert', '-alias', alias, '-keystore', file, '-storepass', password, '-file', cert], env)
  if (exported.status !== 0) throw new Error(`keytool could not export the throwaway certificate: ${exported.all}`)
  return { file, b64: readFileSync(file).toString('base64'), password, alias, certSha256: sha256(readFileSync(cert)) }
}

function makeApk(id: string, libs: string[] = ['arm64-v8a']): Buffer {
  const c = fixture.cases[id]
  const stored = { level: 0 } as const
  const files: Record<string, [Uint8Array, typeof stored]> = {
    'AndroidManifest.xml': [Buffer.from(c.manifest, 'base64'), stored],
    'resources.arsc': [Buffer.from(c.table, 'base64'), stored],
  }
  for (const abi of libs) files[`lib/${abi}/libalib.so`] = [Buffer.alloc(300, 7), stored]
  return Buffer.from(zipSync(files))
}

interface Case {
  dir: string
  temp: string
  home: string
  inDir: string
  outFile: string
  output: string
  env: Record<string, string>
}
/** RUNNER_TEMP holds only `in/`; the sign step must create `out/` itself. On Windows ANDROID_HOME holds a wrapper that runs the real apksigner jar; elsewhere it is the installed SDK. */
function makeCase(apk: Buffer): Case {
  const dir = tempDir('risu590-sign-')
  const temp = path.join(dir, 'runner-temp')
  const home = isWin ? path.join(dir, 'android-home') : (sdk as string)
  const inDir = path.join(temp, 'in')
  mkdirSync(inDir, { recursive: true })
  mkdirSync(path.join(dir, 'home'))
  writeFileSync(path.join(inDir, 'app-unsigned.apk'), apk)
  if (isWin) {
    mkdirSync(path.join(home, 'build-tools', BUILD_TOOLS), { recursive: true })
    const wrapper = path.join(home, 'build-tools', BUILD_TOOLS, 'apksigner')
    const jar = path.join(sdk as string, 'build-tools', BUILD_TOOLS, 'lib', 'apksigner.jar')
    writeFileSync(wrapper, `#!/bin/sh\nexec "${fwd((jdk as { java: string }).java)}" -jar "${fwd(jar)}" "$@"\n`)
    chmodSync(wrapper, 0o755)
  }
  const output = path.join(dir, 'github-output')
  writeFileSync(output, '')
  return {
    dir, temp, home, inDir, output,
    outFile: path.join(temp, 'out', 'app-release.apk'),
    env: { HOME: fwd(path.join(dir, 'home')), RUNNER_TEMP: fwd(temp), GITHUB_OUTPUT: fwd(output), ANDROID_HOME: fwd(home) },
  }
}
function runStep(c: Case, id: string, env: Record<string, string>): Ran {
  const file = path.join(c.dir, `${id}-${randomBytes(3).toString('hex')}.sh`)
  writeFileSync(file, signStep(id))
  return spawnText(bashFile, ['--noprofile', '--norc', '-eo', 'pipefail', fwd(file)], { ...(isWin ? { PATH: `${path.join(c.dir, 'bin')};${basePath}` } : { PATH: process.env.PATH ?? '', ...(process.env.JAVA_HOME ? { JAVA_HOME: process.env.JAVA_HOME } : {}) }), ...winEnv(c.dir), ...c.env, ...env }, c.dir)
}
const secretsOf = (k: Key, overrides: Partial<Record<'password' | 'alias', string>> = {}) => ({
  ANDROID_KEYSTORE_BASE64: k.b64,
  ANDROID_KEYSTORE_PASSWORD: overrides.password ?? k.password,
  ANDROID_KEY_ALIAS: overrides.alias ?? k.alias,
  ANDROID_KEY_PASSWORD: overrides.password ?? k.password,
})

// ---------------------------------------------------------------- the inspect script, beside the same two relative files
let scriptFile = ''
function inspectCli(mode: 'unsigned' | 'signed', c: Case, apkDir: string, extra: Record<string, string> = {}): Ran & { outputFile: string } {
  const outputFile = path.join(c.dir, `inspect-${mode}-output`)
  writeFileSync(outputFile, '')
  const ran = spawnText(process.execPath, [scriptFile, 'inspect', mode], { PATH: path.dirname(process.execPath), ...winEnv(c.dir), ANDROID_HOME: sdk as string, APK_DIR: apkDir, ABI: 'aarch64', GITHUB_OUTPUT: outputFile, ...extra })
  return { ...ran, outputFile }
}
const outputValue = (file: string, key: string) => readFileSync(file, 'utf8').split('\n').find(l => l.startsWith(`${key}=`))?.slice(key.length + 1)

function javaApksigner(args: string[]): Ran {
  return spawnText((jdk as { java: string }).java, ['-jar', path.join(sdk as string, 'build-tools', BUILD_TOOLS, 'lib', 'apksigner.jar'), ...args], { PATH: process.env.PATH ?? '', ...winEnv(os.tmpdir()) })
}

let keyA: Key
let keyB: Key
beforeAll(() => {
  if (!runnable) return
  if (!jdk) throw new Error('Java is required for the signing rows in CI.')
  const dir = tempDir('risu590-keys-')
  keyA = makeKey(dir, 'a')
  keyB = makeKey(dir, 'b')
  const copy = tempDir('risu590-signing-script-')
  mkdirSync(path.join(copy, 'util'))
  mkdirSync(path.join(copy, 'src-tauri'))
  mkdirSync(path.dirname(path.join(copy, contractPath)), { recursive: true })
  copyFileSync(path.join(here, 'androidRelease.mjs'), path.join(copy, 'util', 'androidRelease.mjs'))
  writeFileSync(path.join(copy, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: '0.1.0' }))
  copyFileSync(path.join(root, contractPath), path.join(copy, contractPath))
  scriptFile = path.join(copy, 'util', 'androidRelease.mjs')
}, 60000)

const LIMIT = 30000

describe.skipIf(!runnable)(`S: signing with the real tools${runnable ? '' : ` (skipped: ${why})`}`, () => {
  test('S-1: inspect, sign, check the signer and inspect signed pass on a good APK', () => {
    const c = makeCase(makeApk('ok'))
    if (!isWin) expect(c.env.ANDROID_HOME).toBe(fwd(sdk as string))
    const unsigned = inspectCli('unsigned', c, c.inDir)
    expect(unsigned.status, unsigned.all).toBe(0)
    const unsignedSha = outputValue(unsigned.outputFile, 'sha256') as string
    expect(unsignedSha).toMatch(/^[0-9a-f]{64}$/)

    const inputs = runStep(c, 'check-inputs', { ARTIFACT_ID: '123', UNSIGNED_SHA256: unsignedSha, EXPECTED_CERT_SHA256: keyA.certSha256 })
    expect(inputs.status, inputs.all).toBe(0)
    const checked = runStep(c, 'check-unsigned', { UNSIGNED_SHA256: unsignedSha })
    expect(checked.status, checked.all).toBe(0)

    expect(existsSync(path.join(c.temp, 'out'))).toBe(false)
    const signed = runStep(c, 'sign', secretsOf(keyA))
    expect(signed.status, signed.all).toBe(0)
    for (const secret of [keyA.password, keyA.alias, keyA.b64]) expect(signed.all).not.toContain(secret)
    const removed = runStep(c, 'remove-key', {})
    expect(removed.status, removed.all).toBe(0)
    expect(existsSync(path.join(c.temp, 'signing-key'))).toBe(false)
    expect(readdirSync(path.join(c.temp, 'out'))).toEqual(['app-release.apk'])

    const signer = runStep(c, 'check-signed', { EXPECTED_CERT_SHA256: keyA.certSha256 })
    expect(signer.status, signer.all).toBe(0)
    expect(signer.all).toContain(`Signer #1 certificate SHA-256 digest: ${keyA.certSha256}`)
    const signedSha = outputValue(c.output, 'sha256') as string
    expect(signedSha).toBe(sha256(readFileSync(c.outFile)))

    const verbose = javaApksigner(['verify', '--verbose', c.outFile])
    expect(verbose.status, verbose.all).toBe(0)
    expect(verbose.all).toMatch(/Verified using v1 scheme \(JAR signing\): false/)
    expect(verbose.all).toMatch(/Verified using v2 scheme \(APK Signature Scheme v2\): true/)
    expect(verbose.all).toMatch(/Verified using v3 scheme \(APK Signature Scheme v3\): false/)

    const final = inspectCli('signed', c, path.dirname(c.outFile), { EXPECTED_SHA256: signedSha })
    expect(final.status, final.all).toBe(0)
    expect(final.all).toContain('inspect signed: identity rules passed')
  }, LIMIT)

  test('S-1: the signed file holds no JAR signature entry', () => {
    const c = makeCase(makeApk('ok'))
    const signed = runStep(c, 'sign', secretsOf(keyA))
    expect(signed.status, signed.all).toBe(0)
    const names = Object.keys(unzipSync(readFileSync(c.outFile)))
    expect(names).toContain('AndroidManifest.xml')
    expect(names.filter(n => /^META-INF\/([^/]+\.(SF|RSA|DSA|EC)|MANIFEST\.MF)$/i.test(n))).toEqual([])
  }, LIMIT)

  test('S-2: a file signed by another key, or by two keys, is refused by check-signed', () => {
    const other = makeCase(makeApk('ok'))
    const signedByB = runStep(other, 'sign', secretsOf(keyB))
    expect(signedByB.status, signedByB.all).toBe(0)
    const wrong = runStep(other, 'check-signed', { EXPECTED_CERT_SHA256: keyA.certSha256 })
    expect(wrong.status).toBe(1)
    expect(wrong.all).toContain('::error::The signed file must have exactly one signer')
    expect(outputValue(other.output, 'sha256')).toBeUndefined()

    // The expected key is first in one file and last in the other, so neither "first" nor "last" digest can pass.
    for (const [first, second] of [[keyA, keyB], [keyB, keyA]]) {
      const two = makeCase(makeApk('ok'))
      mkdirSync(path.dirname(two.outFile))
      const both = javaApksigner([
        'sign', '--ks', first.file, '--ks-key-alias', first.alias, '--ks-pass', `pass:${first.password}`, '--key-pass', `pass:${first.password}`,
        '--next-signer', '--ks', second.file, '--ks-key-alias', second.alias, '--ks-pass', `pass:${second.password}`, '--key-pass', `pass:${second.password}`,
        '--v1-signing-enabled', 'false', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'false', '--v4-signing-enabled', 'false',
        '--out', two.outFile, path.join(two.inDir, 'app-unsigned.apk'),
      ])
      expect(both.status, both.all).toBe(0)
      const refused = runStep(two, 'check-signed', { EXPECTED_CERT_SHA256: keyA.certSha256 })
      expect(refused.status).toBe(1)
      expect(refused.all).toContain('::error::The signed file must have exactly one signer')
    }
  }, LIMIT)

  test.each([
    ['password', { password: 'wrong-password-value' }],
    ['alias', { alias: 'wrong-alias-value' }],
  ] as const)('S-3: a wrong %s fails with fixed text, no key file and no signed output', (_name, wrong) => {
    const c = makeCase(makeApk('ok'))
    const ran = runStep(c, 'sign', secretsOf(keyA, wrong))
    expect(ran.status).toBe(1)
    expect(ran.all).toContain('::error::Signing failed.')
    for (const secret of [keyA.password, keyA.alias, keyA.b64, 'wrong-password-value', 'wrong-alias-value']) expect(ran.all).not.toContain(secret)
    expect(existsSync(path.join(c.temp, 'signing-key'))).toBe(false)
    expect(existsSync(c.outFile)).toBe(false)
  }, LIMIT)

  test('S-4: a misaligned file signed with the alignment kept is refused by inspect signed', () => {
    const c = makeCase(makeApk('ok'))
    const input = path.join(c.inDir, 'app-unsigned.apk')
    const probe = spawnText(path.join(sdk as string, 'build-tools', BUILD_TOOLS, exe('zipalign')), ['-c', '-P', '16', '4', input], { PATH: path.dirname(process.execPath), ...winEnv(c.dir) })
    expect(probe.status, 'the unsigned input must be misaligned for this row to mean anything').not.toBe(0)

    mkdirSync(path.dirname(c.outFile))
    const signed = javaApksigner([
      'sign', '--ks', keyA.file, '--ks-key-alias', keyA.alias, '--ks-pass', `pass:${keyA.password}`, '--key-pass', `pass:${keyA.password}`,
      '--v1-signing-enabled', 'false', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'false', '--v4-signing-enabled', 'false',
      '--alignment-preserved', 'true', '--out', c.outFile, input,
    ])
    expect(signed.status, signed.all).toBe(0)
    const refused = inspectCli('signed', c, path.dirname(c.outFile), { EXPECTED_SHA256: sha256(readFileSync(c.outFile)) })
    expect(refused.status).toBe(1)
    expect(refused.all).toContain('::error::inspect K6')
  }, LIMIT)

  test('S-4: a file aligned for 4 KB pages but not 16 KB is refused by inspect signed', () => {
    const c = makeCase(makeApk('ok'))
    mkdirSync(path.dirname(c.outFile))
    const signed = javaApksigner([
      'sign', '--ks', keyA.file, '--ks-key-alias', keyA.alias, '--ks-pass', `pass:${keyA.password}`, '--key-pass', `pass:${keyA.password}`,
      '--v1-signing-enabled', 'false', '--v2-signing-enabled', 'true', '--v3-signing-enabled', 'false', '--v4-signing-enabled', 'false',
      '--lib-page-alignment', '4096', '--out', c.outFile, path.join(c.inDir, 'app-unsigned.apk'),
    ])
    expect(signed.status, signed.all).toBe(0)
    const zipalign = (pages: string) => spawnText(path.join(sdk as string, 'build-tools', BUILD_TOOLS, exe('zipalign')), ['-c', '-P', pages, '4', c.outFile], { PATH: path.dirname(process.execPath), ...winEnv(c.dir) }).status
    expect(zipalign('4')).toBe(0)
    expect(zipalign('16')).not.toBe(0)
    const refused = inspectCli('signed', c, path.dirname(c.outFile), { EXPECTED_SHA256: sha256(readFileSync(c.outFile)) })
    expect(refused.status).toBe(1)
    expect(refused.all).toContain('::error::inspect K6')
  }, LIMIT)

  test.each([
    ['codeMajor', 'K1'],
    ['debugRefTrue', 'K2'],
    ['newlineName', 'K3'],
  ] as const)('S-5: the real aapt2 dump of %s is refused by rule %s', (id, rule) => {
    const c = makeCase(makeApk(id))
    const ran = inspectCli('unsigned', c, c.inDir)
    expect(ran.status).toBe(1)
    expect(ran.all).toContain(`::error::inspect ${rule}:`)
    expect(readFileSync(ran.outputFile, 'utf8')).toBe('')
  }, LIMIT)
})
