// Round-trip verifier for synth-bin-gen.mjs output (MC-471). Plain Node ESM, no src/ imports.
//
//   node Agents/Tools/save-gen/synth-bin-verify.mjs --manifest <m.json> --bin <exported.bin> [--show 20]
//   node Agents/Tools/save-gen/synth-bin-verify.mjs --bin-a <first.bin> --bin-b <second.bin> [--forbid-added-root-keys] [--show 20]
//
// Parses a .bin on its own (the [u32 LE name length][name][u32 LE data length][data] framing of backupContainer.ts), hashes
// every asset body by streaming it, decodes database.risudat and resolves it into one logical tree: characters a store2
// export wrote as stubs are replaced by the character their coldstorage_<uuid>.json unit holds, cold chat pointers by their
// messages, and plugin storage (upstream's _coldpluginIndex, the fork's _coldplugin map) by the plain key -> value map.
//
// What decides the exit code is a comparison of that WHOLE logical tree, not of a chosen list of fields:
//   - with a manifest, one hash per root key of the tree (the manifest cannot hold a mid-scale tree), so any difference in any
//     field of any part, including the order of every list, fails;
//   - with --bin-a/--bin-b, a structural diff of the two full trees (arrays in order, object keys as sets, values compared
//     recursively) that reports every difference by JSON path. Run it against the generator's own .bin to localise a red
//     manifest run. It cannot see a loss common to both files, so the manifest run must pass on the first export.
// Assets are compared by name -> sha256 and size, and against the manifest counts.
// The per-kind sections (characters, chats, modules, with per-field names) only localise a difference; they never decide.
//
// Exclusions, the only data the comparison ignores (each is a rewrite the app makes on import or export):
//   - character coldstorage, coldStoragedChats, coldVersion, coldChatCount, reloadKeys: archive pointers and derived cold
//     fields (store2/codec/bodies DERIVED_COLD_FIELDS, exportInline stubWithMintedKey); the resolved character has none;
//   - chat isStreaming, activeStreamingDisplayOptimizationMode: volatile flags setDatabase writes on every chat;
//   - plugin storage _coldplugin and _coldpluginIndex, and the unit ids behind them: the importer mints new unit ids
//     (pluginStorageIndex convertPluginStorageIndex), so only the key -> value map is compared;
//   - root keys that only the second tree holds: setDatabase fills every missing configuration default (database.svelte
//     setDatabase) and the store2 codec gives an absent list an empty one (store2/codec/normalize, pluginV2), so the app adds
//     root keys the generator never wrote. A root key the first tree holds must exist in the second with an equal value.
//     Every added key is printed as addedRootKeys, each with the name and 16 hex digits of its value hash. That list is
//     informational only and never decides the exit code, except under --forbid-added-root-keys.
//   --forbid-added-root-keys (with --bin-a/--bin-b only): a root key only the second file holds is a named problem (one only
//     the first file holds is already a missing difference, with or without the flag). Use it for two app exports of the same
//     generated file, PC or phone: step b (the PC export against the phone export) and step d (phone against phone) of the
//     acceptance protocol in synth-bin-gen.mjs. Leave it off when one side is the generator's own .bin, where the app's
//     added defaults are expected.
// Not compared: entry order, unit entry names and ids, database bytes, plugins (the plugin list, V2.1 and V3.0, is never generated).
// Exit 0 only when nothing is missing, extra or changed and the file parsed cleanly. With a manifest, the compared sections
// must also hold as many entries as manifest.counts says.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..')
const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'))
// msgpackr 1.10.1 asks Buffer.utf8Write for more bytes than the buffer has left; this Node throws on that where older
// versions clamped. The clamp restores the older behaviour and changes no decoded value.
const nativeUtf8Write = Buffer.prototype.utf8Write
Buffer.prototype.utf8Write = function (text, position, length) { return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position)) }
const { Unpackr } = requireFromRepo('msgpackr/index-no-eval')
const fflate = requireFromRepo('fflate')

