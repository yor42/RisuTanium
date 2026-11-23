// @vitest-environment node
/**
 * Structure and shell behaviour of the release workflows (#590 S1).
 *
 * R1, R2 are regression reproducers for the dispatch-time key exposure and the shared concurrency group; R3 is a
 * compatibility guard for the `android build` arguments. W1..W6 and B-1..B-4 guard the new release rules: the key
 * lives in one environment-gated job, every other job checks what it is handed, and the signing step leaves nothing
 * behind. Shell steps run exactly as GitHub runs them (`bash --noprofile --norc -eo pipefail`) with fake tools, so
 * no secret, token, network or real build is involved.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'
import { parse } from 'yaml'

type Obj = Record<string, unknown>

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workflowDir = path.join(root, '.github', 'workflows')
const RELEASE = 'android-release-apk.yml'
const BUILD = 'android-build.yml'
const REUSABLE_USES = `./.github/workflows/${RELEASE}`
const FOUR = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']
const VARIABLE = 'ANDROID_RELEASE_CERT_SHA256'
const ENVIRONMENT = 'android-release'
const EXPR = /\$\{\{([\s\S]*?)\}\}/g

function asObj(value: unknown): Obj {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected a mapping')
  return value as Obj
}
function asArr(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('expected a list')
  return value
}
const text = (name: string) => readFileSync(path.join(workflowDir, name), 'utf8')
const load = (name: string): Obj => asObj(parse(text(name)))
const workflowFiles = readdirSync(workflowDir).filter(n => /\.ya?ml$/.test(n)).sort()
const jobsOf = (doc: Obj): Record<string, Obj> => Object.fromEntries(Object.entries(asObj(doc.jobs)).map(([k, v]) => [k, asObj(v)]))
const stepsOf = (job: Obj): Obj[] => (job.steps === undefined ? [] : asArr(job.steps).map(asObj))
const needsOf = (job: Obj): string[] => (job.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs.map(String) : [String(job.needs)])
const stepById = (doc: Obj, jobId: string, id: string): Obj => {
  const found = stepsOf(jobsOf(doc)[jobId]).filter(s => s.id === id || (s.id === undefined && s.name === id))
  if (found.length !== 1) throw new Error(`step ${jobId}/${id} not unique`)
  return found[0]
}
const runOf = (step: Obj) => String(step.run).replace(/\r\n/g, '\n')

interface Leaf {
  loc: string[]
  value: string
  isKey: boolean
}
function leaves(node: unknown, loc: string[] = [], out: Leaf[] = []): Leaf[] {
  if (typeof node === 'string') out.push({ loc, value: node, isKey: false })
  else if (Array.isArray(node)) node.forEach((v, i) => leaves(v, [...loc, String(i)], out))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Obj)) {
      out.push({ loc: [...loc, k], value: k, isKey: true })
      leaves(v, [...loc, k], out)
    }
  }
  return out
}
function keysAnywhere(node: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(node)) node.forEach(v => keysAnywhere(v, key, out))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Obj)) {
      if (k.toLowerCase() === key) out.push(v)
      keysAnywhere(v, key, out)
    }
  }
  return out
}

// ---------------------------------------------------------------- R1
function touchesFour(expr: string): boolean {
  if (/\bsecrets\b(?!\s*\.\s*[A-Za-z_][\w-]*)/i.test(expr)) return true
  for (const m of expr.matchAll(/\bsecrets\s*\.\s*([A-Za-z_][\w-]*)/gi)) if (FOUR.includes(m[1].toUpperCase())) return true
  return false
}
/** Every place where a value of one of the four secrets could reach something other than the allowed three forms. */
function secretViolations(doc: Obj): string[] {
  const jobs = jobsOf(doc)
  const out: string[] = []
  for (const leaf of leaves(doc)) {
    for (const m of leaf.value.matchAll(EXPR)) {
      const expr = m[1].trim()
      if (!touchesFour(expr)) continue
      const where = leaf.loc.join('.')
      const whole = !leaf.isKey && leaf.value.trim() === m[0]
      const boolean = new RegExp(`^secrets\\.(${FOUR.join('|')})\\s*!=\\s*''$`).test(expr)
      const named = /^secrets\.([A-Z0-9_]+)$/.exec(expr)?.[1]
      const [head, jobId, section, ...rest] = leaf.loc
      const job = head === 'jobs' ? jobs[jobId] : undefined
      const byName = whole && named && FOUR.includes(named) && job && section === 'secrets' && rest[0] === named && rest.length === 1 && job.uses === REUSABLE_USES
      const inEnvJob =
        whole && named && FOUR.includes(named) && job && section === 'steps' && rest[1] === 'env' && rest[2] === named && rest.length === 3 &&
        job.environment !== undefined && !stepsOf(job).some(s => /checkout/i.test(String(s.uses ?? '')))
      if (!(whole && boolean) && !byName && !inEnvJob) out.push(`${where}: ${m[0]}`)
    }
  }
  return out
}

describe('R1: the four secrets reach only a boolean, a by-name pass to the reusable, or an environment job without checkout', () => {
  test.each(workflowFiles)('%s', file => {
    expect(secretViolations(load(file))).toEqual([])
  })
  test('the classifier refuses the shapes it exists to refuse', () => {
    const wrap = (value: string): Obj => ({ jobs: { x: { 'runs-on': 'u', steps: [{ run: 'echo', env: { ANDROID_KEY_ALIAS: value } }] } } })
    for (const bad of [
      '${{ secrets.ANDROID_KEY_ALIAS }}',
      '${{ SECRETS.android_key_alias }}',
      "${{ secrets['ANDROID_KEY_ALIAS'] }}",
      '${{ toJSON(secrets) }}',
      "${{ secrets[format('{0}', 'ANDROID_KEY_ALIAS')] }}",
      "${{ secrets.ANDROID_KEY_ALIAS || 'x' }}",
    ]) {
      expect(secretViolations(wrap(bad)), bad).toHaveLength(1)
    }
    expect(secretViolations(wrap("${{ secrets.ANDROID_KEY_ALIAS != '' }}"))).toEqual([])
    expect(secretViolations(wrap('${{ secrets.GITHUB_TOKEN }}'))).toEqual([])
  })
})

