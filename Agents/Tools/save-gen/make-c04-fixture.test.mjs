// @vitest-environment node
// Run: pnpm vitest run Agents/Tools/save-gen/make-c04-fixture.test.mjs   (name the file; never the whole save-gen folder)
// Env C04_GENERATOR: path of another copy of make-c04-fixture.mjs, for mutant runs (a copy must sit in a folder whose
// parent chain reaches the repository's node_modules, or keep the copy beside the original's imports; see the hand-back).
// The bin is parsed here by an independent reader of the framing, not by the generator's own code. What this cannot show is
// that the app imports the file: that is the first device step of C04.
import { describe, expect, test, beforeAll } from 'vitest'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const generatorPath = process.env.C04_GENERATOR ?? path.join(HERE, 'make-c04-fixture.mjs')
const { generate } = await import(pathToFileURL(generatorPath).href)
const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'))
const nativeUtf8Write = Buffer.prototype.utf8Write
Buffer.prototype.utf8Write = function (text, position, length) { return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position)) }
const { Unpackr } = requireFromRepo('msgpackr/index-no-eval')
const fflate = requireFromRepo('fflate')
const sha256Hex = (value) => createHash('sha256').update(value).digest('hex')

function parseBin(buffer) {
  const entries = []
  let pos = 0
  while (pos < buffer.length) {
    const nameLength = buffer.readUInt32LE(pos); pos += 4
    const name = buffer.subarray(pos, pos + nameLength).toString('utf8'); pos += nameLength
    const dataLength = buffer.readUInt32LE(pos); pos += 4
    entries.push({ name, data: buffer.subarray(pos, pos + dataLength) }); pos += dataLength
  }
  expect(pos).toBe(buffer.length)
  const databaseEntry = entries.find((e) => e.name === 'database.risudat')
  expect(entries.at(-1)).toBe(databaseEntry)
  expect([...databaseEntry.data.subarray(0, 11)]).toEqual([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8])
  const database = new Unpackr({ useRecords: false }).decode(fflate.decompressSync(databaseEntry.data.subarray(11)))
  return { entries, database, assets: entries.filter((e) => e.name !== 'database.risudat') }
}

const options = { seed: 7, weights: ['light', 'heavy'], background: true, assetMiB: 0.02 }
let run
let parsed
beforeAll(() => {
  run = generate(options)
  parsed = Object.fromEntries(Object.entries(run.files).map(([name, buffer]) => [name, parseBin(buffer)]))
})

