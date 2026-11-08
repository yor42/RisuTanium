// node Agents/Tools/save-gen/make-chat-scene-fixture.accept.mjs   (plain node; not collected by pnpm test)
// Acceptance test of make-chat-scene-fixture.mjs. Env CHAT_SCENE_GENERATOR: path of another copy of the generator, for mutant runs (the
// copy must sit where its own imports resolve: a folder that holds make-c04-fixture.mjs and whose parent chain reaches node_modules).
// The bin is read here by an independent reader of the framing, not by the generator's code. What this cannot show is that the app
// imports the file: that is the first device step of CHORE-664 (a real import through the app's load-backup UI).
// Plain asserts print PASS/FAIL; exit 0 only if every assert holds.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { generate as generateC04, heavyMessage, lightMessage } from './make-c04-fixture.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const generatorPath = process.env.CHAT_SCENE_GENERATOR ?? path.join(HERE, 'make-chat-scene-fixture.mjs')
const { generate } = await import(pathToFileURL(generatorPath).href)
const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'))
const { Unpackr } = requireFromRepo('msgpackr/index-no-eval')
const fflate = requireFromRepo('fflate')
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex')

let failures = 0
const check = (ok, name, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : (detail ? ' :: ' + detail : '')))
  if (!ok) failures++
}

function parseBin(buffer) {
  const entries = []
  let pos = 0
  while (pos < buffer.length) {
    const nameLength = buffer.readUInt32LE(pos); pos += 4
    const name = buffer.subarray(pos, pos + nameLength).toString('utf8'); pos += nameLength
    const dataLength = buffer.readUInt32LE(pos); pos += 4
    entries.push({ name, data: buffer.subarray(pos, pos + dataLength) }); pos += dataLength
  }
  if (pos !== buffer.length) throw new Error('framing does not end at the file end')
  const databaseEntry = entries.find((e) => e.name === 'database.risudat')
  if (entries.at(-1) !== databaseEntry) throw new Error('database.risudat is not the last entry')
  if (![...databaseEntry.data.subarray(0, 11)].every((b, i) => b === [0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8][i])) throw new Error('database header differs')
  return new Unpackr({ useRecords: false }).decode(fflate.decompressSync(databaseEntry.data.subarray(11)))
}

// the documented seeding rule of the generator, written out independently
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const characterRnd = (seed, k) => mulberry32((seed ^ 0x664664 ^ Math.imul(k + 1, 0x9E3779B1)) >>> 0)

const MOCK_URL = 'http://mock.test:9471/v1/chat/completions'
const run = generate({ seed: 664, mockUrl: MOCK_URL, name: 'c664-scene-pc' })
const bin = run.files['c664-scene-pc.bin']
const db = parseBin(bin)
const byName = (name) => db.characters.find((c) => c.name === name)

