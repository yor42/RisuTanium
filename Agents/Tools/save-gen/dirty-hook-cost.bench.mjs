// node --expose-gc Agents/Tools/save-gen/dirty-hook-cost.bench.mjs [--reps 5] [--scale full|small] [--out <file>]
// Run it from a checkout that has node_modules (svelte 5.57.3 and the app's dependencies are resolved from there); a tree
// without them fails with ERR_MODULE_NOT_FOUND in the first child.
// DIRTY-RC PC bench: what the explicit write hook and the patched Svelte proxy cost against stock Svelte (plan r4 "Bars", PC
// bench; r5 B1 note; r6 B2 link-growth row; r3 B7-B9). Best-case hardware, never device proof. Plain node, not vitest: the
// name has no .test and no .harness, so no vitest include pattern collects it. Synthetic data only; no network, no storage.
//
// What runs. The parent starts one child process per (role, repetition), interleaved base, branch, base (the second base set is
// the A/A pass), so each runtime lives alone in its process (no cross-runtime heap or JIT interference). Every child runs under
// the production condition (`--conditions=browser --conditions=production`) against the client runtime and prints esm-env `DEV`;
// a child whose DEV is true voids the whole run, because dev branches such as inspectable_array and tag slow the base.
//   base    stock Svelte 5.57.3 from node_modules, no hook (the stock app).
//   branch  the same runtime files served from patches/svelte-5.57.3 through the plugin's own load() (version and hash checks
//           included; a mismatch throws), with the application's dbWriteHook.ts installed the way stores.svelte.ts does it:
//           installDbWriteHook(root, ...) on the root proxy before the db is assigned, the real markDbWrite sink with an
//           installed tracker and a scheduler that restarts a timer on every mark like saveScheduler.schedule, and the
//           install-time self-check. The app's TypeScript runs through node's type stripping and, for .svelte.ts, the Svelte
//           compiler (compileModule), the same compiler the app build uses. A branch child whose self-check fails, or whose
//           runtime has no PATCH_ID, is void; a base child that has the patch is void.
//
// Rows (child medians; the parent takes the median over repetitions):
//   B1   cold deep $state.snapshot of a 10k-message character (first walk of a fresh proxy), bar branch/base <= 1.5x
//   B1w  the same snapshot walked a second time on the same proxy (warm), diagnostic
//   B2   writes while streaming: 1000 `message.data = ...` writes on the last message of the 10k chat, microseconds per write,
//        bar: branch minus base <= 20 us
//   B2L  the same writes after 64 slot replacements of the chat (`chats[0] = { ...chats[0] }`), which leave the message array's
//        record with 65 links, the record threshold of r6 (the hook records linkGrowth once). Same bar; a miss here triggers the
//        conditional question of r6 (Open items)
//   B3   splice(0, 0, m) on the 10k-message array, bar <= 2x
//   B4   sort of 1000 characters by name, bar <= 2x
//   B5   heap after gc of the walked tree (500 characters plus the 10k-message one, JSON-walked), bar <= +10%, A/A rule
//   B6   mount shape: 500 rows read 5 fields each, cold, bar <= 1.3x
//   B7   encoder pass stand-in: JSON.stringify of every character, cold, diagnostic
//   B8   contentFingerprint shape of the 10k character ({ ...cha }, delete volatile fields, JSON.stringify), diagnostic
//   B9   boot walk on the save-gen module-heavy tier (buildTierDatabase('module-heavy'), 52 modules): deep snapshot of
//        db.modules plus the per-module walk of the first effect run, diagnostic
//
// Pass rule: a ratio row is PASS at or below its bar and FAIL above it; B2 and B2L compare an absolute difference. A row whose
// A/A spread (median of base set 1 against base set 2) is at or over 10% and whose bar is a +10% bar (B5) reads INCONCLUSIVE; for
// the other rows the spread is printed as NOISY information beside the verdict. Rows B1w and B7-B9 are DIAGNOSTIC (MC-1330).
// The numbers are printed, not interpreted: the device rows decide the merge gate.
//
// Limits stated by the bench itself: B7 and B9 stand in for RisuSaveEncoder and registerDbChangeEffects (application code that
// needs the whole app); B6 reads the fields without a DOM; the 500 small characters are built here from the save-gen message
// bodies (profile S quantiles: 2 chats of 8 to 16 messages), the modules come from buildTierDatabase.
import { spawnSync } from 'node:child_process'
import { register, createRequire, stripTypeScriptTypes } from 'node:module'
import { isMainThread } from 'node:worker_threads'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const THIS_FILE = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(THIS_FILE), '..', '..', '..')
const PLUGIN_URL = pathToFileURL(path.join(REPO_ROOT, 'patches', 'svelte-5.57.3', 'plugin.mjs')).href
const PATCH_MARKER = 'risu-proxy-patch svelte@5.57.3'
const RESULT_PREFIX = 'DHC_RESULT '
const SMALL_REPLACEMENTS = 64

