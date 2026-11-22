// Release-APK checks for .github/workflows/android-release-apk.yml. Node built-ins only, so a runner needs no install.
//
//   node util/androidRelease.mjs guard               refuses a dispatch before any build starts
//   node util/androidRelease.mjs inspect unsigned    identity rules on the unsigned build output
//   node util/androidRelease.mjs inspect signed      the same rules on the signed bytes, plus 16 KB alignment
//
// Importing this file has no effect. Every message printed is a fixed text plus values this script computed or
// expects: never a value taken from the APK, a tool's output or an exception, because an APK is untrusted input
// and its text could otherwise become a workflow command.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const TAURI_CONF = path.resolve(here, '..', 'src-tauri', 'tauri.conf.json')
const CONTRACT = path.resolve(here, '..', 'src-tauri', 'gen', 'android', 'app', 'src', 'test', 'resources', 'app-update-v1', 'contract.properties')

export const PACKAGE_NAME = 'io.github.yor42.risutanium'
export const BUILD_TOOLS = '36.0.0'
export const ENVIRONMENT = 'android-release'
export const GUARD_TIMEOUT_MS = 15000
export const SECRET_NAMES = ['ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']
export const VARIABLE_NAME = 'ANDROID_RELEASE_CERT_SHA256'
export const ABI_SETS = {
    aarch64: ['arm64-v8a'],
    all: ['arm64-v8a', 'armeabi-v7a', 'x86', 'x86_64'],
}
const ANDROID_NS = 'http://schemas.android.com/apk/res/android'
const TOOL_TIMEOUT_MS = 60000
const TOOL_OUTPUT_LIMIT = 64 * 1024 * 1024

/** A refusal carries only a fixed text. Anything else that is thrown becomes UNEXPECTED. */
export class Refusal extends Error {
    constructor(line) {
        super(line)
        this.line = line
    }
}
const UNEXPECTED = '::error::unexpected failure; nothing was changed'

function refuse(rule, text) {
    throw new Refusal(`::error::${rule}: ${text}`)
}

// ---------------------------------------------------------------- version rule

function parseProperties(text) {
    const values = {}
    for (const raw of text.split('\n')) {
        const line = raw.replace(/\r$/, '')
        if (line === '' || line.startsWith('#')) continue
        const at = line.indexOf('=')
        if (at > 0) values[line.slice(0, at).trim()] = line.slice(at + 1).trim()
    }
    return values
}

/**
 * The release version rule: three dot-separated numbers without leading zeros, minor and patch at most 999, and a
 * version code major*1000000 + minor*1000 + patch inside the frozen update contract's bounds.
 */
export function releaseVersion(confText, contractText) {
    const bad = (min, max) => {
        throw new Refusal(`::error::guard: src-tauri/tauri.conf.json version must be MAJOR.MINOR.PATCH without leading zeros, minor and patch at most 999, with version code major*1000000 + minor*1000 + patch between ${min} and ${max}.`)
    }
    const props = parseProperties(contractText)
    const min = Number(props.versionCodeMin)
    const max = Number(props.versionCodeMax)
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 0 || max < min) {
        throw new Refusal('::error::guard: the update contract bounds are unreadable.')
    }
    let version
    try {
        version = JSON.parse(confText).version
    } catch {
        return bad(min, max)
    }
    const match = typeof version === 'string' ? /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})$/.exec(version) : null
    if (!match) return bad(min, max)
    const code = Number(match[1]) * 1000000 + Number(match[2]) * 1000 + Number(match[3])
    if (code < min || code > max) return bad(min, max)
    return { version, code }
}

function readExpectation(config) {
    if (config) return config
    return releaseVersion(readFileSync(TAURI_CONF, 'utf8'), readFileSync(CONTRACT, 'utf8'))
}

// ---------------------------------------------------------------- guard

async function getJson(url, token, timeoutMs) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'risutanium-android-release-guard',
            },
            redirect: 'error',
            signal: controller.signal,
        })
        if (response.status !== 200) return null
        return await response.json()
    } catch {
        return null
    } finally {
        clearTimeout(timer)
    }
}