describe('R2: debug and release builds never share a concurrency group', () => {
  test('exact group and cancel expressions', () => {
    expect(asObj(load(BUILD).concurrency)).toEqual({
      group: 'android-build-${{ inputs.build_type }}',
      'cancel-in-progress': "${{ inputs.build_type == 'debug' }}",
    })
    expect(load(RELEASE).concurrency).toBeUndefined()
  })
})

// ---------------------------------------------------------------- shell harness
const isWin = process.platform === 'win32'
const fwd = (p: string) => p.replace(/\\/g, '/')
const gitRoot = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git')
const bashFile = isWin ? path.join(gitRoot, 'bin', 'bash.exe') : 'bash'
const basePath = isWin ? [path.join(gitRoot, 'usr', 'bin'), path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')].join(';') : '/usr/bin:/bin'
const cleanup: string[] = []
afterAll(() => {
  for (const dir of cleanup) rmSync(dir, { recursive: true, force: true })
})

interface Case {
  dir: string
  work: string
  temp: string
  fakeBin: string
  ahome: string
  output: string
  env: Record<string, string>
}
/** Every path of a case lies in its own folder: RUNNER_TEMP, GITHUB_OUTPUT, HOME, the work directory and the fake tools. */
function makeCase(): Case {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'risu590-wf-'))
  cleanup.push(dir)
  const sub = (name: string) => {
    const p = path.join(dir, name)
    mkdirSync(p, { recursive: true })
    return p
  }
  const work = sub('work')
  const temp = sub('runner-temp')
  const fakeBin = sub('bin')
  const ahome = sub('android-home')
  const home = sub('home')
  const output = path.join(dir, 'github-output')
  writeFileSync(output, '')
  return {
    dir, work, temp, fakeBin, ahome, output,
    env: { HOME: fwd(home), RUNNER_TEMP: fwd(temp), GITHUB_OUTPUT: fwd(output), GITHUB_ENV: fwd(path.join(dir, 'github-env')), ANDROID_HOME: fwd(ahome), FAKE_LOG: fwd(path.join(dir, 'fake.log')) },
  }
}
function writeExecutable(file: string, body: string) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, body.replace(/\r\n/g, '\n'))
  chmodSync(file, 0o755)
}
interface Ran {
  status: number | null
  stdout: string
  stderr: string
  all: string
}
function runShell(c: Case, script: string, env: Record<string, string> = {}): Ran {
  const file = path.join(c.dir, `step-${cleanup.length}-${Math.random().toString(36).slice(2)}.sh`)
  writeFileSync(file, script)
  const result = spawnSync(bashFile, ['--noprofile', '--norc', '-eo', 'pipefail', fwd(file)], {
    cwd: c.work,
    encoding: 'utf8',
    timeout: 20000,
    env: {
      PATH: `${c.fakeBin}${isWin ? ';' : ':'}${basePath}`,
      ...(isWin ? { SYSTEMROOT: process.env.SystemRoot ?? 'C:\\Windows', TEMP: c.dir, TMP: c.dir } : {}),
      ...c.env,
      ...env,
    },
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', all: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}
const sha256 = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex')

const FAKE_PNPM = `#!/bin/sh
if [ "$1" = "--risu-fake-probe" ]; then echo RISU-FAKE-PNPM; exit 0; fi
printf '%s\\n' "$@" >> "$FAKE_LOG"
`
/** A fake apksigner: signing copies the last argument to --out; every run prints the secrets it can see, plus a workflow command. */
const FAKE_APKSIGNER = `#!/bin/sh
log() { printf '%s\\n' "$*" >> "$FAKE_LOG"; }
mode=$1; shift
prev=''; out=''; ks=''; last=''
for a in "$@"; do
  [ "$prev" = --out ] && out=$a
  [ "$prev" = --ks ] && ks=$a
  prev=$a; last=$a
done
echo "marker $ANDROID_KEYSTORE_PASSWORD $ANDROID_KEY_PASSWORD $ANDROID_KEY_ALIAS"
echo "::error::injected-by-apksigner" >&2
case "$mode" in
  sign)
    log "sign keystore=$(cat "$ks" 2>/dev/null)"
    if [ "\${FAKE_SIGN:-ok}" = fail ]; then exit 1; fi
    cat "$last" > "$out"
    ;;
  verify)
    log "verify"
    if [ -n "\${FAKE_VERIFY_FILE:-}" ]; then cat "$FAKE_VERIFY_FILE"; fi
    exit "\${FAKE_VERIFY_STATUS:-0}"
    ;;
esac
`
function installApksigner(c: Case) {
  writeExecutable(path.join(c.ahome, 'build-tools', '36.0.0', 'apksigner'), FAKE_APKSIGNER)
}
/** The harness must be running the recorder: anything else is a hard failure before any build step runs. */
function installFakePnpm(c: Case) {
  writeExecutable(path.join(c.fakeBin, 'pnpm'), FAKE_PNPM)
  const probe = runShell(c, 'pnpm --risu-fake-probe')
  if (probe.stdout.trim() !== 'RISU-FAKE-PNPM') throw new Error('pnpm does not resolve to the fake recorder; no build step is run')
}
function evalEnv(env: unknown, inputs: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env === undefined ? {} : asObj(env))) {
    out[k] = String(v).replace(EXPR, (_, expr: string) => {
      const e = expr.trim()
      if (e.startsWith('secrets.')) return ''
      const key = e.replace(/^inputs\./, '')
      if (!e.startsWith('inputs.') || !(key in inputs)) throw new Error(`unmapped expression ${e}`)
      return inputs[key]
    })
  }
  return out
}
/** Runs one workflow step's script with the fake pnpm and returns the arguments pnpm received. */
function pnpmArgs(doc: Obj, jobId: string, id: string, inputs: Record<string, string>): string[] {
  const c = makeCase()
  installFakePnpm(c)
  const step = stepById(doc, jobId, id)
  const r = runShell(c, runOf(step), evalEnv(step.env, inputs))
  expect(r.status, r.all).toBe(0)
  return readFileSync(c.env.FAKE_LOG, 'utf8').split('\n').filter(Boolean)
}

// ---------------------------------------------------------------- R3 and B-1
const tauriJs = path.join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const wantedCli = String(asObj(JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).devDependencies)['@tauri-apps/cli'])
const installedCli = existsSync(tauriJs) ? String(JSON.parse(readFileSync(path.join(root, 'node_modules', '@tauri-apps', 'cli', 'package.json'), 'utf8')).version) : ''