// ---- loader hooks (run in node's hooks thread; the file registers itself) --------------------------------------------------
let patchPlugin = null

export async function initialize(data) {
  if (data.role === 'branch') patchPlugin = (await import(PLUGIN_URL)).svelteProxyPatch()
}

// The app's modules import each other without extensions; .ts is tried when the plain specifier is not found.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (error) {
    const relative = specifier.startsWith('./') || specifier.startsWith('../')
    if (!relative || error.code !== 'ERR_MODULE_NOT_FOUND') throw error
    return nextResolve(specifier + '.ts', context)
  }
}

export async function load(url, context, nextLoad) {
  // The same interception the plugin does for Vite: the two client runtime files are replaced by the patched copies.
  if (patchPlugin !== null && /\/svelte\/src\/internal\/client\/(proxy|index)\.js$/.test(url.replace(/\\/g, '/'))) {
    const source = patchPlugin.load(fileURLToPath(url))
    if (source !== null) return { format: 'module', source, shortCircuit: true }
  }
  // TypeScript of the app: transform mode, because some modules use parameter properties, which strip-only mode refuses.
  if (url.endsWith('.ts') && !url.includes('/node_modules/')) {
    const file = fileURLToPath(url)
    // Vite's import.meta.env is the production build's: DEV false.
    const code = stripTypeScriptTypes(readFileSync(file, 'utf8'), { mode: 'transform' })
      .replaceAll('import.meta.env', "({ DEV: false, PROD: true, MODE: 'production', BASE_URL: '/' })")
    if (!url.endsWith('.svelte.ts')) return { format: 'module', source: code, shortCircuit: true }
    const { compileModule } = await import('svelte/compiler')
    const { js } = compileModule(code, { filename: file, generate: 'client', dev: false })
    return { format: 'module', source: js.code, shortCircuit: true }
  }
  return nextLoad(url, context)
}

// ---- statistics ------------------------------------------------------------------------------------------------------------
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
const fixed = (value, digits = 2) => (value === null || value === undefined || Number.isNaN(value) ? 'n/a' : value.toFixed(digits))

