// Draft-release checks and uploads for .github/workflows/release-desktop.yml. Node built-ins only (fetch included).
//
//   node util/androidPublish.mjs check      before any build: refuses a run that would collide with a release
//   node util/androidPublish.mjs publish    attaches the signed APK and latest-android.json to this commit's draft
//   node util/androidPublish.mjs attach-locks   attaches the resolved Cargo.lock of every build to this commit's draft
//
// Importing this file has no effect. Every message printed is a fixed text plus values this script computed (the tag,
// numeric release and asset ids, the repository constant): never release notes, a draft's name or body, or any other
// text taken from the API, because that text is untrusted and could otherwise become a workflow command. Nothing is
// ever deleted or edited: a conflict is refused, and the commands that would clear it are printed for the maintainer.
// The network goes through an injected `api` function, so the rules run in tests against a fake.
import { createHash } from 'node:crypto'
import { lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Refusal, releaseVersion } from './androidRelease.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const TAURI_CONF = path.resolve(here, '..', 'src-tauri', 'tauri.conf.json')
const CONTRACT = path.resolve(here, '..', 'src-tauri', 'gen', 'android', 'app', 'src', 'test', 'resources', 'app-update-v1', 'contract.properties')

export const REPOSITORY = 'yor42/RisuTanium'
export const API_BASE = 'https://api.github.com'
export const UPLOAD_BASE = 'https://uploads.github.com'
export const LATEST_NAME = 'latest-android.json'
export const SIGNED_NAME = 'app-release.apk'
export const JSON_MAX_BYTES = 262144
export const APK_MAX_BYTES = 2000000000
export const API_TIMEOUT_MS = 15000
export const UPLOAD_TIMEOUT_MS = 15 * 60 * 1000
export const MAX_PAGES = 10
const APK_TYPE = 'application/vnd.android.package-archive'
const UNEXPECTED = '::error::unexpected failure; check the draft release and its assets by hand'
const BAD_ANSWER = '::error::GitHub answered in a form this script does not accept, or the request failed.'
const TOO_MANY = '::error::more releases or assets than this script checks; clean them up by hand first.'

function refuse(text) {
    throw new Refusal(`::error::${text}`)
}

// ---------------------------------------------------------------- names and bytes

/** The two files this script attaches, in upload order: the APK, then the description. */
export function androidAssetNames(version) {
    return [`RisuTanium_${version}_android-universal.apk`, LATEST_NAME]
}

/** An Android file by name: the description, or anything ending in .apk (desktop builds never emit one). */
export function isAndroidAsset(name) {
    return name === LATEST_NAME || name.toLowerCase().endsWith('.apk')
}

export function apkUrl(version) {
    return `https://github.com/${REPOSITORY}/releases/download/v${version}/${androidAssetNames(version)[0]}`
}

/** latest-android.json version 1: key order version, versionCode, notes, url, size, then a newline. Notes stay as typed. */
export function buildLatestJson({ version, code, notes, size }) {
    if (typeof notes !== 'string') refuse('the release notes are not text.')
    if (!Number.isSafeInteger(size) || size < 1 || size > APK_MAX_BYTES) refuse('the APK size is outside 1..2000000000 bytes.')
    const text = `${JSON.stringify({ version, versionCode: code, notes, url: apkUrl(version), size })}\n`
    if (Buffer.byteLength(text, 'utf8') > JSON_MAX_BYTES) refuse(`the release notes are too long for ${LATEST_NAME} (limit ${JSON_MAX_BYTES} bytes).`)
    return text
}

/** One `gh` command per asset that blocks a re-upload. The asset id form needs no tag lookup, which a draft lacks. */
export function deleteCommands(assets) {
    return assets.map(asset => `gh api -X DELETE repos/${REPOSITORY}/releases/assets/${asset.id}`)
}

// ---------------------------------------------------------------- API answers

/** The releases carrying this tag, reduced to the three fields the rules use. Entries of other tags are ignored. */
export function tagReleases(list, tag) {
    if (!Array.isArray(list)) throw new Refusal(BAD_ANSWER)
    const found = []
    for (const item of list) {
        if (typeof item !== 'object' || item === null || item.tag_name !== tag) continue
        if (!Number.isSafeInteger(item.id) || item.id < 1 || typeof item.draft !== 'boolean' || typeof item.target_commitish !== 'string') {
            throw new Refusal(BAD_ANSWER)
        }
        found.push({ id: item.id, draft: item.draft, target: item.target_commitish })
    }
    return found
}

