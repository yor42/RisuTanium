// CHORE-806 stage 0: writes a c806 library as an upstream-shaped .bin holding one entry, database.risudat. Plain Node ESM.
//
//   node Agents/Tools/save-gen/c806-bin-write.mjs --out <path outside the repo> [--seed 806] [--characters 1000] [--chats 20]
//        [--messages 1] [--message-sigma 0.9] [--modules 180] --archive on|off
//
// File shape and entry encoding follow synth-bin-gen.mjs: [u32 LE name length][name][u32 LE data length][data], and the
// database entry is the 11-byte header [0,'RISUSAVE',0,8] then fflate.compressSync(msgpackr.encode(db), { mtime: 0 }), what
// encodeRisuSaveLegacy(db, 'compression') writes. Beside the file it writes <out>.c806.json with the parameters, the file's
// sha256 and the generator id, so an importer can refuse a .bin that is not a c806 one.
// Refusals: an output path inside the repository (checked through real paths), an existing target that has no c806 sidecar,
// and an entry of more than 4 GiB.
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { GENERATOR_ID, buildLibrary, normalizeParams } from './c806-library.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..', '..')
const requireFromRepo = createRequire(path.join(REPO_ROOT, 'package.json'))
const DATABASE_HEADER = Uint8Array.of(0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8)
const ENTRY_NAME = 'database.risudat'
const MAX_ENTRY_BYTES = 0xFFFFFFFF
export const SIDECAR_SUFFIX = '.c806.json'

/** `target` with its nearest existing ancestor resolved through links; the part that does not exist yet is appended as written. */
function realPathOfExisting(target) {
  const missing = []
  let current = target
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    missing.unshift(path.basename(current))
    current = parent
  }
  return path.join(fs.realpathSync(current), ...missing)
}

/** The resolved output path, or a refusal when it lies inside the repository (real paths, so a link into it is refused too). */
export function checkOutsideRepo(out) {
  const resolved = path.resolve(out)
  const rel = path.relative(fs.realpathSync(REPO_ROOT), realPathOfExisting(resolved))
  const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)
  if (!outside) throw new Error(`refusing to write inside the repository (${REPO_ROOT}): ${resolved}`)
  return resolved
}

/** msgpackr 1.10.1 asks Buffer.utf8Write for more bytes than the buffer has left; this Node throws on that. The clamp changes no output byte and is undone afterwards. */
function withUtf8WriteClamp(body) {
  const native = Buffer.prototype.utf8Write
  Buffer.prototype.utf8Write = function (text, position, length) { return native.call(this, text, position, Math.min(length, this.length - position)) }
  try {
    return body()
  } finally {
    Buffer.prototype.utf8Write = native
  }
}

/** The database entry data: header, then the compressed msgpack. */
export function encodeDatabaseEntry(database) {
  const { Packr } = requireFromRepo('msgpackr/index-no-eval')
  const fflate = requireFromRepo('fflate')
  const packed = fflate.compressSync(withUtf8WriteClamp(() => new Packr({ useRecords: false }).encode(database)), { mtime: 0 })
  return Buffer.concat([DATABASE_HEADER, Buffer.from(packed.buffer, packed.byteOffset, packed.length)])
}

function u32le(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) throw new Error(`entry length ${value} does not fit a u32`)
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value)
  return out
}

/**
 * Writes `database` as <out> plus its sidecar. `params` is recorded as given (the library parameters). Returns the sizes and the hash.
 * Nothing is left at <out> on a failure; the partial file is removed.
 */
export function writeBin({ database, out, params }) {
  const target = checkOutsideRepo(out)
  // an existing file without a c806 sidecar is somebody else's data: the rename below would silently replace it
  if (fs.existsSync(target) && !fs.existsSync(target + SIDECAR_SUFFIX)) throw new Error(`refusing to overwrite an existing file that has no c806 sidecar: ${target}`)
  const entry = encodeDatabaseEntry(database)
  if (entry.length > MAX_ENTRY_BYTES) throw new Error(`database entry of ${entry.length} bytes exceeds the 4 GiB entry limit`)
  const nameBytes = Buffer.from(ENTRY_NAME, 'utf8')
  const head = Buffer.concat([u32le(nameBytes.length), nameBytes, u32le(entry.length)])
  const partial = target + '.partial'
  const hash = createHash('sha256')
  const fd = fs.openSync(partial, 'w')
  try {
    for (const buf of [head, entry]) {
      hash.update(buf)
      for (let offset = 0; offset < buf.length;) offset += fs.writeSync(fd, buf, offset, buf.length - offset)
    }
  } catch (error) {
    fs.closeSync(fd)
    fs.rmSync(partial, { force: true })
    throw error
  }
  fs.closeSync(fd)
  const fileBytes = head.length + entry.length
  if (fs.statSync(partial).size !== fileBytes) {
    fs.rmSync(partial, { force: true })
    throw new Error('the written file differs in size from the entry')
  }
  fs.renameSync(partial, target)
  const sidecar = { format: 'c806-bin-sidecar/1', generator: GENERATOR_ID, params, sha256: hash.digest('hex'), fileBytes, entryBytes: entry.length, entries: [ENTRY_NAME] }
  fs.writeFileSync(target + SIDECAR_SUFFIX, JSON.stringify(sidecar))
  return { out: target, sidecar: target + SIDECAR_SUFFIX, ...sidecar }
}

function parseArguments(argv) {
  const opt = { out: '' }
  const params = {}
  const numeric = { '--seed': 'seed', '--characters': 'characters', '--chats': 'chatsPerCharacter', '--messages': 'messagesPerChat', '--message-sigma': 'messageCountSigma', '--modules': 'modules' }
  for (let i = 0; i < argv.length; i += 2) {
    const arg = argv[i]
    const value = argv[i + 1]
    if (value === undefined) throw new Error(`${arg} needs a value`)
    if (arg === '--out') opt.out = value
    else if (arg === '--archive') {
      if (value !== 'on' && value !== 'off') throw new Error('--archive must be on or off')
      params.archiveCharacters = value === 'on'
    } else if (Object.hasOwn(numeric, arg)) params[numeric[arg]] = Number(value)
    else throw new Error(`unknown argument ${arg}`)
  }
  if (!opt.out) throw new Error('--out is required')
  return { out: opt.out, params: normalizeParams(params) }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { out, params } = parseArguments(process.argv.slice(2))
  checkOutsideRepo(out)
  console.log(JSON.stringify(writeBin({ database: buildLibrary(params), out, params }), null, 2))
}