const PIECE_BYTES = 4 * 1024 * 1024
const MAX_NAME_BYTES = 1024 * 1024
const MAX_BUFFERED_ENTRY_BYTES = 1024 * 1024 * 1024
const MAX_REPORTED_DIFFERENCES = 100000
const COLD_STORAGE_HEADER = 'COLDSTORAGE'
const ENCRYPTION_MARKER_NAME = 'encryption.risudat'
export const EXCLUDED_CHARACTER_KEYS = ['coldstorage', 'coldStoragedChats', 'coldVersion', 'coldChatCount', 'reloadKeys']
export const EXCLUDED_CHAT_KEYS = ['isStreaming', 'activeStreamingDisplayOptimizationMode']
const SIDE_FIELDS = ['hypaV2Data', 'hypaV3Data', 'scriptstate', 'localLore']
const PLUGIN_MAP_KEY = '_coldplugin'
const PLUGIN_INDEX_KEY = '_coldpluginIndex'
const PLUGIN_INDEX_TYPE = 'risu-plugin-storage-index'
const INLAY_NAME_PATTERN = /^risu-inlay-([0-9a-f]{64})-(0|[1-9][0-9]{0,6})\.part$/
const COLD_UNIT_NAME_PATTERN = /^(?:coldstorage[/_])?([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.json$/

function parseArguments(argv) {
  const opt = { manifest: '', bin: '', binA: '', binB: '', show: 20, forbidAddedRootKeys: false }
  for (let i = 0; i < argv.length; i += 2) {
    const arg = argv[i]
    if (arg === '--forbid-added-root-keys') { opt.forbidAddedRootKeys = true; i--; continue }
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`${arg} needs a value`)
    if (arg === '--manifest') opt.manifest = value
    else if (arg === '--bin') opt.bin = value
    else if (arg === '--bin-a') opt.binA = value
    else if (arg === '--bin-b') opt.binB = value
    else if (arg === '--show') opt.show = Number(value)
    else throw new Error(`unknown argument ${arg}`)
  }
  const manifestMode = opt.manifest !== '' || opt.bin !== ''
  const binMode = opt.binA !== '' || opt.binB !== ''
  if (manifestMode === binMode) throw new Error('give either --manifest with --bin, or --bin-a with --bin-b')
  if (manifestMode && (!opt.manifest || !opt.bin)) throw new Error('--manifest and --bin are required together')
  if (binMode && (!opt.binA || !opt.binB)) throw new Error('--bin-a and --bin-b are required together')
  if (manifestMode && opt.forbidAddedRootKeys) throw new Error('--forbid-added-root-keys goes with --bin-a and --bin-b only')
  return opt
}

const sha256HexOf = (value) => createHash('sha256').update(value).digest('hex')

/** JSON with sorted object keys and no undefined members: the same value always gives the same text. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map((item) => (item === undefined ? 'null' : canonical(item))).join(',') + ']'
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
}

/** Per-key hashes and one hash over them, for the keys of `object` that are not excluded. */
function project(object, excluded, extra = {}) {
  const fields = {}
  const source = { ...object, ...extra }
  for (const key of Object.keys(source).sort()) {
    if (excluded.includes(key) || source[key] === undefined) continue
    fields[key] = sha256HexOf(canonical(source[key])).slice(0, 16)
  }
  return { hash: sha256HexOf(canonical(fields)), fields }
}

// ---------------------------------------------------------------------------------------------------------------------
// container walk

function readExactly(fd, buffer, length, position) {
  let got = 0
  while (got < length) {
    const n = fs.readSync(fd, buffer, got, length - got, position + got)
    if (n === 0) break
    got += n
  }
  return got
}

export function walkContainer(binPath) {
  const fd = fs.openSync(binPath, 'r')
  const size = fs.fstatSync(fd).size
  const result = { size, entries: 0, assets: new Map(), duplicateAssets: [], units: new Map(), database: null, inlays: 0, problems: [] }
  const piece = Buffer.alloc(PIECE_BYTES)
  const four = Buffer.alloc(4)
  let position = 0
  try {
    while (position < size) {
      if (readExactly(fd, four, 4, position) < 4) { result.problems.push(`truncated entry header at ${position}`); break }
      const nameLength = four.readUInt32LE(0)
      if (nameLength > MAX_NAME_BYTES) { result.problems.push(`name length ${nameLength} at ${position} is not plausible`); break }
      const nameBytes = Buffer.alloc(nameLength)
      if (readExactly(fd, nameBytes, nameLength, position + 4) < nameLength || readExactly(fd, four, 4, position + 4 + nameLength) < 4) {
        result.problems.push(`truncated entry header at ${position}`)
        break
      }
      const dataLength = four.readUInt32LE(0)
      const dataStart = position + 8 + nameLength
      if (dataStart + dataLength > size) { result.problems.push(`entry at ${position} runs past the end of the file`); break }
      const name = new TextDecoder().decode(nameBytes)
      result.entries++
      if (name === ENCRYPTION_MARKER_NAME) result.problems.push('encryption marker entry present')
      const unitMatch = COLD_UNIT_NAME_PATTERN.exec(name)
      if (name === 'database.risudat' || unitMatch) {
        if (dataLength > MAX_BUFFERED_ENTRY_BYTES) { result.problems.push(`${name} is ${dataLength} bytes; not buffered`); position = dataStart + dataLength; continue }
        const body = Buffer.alloc(dataLength)
        if (readExactly(fd, body, dataLength, dataStart) < dataLength) { result.problems.push(`${name} could not be read whole`); break }
        if (name === 'database.risudat') {
          if (result.database) result.problems.push('more than one database.risudat entry')
          result.database = body
        } else {
          // the key keeps its case, as getColdStorageBackupKey does
          if (result.units.has(unitMatch[1])) result.problems.push(`unit ${unitMatch[1]} appears more than once`)
          try { result.units.set(unitMatch[1], JSON.parse(body.toString('utf8'))) } catch { result.problems.push(`unit ${name} is not JSON`) }
        }
      } else if (INLAY_NAME_PATTERN.test(name)) {
        result.inlays++
      } else {
        const hash = createHash('sha256')
        for (let done = 0; done < dataLength;) {
          const n = Math.min(PIECE_BYTES, dataLength - done)
          if (readExactly(fd, piece, n, dataStart + done) < n) { result.problems.push(`asset ${name} could not be read whole`); break }
          hash.update(piece.subarray(0, n))
          done += n
        }
        if (result.assets.has(name)) result.duplicateAssets.push(name)
        result.assets.set(name, { sha256: hash.digest('hex'), bytes: dataLength })
      }
      position = dataStart + dataLength
    }
  } finally {
    fs.closeSync(fd)
  }
  return result
}

// ---------------------------------------------------------------------------------------------------------------------
// database

export function decodeDatabase(body) {
  const unpackr = new Unpackr({ int64AsType: 'number', useRecords: false })
  const prefix = Buffer.from([0, 82, 73, 83, 85, 83, 65, 86, 69, 0])
  if (body.length < 11 || !body.subarray(0, 10).equals(prefix)) {
    if (body.subarray(0, 8).toString('latin1') === 'RISUSAVE') throw new Error('database.risudat is in the block format; this verifier reads only the legacy formats')
    throw new Error('database.risudat has no recognised header')
  }
  const rest = body.subarray(11)
  switch (body[10]) {
    case 8: return unpackr.unpack(Buffer.from(fflate.decompressSync(rest)))
    case 7: return unpackr.unpack(rest)
    case 9: return unpackr.unpack(gunzipSync(rest))
    default: throw new Error(`database.risudat header kind ${body[10]} is not recognised`)
  }
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const withoutKeys = (object, keys) => Object.fromEntries(Object.entries(object).filter(([key]) => !keys.includes(key)))

/**
 * The whole character of `slot`: the slot itself when it is not a stub; for a stub the character its unit holds, as
 * resolveLegacyTree restores it. A stub whose unit is missing, is not a character or holds another chaId is not resolved
 * (the importer would write a placeholder there): it stays as the stub and is reported.
 */
function resolveCharacter(slot, units, counts) {
  if (!slot.coldstorage) { counts.inline++; return slot }
  const unit = typeof slot.coldstorage === 'string' ? units.get(slot.coldstorage) : undefined
  const held = isPlainObject(unit) ? unit.character : undefined
  if (!isPlainObject(held)) { counts.unresolvedStubs.push(slot.chaId); return slot }
  if (held.chaId !== slot.chaId) { counts.mismatchedStubs.push(`${slot.chaId} names a unit that holds ${held.chaId}`); return slot }
  counts.stub++
  const restored = { ...held }
  // the stub is authoritative for the trash state; lastInteraction keeps the newer of stub and unit
  if (slot.trashTime) restored.trashTime = slot.trashTime
  else delete restored.trashTime
  if (typeof slot.lastInteraction === 'number' && (typeof restored.lastInteraction !== 'number' || slot.lastInteraction > restored.lastInteraction)) {
    restored.lastInteraction = slot.lastInteraction
  }
  return restored
}

/**
 * A chat whose first message names a unit gets the unit's messages followed by the chat's remaining messages. A unit that is an
 * object also sets the four side fields (an absent one clears the chat's own); a bare message list leaves them.
 */
function resolveChat(chat, units, counts) {
  const first = chat.message?.[0]?.data
  if (typeof first !== 'string' || !first.startsWith(COLD_STORAGE_HEADER)) return chat
  const unit = units.get(first.slice(COLD_STORAGE_HEADER.length))
  const messages = Array.isArray(unit) ? unit : isPlainObject(unit) && Array.isArray(unit.message) ? unit.message : null
  if (messages === null) { counts.unresolvedChats.push(chat.id); return chat }
  counts.coldChats++
  const restored = { ...chat, message: [...messages, ...chat.message.slice(1)] }
  if (isPlainObject(unit)) {
    for (const field of SIDE_FIELDS) {
      if (unit[field] === undefined) delete restored[field]
      else restored[field] = unit[field]
    }
  }
  return restored
}

/**
 * Plugin storage as the plain key -> value map the app holds: upstream's index pointer (an index unit naming each key's JSON
 * text or the unit that holds it) and the fork's _coldplugin map (key -> unit id) are both replaced by their values, the index
 * winning over the map for one key as the importer has it. A unit that is absent or an index that is malformed is reported.
 */
function foldPluginStorage(storage, units, counts) {
  if (!isPlainObject(storage)) return storage
  const folded = {}
  for (const [key, value] of Object.entries(storage)) {
    if (key !== PLUGIN_MAP_KEY && key !== PLUGIN_INDEX_KEY) folded[key] = value
  }
  const map = storage[PLUGIN_MAP_KEY]
  if (isPlainObject(map)) {
    for (const [key, id] of Object.entries(map)) {
      if (typeof id !== 'string') continue
      if (units.has(id)) folded[key] = units.get(id)
      else counts.pluginProblems.push(`plugin storage "${key}" names unit ${id}, which has no entry`)
    }
  }
  const pointer = storage[PLUGIN_INDEX_KEY]
  if (typeof pointer === 'string' && pointer !== '') {
    const index = units.get(pointer)
    if (!isPlainObject(index) || index.type !== PLUGIN_INDEX_TYPE || !Array.isArray(index.entries) || !Array.isArray(index.trash)) {
      counts.pluginProblems.push(`plugin storage index ${pointer} has no entry, or is not an index`)
    } else {
      // a later entry for a key replaces an earlier one; a large reference wins over a small value in one entry
      for (const entry of index.entries) {
        if (!isPlainObject(entry) || typeof entry.k !== 'string') continue
        if (typeof entry.l === 'string') {
          if (units.has(entry.l)) folded[entry.k] = units.get(entry.l)
          else counts.pluginProblems.push(`plugin storage "${entry.k}" names unit ${entry.l}, which has no entry`)
        } else if (typeof entry.s === 'string') {
          try { folded[entry.k] = JSON.parse(entry.s) } catch { counts.pluginProblems.push(`plugin storage "${entry.k}" holds text that is not JSON`) }
        }
      }
    }
  }
  return folded
}

/**
 * The logical tree of a decoded database: every root key as stored except the characters (stubs and cold chat pointers
 * resolved, excluded fields removed) and plugin storage (folded). `db` and `units` are not modified, but the result shares
 * nested objects with them; clone it before the app's code mutates `db`.
 */
export function resolveTree(db, units) {
  const counts = {
    inline: 0, stub: 0, coldChats: 0, unresolvedStubs: [], mismatchedStubs: [], unresolvedChats: [], pluginProblems: [],
  }
  const tree = {}
  for (const key of Object.keys(db)) if (db[key] !== undefined) tree[key] = db[key]
  if (Array.isArray(db.characters)) {
    tree.characters = db.characters.map((slot) => {
      if (!isPlainObject(slot)) return slot
      const character = resolveCharacter(slot, units, counts)
      const chats = Array.isArray(character.chats)
        ? character.chats.map((chat) => (isPlainObject(chat) ? withoutKeys(resolveChat(chat, units, counts), EXCLUDED_CHAT_KEYS) : chat))
        : character.chats
      return { ...withoutKeys(character, EXCLUDED_CHARACTER_KEYS), ...(chats === undefined ? {} : { chats }) }
    })
  }
  if (Object.hasOwn(db, 'pluginCustomStorage')) tree.pluginCustomStorage = foldPluginStorage(db.pluginCustomStorage, units, counts)
  return { tree, counts }
}

/** The per-kind maps the report localises with, and one hash per root key: the manifest side of the decision. */
function entitiesOf(tree) {
  const duplicates = { characters: [], chats: [], modules: [] }
  const entities = { characters: new Map(), chats: new Map(), modules: new Map() }
  const put = (map, key, value, list) => { if (map.has(key)) list.push(key); map.set(key, value) }
  for (const character of Array.isArray(tree.characters) ? tree.characters : []) {
    if (!isPlainObject(character)) continue
    const chats = Array.isArray(character.chats) ? character.chats : []
    const { chats: _chats, ...rest } = character
    // chat ids keep their stored order: chatPage indexes the list
    put(entities.characters, character.chaId, project(rest, [], { chatIds: chats.map((c) => c.id) }), duplicates.characters)
    for (const chat of chats) put(entities.chats, `${character.chaId}|${chat.id}`, project(chat, []), duplicates.chats)
  }
  for (const module of Array.isArray(tree.modules) ? tree.modules : []) {
    if (isPlainObject(module)) put(entities.modules, module.id, project(module, []), duplicates.modules)
  }
  return { entities, duplicates }
}

export function partsOf(tree) {
  const parts = new Map()
  for (const key of Object.keys(tree).sort()) if (tree[key] !== undefined) parts.set(key, { hash: sha256HexOf(canonical(tree[key])) })
  return parts
}

/**
 * The root keys of `tree` that `expectedParts` does not hold, sorted, each with the first 16 hex digits of the SHA-256 of its
 * canonical() value. Informational: only --forbid-added-root-keys turns an added key into a problem.
 */
export function addedRootKeysOf(tree, expectedParts) {
  return Object.keys(tree)
    .filter((key) => tree[key] !== undefined && !expectedParts.has(key))
    .sort()
    .map((name) => ({ name, hash: sha256HexOf(canonical(tree[name])).slice(0, 16) }))
}

/** One .bin read whole: its container walk, the logical tree, and what went wrong reading it. `db` is the decoded database as stored. */
export function inspectBin(binPath, label) {
  const problems = []
  const walk = walkContainer(binPath)
  problems.push(...walk.problems)
  if (walk.duplicateAssets.length) problems.push(`${walk.duplicateAssets.length} asset names appear more than once`)
  let db = null
  let tree = null
  let entities = null
  let parts = null
  let resolution = null
  if (!walk.database) {
    problems.push('no database.risudat entry')
  } else {
    try { db = decodeDatabase(walk.database) } catch (error) { problems.push(`database does not decode: ${error.message}`) }
    if (db) {
      const resolved = resolveTree(db, walk.units)
      const counts = resolved.counts
      tree = resolved.tree
      const collected = entitiesOf(tree)
      entities = collected.entities
      parts = partsOf(tree)
      resolution = { inlineCharacters: counts.inline, stubCharacters: counts.stub, coldChats: counts.coldChats, unitEntries: walk.units.size }
      if (counts.unresolvedStubs.length) problems.push(`${counts.unresolvedStubs.length} stub characters have no usable unit entry`)
      for (const text of counts.mismatchedStubs) problems.push(`stub ${text}`)
      if (counts.unresolvedChats.length) problems.push(`${counts.unresolvedChats.length} cold chat pointers have no unit entry`)
      for (const text of counts.pluginProblems) problems.push(text)
      for (const [name, list] of Object.entries(collected.duplicates)) {
        if (list.length) problems.push(`${list.length} ${name} appear more than once`)
      }
    }
  }
  return { walk, db, tree, entities, parts, resolution, problems: label ? problems.map((text) => `${label}: ${text}`) : problems }
}

// ---------------------------------------------------------------------------------------------------------------------
// comparison

const kindOf = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value)
const definedKeys = (object) => Object.keys(object).filter((key) => object[key] !== undefined)
const childPath = (parent, key) => (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`)
const preview = (value) => (typeof value === 'string' ? JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}... (${value.length} chars)` : value) : String(value))