interface BuildStep {
  file: string
  job: string
  id: string
}
function androidBuildSteps(): BuildStep[] {
  const found: BuildStep[] = []
  for (const file of [BUILD, RELEASE].filter(f => workflowFiles.includes(f))) {
    for (const [job, body] of Object.entries(jobsOf(load(file)))) {
      for (const [index, step] of stepsOf(body).entries()) {
        if (/\bandroid build\b/.test(String(step.run ?? ''))) found.push({ file, job, id: String(step.id ?? step.name ?? `#${index}`) })
      }
    }
  }
  return found
}

describe('R3: every `android build` step passes arguments the installed Tauri CLI accepts', () => {
  test('the guarded steps are found, so an emptied list cannot pass', () => {
    expect(androidBuildSteps().map(s => `${s.file}/${s.job}`)).toContain(`${BUILD}/build-android`)
  })
  test('each step, both ABIs and both build types: the CLI parses the arguments (--help appended, nothing builds)', ctx => {
    if (installedCli !== wantedCli) {
      if (process.env.CI) throw new Error(`installed @tauri-apps/cli ${installedCli || 'missing'} differs from package.json ${wantedCli}`)
      ctx.skip()
      return
    }
    for (const step of androidBuildSteps()) {
      const doc = load(step.file)
      const stepObj = stepById(doc, step.job, step.id)
      const c = makeCase()
      installFakePnpm(c)
      for (const abi of ['aarch64', 'all']) {
        for (const build_type of step.file === BUILD ? ['debug', 'release'] : ['release']) {
          rmSync(c.env.FAKE_LOG, { force: true })
          const r = runShell(c, runOf(stepObj), evalEnv(stepObj.env, { build_type, abi }))
          expect(r.status, r.all).toBe(0)
          const args = readFileSync(c.env.FAKE_LOG, 'utf8').split('\n').filter(Boolean)
          expect(args.slice(0, 3)).toEqual(['tauri', 'android', 'build'])
          const cli = spawnSync(process.execPath, [tauriJs, ...args.slice(1), '--help'], { encoding: 'utf8', timeout: 60000, cwd: root })
          expect(cli.status, `${step.file}/${step.job} ${args.join(' ')}: ${cli.stderr}`).toBe(0)
        }
      }
    }
  }, 120000)
})

describe('B-1: release build arguments', () => {
  test.each(['aarch64', 'all'])('release %s: --apk without a value, never --debug, --target only for aarch64', abi => {
    const args = pnpmArgs(load(RELEASE), 'build', 'build', { abi })
    expect(args).toEqual(abi === 'all' ? ['tauri', 'android', 'build', '--apk'] : ['tauri', 'android', 'build', '--apk', '--target', 'aarch64'])
  })
  test.each(['aarch64', 'all'])('debug %s keeps the debug flag', abi => {
    const args = pnpmArgs(load(BUILD), 'build-android', 'Build APK', { build_type: 'debug', abi })
    expect(args.slice(0, 5)).toEqual(['tauri', 'android', 'build', '--apk', '--debug'])
  })
})

// ---------------------------------------------------------------- W1..W6
const reusable = () => load(RELEASE)
const caller = () => load(BUILD)

describe('W1: one environment, on sign, with the exact name; no inherited secrets', () => {
  test('exactly one environment key in all workflows, on sign', () => {
    const found = workflowFiles.flatMap(f => keysAnywhere(load(f), 'environment').map(v => `${f}:${JSON.stringify(v)}`))
    expect(found).toEqual([`${RELEASE}:${JSON.stringify(ENVIRONMENT)}`])
    expect(jobsOf(reusable()).sign.environment).toBe(ENVIRONMENT)
  })
  test('no secrets: inherit anywhere, and exactly the four names', () => {
    for (const f of workflowFiles) {
      for (const value of keysAnywhere(load(f), 'secrets')) expect(value, f).not.toBe('inherit')
    }
    const names = (o: unknown) => Object.keys(asObj(o)).sort()
    const call = asObj(asObj(reusable().on).workflow_call)
    expect(names(call.secrets)).toEqual([...FOUR].sort())
    expect(names(jobsOf(caller())['release-apk'].secrets)).toEqual([...FOUR].sort())
    expect(names(stepById(reusable(), 'sign', 'sign').env)).toEqual([...FOUR].sort())
  })
})

