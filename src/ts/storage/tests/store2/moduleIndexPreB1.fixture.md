# moduleIndexPreB1.fixture

Frozen output of the module-index writer before the entry-fields tag (the fourth element of an entry's `unit` Ref), used by `moduleIndexTag.test.ts` (`entry-rewrite-adds-tag`). It holds a store written by the unmodified code, so a change to the writer cannot rewrite the input it is tested against.

- Generating commit: `a831430cc` (clean tree from `git archive a831430cc src`, no working-tree changes).
- Derivation: `createListDerivation()` from `src/ts/storage/store2/lists/derive`, so unchanged modules take the carried-lists branch on a later pass.
- Seeds: encode environment `seededEnv(901)`, key mint `createKeyMint(testEnv(createClock(), 4101), null)`, `seq` 1, `createdAt` and `now` 1700000000000. The tests that read this file use other seeds, so a new key never equals a fixture key.
- Profile: `buildSmall(1)` with its `modules` replaced by four modules: `uniq` (unique id, `mcp`, one asset), `dup` twice (the first with `mcp`), and `plain`. The resulting database is stored in the file as `database` and the test reads it from there, not from `buildSmall`.
- File: `generatedBy`, `manifestKey`, `units` (`identity`, `key`, `bytes` as base64 framed unit bytes, every unit of the tree) and `database`.
- Regenerate only to change the profile, never to follow a writer change: the point of the file is that the writer that made it is the old one.

Generator (a vitest test run under the a831430cc tree, written to the path given in the last call):

~~~ts
// Generates moduleIndexPreB1.fixture.json from the clean a831430cc source extracted next to this file.
import { test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { planScopedEncode, unitsToWrite, type EncodeOptions, type EncodeScope } from 'src/ts/storage/store2/codec'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { asDatabase, buildSmall, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, testEnv } from 'src/ts/storage/tests/store2/commitFixtures'

const NOW = 1_700_000_000_000
const ENV_SEED = 901
const MINT_SEED = 4101
const HEX = 'ab'.repeat(32)

const mod = (id: string, extra: Obj = {}): Obj => ({ name: `Module ${id}`, description: `about ${id}`, id, lorebook: [], regex: [], trigger: [], ...extra })

test('write the pre-B1 fixture', async () => {
    const base = JSON.parse(JSON.stringify(buildSmall(1))) as Obj
    base.modules = [
        mod('uniq', { mcp: { url: 'https://mcp.invalid/a' }, assets: [['a', `assets/${HEX}.png`]] }),
        mod('dup', { name: 'first', mcp: { url: 'https://mcp.invalid/b' } }),
        mod('dup', { name: 'second' }),
        mod('plain'),
    ]
    const database = JSON.parse(JSON.stringify(base)) as Obj
    const scope: EncodeScope = { modules: true, characters: 'all' }
    const options: EncodeOptions = { env: seededEnv(ENV_SEED), lists: createListDerivation(), seq: 1, createdAt: NOW, previous: null }
    const plan = await planScopedEncode(asDatabase(base), options, scope)
    const tree = plan.finalize({ mint: createKeyMint(testEnv(createClock(), MINT_SEED), null).mint, seq: 1, now: NOW })
    const units = unitsToWrite(tree).map(unit => ({ identity: unit.identity, key: unit.key, bytes: Buffer.from(unit.bytes).toString('base64') }))
    writeFileSync('<scratch>/fixture-gen/moduleIndexPreB1.fixture.json', JSON.stringify({
        generatedBy: 'a831430cc', manifestKey: tree.manifestKey, units, database,
    }, null, 1))
})

~~~