export function normalizeAssets(list) {
    if (!Array.isArray(list)) throw new Refusal(BAD_ANSWER)
    return list.map(item => {
        if (typeof item !== 'object' || item === null || !Number.isSafeInteger(item.id) || item.id < 1 || typeof item.name !== 'string') {
            throw new Refusal(BAD_ANSWER)
        }
        return { id: item.id, name: item.name }
    })
}

/** Every page of a list endpoint until an empty one. Always the paged endpoint: an embedded list may be cut short. */
async function pagedGet(api, url) {
    const out = []
    for (let page = 1; page <= MAX_PAGES; page++) {
        const answer = await api({ method: 'GET', url: `${url}${url.includes('?') ? '&' : '?'}per_page=100&page=${page}` })
        if (answer.status !== 200 || !Array.isArray(answer.body)) throw new Refusal(BAD_ANSWER)
        if (answer.body.length === 0) return out
        out.push(...answer.body)
    }
    throw new Refusal(TOO_MANY)
}

const releasesUrl = repo => `${API_BASE}/repos/${repo}/releases`

async function assetsOf(api, repo, id) {
    return normalizeAssets(await pagedGet(api, `${releasesUrl(repo)}/${id}/assets`))
}

// ---------------------------------------------------------------- release-check

const COMMIT = /^[0-9a-f]{40}$/
const PLAIN_VERSION = /^[0-9A-Za-z.+-]{1,64}$/

/**
 * Rules that need no network. Android on: the version rule of the release workflow, main branch of this repository
 * only, and notes that fit latest-android.json. Android off: a usable tag name only.
 */
export function preflight({ includeAndroid, ref, repo, sha, confText, contractText, notes }) {
    const errors = []
    let version = null
    let code = null
    if (includeAndroid) {
        try {
            ;({ version, code } = releaseVersion(confText, contractText))
        } catch (error) {
            errors.push(error instanceof Refusal ? error.line : UNEXPECTED)
        }
        if (repo !== REPOSITORY || ref !== 'refs/heads/main') {
            errors.push(`::error::release-check: an Android release runs only from the main branch of ${REPOSITORY} (refs/heads/main).`)
        }
    } else {
        try {
            const parsed = JSON.parse(confText).version
            if (typeof parsed === 'string' && PLAIN_VERSION.test(parsed)) version = parsed
        } catch {
            version = null
        }
        if (version === null) errors.push('::error::release-check: the version in src-tauri/tauri.conf.json is not usable as a release tag.')
    }
    if (!COMMIT.test(sha ?? '')) errors.push('::error::release-check: the commit of this run is not a 40-digit lower-case hex id.')
    if (includeAndroid && version !== null) {
        try {
            buildLatestJson({ version, code, notes, size: APK_MAX_BYTES })
        } catch (error) {
            errors.push(error instanceof Refusal ? error.line : UNEXPECTED)
        }
    }
    return { errors, version }
}

/** Which drafts' assets the rules read: Android on, this commit's draft (C6); off, other commits' drafts (C7). */
export function draftsToInspect(includeAndroid, sha, releases) {
    return releases.filter(release => release.draft && (includeAndroid ? release.target === sha : release.target !== sha))
}

function assetsFor(assetsById, id) {
    const list = Object.hasOwn(assetsById, id) ? assetsById[id] : undefined
    if (!Array.isArray(list)) throw new Refusal(BAD_ANSWER)
    return list
}

/** The conflicts between this run and the releases that carry its tag. Returns error lines; empty means go on. */
export function checkRelease({ includeAndroid, sha, version, releases, assetsById }) {
    const tag = `v${version}`
    const lines = []
    const drafts = releases.filter(release => release.draft)
    const mine = drafts.filter(release => release.target === sha)
    const others = drafts.filter(release => release.target !== sha)
    if (includeAndroid) {
        for (const release of releases.filter(item => !item.draft)) {
            lines.push(`::error::release-check: ${tag} is already published (release id ${release.id}). An Android release is never attached to a published release.`)
        }
        for (const release of others) {
            lines.push(`::error::release-check: a draft of ${tag} from another commit exists (release id ${release.id}). Publish or delete it by hand first.`)
        }
        if (mine.length > 1) {
            lines.push(`::error::release-check: ${mine.length} drafts of ${tag} from this commit exist (release ids ${mine.map(release => release.id).join(', ')}). Delete all but one by hand first.`)
        }
        if (mine.length === 1) {
            const names = androidAssetNames(version)
            const held = assetsFor(assetsById, mine[0].id).filter(asset => names.includes(asset.name))
            if (held.length > 0) {
                lines.push(`::error::release-check: the draft of this commit (release id ${mine[0].id}) already holds Android assets. Delete them by hand first:`)
                lines.push(...deleteCommands(held))
            }
        }
    } else {
        for (const release of others) {
            const held = assetsFor(assetsById, release.id).filter(asset => isAndroidAsset(asset.name))
            if (held.length > 0) {
                lines.push(`::error::release-check: the draft of ${tag} from another commit (release id ${release.id}) holds an Android file (asset id ${held[0].id}). Remove it by hand first.`)
            }
        }
    }
    return lines
}