// ---- the child: one runtime, every row --------------------------------------------------------------------------------------
async function runChild(role, scale) {
  const sveltePackageJson = fileURLToPath(import.meta.resolve('svelte/package.json'))
  const esmEnvUrl = pathToFileURL(createRequire(sveltePackageJson).resolve('esm-env')).href
  const { DEV } = await import(esmEnvUrl)
  const lib = await import('svelte/internal/client')
  const hasPatch = typeof lib.set_state_write_hook === 'function'
  const info = { role, scale, DEV, hasPatch, patchId: typeof lib.PATCH_ID === 'string' ? lib.PATCH_ID : null, node: process.version }
  if (DEV) return { info, rows: {}, void: 'esm-env DEV is true' }
  if (role === 'base' && hasPatch) return { info, rows: {}, void: 'the base child has the patched runtime' }
  if (role === 'branch' && (!hasPatch || typeof lib.PATCH_ID !== 'string' || !lib.PATCH_ID.startsWith(PATCH_MARKER))) {
    return { info, rows: {}, void: 'the branch child lacks the patched runtime or its marker' }
  }

  // The application's hook, as stores.svelte.ts installs it. Only the branch loads it.
  let hook = null
  let marks = null
  if (role === 'branch') {
    hook = await import(pathToFileURL(path.join(REPO_ROOT, 'src', 'ts', 'storage', 'dbWriteHook.ts')).href)
    const saveMarks = await import(pathToFileURL(path.join(REPO_ROOT, 'src', 'ts', 'storage', 'characterSaveMarks.ts')).href)
    let timer = null
    marks = { scheduled: 0 }
    saveMarks.installCharacterSaveMarks({
      tracker: { character: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false },
      schedule() {
        marks.scheduled++
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {}, 1000)
        timer.unref()
      },
    })
  }

  const { mulberry32, buildTierDatabase } = await import(pathToFileURL(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'build.ts')).href)
  const { heavyMessage, lightMessage } = await import(pathToFileURL(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'make-c04-fixture.mjs')).href)

  const BIG_MESSAGES = scale === 'small' ? 1000 : 10000
  const SMALL_CHARACTERS = scale === 'small' ? 100 : 500
  const SORT_CHARACTERS = scale === 'small' ? 200 : 1000
  const reps = scale === 'small' ? { cold: 3, hot: 3 } : { cold: 7, hot: 7 }

  const rnd = mulberry32(664)
  const uuid = (n) => 'c' + n.toString(16).padStart(7, '0') + '-0000-4000-8000-' + (n * 7919).toString(16).padStart(12, '0')
  const message = (m) => ({ role: m % 2 === 0 ? 'char' : 'user', data: m % 2 === 0 ? heavyMessage(m, rnd).text : lightMessage(m).text, time: 1700000000000 + m * 60000, chatId: 'm' + m })
  const character = (n, chatSizes) => ({
    type: 'character', chaId: uuid(n), name: 'Character ' + String(n).padStart(5, '0'), image: '', desc: 'synthetic description '.repeat(20), firstMessage: 'Hello.',
    notes: '', tags: ['synthetic', 'bench'], chatPage: 0, firstMsgIndex: -1, lastInteraction: 1700000000000 + n, trashTime: 0, utilityBot: false,
    customscript: [], triggerscript: [], globalLore: [], bias: [], emotionImages: [], additionalAssets: [], alternateGreetings: [],
    chats: chatSizes.map((count, c) => ({ id: uuid(n) + '-chat' + c, name: 'chat ' + c, note: '', localLore: [], message: Array.from({ length: count }, (_, m) => message(m)) })),
  })
  const smallSizes = (n) => [8 + (n % 9), 8 + ((n * 3) % 9)]
  const raw = {
    characters: [character(0, [BIG_MESSAGES]), ...Array.from({ length: SMALL_CHARACTERS - 1 }, (_, i) => character(i + 1, smallSizes(i)))],
    sortCharacters: Array.from({ length: SORT_CHARACTERS }, (_, i) => ({ ...character(i + 10000, [1]), name: 'N' + ((i * 7919) % SORT_CHARACTERS).toString().padStart(5, '0') })),
    modules: buildTierDatabase('module-heavy').database.modules,
  }
  info.counts = { bigMessages: BIG_MESSAGES, characters: raw.characters.length, sortCharacters: raw.sortCharacters.length, modules: raw.modules.length }

  // A fresh DBState the way the app builds it: the root proxy, the hook installed, then the database assigned (the boot load).
  let rootsBuilt = 0
  function freshRoot(db) {
    const root = lib.proxy({ db: { characters: [], modules: [] } })
    if (hook !== null) {
      hook.installDbWriteHook(root, { selectedChaId: () => undefined })
      if (!hook.selfCheckDbWriteHook()) throw new Error('hook self-check failed in the branch child')
    }
    root.db = structuredClone(db)
    rootsBuilt++
    return root
  }
  const mainDb = { characters: raw.characters, modules: [] }
  const timed = (fn) => { const t0 = performance.now(); fn(); return performance.now() - t0 }
  const collectGarbage = () => { globalThis.gc(); globalThis.gc() }
  const rows = {}

  // B5 first: nothing else has run, so the heap read is the tree and its wrappers.
  collectGarbage()
  const heapBefore = process.memoryUsage().heapUsed
  {
    const root = freshRoot(mainDb)
    for (const c of root.db.characters) JSON.stringify(c)
    collectGarbage()
    rows.B5 = (process.memoryUsage().heapUsed - heapBefore) / 1048576
  }
  collectGarbage()

  // B1 and B1w
  {
    const cold = []
    const warm = []
    for (let i = 0; i < reps.cold; i++) {
      const root = freshRoot(mainDb)
      const big = root.db.characters[0]
      cold.push(timed(() => lib.snapshot(big)))
      warm.push(timed(() => lib.snapshot(big)))
    }
    rows.B1 = median(cold.slice(1))
    rows.B1w = median(warm.slice(1))
  }

  // B6: 500 rows, 5 fields each
  {
    const times = []
    for (let i = 0; i < reps.cold; i++) {
      const root = freshRoot(mainDb)
      let sink = 0
      times.push(timed(() => {
        for (const c of root.db.characters) sink += c.name.length + c.chaId.length + c.desc.length + c.image.length + c.tags.length
      }))
      if (sink === -1) console.log(sink)
    }
    rows.B6 = median(times.slice(1))
  }

  // B7: encoder pass stand-in
  {
    const times = []
    for (let i = 0; i < Math.max(3, reps.cold - 2); i++) {
      const root = freshRoot(mainDb)
      let bytes = 0
      times.push(timed(() => { for (const c of root.db.characters) bytes += JSON.stringify(c).length }))
      if (bytes === -1) console.log(bytes)
    }
    rows.B7 = median(times.slice(1))
  }

  // B8: contentFingerprint of the 10k character
  {
    const times = []
    for (let i = 0; i < reps.cold; i++) {
      const root = freshRoot(mainDb)
      const big = root.db.characters[0]
      let size = 0
      times.push(timed(() => {
        const copy = { ...big }
        for (const field of ['lastInteraction', 'trashTime']) delete copy[field]
        size += JSON.stringify(copy).length
      }))
      if (size === -1) console.log(size)
    }
    rows.B8 = median(times.slice(1))
  }

  // B9: boot walk on the module-heavy tier
  {
    const times = []
    const bootDb = { characters: raw.characters.slice(1, 60), modules: raw.modules }
    for (let i = 0; i < reps.cold; i++) {
      const root = freshRoot(bootDb)
      let bytes = 0
      times.push(timed(() => {
        const snapshot = lib.snapshot(root.db.modules)
        for (const m of root.db.modules) bytes += JSON.stringify(m).length + snapshot.length
      }))
      if (bytes === -1) console.log(bytes)
    }
    rows.B9 = median(times.slice(1))
  }

  // B2 and B2L: streaming writes, microseconds per write
  const WRITES = 1000
  const writeLoop = (target, tag) => {
    const t0 = performance.now()
    for (let i = 0; i < WRITES; i++) target.data = tag + i
    return ((performance.now() - t0) * 1000) / WRITES
  }
  {
    const times = []
    for (let i = 0; i < reps.hot; i++) {
      const root = freshRoot(mainDb)
      const last = root.db.characters[0].chats[0].message[BIG_MESSAGES - 1]
      times.push(writeLoop(last, 's' + i + '-'))
    }
    rows.B2 = median(times.slice(1))
  }
  {
    const times = []
    let links = null
    for (let i = 0; i < reps.hot; i++) {
      const root = freshRoot(mainDb)
      const char = root.db.characters[0]
      for (let r = 0; r < SMALL_REPLACEMENTS; r++) char.chats[0] = { ...char.chats[0] }
      const messages = char.chats[0].message
      if (hook !== null) links = hook.linkCountOf(messages)
      times.push(writeLoop(messages[BIG_MESSAGES - 1], 'l' + i + '-'))
    }
    rows.B2L = median(times.slice(1))
    info.linksOnMessageArray = links
  }

  // B3: splice(0, 0, m) on the 10k array
  {
    const times = []
    const root = freshRoot(mainDb)
    const messages = root.db.characters[0].chats[0].message
    for (let i = 0; i < reps.hot * 2; i++) times.push(timed(() => messages.splice(0, 0, { role: 'user', data: 'inserted ' + i, time: i, chatId: 'ins' + i })))
    rows.B3 = median(times.slice(2))
  }

  // B4: sort of the character list
  {
    const times = []
    const root = freshRoot({ characters: raw.sortCharacters, modules: [] })
    const list = root.db.characters
    for (let i = 0; i < reps.hot; i++) {
      const direction = i % 2 === 0 ? 1 : -1
      times.push(timed(() => list.sort((a, b) => (a.name < b.name ? -direction : a.name > b.name ? direction : 0))))
    }
    rows.B4 = median(times.slice(1))
  }

  if (marks !== null) info.scheduledMarks = marks.scheduled
  info.rootsBuilt = rootsBuilt
  return { info, rows, void: null }
}