/** Returns the list of error lines; an empty list means the dispatch may continue. */
export async function guard(env, { timeoutMs = GUARD_TIMEOUT_MS, config } = {}) {
    const errors = []
    if (env.GITHUB_REF !== 'refs/heads/main') {
        errors.push('::error::guard: release builds run only from the main branch (refs/heads/main). Dispatch the workflow from main.')
    }
    if (!Object.hasOwn(ABI_SETS, env.ABI ?? '')) {
        errors.push('::error::guard: the ABI must be aarch64 or all.')
    }
    try {
        readExpectation(config)
    } catch (error) {
        errors.push(error instanceof Refusal ? error.line : UNEXPECTED)
    }
    for (const name of SECRET_NAMES) {
        if (env[`REPO_HAS_${name}`] !== 'false') {
            errors.push(`::error::guard: a repository-level secret ${name} exists or could not be checked. Delete it at repository level (Settings > Secrets and variables > Actions > Repository secrets); only the environment ${ENVIRONMENT} may hold it.`)
        }
    }
    if (env[`REPO_HAS_${VARIABLE_NAME}`] !== 'false') {
        errors.push(`::error::guard: a repository-level variable ${VARIABLE_NAME} exists or could not be checked. Delete it at repository level (Settings > Secrets and variables > Actions > Variables > Repository variables); only the environment ${ENVIRONMENT} may hold it.`)
    }
    const api = env.GITHUB_API_URL
    const repository = env.GITHUB_REPOSITORY
    const token = env.GITHUB_TOKEN
    if (!api || !token || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) {
        errors.push('::error::guard: the GitHub API address, repository or token is missing, so the environment cannot be checked.')
    }
    if (errors.length > 0) return errors

    const base = `${api}/repos/${repository}/environments/${ENVIRONMENT}`
    const environment = await getJson(base, token, timeoutMs)
    const policy = environment?.deployment_branch_policy
    if (!policy || policy.custom_branch_policies !== true || policy.protected_branches !== false) {
        return [`::error::guard: environment ${ENVIRONMENT} could not be read, or it does not restrict deployments to selected branches (custom branch policies on, protected branches off).`]
    }
    const rules = await getJson(`${base}/deployment-branch-policies?per_page=100`, token, timeoutMs)
    const list = rules?.branch_policies
    if (!Array.isArray(list) || list.length !== 1 || list[0]?.name !== 'main' || list[0]?.type !== 'branch') {
        return [`::error::guard: environment ${ENVIRONMENT} could not be read, or its deployment branch rules are not exactly one rule: the branch main.`]
    }
    return []
}

// ---------------------------------------------------------------- inspect: manifest rules (K1..K3)

/** Normalise an aapt2 dump: LF split, one trailing CR removed, leading spaces removed, nothing else. */
export function dumpLines(stdout) {
    return stdout.split('\n').map(line => line.replace(/\r$/, '').replace(/^ +/, ''))
}

/** K1..K3 over one aapt2 xmltree dump. Throws a Refusal naming the rule. */
export function checkManifestDump(stdout, expected) {
    const lines = dumpLines(stdout)
    const exactly = (select, want) => {
        const hits = lines.filter(select)
        return hits.length === 1 && hits[0] === want
    }
    const codeLine = `A: ${ANDROID_NS}:versionCode(0x0101021b)=${expected.code}`
    const nameLine = `A: ${ANDROID_NS}:versionName(0x0101021c)="${expected.version}" (Raw: "${expected.version}")`
    const packageLine = `A: package="${PACKAGE_NAME}" (Raw: "${PACKAGE_NAME}")`
    if (!exactly(line => line.includes('versionCode') || line.includes('0x0101021b') || line.includes('0x01010576'), codeLine)) {
        refuse('inspect K1', `the manifest must carry exactly one version code line, equal to ${expected.code}, and no other line that names a version code.`)
    }
    if (lines.some(line => line.includes('debuggable') || line.includes('0x0101000f') || line.includes('testOnly') || line.includes('0x01010272'))) {
        refuse('inspect K2', 'the manifest must not mention debuggable or testOnly in any form.')
    }
    if (!exactly(line => line.includes('versionName') || line.includes('0x0101021c'), nameLine)) {
        refuse('inspect K3', `the manifest must carry exactly one version name line, equal to "${expected.version}".`)
    }
    if (!exactly(line => line.startsWith('A: package'), packageLine)) {
        refuse('inspect K3', `the manifest must carry exactly one package line, equal to ${PACKAGE_NAME}.`)
    }
    if (lines.some(line => line.startsWith('A: split'))) {
        refuse('inspect K3', 'the manifest must not declare a split.')
    }
}