function readRepoConf() {
    return { confText: readFileSync(TAURI_CONF, 'utf8'), contractText: readFileSync(CONTRACT, 'utf8') }
}

function parseMode(env) {
    if (env.INCLUDE_ANDROID !== 'true' && env.INCLUDE_ANDROID !== 'false') refuse('release-check: INCLUDE_ANDROID must be exactly true or false.')
    return env.INCLUDE_ANDROID === 'true'
}

/** Returns { lines, version, includeAndroid }. Empty lines mean the run may build. */
export async function check(env, { api, readConf = readRepoConf }) {
    const includeAndroid = parseMode(env)
    const repo = env.GITHUB_REPOSITORY ?? ''
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) refuse('release-check: the repository name is missing.')
    const { confText, contractText } = readConf()
    const pre = preflight({ includeAndroid, ref: env.GITHUB_REF, repo, sha: env.GITHUB_SHA, confText, contractText, notes: env.RELEASE_NOTES ?? '' })
    if (pre.errors.length > 0) return { lines: pre.errors, version: pre.version, includeAndroid }
    const version = pre.version
    const releases = tagReleases(await pagedGet(api, releasesUrl(repo)), `v${version}`)
    const assetsById = {}
    for (const release of draftsToInspect(includeAndroid, env.GITHUB_SHA, releases)) {
        assetsById[release.id] = await assetsOf(api, repo, release.id)
    }
    return { lines: checkRelease({ includeAndroid, sha: env.GITHUB_SHA, version, releases, assetsById }), version, includeAndroid }
}

// ---------------------------------------------------------------- publish

/** The one draft of this commit, or a Refusal naming why there is not exactly one safe target. */
export function selectDraft(releases, sha, version) {
    const tag = `v${version}`
    const published = releases.filter(release => !release.draft)
    if (published.length > 0) refuse(`publish: ${tag} is already published (release id ${published[0].id}).`)
    const drafts = releases.filter(release => release.draft)
    const others = drafts.filter(release => release.target !== sha)
    if (others.length > 0) refuse(`publish: a draft of ${tag} from another commit exists (release id ${others[0].id}).`)
    const mine = drafts.filter(release => release.target === sha)
    if (mine.length === 0) refuse(`publish: there is no draft of ${tag} from this commit.`)
    if (mine.length > 1) {
        refuse(`publish: race detected, ${mine.length} drafts of ${tag} from this commit (release ids ${mine.map(release => release.id).join(', ')}). Merge or delete them by hand, then re-run publish.`)
    }
    return mine[0]
}

const sha256Of = bytes => createHash('sha256').update(bytes).digest('hex')

/** The folder must hold exactly one regular file, app-release.apk, whose hash is the one the signing job reported. */
function readSignedApk(dir, expectedSha256) {
    if (!dir) refuse('publish: the APK folder is not set.')
    const entries = readdirSync(dir)
    const one = entries.length === 1 ? lstatSync(path.join(dir, entries[0])) : null
    if (!one || entries[0] !== SIGNED_NAME || !one.isFile() || one.isSymbolicLink()) {
        refuse(`publish: the folder must hold exactly one regular file, ${SIGNED_NAME}.`)
    }
    if (one.size < 1 || one.size > APK_MAX_BYTES) refuse('publish: the APK size is outside 1..2000000000 bytes.')
    const bytes = readFileSync(path.join(dir, SIGNED_NAME))
    const sha256 = sha256Of(bytes)
    if (sha256 !== expectedSha256) refuse('publish: the downloaded APK is not the file that the signing job reported.')
    return { bytes, size: bytes.length, sha256 }
}

async function getRelease(api, id) {
    const answer = await api({ method: 'GET', url: `${releasesUrl(REPOSITORY)}/${id}` })
    if (answer.status !== 200 || typeof answer.body !== 'object' || answer.body === null) throw new Refusal(BAD_ANSWER)
    return answer.body
}

