# chatUnseenReplyPreS1d.fixture

Frozen output of the chat encoder before `unseenReply` moved into the last chunk's `st` (CHORE-685 S1d), used by `codecChatUnseenReply.test.ts` (the MC-350 read-in-place cases). It holds a store written by the unmodified code, in which a chat's `unseenReply` is an ordinary core field, so a change to the writer cannot rewrite the input it is tested against.

- Generating commit: `066793b67` (clean tree from `git archive 066793b67 src server package.json pnpm-workspace.yaml tsconfig.json tsconfig.node.json vite.config.ts vitest.config.ts vitest.setup.ts`, no working-tree changes; generated before `codec/chat.ts` was edited).
- Derivation: `createListDerivation()` from `src/ts/storage/store2/lists/derive`.
- Seeds: encode environment `seededEnv(911)`, key mint `createKeyMint(testEnv(createClock(), 4111), null)`, `seq` 1, `createdAt` and `now` 1700000000000. The tests that read this file use other seeds (`seededEnv(600...)`, mint `8200...`), so a new key never equals a fixture key.
- Profile: `buildSmall(2)`. The first chat of the second character carries `unseenReply: 'reply'`; no other chat has the key. The resulting database is stored in the file as `database` and the test reads it from there, not from `buildSmall`.
- File: `generatedBy`, `manifestKey`, `markedChaId`, `markedChatId`, `cleanChaId`, `units` (`identity`, `key`, `bytes` as base64 framed unit bytes, every unit of the tree) and `database`.
- What it pins: the marked chat's core unit holds `unseenReply` in `f` and its chunk has no such key in `st` (the earlier build's placement); the first character's chats have no key at all, so a pass over that character writes none of its units.
- Regenerate only to change the profile, never to follow a writer change: the point of the file is that the writer that made it is the old one. The file is stored with CRLF line endings like the rest of the tree; the JSON content is the generator's output.

Generator (a vitest test run under the 066793b67 tree, written to the path given in the last call):

~~~ts
// @vitest-environment node
// Generates chatUnseenReplyPreS1d.fixture.json from the clean 066793b67 source.
import { test } from 'vitest'
import { writeFileSync } from 'node:fs'
import { planScopedEncode, unitsToWrite, type EncodeOptions, type EncodeScope } from 'src/ts/storage/store2/codec'
import { createKeyMint } from 'src/ts/storage/store2/commit'
import { createListDerivation } from 'src/ts/storage/store2/lists/derive'
import { asDatabase, buildSmall, seededEnv, type Obj } from 'src/ts/storage/tests/store2/codecFixtures'
import { createClock, testEnv } from 'src/ts/storage/tests/store2/commitFixtures'

const NOW = 1_700_000_000_000
const ENV_SEED = 911
const MINT_SEED = 4111

test('write the pre-S1d fixture', async () => {
    const base = JSON.parse(JSON.stringify(buildSmall(2))) as Obj
    const characters = base.characters as Obj[]
    const marked = (characters[1].chats as Obj[])[0]
    marked.unseenReply = 'reply'
    const database = JSON.parse(JSON.stringify(base)) as Obj
    const scope: EncodeScope = { modules: true, characters: 'all' }
    const options: EncodeOptions = { env: seededEnv(ENV_SEED), lists: createListDerivation(), seq: 1, createdAt: NOW, previous: null }
    const plan = await planScopedEncode(asDatabase(base), options, scope)
    const tree = plan.finalize({ mint: createKeyMint(testEnv(createClock(), MINT_SEED), null).mint, seq: 1, now: NOW })
    const units = unitsToWrite(tree).map(unit => ({ identity: unit.identity, key: unit.key, bytes: Buffer.from(unit.bytes).toString('base64') }))
    writeFileSync('<scratch>/fixture-gen/chatUnseenReplyPreS1d.fixture.json', JSON.stringify({
        generatedBy: '066793b67', manifestKey: tree.manifestKey, markedChaId: characters[1].chaId, markedChatId: marked.id, cleanChaId: characters[0].chaId, units, database,
    }, null, 1))
})

~~~