// ---------------------------------------------------------------- inspect: central directory rules (K4, K5)

const END_SIGNATURE = 0x06054b50
const ENTRY_SIGNATURE = 0x02014b50

/** K4: the central directory's entry names, or a Refusal. Reads no local header, entry data or manifest byte. */
export function readCentralDirectory(bytes) {
    const fail = () => refuse('inspect K4', 'the ZIP central directory is not a plain, unambiguous list of uniquely and plainly named entries.')
    if (bytes.length < 22) return fail()
    const end = bytes.length - 22
    if (bytes.readUInt32LE(end) !== END_SIGNATURE || bytes.readUInt16LE(end + 20) !== 0) return fail()
    const count = bytes.readUInt16LE(end + 10)
    const size = bytes.readUInt32LE(end + 12)
    const offset = bytes.readUInt32LE(end + 16)
    if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) return fail()
    const names = []
    const seen = new Set()
    let at = offset
    while (at < end) {
        if (at + 46 > end || bytes.readUInt32LE(at) !== ENTRY_SIGNATURE) return fail()
        const nameLength = bytes.readUInt16LE(at + 28)
        const extraLength = bytes.readUInt16LE(at + 30)
        const commentLength = bytes.readUInt16LE(at + 32)
        const next = at + 46 + nameLength + extraLength + commentLength
        if (next > end) return fail()
        const raw = bytes.subarray(at + 46, at + 46 + nameLength)
        for (const byte of raw) {
            if (byte < 0x20 || byte === 0x7f) return fail()
        }
        const name = raw.toString('latin1')
        if (seen.has(name)) return fail()
        seen.add(name)
        names.push(name)
        at = next
    }
    if (at !== end || names.length !== count) return fail()
    return names
}

/** K5: the lib/<abi>/ directories are exactly the expected set and each holds libalib.so. */
export function checkLibraries(names, abis) {
    const found = new Set()
    for (const name of names) {
        if (!name.startsWith('lib/')) continue
        const match = /^lib\/([^/]+)\//.exec(name)
        if (!match) refuse('inspect K5', `the native library folders must be exactly: ${abis.join(', ')}.`)
        found.add(match[1])
    }
    const same = found.size === abis.length && abis.every(abi => found.has(abi))
    if (!same || !abis.every(abi => names.includes(`lib/${abi}/libalib.so`))) {
        refuse('inspect K5', `the native library folders must be exactly: ${abis.join(', ')}, each holding libalib.so.`)
    }
}

// ---------------------------------------------------------------- inspect

function toolName(name) {
    return process.platform === 'win32' ? `${name}.exe` : name
}

/** Runs one tool without a shell. The result carries stdout as latin1 text and never stderr. */
export function runTool(file, args) {
    const result = spawnSync(file, args, {
        shell: false,
        encoding: 'latin1',
        timeout: TOOL_TIMEOUT_MS,
        maxBuffer: TOOL_OUTPUT_LIMIT,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
    })
    return { status: result.status, signal: result.signal, error: result.error, stdout: result.stdout }
}

function toolFailed(result) {
    return !result || result.error || result.signal || result.status !== 0 || typeof result.stdout !== 'string'
}