describe('W2: sign has no checkout, install or cache, and holds the secrets alone', () => {
  const sign = () => jobsOf(reusable()).sign
  test('exact step ids, two 40-hex pins, no cache', () => {
    expect(stepsOf(sign()).map(s => s.id)).toEqual(['check-inputs', 'download', 'check-unsigned', 'sign', 'remove-key', 'check-signed', 'upload'])
    const uses = stepsOf(sign()).map(s => s.uses).filter(Boolean).map(String)
    expect(uses).toHaveLength(2)
    for (const u of uses) expect(u).toMatch(/^actions\/(download|upload)-artifact@[0-9a-f]{40}( #.*)?$/)
    expect(JSON.stringify(sign())).not.toMatch(/cache/i)
  })
  test('secrets appear only in step sign (reusable: and the guard booleans)', () => {
    for (const [jobId, job] of Object.entries(jobsOf(reusable()))) {
      for (const step of stepsOf(job)) {
        const has = JSON.stringify(step).includes('secrets.')
        const allowed = (jobId === 'sign' && step.id === 'sign') || (jobId === 'guard' && step.id === 'guard')
        expect(has, `${jobId}/${String(step.id)}`).toBe(allowed)
      }
    }
  })
  test('permissions of every job and the caller', () => {
    const perms = Object.fromEntries(Object.entries(jobsOf(reusable())).map(([k, v]) => [k, v.permissions]))
    expect(perms).toEqual({
      guard: { contents: 'read', actions: 'read' },
      build: { contents: 'read' },
      inspect: { contents: 'read' },
      sign: {},
      'inspect-signed': { contents: 'read' },
    })
    expect(reusable().permissions).toEqual({})
    expect(caller().permissions).toEqual({ contents: 'read' })
    expect(jobsOf(caller())['release-apk'].permissions).toEqual({ contents: 'read', actions: 'read' })
    expect(jobsOf(caller())['build-android'].permissions).toBeUndefined()
  })
})

describe('W3: the reusable is called from one place, by dispatch only', () => {
  test('triggers and interface', () => {
    expect(Object.keys(asObj(reusable().on))).toEqual(['workflow_call'])
    const call = asObj(asObj(reusable().on).workflow_call)
    expect(Object.keys(call).sort()).toEqual(['inputs', 'secrets'])
    expect(asObj(asObj(call.inputs).abi)).toMatchObject({ type: 'string', required: true })
    for (const name of FOUR) expect(asObj(asObj(call.secrets)[name]).required).toBe(true)
    expect(Object.keys(jobsOf(reusable()))).toEqual(['guard', 'build', 'inspect', 'sign', 'inspect-signed'])
  })
  test('exactly one caller, with the exact condition, inputs and by-name secrets', () => {
    expect(workflowFiles).toContain(RELEASE)
    const callers = workflowFiles.flatMap(f => Object.entries(jobsOf(load(f))).filter(([, j]) => String(j.uses ?? '').includes('android-release-apk')).map(([id]) => `${f}/${id}`))
    expect(callers).toEqual([`${BUILD}/release-apk`])
    expect(Object.keys(asObj(caller().on))).toEqual(['workflow_dispatch'])
    const job = jobsOf(caller())['release-apk']
    for (const key of Object.keys(job)) expect(['name', 'if', 'uses', 'with', 'secrets', 'permissions']).toContain(key)
    expect(job.if).toBe("inputs.build_type == 'release'")
    expect(job.uses).toBe(REUSABLE_USES)
    expect(job.with).toEqual({ abi: '${{ inputs.abi }}' })
    expect(job.secrets).toEqual(Object.fromEntries(FOUR.map(n => [n, `\${{ secrets.${n} }}`])))
    expect(jobsOf(caller())['build-android'].if).toBe("inputs.build_type == 'debug'")
  })
  test('guard booleans, shell and CUDA env', () => {
    expect(asObj(stepById(reusable(), 'guard', 'guard').env)).toMatchObject(
      Object.fromEntries([...FOUR.map(n => [`REPO_HAS_${n}`, `\${{ secrets.${n} != '' }}`]), [`REPO_HAS_${VARIABLE}`, `\${{ vars.${VARIABLE} != '' }}`]]),
    )
    expect(asObj(asObj(reusable().defaults).run).shell).toBe('bash')
    expect(asObj(reusable().env).ONNXRUNTIME_NODE_INSTALL_CUDA).toBe('skip')
  })
})

describe('W4: checkouts take the run ref; no git or expression in a reusable script', () => {
  test('no ref or repository on any checkout', () => {
    for (const file of [BUILD, RELEASE]) {
      for (const job of Object.values(jobsOf(load(file)))) {
        for (const step of stepsOf(job).filter(s => /^actions\/checkout@/.test(String(s.uses ?? '')))) {
          const withKeys = Object.keys(asObj(step.with ?? {}))
          expect(withKeys, file).not.toContain('ref')
          expect(withKeys, file).not.toContain('repository')
          if (file === RELEASE) expect(step.with).toEqual({ 'persist-credentials': false })
        }
      }
    }
  })
  test('reusable run scripts hold no git command and no expression', () => {
    for (const job of Object.values(jobsOf(reusable()))) {
      for (const step of stepsOf(job).filter(s => s.run !== undefined)) {
        expect(runOf(step)).not.toMatch(/\bgit\b/)
        expect(runOf(step)).not.toContain('${{')
      }
    }
  })
})

describe('W5: job wiring', () => {
  const jobs = () => jobsOf(reusable())
  test('exact needs and allowed keys', () => {
    expect(Object.fromEntries(Object.entries(jobs()).map(([k, v]) => [k, needsOf(v)]))).toEqual({
      guard: [], build: ['guard'], inspect: ['build'], sign: ['inspect'], 'inspect-signed': ['sign'],
    })
    for (const [jobId, job] of Object.entries(jobs())) {
      for (const key of Object.keys(job)) expect(['name', 'needs', 'runs-on', 'environment', 'permissions', 'timeout-minutes', 'outputs', 'steps'], jobId).toContain(key)
      for (const step of stepsOf(job)) {
        for (const key of Object.keys(step)) expect(['id', 'name', 'uses', 'with', 'env', 'run', 'if'], `${jobId}/${String(step.id)}`).toContain(key)
        if (step.if !== undefined) {
          expect(`${jobId}/${String(step.id)}`).toBe('sign/remove-key')
          expect(step.if).toBe('always()')
        }
      }
    }
    expect(stepById(reusable(), 'sign', 'remove-key').if).toBe('always()')
  })
  test('the three node commands are exactly these', () => {
    const commands: Record<string, string> = {
      'guard/guard': 'node util/androidRelease.mjs guard',
      'inspect/inspect': 'node util/androidRelease.mjs inspect unsigned',
      'inspect-signed/inspect': 'node util/androidRelease.mjs inspect signed',
    }
    const seen: string[] = []
    for (const [jobId, job] of Object.entries(jobs())) {
      for (const step of stepsOf(job).filter(s => s.run !== undefined)) {
        const key = `${jobId}/${String(step.id)}`
        if (/\bnode\b/.test(runOf(step))) {
          seen.push(key)
          expect(runOf(step).replace(/\n$/, ''), key).toBe(`set -euo pipefail\n${commands[key]}`)
        }
      }
    }
    expect(seen).toEqual(Object.keys(commands))
  })
  test('job outputs', () => {
    expect(Object.fromEntries(Object.entries(jobs()).filter(([, j]) => j.outputs).map(([k, v]) => [k, v.outputs]))).toEqual({
      build: { 'artifact-id': '${{ steps.upload.outputs.artifact-id }}' },
      inspect: { 'artifact-id': '${{ steps.check-inputs.outputs.artifact-id }}', sha256: '${{ steps.inspect.outputs.sha256 }}' },
      sign: { 'artifact-id': '${{ steps.upload.outputs.artifact-id }}', sha256: '${{ steps.check-signed.outputs.sha256 }}' },
    })
  })
  test('ids and hashes travel only along the chain', () => {
    const where = (needle: string) => Object.entries(jobs()).filter(([, j]) => JSON.stringify(j).includes(needle)).map(([k]) => k)
    expect(where('needs.build.outputs')).toEqual(['inspect'])
    expect(where('needs.inspect.outputs')).toEqual(['sign'])
    expect(where('needs.sign.outputs')).toEqual(['inspect-signed'])
    expect(asObj(stepById(reusable(), 'inspect', 'check-inputs').env)).toEqual({ ARTIFACT_ID: '${{ needs.build.outputs.artifact-id }}' })
    expect(asObj(stepById(reusable(), 'sign', 'check-unsigned').env)).toEqual({ UNSIGNED_SHA256: '${{ needs.inspect.outputs.sha256 }}' })
    expect(asObj(stepById(reusable(), 'sign', 'download').with)['artifact-ids']).toBe('${{ needs.inspect.outputs.artifact-id }}')
    expect(asObj(stepById(reusable(), 'inspect-signed', 'inspect').env).EXPECTED_SHA256).toBe('${{ needs.sign.outputs.sha256 }}')
    expect(asObj(stepById(reusable(), 'inspect-signed', 'download').with)['artifact-ids']).toBe('${{ needs.sign.outputs.artifact-id }}')
  })
  test('the check steps receive exactly the chained values and the variable', () => {
    expect(stepById(reusable(), 'sign', 'check-inputs').env).toEqual({
      ARTIFACT_ID: '${{ needs.inspect.outputs.artifact-id }}',
      UNSIGNED_SHA256: '${{ needs.inspect.outputs.sha256 }}',
      EXPECTED_CERT_SHA256: '${{ vars.ANDROID_RELEASE_CERT_SHA256 }}',
    })
    expect(stepById(reusable(), 'sign', 'check-signed').env).toEqual({ EXPECTED_CERT_SHA256: '${{ vars.ANDROID_RELEASE_CERT_SHA256 }}' })
    expect(stepById(reusable(), 'inspect-signed', 'check-inputs').env).toEqual({
      ARTIFACT_ID: '${{ needs.sign.outputs.artifact-id }}',
      SIGNED_SHA256: '${{ needs.sign.outputs.sha256 }}',
    })
  })
  test('the variable has three places, retention is 3 and 14 days, each upload is one file', () => {
    const uses = workflowFiles.flatMap(f => leaves(load(f)).filter(l => l.value.includes(`vars.${VARIABLE}`)).map(l => `${f}:${l.loc.slice(0, 2).join('.')}:${l.loc.slice(-1)[0]}`))
    expect(uses).toEqual([
      `${RELEASE}:jobs.guard:REPO_HAS_${VARIABLE}`,
      `${RELEASE}:jobs.sign:EXPECTED_CERT_SHA256`,
      `${RELEASE}:jobs.sign:EXPECTED_CERT_SHA256`,
    ])
    const upload = (job: string) => asObj(stepById(reusable(), job, 'upload').with)
    expect(upload('build')['retention-days']).toBe(3)
    expect(upload('sign')['retention-days']).toBe(14)
    for (const job of ['build', 'sign']) {
      expect(upload(job)['if-no-files-found']).toBe('error')
      expect(String(upload(job).path)).toMatch(/^\$\{\{ runner\.temp \}\}\/[a-z]+\/app-(unsigned|release)\.apk$/)
    }
  })
})

describe('W6: documents carry both names and the ref sentence', () => {
  const sentence = 'The environment rule checks the ref a run starts from, not code that the run checks out later.'
  const recovery = 'After changing a variable or secret, confirm that no repository-level copy exists before "Re-run failed jobs", or use "Re-run all jobs", because a partial re-run does not repeat guard.'
  const files = (): Record<string, string> => ({
    [BUILD]: text(BUILD),
    [RELEASE]: text(RELEASE),
    'SIGNING.md': readFileSync(path.join(root, 'Agents', 'Tools', 'device', 'SIGNING.md'), 'utf8'),
  })
  test.each([BUILD, RELEASE, 'SIGNING.md'])('%s', name => {
    const body = files()[name].replace(/\r\n/g, '\n')
    expect(body).toContain(ENVIRONMENT)
    expect(body).toContain(VARIABLE)
    expect(body.split('\n').some(l => l.includes(sentence)), 'ref sentence on one line').toBe(true)
    expect(body.split('\n').some(l => l.includes(recovery)), 'recovery sentence on one line').toBe(true)
  })
  test('the reusable header states its trust boundary', () => {
    const body = files()[RELEASE]
    expect(body).toContain('sign runs sha256sum and apksigner (Java) and no native APK parser.')
    expect(body).toContain('the variable is public and appears in logs: never put a secret in it')
    expect(body).toContain('never install or share an APK from a red run, even though its artifact exists')
  })
})

// A file hash, no certificate fingerprint. This file is the signing boundary: changing it is a signing-contract change.
const RELEASE_WORKFLOW_FILE_SHA256 = 'be61e8a575461b1dd1c92a2df5174ed37f0ee83a491703569fe15f02642b14c8'
describe('W7: the release workflow is the reviewed file', () => {
  test('file hash', () => {
    const body = readFileSync(path.join(workflowDir, RELEASE)).toString('latin1').replace(/\r\n/g, '\n')
    expect(createHash('sha256').update(body, 'latin1').digest('hex')).toBe(RELEASE_WORKFLOW_FILE_SHA256)
  })
})

describe('A1: the node steps as written', () => {
  test.each([
    ['guard/guard', '::error::guard: release builds run only from the main branch'],
    ['inspect/inspect', '::error::inspect: the ABI must be aarch64 or all.'],
    ['inspect-signed/inspect', '::error::inspect: the ABI must be aarch64 or all.'],
  ])('%s refuses in an empty environment', (key, line) => {
    const [job, id] = key.split('/')
    const file = path.join(makeCase().dir, 'node-step.sh')
    writeFileSync(file, stepRun(job, id))
    const r = spawnSync(bashFile, ['--noprofile', '--norc', '-eo', 'pipefail', fwd(file)], {
      cwd: root,
      encoding: 'utf8',
      timeout: 20000,
      env: { PATH: `${path.dirname(process.execPath)}${isWin ? ';' : ':'}${basePath}`, ...(isWin ? { SYSTEMROOT: process.env.SystemRoot ?? 'C:\\Windows' } : {}) },
    })
    expect(r.status, `${r.stdout}${r.stderr}`).toBe(1)
    expect(r.stdout).toContain(line)
  })
})

// ---------------------------------------------------------------- B-2..B-4
const stepRun = (job: string, id: string) => runOf(stepById(reusable(), job, id))
const HOSTILE = 'x\n::error::pwned-by-input'

describe('B-2: collect', () => {
  const dirName = 'src-tauri/gen/android/app/build/outputs/apk/universal/release'
  const collect = (files: Record<string, string>) => {
    const c = makeCase()
    mkdirSync(path.join(c.work, dirName), { recursive: true })
    for (const [name, body] of Object.entries(files)) writeFileSync(path.join(c.work, dirName, name), body)
    return { c, r: runShell(c, stepRun('build', 'collect')) }
  }
  test('the unsigned file is copied under its fixed name', () => {
    const { c, r } = collect({ 'app-universal-release-unsigned.apk': 'unsigned-bytes' })
    expect(r.status, r.all).toBe(0)
    expect(readFileSync(path.join(c.temp, 'unsigned', 'app-unsigned.apk'), 'utf8')).toBe('unsigned-bytes')
  })
  test('a missing file is refused', () => {
    const { c, r } = collect({})
    expect(r.status).toBe(1)
    expect(existsSync(path.join(c.temp, 'unsigned'))).toBe(false)
  })
  test('a signed-name file is refused, even next to a good one, and nothing is copied', () => {
    const { c, r } = collect({ 'app-universal-release.apk': 'signed', 'app-universal-release-unsigned.apk': 'unsigned-bytes' })
    expect(r.status).toBe(1)
    expect(r.all).toContain('::error::Gradle produced a signed release APK name')
    expect(existsSync(path.join(c.temp, 'unsigned'))).toBe(false)
  })
})

const HEX = (ch: string) => ch.repeat(64)
function refused(r: Ran, hostile = 'pwned-by-input') {
  expect(r.status, r.all).not.toBe(0)
  expect(r.all).not.toContain(hostile)
}

describe('B-3: the checks between the jobs', () => {
  test('inspect check-inputs: only a plain number passes', () => {
    const run = stepRun('inspect', 'check-inputs')
    const ok = makeCase()
    expect(runShell(ok, run, { ARTIFACT_ID: '4711' }).status).toBe(0)
    expect(readFileSync(ok.output, 'utf8')).toBe('artifact-id=4711\n')
    for (const bad of ['', 'abc', '12 34', '12\n34', HOSTILE, '1;2', '-1', '0x10']) {
      const c = makeCase()
      refused(runShell(c, run, { ARTIFACT_ID: bad }))
      expect(readFileSync(c.output, 'utf8')).toBe('')
    }
    refused(runShell(makeCase(), run))
  })

  const signInputs = (over: Record<string, string | undefined> = {}) => {
    const env: Record<string, string> = { ARTIFACT_ID: '4711', UNSIGNED_SHA256: HEX('a'), EXPECTED_CERT_SHA256: HEX('b') }
    for (const [k, v] of Object.entries(over)) {
      if (v === undefined) delete env[k]
      else env[k] = v
    }
    const c = makeCase()
    installApksigner(c)
    return runShell(c, stepRun('sign', 'check-inputs'), env)
  }
  test('sign check-inputs: id, hash, signer value and tool', () => {
    expect(signInputs().status).toBe(0)
    for (const bad of ['', 'abc', '12 34', HOSTILE]) refused(signInputs({ ARTIFACT_ID: bad }))
    for (const bad of ['', HEX('A'), 'a'.repeat(63), 'a'.repeat(65), HEX('g'), `${HEX('a')}\n`, HOSTILE, `${HEX('a')} `]) refused(signInputs({ UNSIGNED_SHA256: bad }))
    for (const bad of ['', HEX('B'), 'b'.repeat(63), 'b'.repeat(65), `${'bb:'.repeat(31)}bb`, ` ${HEX('b')}`, `${HEX('b')}\n`, `${HEX('b')} `, HOSTILE]) {
      refused(signInputs({ EXPECTED_CERT_SHA256: bad }))
    }
    refused(signInputs({ EXPECTED_CERT_SHA256: undefined }))
    const noTool = makeCase()
    refused(runShell(noTool, stepRun('sign', 'check-inputs'), { ARTIFACT_ID: '4711', UNSIGNED_SHA256: HEX('a'), EXPECTED_CERT_SHA256: HEX('b') }))
  })

  test('inspect-signed check-inputs: id and hash', () => {
    const run = (env: Record<string, string>) => runShell(makeCase(), stepRun('inspect-signed', 'check-inputs'), env)
    const good = { ARTIFACT_ID: '4711', SIGNED_SHA256: HEX('a') }
    expect(run(good).status).toBe(0)
    for (const bad of ['', 'abc', '12 34', HOSTILE]) {
      const r = run({ ...good, ARTIFACT_ID: bad })
      refused(r)
      expect(r.all).toContain('::error::The signed artifact id from sign is not a number.')
    }
    for (const bad of ['', HEX('A'), 'a'.repeat(63), 'a'.repeat(65), HEX('g'), `${HEX('a')}\n`, HOSTILE, `${HEX('a')} `]) {
      const r = run({ ...good, SIGNED_SHA256: bad })
      refused(r)
      expect(r.all).toContain('::error::The signed file hash from sign is not 64 lower-case hex digits.')
    }
    refused(run({ SIGNED_SHA256: HEX('a') }))
    refused(run({ ARTIFACT_ID: '4711' }))
  })

  const unsigned = (build: (c: Case, inDir: string) => void, hash: string) => {
    const c = makeCase()
    const inDir = path.join(c.temp, 'in')
    mkdirSync(inDir, { recursive: true })
    build(c, inDir)
    return runShell(c, stepRun('sign', 'check-unsigned'), { UNSIGNED_SHA256: hash })
  }
  test('sign check-unsigned: the one regular file with the inspected hash', () => {
    const put = (inDir: string) => writeFileSync(path.join(inDir, 'app-unsigned.apk'), 'inspected-bytes')
    expect(unsigned((_, d) => put(d), sha256('inspected-bytes')).status).toBe(0)
    refused(unsigned((_, d) => put(d), sha256('other-bytes')))
    refused(unsigned((_, d) => { put(d); writeFileSync(path.join(d, 'extra.apk'), 'x') }, sha256('inspected-bytes')))
    refused(unsigned((_, d) => { put(d); writeFileSync(path.join(d, '.hidden'), 'x') }, sha256('inspected-bytes')))
    refused(unsigned(() => undefined, sha256('inspected-bytes')))
    refused(unsigned((_, d) => writeFileSync(path.join(d, 'other.apk'), 'inspected-bytes'), sha256('inspected-bytes')))
    refused(unsigned((_, d) => mkdirSync(path.join(d, 'app-unsigned.apk')), sha256('inspected-bytes')))
  })
  test('sign check-unsigned: a linked file is refused', ctx => {
    let skipped = false
    const r = unsigned((c, d) => {
      const target = path.join(c.dir, 'target.apk')
      writeFileSync(target, 'inspected-bytes')
      try {
        symlinkSync(target, path.join(d, 'app-unsigned.apk'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EPERM' && !process.env.CI) skipped = true
        else throw error
      }
    }, sha256('inspected-bytes'))
    if (skipped) {
      ctx.skip()
      return
    }
    refused(r)
  })

  const signer = (verify: string | null, over: Record<string, string> = {}, status = 0) => {
    const c = makeCase()
    installApksigner(c)
    mkdirSync(path.join(c.temp, 'out'), { recursive: true })
    writeFileSync(path.join(c.temp, 'out', 'app-release.apk'), 'signed-bytes')
    const env: Record<string, string> = { EXPECTED_CERT_SHA256: HEX('b'), FAKE_VERIFY_STATUS: String(status), ...over }
    if (verify !== null) {
      writeFileSync(path.join(c.dir, 'verify.txt'), verify)
      env.FAKE_VERIFY_FILE = fwd(path.join(c.dir, 'verify.txt'))
    }
    return { c, r: runShell(c, stepRun('sign', 'check-signed'), env) }
  }
  const digest = (n: number, hex: string) => `Signer #${n} certificate SHA-256 digest: ${hex}\nSigner #${n} certificate SHA-1 digest: ${'c'.repeat(40)}\n`
  test('sign check-signed: exactly one signer line, equal to the variable', () => {
    const good = signer(`Signer #1 certificate DN: CN=x\n${digest(1, HEX('b'))}`)
    expect(good.r.status, good.r.all).toBe(0)
    expect(readFileSync(good.c.output, 'utf8')).toBe(`sha256=${sha256('signed-bytes')}\n`)
    expect(good.r.stdout.trim()).toBe(`Signer #1 certificate SHA-256 digest: ${HEX('b')}`)
    expect(signer(`${digest(1, HEX('b'))}`.replace(/\n/g, '\r\n')).r.status).toBe(0)
    for (const bad of [
      '',
      digest(1, HEX('d')),
      `${digest(1, HEX('b'))}${digest(2, HEX('b'))}`,
      `${digest(1, HEX('b'))}${digest(2, HEX('d'))}`,
      digest(1, HEX('b')).replace('Signer #1', 'Signer #2'),
      `${digest(1, HEX('b'))}::error::pwned-by-input\n`.replace('Signer #1 certificate SHA-1 digest', 'Signer #1 certificate SHA-256 digest'),
    ]) {
      const { r } = signer(bad)
      refused(r)
    }
    refused(signer(digest(1, HEX('b')), {}, 1).r)
    refused(signer(null).r)
    const hostile = signer(`Signer #1 certificate DN: CN=::error::pwned-by-input\n${digest(1, HEX('d'))}`)
    refused(hostile.r)
  })
})

describe('B-4: the sign step', () => {
  const keystore = 'RISU-FAKE-KEYSTORE-BYTES'
  const secrets = (over: Record<string, string> = {}): Record<string, string> => ({
    ANDROID_KEYSTORE_BASE64: Buffer.from(keystore).toString('base64').replace(/(.{8})/g, '$1\n'),
    ANDROID_KEYSTORE_PASSWORD: 'MARKER-STORE-PASS',
    ANDROID_KEY_ALIAS: 'MARKER-ALIAS',
    ANDROID_KEY_PASSWORD: 'MARKER-KEY-PASS',
    ...over,
  })
  const sign = (over: Record<string, string> = {}, fake: Record<string, string> = {}) => {
    const c = makeCase()
    installApksigner(c)
    mkdirSync(path.join(c.temp, 'in'), { recursive: true })
    writeFileSync(path.join(c.temp, 'in', 'app-unsigned.apk'), 'unsigned-bytes')
    return { c, r: runShell(c, stepRun('sign', 'sign'), { ...secrets(over), ...fake }) }
  }
  const noLeak = (r: Ran) => {
    for (const marker of ['MARKER-STORE-PASS', 'MARKER-ALIAS', 'MARKER-KEY-PASS', 'injected-by-apksigner', 'RISU-FAKE-KEYSTORE']) expect(r.all).not.toContain(marker)
  }
  test('a good run decodes the key, signs into a fresh out folder and leaves no key by the exit trap alone', () => {
    const { c, r } = sign()
    expect(r.status, r.all).toBe(0)
    noLeak(r)
    expect(readFileSync(path.join(c.temp, 'out', 'app-release.apk'), 'utf8')).toBe('unsigned-bytes')
    expect(readFileSync(c.env.FAKE_LOG, 'utf8')).toContain(`sign keystore=${keystore}`)
    expect(existsSync(path.join(c.temp, 'signing-key'))).toBe(false)
  })
  test('a failing apksigner prints no marker and no workflow command of its own, and the key is gone', () => {
    const { c, r } = sign({}, { FAKE_SIGN: 'fail' })
    expect(r.status).toBe(1)
    expect(r.all).toContain('::error::Signing failed.')
    noLeak(r)
    expect(readFileSync(c.env.FAKE_LOG, 'utf8')).toContain('sign keystore=')
    expect(existsSync(path.join(c.temp, 'signing-key'))).toBe(false)
    expect(existsSync(path.join(c.temp, 'out', 'app-release.apk'))).toBe(false)
  })
  test.each(FOUR)('an empty %s is refused before the key is written', name => {
    const { c, r } = sign({ [name]: '' })
    expect(r.status).toBe(1)
    expect(r.all).toContain(`::error::Secret ${name} is empty`)
    noLeak(r)
    expect(existsSync(path.join(c.temp, 'signing-key'))).toBe(false)
    expect(existsSync(c.env.FAKE_LOG)).toBe(false)
  })
  test('bad base64 is refused without calling apksigner and without a key left', () => {
    const { c, r } = sign({ ANDROID_KEYSTORE_BASE64: '!!not*base64!!' })
    expect(r.status).toBe(1)
    expect(r.all).toContain('::error::The keystore secret is not valid base64.')
    noLeak(r)
    expect(existsSync(c.env.FAKE_LOG)).toBe(false)
    expect(existsSync(path.join(c.temp, 'signing-key'))).toBe(false)
  })
})