// ---- the parent: interleaved children, table -------------------------------------------------------------------------------
const ROWS = [
  { id: 'B1', unit: 'ms', what: 'cold deep snapshot, 10k-message character', kind: 'ratio', bar: 1.5 },
  { id: 'B1w', unit: 'ms', what: 'same snapshot, warm (second walk)', kind: 'diagnostic' },
  { id: 'B2', unit: 'us/write', what: '1000 streamed writes, last message', kind: 'delta', bar: 20 },
  { id: 'B2L', unit: 'us/write', what: 'write under a child with 64 links (65 on the array)', kind: 'delta', bar: 20 },
  { id: 'B3', unit: 'ms', what: 'splice(0,0,m) on the 10k array', kind: 'ratio', bar: 2 },
  { id: 'B4', unit: 'ms', what: 'sort of 1000 characters', kind: 'ratio', bar: 2 },
  { id: 'B5', unit: 'MiB', what: 'heap after gc, walked tree (500 chars + 10k chat)', kind: 'ratio', bar: 1.1, aa: true },
  { id: 'B6', unit: 'ms', what: 'mount shape, 500 rows x 5 fields, cold', kind: 'ratio', bar: 1.3 },
  { id: 'B7', unit: 'ms', what: 'encoder pass stand-in (stringify every character)', kind: 'diagnostic' },
  { id: 'B8', unit: 'ms', what: 'contentFingerprint shape, 10k character', kind: 'diagnostic' },
  { id: 'B9', unit: 'ms', what: 'boot walk, module-heavy tier (52 modules)', kind: 'diagnostic' },
]