/**
 * Structural difference between two trees: arrays in order (a different length is one difference, then the common prefix is
 * compared), object keys as sets, values recursively, every difference with its JSON path. A root key only `actual` holds is
 * not a difference (the app fills configuration defaults) and is listed in `addedRootKeys`. Counting stops at
 * MAX_REPORTED_DIFFERENCES (`truncated`), which is still a failure.
 */
export function deepDiff(expected, actual, show) {
  const result = { differences: 0, truncated: false, addedRootKeys: [], sample: [] }
  const add = (at, kind, detail) => {
    if (result.differences >= MAX_REPORTED_DIFFERENCES) { result.truncated = true; return }
    result.differences++
    if (result.sample.length < show) result.sample.push({ path: at, kind, ...detail })
  }
  const visit = (a, b, at, isRoot) => {
    if (result.truncated) return
    const kindA = kindOf(a)
    const kindB = kindOf(b)
    if (kindA !== kindB) { add(at, 'type', { expected: kindA, found: kindB }); return }
    if (kindA === 'array') {
      if (a.length !== b.length) add(at, 'length', { expected: a.length, found: b.length })
      for (let i = 0, n = Math.min(a.length, b.length); i < n; i++) visit(a[i], b[i], `${at}[${i}]`, false)
      return
    }
    if (kindA === 'object') {
      const keysA = definedKeys(a)
      const keysB = definedKeys(b)
      const setA = new Set(keysA)
      const setB = new Set(keysB)
      for (const key of keysA) {
        if (!setB.has(key)) add(childPath(at, key), 'missing', {})
        else visit(a[key], b[key], childPath(at, key), false)
      }
      for (const key of keysB) {
        if (setA.has(key)) continue
        if (isRoot) result.addedRootKeys.push(key)
        else add(childPath(at, key), 'extra', {})
      }
      return
    }
    if (!(a === b || (a !== a && b !== b))) add(at, 'changed', { expected: preview(a), found: preview(b) })
  }
  visit(expected, actual, '$', true)
  return result
}