async function upload(api, base, name, contentType, bytes) {
    const answer = await api({ method: 'POST', url: `${base}?name=${encodeURIComponent(name)}`, body: bytes, contentType, timeoutMs: UPLOAD_TIMEOUT_MS })
    const asset = answer.body
    const digestOk = asset?.digest === null || asset?.digest === undefined || asset?.digest === `sha256:${sha256Of(bytes)}`
    if (answer.status !== 201 || typeof asset !== 'object' || asset === null || asset.name !== name || asset.size !== bytes.length || asset.state !== 'uploaded' || !digestOk || !Number.isSafeInteger(asset.id)) {
        refuse(`publish: GitHub did not confirm the upload of ${name}. Check the draft's assets by hand before any re-run.`)
    }
    return asset.id
}

/** Returns { ok, lines }. A re-run over existing Android assets prints the delete commands and uploads nothing. */
export async function publish(env, { api, readConf = readRepoConf }) {
    const { confText, contractText } = readConf()
    const { version, code } = releaseVersion(confText, contractText)
    const sha = env.GITHUB_SHA ?? ''
    if (env.GITHUB_REPOSITORY !== REPOSITORY) refuse(`publish: this runs only in ${REPOSITORY}.`)
    if (!COMMIT.test(sha)) refuse('publish: the commit of this run is not a 40-digit lower-case hex id.')
    if (!/^[0-9a-f]{64}$/.test(env.SIGNED_SHA256 ?? '')) refuse('publish: the signed file hash is not 64 lower-case hex digits.')
    const apk = readSignedApk(env.APK_DIR, env.SIGNED_SHA256)
    const json = Buffer.from(buildLatestJson({ version, code, notes: env.RELEASE_NOTES ?? '', size: apk.size }), 'utf8')

    const tag = `v${version}`
    const draft = selectDraft(tagReleases(await pagedGet(api, releasesUrl(REPOSITORY)), tag), sha, version)
    const base = `${UPLOAD_BASE}/repos/${REPOSITORY}/releases/${draft.id}/assets`
    const release = await getRelease(api, draft.id)
    if (release.id !== draft.id || release.draft !== true || release.tag_name !== tag || release.target_commitish !== sha || release.upload_url !== `${base}{?name,label}`) {
        refuse('publish: the draft changed or does not match this run.')
    }
    const [apkName, jsonName] = androidAssetNames(version)
    const held = (await assetsOf(api, REPOSITORY, draft.id)).filter(asset => asset.name === apkName || asset.name === jsonName)
    if (held.length > 0) {
        return { ok: false, lines: [`::error::publish: the draft (release id ${draft.id}) already holds Android assets. Delete them by hand, then re-run publish:`, ...deleteCommands(held)] }
    }

    const apkId = await upload(api, base, apkName, APK_TYPE, apk.bytes)
    const jsonId = await upload(api, base, jsonName, 'application/json', json)
    const after = await getRelease(api, draft.id)
    if (after.id !== draft.id || after.draft !== true || after.target_commitish !== sha) refuse('publish: the draft changed during the upload. Check it by hand.')
    return { ok: true, lines: [`publish: attached ${apkName} (asset id ${apkId}, ${apk.size} bytes) and ${jsonName} (asset id ${jsonId}) to draft release id ${draft.id} of ${tag}.`] }
}

// ---------------------------------------------------------------- attach-locks

export const LOCK_MAX_BYTES = 4 * 1024 * 1024
const LOCK_NAME = /^Cargo\.lock-[0-9A-Za-z._-]{1,80}$/

/** The expected asset names from a comma list: each one Cargo.lock-<label>, no repeats, at least one. */
export function expectedLockNames(text) {
    const names = String(text ?? '').split(',')
    if (names.some(name => !LOCK_NAME.test(name)) || new Set(names).size !== names.length) {
        refuse('attach-locks: EXPECTED_LOCKS must be a comma list of distinct names like Cargo.lock-<target>.')
    }
    return names
}

/** The folder must hold exactly the expected regular files, none empty or over the limit. Nothing from the folder is printed. */
function readLocks(dir, expected) {
    if (!dir) refuse('attach-locks: the lock folder is not set.')
    const entries = readdirSync(dir).sort()
    if (entries.join('\n') !== [...expected].sort().join('\n')) refuse('attach-locks: the folder must hold exactly the expected Cargo.lock files.')
    return entries.map(name => {
        const info = lstatSync(path.join(dir, name))
        if (!info.isFile() || info.isSymbolicLink() || info.size < 1 || info.size > LOCK_MAX_BYTES) {
            refuse(`attach-locks: ${name} is not a regular file of 1..${LOCK_MAX_BYTES} bytes.`)
        }
        return { name, bytes: readFileSync(path.join(dir, name)) }
    })
}