function spawnChild(role, scale, label) {
  const started = Date.now()
  const result = spawnSync(process.execPath, [
    '--expose-gc', '--conditions=browser', '--conditions=production', '--no-warnings', THIS_FILE, '--child', role, '--scale', scale,
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DHC_ROLE: role } })
  const line = (result.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith(RESULT_PREFIX))
  if (line === undefined) {
    console.error('child ' + label + ' printed no result (exit ' + result.status + '):\n' + (result.stderr ?? '').split(/\r?\n/).slice(-15).join('\n'))
    process.exit(1)
  }
  console.error('  ' + label + ' done in ' + ((Date.now() - started) / 1000).toFixed(1) + ' s')
  return JSON.parse(line.slice(RESULT_PREFIX.length))
}

function parentMain() {
  const args = process.argv.slice(2)
  const option = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1] }
  const reps = Number(option('--reps', '5'))
  const scale = option('--scale', 'full')
  const outFile = option('--out', null)
  if (!Number.isInteger(reps) || reps < 1 || !['full', 'small'].includes(scale)) {
    console.error('usage: node --expose-gc dirty-hook-cost.bench.mjs [--reps 5] [--scale full|small] [--out <file>]')
    process.exit(4)
  }
  const sets = { A1: [], B: [], A2: [] }
  let infoBase = null
  let infoBranch = null
  for (let rep = 1; rep <= reps; rep++) {
    for (const [set, role] of [['A1', 'base'], ['B', 'branch'], ['A2', 'base']]) {
      const child = spawnChild(role, scale, 'rep ' + rep + '/' + reps + ' ' + set + ' (' + role + ')')
      if (child.void !== null) {
        console.error('RUN VOID: ' + child.void + ' (' + JSON.stringify(child.info) + ')')
        process.exit(3)
      }
      sets[set].push(child.rows)
      if (role === 'base') infoBase = child.info
      else infoBranch = child.info
    }
  }
  const med = (set, id) => median(sets[set].map((r) => r[id]))
  const lines = []
  lines.push('DIRTY-RC hook cost bench (PC; best-case hardware, never device proof)')
  lines.push('scale ' + scale + ', ' + reps + ' interleaved repetitions of A1 (base), B (branch), A2 (base); node ' + infoBase.node)
  lines.push('esm-env DEV: base ' + infoBase.DEV + ', branch ' + infoBranch.DEV + ' (a true value voids the run)')
  lines.push('branch runtime marker: ' + infoBranch.patchId + '; base has the patch: ' + infoBase.hasPatch)
  lines.push('data: ' + JSON.stringify(infoBranch.counts) + '; links on the message array in B2L (branch): ' + infoBranch.linksOnMessageArray + '; marks scheduled in the last branch child: ' + infoBranch.scheduledMarks)
  if (scale === 'small') lines.push('SMALL SCALE: a smoke run; none of these numbers is comparable with the bars')
  lines.push('')
  const header = ['row', 'what', 'unit', 'base A1', 'base A2', 'A/A', 'branch', 'B/A', 'bar', 'verdict']
  const table = [header]
  for (const row of ROWS) {
    const a1 = med('A1', row.id)
    const a2 = med('A2', row.id)
    const b = med('B', row.id)
    const base = median([...sets.A1.map((r) => r[row.id]), ...sets.A2.map((r) => r[row.id])])
    const spread = Math.abs(a1 / a2 - 1)
    const ratio = b / base
    let barText = '-'
    let verdict = 'DIAGNOSTIC'
    if (row.kind === 'ratio') {
      barText = '<= ' + (row.bar === 1.1 ? '+10%' : row.bar + 'x')
      verdict = ratio <= row.bar ? 'PASS' : 'FAIL'
      if (row.aa && spread >= 0.10) verdict = 'INCONCLUSIVE (A/A spread ' + fixed(spread * 100, 1) + '%)'
      else if (spread >= 0.10) verdict += ' (NOISY: A/A ' + fixed(spread * 100, 1) + '%)'
    } else if (row.kind === 'delta') {
      barText = '<= +' + row.bar + ' us'
      verdict = b - base <= row.bar ? 'PASS' : 'FAIL'
      if (spread >= 0.10) verdict += ' (NOISY: A/A ' + fixed(spread * 100, 1) + '%)'
    }
    const bText = row.kind === 'delta' ? fixed(b) + ' (' + (b - base >= 0 ? '+' : '') + fixed(b - base) + ')' : fixed(b)
    table.push([row.id, row.what, row.unit, fixed(a1), fixed(a2), fixed(spread * 100, 1) + '%', bText, fixed(ratio) + 'x', barText, verdict])
  }
  const widths = header.map((_, i) => Math.max(...table.map((r) => r[i].length)))
  for (const r of table) lines.push(r.map((cell, i) => cell.padEnd(widths[i])).join('  ').trimEnd())
  lines.push('')
  lines.push('per-repetition values (A1 / B / A2):')
  for (const row of ROWS) {
    lines.push('  ' + row.id.padEnd(4) + ['A1', 'B', 'A2'].map((set) => set + ' ' + sets[set].map((r) => fixed(r[row.id])).join(' ')).join('   '))
  }
  const text = lines.join('\n')
  console.log(text)
  if (outFile !== null) writeFileSync(outFile, text + '\n')
}

// ---- entry ------------------------------------------------------------------------------------------------------------------
if (isMainThread && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--child') {
    const role = process.argv[3]
    const scale = process.argv[process.argv.indexOf('--scale') + 1]
    register(import.meta.url, { data: { role } })
    runChild(role, scale).then((result) => {
      console.log(RESULT_PREFIX + JSON.stringify(result))
      process.exit(0)
    }, (error) => {
      console.error(error && error.stack ? error.stack : String(error))
      process.exit(1)
    })
  } else {
    parentMain()
  }
}