function fieldDifferences(expectedFields, actualFields) {
  const keys = new Set([...Object.keys(expectedFields), ...Object.keys(actualFields)])
  return [...keys].filter((key) => expectedFields[key] !== actualFields[key]).sort().map((key) => (
    !(key in actualFields) ? `-${key}` : !(key in expectedFields) ? `+${key}` : `~${key}`))
}

/** missing / extra / changed between two key -> value maps; `describe` explains a changed entry. `allowExtra` lists, but does not count, keys only `actual` holds. */
function compareMaps(expected, actual, same, describe, show, allowExtra = false) {
  const missing = []
  const changed = []
  let matched = 0
  for (const [key, value] of expected) {
    if (!actual.has(key)) { missing.push(key); continue }
    if (same(value, actual.get(key))) matched++
    else changed.push({ key, ...describe(value, actual.get(key)) })
  }
  const extra = [...actual.keys()].filter((key) => !expected.has(key))
  return {
    expected: expected.size, found: actual.size, matched,
    missing: missing.length, extra: allowExtra ? 0 : extra.length, changed: changed.length,
    ...(allowExtra ? { addedKeys: extra.length } : {}),
    sample: { missing: missing.slice(0, show), extra: extra.slice(0, show), changed: changed.slice(0, show) },
  }
}