// T1 chat sizes, roles and bodies
check(db.characters.map((c) => c.name).join('|') === 'C664 N30|C664 N300|C664 N600|C664 N600 Prose|C664 R1', 'T1 five characters in the documented order', db.characters.map((c) => c.name).join('|'))
for (const [name, count] of [['C664 N30', 30], ['C664 N300', 300], ['C664 N600', 600], ['C664 N600 Prose', 600], ['C664 R1', 30]]) {
  const character = byName(name)
  const messages = character?.chats?.length === 1 ? character.chats[0].message : []
  check(messages.length === count && messages.every((m, i) => m.role === (i % 2 === 0 ? 'char' : 'user')), `T1 ${name}: one chat of exactly ${count} messages, roles alternating from char`, String(messages.length))
}
for (const [k, name] of [[0, 'C664 N30'], [1, 'C664 N300'], [2, 'C664 N600'], [4, 'C664 R1']]) {
  const rnd = characterRnd(664, k)
  const messages = byName(name).chats[0].message
  let same = true
  for (let m = 0; m < messages.length; m++) {
    const expected = m % 2 === 0 ? heavyMessage(m, rnd).text : lightMessage(m).text
    if (messages[m].data !== expected) { same = false; break }
  }
  check(same, `T1 ${name}: char bodies equal heavyMessage and user bodies equal lightMessage of make-c04-fixture`)
}
{
  const prose = byName('C664 N600 Prose').chats[0].message
  const sizes = prose.map((m) => Buffer.byteLength(m.data))
  check(Math.min(...sizes) >= 1000 && Math.max(...sizes) <= 1100 && prose.every((m) => !/[<>*`|]/.test(m.data) && m.data.includes('\n\n')), 'T1 prose: every message is 1000 to 1100 bytes of plain text with one paragraph break and no markup', `${Math.min(...sizes)}..${Math.max(...sizes)}`)
}
const heavySizes = byName('C664 N600').chats[0].message.filter((m, i) => i % 2 === 0).map((m) => Buffer.byteLength(m.data))
check(Math.min(...heavySizes) >= 2900, 'T1 heavy char turns are at least 2.9 KB')

// T2 root fields
const root = db
check(root.aiModel === 'reverse_proxy' && root.subModel === 'reverse_proxy' && root.forceReplaceUrl === MOCK_URL && root.customProxyRequestModel === 'mock-model' && root.proxyKey === 'mock-key', 'T2 root points the app at the mock: aiModel, forceReplaceUrl = --mock-url, model name, throwaway key')
check(root.useStreaming === true && root.usePlainFetch === true && root.theme === '', 'T2 useStreaming and usePlainFetch are true and theme is empty')
check(!('streamingDisplayOptimizationMode' in root) && !('streamingDisplayOptimizationMode' in db.botPresets[0]), 'T2 streamingDisplayOptimizationMode is not written (the app default applies)')
check(db.botPresets[0].forceReplaceUrl === MOCK_URL && db.botPresets[0].proxyKey === 'mock-key' && db.botPresets[0].useStreaming === true, 'T2 the active preset repeats the mock settings')
check(!JSON.stringify(db).match(/sk-|api[_-]?key|Bearer/i), 'T2 no credential-like text')
const phone = parseBin(generate({ seed: 664, mockUrl: 'http://127.0.0.1:9471/v1/chat/completions', name: 'c664-scene-phone', plainFetch: false }).files['c664-scene-phone.bin'])
check(phone.forceReplaceUrl === 'http://127.0.0.1:9471/v1/chat/completions' && phone.usePlainFetch === false && phone.useStreaming === true, 'T2 --mock-url and --plain-fetch off reach the root')

// T3 script profile
{
  const r1 = byName('C664 R1')
  const outputs = r1.customscript.filter((s) => s.type === 'editoutput')
  const displays = r1.customscript.filter((s) => s.type === 'editdisplay')
  const words = ['amber', 'birch', 'cedar', 'dune', 'elm', 'fern', 'glen', 'heath', 'iris', 'juniper']
  check(r1.customscript.length === 20 && outputs.length === 10 && displays.length === 10, 'T3 R1 has 10 editoutput and 10 editdisplay regex scripts', `${outputs.length}/${displays.length}`)
  check(outputs.every((s, k) => s.in === `\\b${words[k]}\\b` && s.out === '$&') && displays.every((s, k) => s.in === `\\b${words[k]}\\b` && s.out === '$&'), 'T3 the patterns match words of the mock reply and keep the text ($&)')
  check(r1.triggerscript.length === 1 && r1.triggerscript[0].effect.length === 1 && r1.triggerscript[0].effect[0].type === 'triggerlua' && r1.triggerscript[0].effect[0].code.includes('listenEdit("editOutput"') && r1.triggerscript[0].effect[0].code.includes('[mock-r3ply]') && r1.triggerscript[0].effect[0].code.includes('%[mock%-reply%]'), 'T3 R1 has one Lua trigger that listens on editOutput and rewrites [mock-reply] to [mock-r3ply]')
  const others = db.characters.filter((c) => c.name !== 'C664 R1')
  check(others.every((c) => c.customscript.length === 0 && c.triggerscript.length === 0), 'T3 the other characters have no scripts and no triggers')
}

// T4 determinism, and the imported c04 builders unchanged
{
  const again = generate({ seed: 664, mockUrl: MOCK_URL, name: 'c664-scene-pc' })
  check(sha256Hex(again.files['c664-scene-pc.bin']) === sha256Hex(bin) && JSON.stringify(again.manifest) === JSON.stringify(run.manifest), 'T4 the same seed, name and options give byte-identical bin and manifest')
  const other = generate({ seed: 665, mockUrl: MOCK_URL, name: 'c664-scene-pc' })
  check(sha256Hex(other.files['c664-scene-pc.bin']) !== sha256Hex(bin), 'T4 another seed gives another file')
  const c04 = generateC04({ seed: 1, weights: ['light', 'heavy'], background: false, assetMiB: 0.02 })
  check(c04.manifest.weights.light.sha256 === '55ceb57e0086d5a48b24b48a307c4a8374bd7c1a0e87002312b371b5affca5d3' && c04.manifest.weights.heavy.sha256 === 'e33c983b4ba635108fd7a66dc9fd4564108bd27c5c0911f99df98baa030f5423', 'T4 make-c04-fixture output for seed 1 (light and heavy, 0.02 MiB assets) is unchanged: the imported message builders are unmodified')
  check(run.manifest.sha256 === sha256Hex(bin) && run.manifest.bytes === bin.length && run.manifest.characters.map((c) => c.messages).join() === '30,300,600,600,30', 'T4 the manifest matches the file')
}

// the command line: writes the bin and the manifest, refuses an --out inside the repository
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c664-scene-accept-'))
  try {
    const cli = execFileSync(process.execPath, [generatorPath, '--out', tmp, '--name', 'cli-scene', '--mock-url', MOCK_URL], { encoding: 'utf8' })
    check(JSON.parse(cli).files['cli-scene.bin'] > 0 && fs.existsSync(path.join(tmp, 'cli-scene-manifest.json')) && sha256Hex(fs.readFileSync(path.join(tmp, 'cli-scene.bin'))) === sha256Hex(generate({ seed: 664, mockUrl: MOCK_URL, name: 'cli-scene' }).files['cli-scene.bin']), 'CLI writes <name>.bin and <name>-manifest.json equal to generate()')
    // inside the generator's own repository root (three levels above the file), wherever that copy sits
    const insideOwnRoot = path.join(path.resolve(path.dirname(generatorPath), '..', '..', '..'), 'scratch-should-not-exist')
    let refused = false
    try { execFileSync(process.execPath, [generatorPath, '--out', insideOwnRoot], { stdio: 'pipe' }) } catch { refused = true }
    check(refused && !fs.existsSync(insideOwnRoot), 'CLI refuses an --out inside the repository')
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

console.log(failures === 0 ? 'ALL PASSED' : 'FAILED: ' + failures)
process.exit(failures === 0 ? 0 : 1)
