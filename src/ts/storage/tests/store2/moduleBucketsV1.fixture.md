# moduleBucketsV1.fixture

Frozen output of the module-index writer before the bucketed layout (the S2 encoder, module index type 10 with `v` 1 and all entries inline), used by `moduleBuckets.test.ts` and `moduleBucketsCommit.test.ts`. It holds a store written by the unmodified code, so a change to the writer cannot rewrite the input it is tested against.

- Generating commit: `4a3f42dbf` (clean tree from `git archive 4a3f42dbf src package.json tsconfig.json tsconfig.node.json vite.config.ts vitest.config.ts vitest.setup.ts`, no working-tree changes, run with a `node_modules` junction to the repository's).
- Derivation: `createListDerivation()` from `src/ts/storage/store2/lists/derive`, so unchanged modules take the carried-lists branch on a later pass.
- Seeds: encode environment `seededEnv(902)`, key mint `createKeyMint(seededEnv(4102), null)`, `seq` 1, `createdAt` and `now` 1700000000000. The tests that read this file use other seeds, so a new key never equals a fixture key.
- Profile: `buildSmall(1)` with its `modules` replaced by forty modules: `mod-00` to `mod-37` (`mod-05` with `mcp`, `mod-09` with one asset `assets/cdcd...cd.png`), then `dup` twice (names `first` and `second`). The resulting database is stored in the file as `database` and the tests read it from there, not from `buildSmall`. Forty modules give four buckets under the bucket count rule (`ceil(40 / 16)` is 3, rounded up to a power of two).
- File: `generatedBy`, `manifestKey`, `units` (`identity`, `key`, `bytes` as base64 framed unit bytes, every unit of the tree) and `database`.
- Regenerate only to change the profile, never to follow a writer change: the point of the file is that the writer that made it is the old one.

Generator (a vitest test run under the `4a3f42dbf` tree, written to the path in the `FIXTURE_OUT` environment variable). It uses `seededEnv` for the mint because `commitFixtures` pulls in the Node server fixture, which an extracted `src` alone does not carry.

~~~ts
// Generates moduleBucketsV1.fixture.json from the clean 4a3f42dbf source extracted next to this file.
import { test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { planScopedEncode, unitsToWrite, type EncodeOptions, type EncodeScope } from 'src/ts/storage/store2/codec'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { asDatabase, buildSmall, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'

const NOW = 1_700_000_000_000
const ENV_SEED = 902
const MINT_SEED = 4102
const HEX = 'cd'.repeat(32)

const mod = (id: string, extra: Obj = {}): Obj => ({ name: `Module ${id}`, description: `about ${id}`, id, lorebook: [], regex: [], trigger: [], ...extra })

test('write the module buckets v1 fixture', async () => {
    const base = JSON.parse(JSON.stringify(buildSmall(1))) as Obj
    base.modules = [
        ...Array.from({ length: 38 }, (_, index) => mod(`mod-${String(index).padStart(2, '0')}`, index === 5 ? { mcp: { url: 'https://mcp.invalid/a' } } : index === 9 ? { assets: [['a', `assets/${HEX}.png`]] } : {})),
        mod('dup', { name: 'first' }),
        mod('dup', { name: 'second' }),
    ]
    const database = JSON.parse(JSON.stringify(base)) as Obj
    const scope: EncodeScope = { modules: true, characters: 'all' }
    const options: EncodeOptions = { env: seededEnv(ENV_SEED), lists: createListDerivation(), seq: 1, createdAt: NOW, previous: null }
    const plan = await planScopedEncode(asDatabase(base), options, scope)
    const tree = plan.finalize({ mint: createKeyMint(seededEnv(MINT_SEED), null).mint, seq: 1, now: NOW })
    const units = unitsToWrite(tree).map(unit => ({ identity: unit.identity, key: unit.key, bytes: Buffer.from(unit.bytes).toString('base64') }))
    writeFileSync(process.env.FIXTURE_OUT as string, JSON.stringify({
        generatedBy: '4a3f42dbf', manifestKey: tree.manifestKey, units, database,
    }, null, 1))
})

~~~