function compareProjected(expectedMap, actualMap, show) {
  return compareMaps(
    expectedMap, actualMap,
    (a, b) => a.hash === b.hash,
    (a, b) => ({ fields: fieldDifferences(a.fields, b.fields) }),
    show,
  )
}

function main() {
  const opt = parseArguments(process.argv.slice(2))
  const problems = []
  let expected = null
  let actualSide
  let first = null
  if (opt.manifest) {
    const manifest = JSON.parse(fs.readFileSync(opt.manifest, 'utf8'))
    if (manifest.format !== 'risu-synth-bin-manifest/1') problems.push(`unknown manifest format ${manifest.format}`)
    if (canonical(manifest.exclusions) !== canonical({ characterKeys: EXCLUDED_CHARACTER_KEYS, chatKeys: EXCLUDED_CHAT_KEYS })) problems.push('manifest exclusions differ from this verifier')
    expected = {
      assets: new Map(Object.entries(manifest.assets)), characters: new Map(Object.entries(manifest.characters)),
      chats: new Map(Object.entries(manifest.chats)), modules: new Map(Object.entries(manifest.modules)), parts: new Map(Object.entries(manifest.parts)),
    }
    // the expectation sections must hold what the manifest says it holds, so an empty manifest cannot match an empty file
    for (const [section, count] of [['assets', manifest.counts?.assets], ['characters', manifest.counts?.characters], ['chats', manifest.counts?.chats], ['modules', manifest.counts?.modules], ['parts', manifest.counts?.parts]]) {
      if (expected[section].size !== count) problems.push(`manifest ${section} holds ${expected[section].size} entries but counts says ${count}`)
    }
    actualSide = inspectBin(opt.bin, '')
  } else {
    first = inspectBin(opt.binA, 'a')
    problems.push(...first.problems)
    if (first.entities) expected = { assets: first.walk.assets, ...first.entities, parts: first.parts }
    actualSide = inspectBin(opt.binB, 'b')
  }
  problems.push(...actualSide.problems)
  const { walk } = actualSide

  const kinds = {}
  let tree = null
  let addedRootKeys = []
  if (expected) {
    kinds.assets = compareMaps(
      expected.assets, walk.assets,
      (a, b) => a.sha256 === b.sha256 && a.bytes === b.bytes,
      (a, b) => ({ expectedSha256: a.sha256, foundSha256: b.sha256, expectedBytes: a.bytes, foundBytes: b.bytes, kind: a.kind }),
      opt.show,
    )
    if (actualSide.entities) {
      for (const kind of ['characters', 'chats', 'modules']) kinds[kind] = compareProjected(expected[kind], actualSide.entities[kind], opt.show)
      kinds.parts = compareMaps(expected.parts, actualSide.parts, (a, b) => a.hash === b.hash, () => ({}), opt.show, true)
      if (first?.tree && actualSide.tree) tree = deepDiff(first.tree, actualSide.tree, opt.show)
      addedRootKeys = addedRootKeysOf(actualSide.tree, expected.parts)
      // A root key only the first tree holds is already a named difference; this names the opposite case.
      if (opt.forbidAddedRootKeys) for (const { name } of addedRootKeys) problems.push(`root key "${name}" is only in the second file (--forbid-added-root-keys)`)
    }
  }

  // The decision: manifest mode takes the root-key hashes, bin-against-bin mode the full structural diff; the assets in both.
  // kinds.characters, kinds.chats and kinds.modules only say where.
  const assetDifferences = kinds.assets ? kinds.assets.missing + kinds.assets.extra + kinds.assets.changed : 0
  const treeDifferences = first ? (tree?.differences ?? 0) : kinds.parts ? kinds.parts.missing + kinds.parts.extra + kinds.parts.changed : 0
  const differences = assetDifferences + treeDifferences
  const complete = Boolean(kinds.assets && kinds.parts && (!first || tree))
  const ok = differences === 0 && problems.length === 0 && complete
  console.log(JSON.stringify({ ok, differences, problems, addedRootKeys, file: { bytes: walk.size, entries: walk.entries, inlayEntries: walk.inlays }, resolution: actualSide.resolution, kinds, tree }, null, 2))
  process.exitCode = ok ? 0 : 1
}

// The harness imports the functions above; the command line runs main.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main()