/** Returns { ok, lines }. Like publish: one matching draft of this commit, nothing deleted, a re-run over held names uploads nothing. */
export async function attachLocks(env, { api, readConf = readRepoConf }) {
    const version = (() => {
        try {
            const parsed = JSON.parse(readConf().confText).version
            return typeof parsed === 'string' && PLAIN_VERSION.test(parsed) ? parsed : null
        } catch {
            return null
        }
    })()
    if (version === null) refuse('attach-locks: the version in src-tauri/tauri.conf.json is not usable as a release tag.')
    const sha = env.GITHUB_SHA ?? ''
    if (env.GITHUB_REPOSITORY !== REPOSITORY) refuse(`attach-locks: this runs only in ${REPOSITORY}.`)
    if (!COMMIT.test(sha)) refuse('attach-locks: the commit of this run is not a 40-digit lower-case hex id.')
    const locks = readLocks(env.LOCK_DIR, expectedLockNames(env.EXPECTED_LOCKS))

    const tag = `v${version}`
    const draft = selectDraft(tagReleases(await pagedGet(api, releasesUrl(REPOSITORY)), tag), sha, version)
    const base = `${UPLOAD_BASE}/repos/${REPOSITORY}/releases/${draft.id}/assets`
    const release = await getRelease(api, draft.id)
    if (release.id !== draft.id || release.draft !== true || release.tag_name !== tag || release.target_commitish !== sha || release.upload_url !== `${base}{?name,label}`) {
        refuse('attach-locks: the draft changed or does not match this run.')
    }
    const names = locks.map(lock => lock.name)
    const held = (await assetsOf(api, REPOSITORY, draft.id)).filter(asset => names.includes(asset.name))
    if (held.length > 0) {
        return { ok: false, lines: [`::error::attach-locks: the draft (release id ${draft.id}) already holds Cargo.lock files. Delete them by hand, then re-run:`, ...deleteCommands(held)] }
    }
    const ids = []
    for (const lock of locks) ids.push(await upload(api, base, lock.name, 'text/plain', lock.bytes))
    const after = await getRelease(api, draft.id)
    if (after.id !== draft.id || after.draft !== true || after.target_commitish !== sha) refuse('attach-locks: the draft changed during the upload. Check it by hand.')
    return { ok: true, lines: [`attach-locks: attached ${locks.length} Cargo.lock files (asset ids ${ids.join(', ')}) to draft release id ${draft.id} of ${tag}.`] }
}

// ---------------------------------------------------------------- network

/** The real API function: GET and POST only, no redirect followed, bounded time. Returns { status, body }. */
export function githubApi(token) {
    if (!token) refuse('the GitHub token is missing.')
    return async ({ method, url, body, contentType, timeoutMs = API_TIMEOUT_MS }) => {
        if ((method !== 'GET' && method !== 'POST') || !(url.startsWith(`${API_BASE}/`) || url.startsWith(`${UPLOAD_BASE}/`))) {
            throw new Refusal(BAD_ANSWER)
        }
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), timeoutMs)
        try {
            const headers = {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'risutanium-release-desktop',
            }
            if (contentType) headers['Content-Type'] = contentType
            const response = await fetch(url, { method, headers, body, redirect: 'error', signal: controller.signal })
            let parsed = null
            if (response.status === 200 || response.status === 201) {
                try {
                    parsed = await response.json()
                } catch {
                    parsed = null
                }
            } else {
                await response.arrayBuffer().catch(() => undefined)
            }
            return { status: response.status, body: parsed }
        } catch {
            throw new Refusal(BAD_ANSWER)
        } finally {
            clearTimeout(timer)
        }
    }
}

// ---------------------------------------------------------------- command line

/** Returns the exit code. Output lines go through `log`. */
export async function main(argv, env = process.env, log = console.log, { api, readConf } = {}) {
    try {
        const [command] = argv
        if (argv.length !== 1 || (command !== 'check' && command !== 'publish' && command !== 'attach-locks')) {
            log('::error::usage: androidPublish.mjs check | publish | attach-locks')
            return 2
        }
        const deps = { api: api ?? githubApi(env.GITHUB_TOKEN) }
        if (readConf !== undefined) deps.readConf = readConf
        if (command === 'check') {
            const result = await check(env, deps)
            for (const line of result.lines) log(line)
            if (result.lines.length === 0) log(`release-check: v${result.version}: no conflicting release (Android ${result.includeAndroid ? 'on' : 'off'}).`)
            return result.lines.length === 0 ? 0 : 1
        }
        const result = command === 'publish' ? await publish(env, deps) : await attachLocks(env, deps)
        for (const line of result.lines) log(line)
        return result.ok ? 0 : 1
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