describe('make-c04-fixture', () => {
  test('both weights, 30 messages per chat, one chat per character', () => {
    expect(Object.keys(run.files)).toEqual(['c04-light.bin', 'c04-heavy.bin'])
    for (const { database } of Object.values(parsed)) {
      expect(database.characters.map((c) => c.name)).toEqual(['C04 Character-Level', 'C04 Chat-Level'])
      for (const character of database.characters) {
        expect(character.chats).toHaveLength(1)
        expect(character.chats[0].message).toHaveLength(30)
      }
    }
    for (const weight of ['light', 'heavy']) {
      for (const character of run.manifest.weights[weight].characters) for (const chat of character.chats) expect(chat.messages).toBe(30)
    }
  })

  test('message sizes: heavy median is at least 2.5 KB, light stays short, markdown only', () => {
    const sizes = (file) => parsed[file].database.characters.flatMap((c) => c.chats[0].message.map((m) => Buffer.byteLength(m.data))).sort((a, b) => a - b)
    const heavy = sizes('c04-heavy.bin')
    expect(heavy[Math.floor(heavy.length / 2)]).toBeGreaterThanOrEqual(2500)
    expect(Math.max(...sizes('c04-light.bin'))).toBeLessThan(300)
    for (const { database } of Object.values(parsed)) {
      for (const character of database.characters) for (const m of character.chats[0].message) expect(m.data).not.toMatch(/[<>]/)
    }
    for (const weight of ['light', 'heavy']) {
      const first = run.manifest.weights[weight].characters[0].chats[0].messageBytes
      expect(first.median).toBeGreaterThan(0)
    }
    expect(run.manifest.weights.light.approxDomNodesPerMessage).toBe(13)
    expect(run.manifest.weights.heavy.approxDomNodesPerMessage).toBeGreaterThanOrEqual(115)
    expect(run.manifest.weights.heavy.approxDomNodesPerMessage).toBeLessThanOrEqual(125)
  })

  test('module set: 3 regex-heavy (40 scripts), 2 asset, background embedding, hide icon, plain, 20 disabled', () => {
    const { database } = parsed['c04-light.bin']
    expect(database.modules).toHaveLength(28)
    const byName = (name) => database.modules.find((m) => m.name === name)
    for (const n of [1, 2, 3]) expect(byName(`C04 Regex Heavy ${n}`).regex).toHaveLength(40)
    const types = (n) => new Set(byName(`C04 Regex Heavy ${n}`).regex.map((r) => r.type))
    expect([...types(1)].sort()).toEqual(['editdisplay', 'editprocess'])
    expect([...types(3)]).toEqual(['editprocess'])
    expect(byName('C04 Background Embedding').backgroundEmbedding).toContain('c04-embed')
    expect(byName('C04 Hide Icon').hideIcon).toBe(true)
    expect(database.modules.filter((m) => m.name.startsWith('C04 Disabled '))).toHaveLength(20)
    expect(database.enabledModules).toEqual([])
    expect(new Set(database.modules.map((m) => m.id)).size).toBe(28)
    expect(run.manifest.modules.map((m) => m.class).sort()).toEqual([
      'asset-bearing', 'asset-bearing', 'backgroundEmbedding', ...Array(20).fill('disabled'), 'hideIcon', 'plain', 'prompt-only-regex', 'regex-affecting-display', 'regex-affecting-display'].sort())
  })

  test('regex patterns match the message text of both weights', () => {
    for (const { database } of Object.values(parsed)) {
      const text = database.characters[0].chats[0].message.map((m) => m.data).join('\n')
      const module = database.modules.find((m) => m.name === 'C04 Regex Heavy 1')
      const matching = module.regex.filter((r) => new RegExp(r.in, r.flag).test(text))
      expect(matching.length).toBe(40)
    }
  })

  test('character-level and chat-level module lists name existing modules', () => {
    for (const { database } of Object.values(parsed)) {
      const ids = new Set(database.modules.map((m) => m.id))
      const [characterLevel, chatLevel] = database.characters
      expect(characterLevel.modules).toHaveLength(5)
      expect(characterLevel.chats[0].modules).toBeUndefined()
      expect(chatLevel.modules).toBeUndefined()
      expect(chatLevel.chats[0].modules).toHaveLength(3)
      for (const id of [...characterLevel.modules, ...chatLevel.chats[0].modules]) expect(ids.has(id), `module id ${id}`).toBe(true)
      expect(run.manifest.weights.light.characters[0].modules).toEqual(characterLevel.modules)
      expect(run.manifest.weights.light.characters[1].chats[0].modules).toEqual(chatLevel.chats[0].modules)
    }
    const manifestIds = new Set(run.manifest.modules.map((m) => m.id))
    for (const id of run.manifest.unreferenced) expect(manifestIds.has(id)).toBe(true)
    expect(run.manifest.unreferenced).toHaveLength(20)
  })

  test('asset entries are named by the hash of their bytes and the asset modules point at them', () => {
    const { database, assets } = parsed['c04-heavy.bin']
    const names = new Set(assets.map((a) => a.name))
    for (const asset of assets) expect(asset.name).toBe(sha256Hex(asset.data) + '.png')
    for (const n of [1, 2]) {
      const module = database.modules.find((m) => m.name === `C04 Asset Module ${n}`)
      expect(module.assets.length).toBeGreaterThan(0)
      for (const [, ref] of module.assets) expect(names.has(ref.replace('assets/', ''))).toBe(true)
    }
  })

  test('background option sets backgroundHTML on the character-level character only', () => {
    const on = parsed['c04-light.bin'].database.characters
    expect(on[0].backgroundHTML).toContain('c04-bg')
    expect(on[1].backgroundHTML).toBeUndefined()
    const off = parseBin(generate({ ...options, weights: ['light'], background: false }).files['c04-light.bin']).database.characters
    expect(off[0].backgroundHTML).toBeUndefined()
  })

  test('same seed gives identical sha256, another seed differs, manifest hashes match the files', () => {
    const again = generate(options)
    for (const name of Object.keys(run.files)) {
      expect(sha256Hex(again.files[name])).toBe(sha256Hex(run.files[name]))
      expect(run.manifest.weights[name.includes('light') ? 'light' : 'heavy'].sha256).toBe(sha256Hex(run.files[name]))
    }
    expect(sha256Hex(generate({ ...options, seed: 8 }).files['c04-light.bin'])).not.toBe(sha256Hex(run.files['c04-light.bin']))
  })

  test('synth-bin-verify parses each file on its own and a bin compared with itself is ok', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c04-verify-'))
    try {
      for (const [name, buffer] of Object.entries(run.files)) {
        const file = path.join(dir, name)
        fs.writeFileSync(file, buffer)
        const result = spawnSync(process.execPath, [path.join(HERE, 'synth-bin-verify.mjs'), '--bin-a', file, '--bin-b', file], { encoding: 'utf8' })
        expect(result.status, result.stdout + result.stderr).toBe(0)
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