function sha256Of(bytes) {
    return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Both modes read one regular file once, hash that buffer and apply K0..K5; signed mode first compares the hash with
 * the one sign reported, and then also runs zipalign (K6). Returns { sha256 } or throws a Refusal.
 */
export function inspect(mode, env, { tool = runTool, config } = {}) {
    if (mode !== 'unsigned' && mode !== 'signed') refuse('inspect', 'the mode must be unsigned or signed.')
    const abis = Object.hasOwn(ABI_SETS, env.ABI ?? '') ? ABI_SETS[env.ABI] : null
    if (!abis) refuse('inspect', 'the ABI must be aarch64 or all.')
    if (!env.APK_DIR) refuse('inspect', 'the APK folder is not set.')
    const home = env.ANDROID_HOME
    if (!home) refuse('inspect', `the Android SDK location is not set; build-tools ${BUILD_TOOLS} is required.`)
    if (mode === 'signed' && !/^[0-9a-f]{64}$/.test(env.EXPECTED_SHA256 ?? '')) {
        refuse('inspect', 'the expected signed hash must be 64 lower-case hex digits.')
    }
    const expected = readExpectation(config)

    const fileName = mode === 'signed' ? 'app-release.apk' : 'app-unsigned.apk'
    const entries = readdirSync(env.APK_DIR)
    const one = entries.length === 1 ? lstatSync(path.join(env.APK_DIR, entries[0])) : null
    if (!one || entries[0] !== fileName || !one.isFile() || one.isSymbolicLink()) {
        refuse('inspect', `the folder must hold exactly one regular file, ${fileName}.`)
    }
    const apk = path.join(env.APK_DIR, fileName)
    const bytes = readFileSync(apk)
    const sha256 = sha256Of(bytes)
    if (mode === 'signed' && sha256 !== env.EXPECTED_SHA256) {
        refuse('inspect', 'the signed file is not the file that sign reported.')
    }

    const buildTools = path.join(home, 'build-tools', BUILD_TOOLS)
    const dump = tool(path.join(buildTools, toolName('aapt2')), ['dump', 'xmltree', '--file', 'AndroidManifest.xml', apk])
    if (toolFailed(dump)) {
        refuse('inspect K0', `aapt2 from build-tools ${BUILD_TOOLS} did not run cleanly (missing, timed out, over the output limit, signalled or a non-zero exit).`)
    }
    checkManifestDump(dump.stdout, expected)
    checkLibraries(readCentralDirectory(bytes), abis)
    if (mode === 'signed') {
        const aligned = tool(path.join(buildTools, toolName('zipalign')), ['-c', '-P', '16', '4', apk])
        if (toolFailed(aligned)) {
            refuse('inspect K6', 'the signed file is not aligned for 16 KB pages (zipalign -c -P 16 4).')
        }
    }
    return { sha256, expected, abis }
}

// ---------------------------------------------------------------- command line

/** Returns the exit code. Output lines go through `log`. */
export async function main(argv, env = process.env, log = console.log) {
    try {
        const [command, mode] = argv
        if (command === 'guard' && argv.length === 1) {
            const errors = await guard(env)
            for (const line of errors) log(line)
            if (errors.length === 0) log(`guard: main branch, no repository-level copies, environment ${ENVIRONMENT} restricted to main.`)
            return errors.length === 0 ? 0 : 1
        }
        if (command === 'inspect' && argv.length === 2 && (mode === 'unsigned' || mode === 'signed')) {
            const result = inspect(mode, env)
            if (mode === 'unsigned') {
                if (!env.GITHUB_OUTPUT) refuse('inspect', 'the step output file is not set.')
                appendFileSync(env.GITHUB_OUTPUT, `sha256=${result.sha256}\n`)
            }
            log(`inspect ${mode}: identity rules passed for version ${result.expected.version} (code ${result.expected.code}), libraries ${result.abis.join(', ')}, sha256=${result.sha256}`)
            return 0
        }
        log('::error::usage: androidRelease.mjs guard | inspect unsigned | inspect signed')
        return 2
    } catch (error) {
        log(error instanceof Refusal ? error.line : UNEXPECTED)
        return 1
    }
}

/** Both sides go through realpath, so a run through a directory link or a short name still counts as direct. */
function isDirectRun() {
    if (!process.argv[1]) return false
    try {
        const same = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b)
        return same(realpathSync.native(path.resolve(process.argv[1])), realpathSync.native(fileURLToPath(import.meta.url)))
    } catch {
        return false
    }
}

if (isDirectRun()) {
    process.exitCode = await main(process.argv.slice(2))
}
