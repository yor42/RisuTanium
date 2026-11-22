// @vitest-environment node
import { describe, expect, test, vi } from 'vitest'
import { checkRefs, checkReqTokens, V1_REF_STRINGS } from 'src/ts/drive/rtb/refsFingerprint'
import { EXCLUDED_FIELDS, SETTINGS_FIELDS } from 'src/ts/drive/rtb/settingsFields'
import { assembleDatabase } from 'src/ts/storage/store2/codec'
import { keyOfRef, KNOWN_REQ, readUnit, UNIT_TYPE, type Manifest } from 'src/ts/storage/store2/format'
import { omittedTailsOf, planRestore } from 'src/ts/storage/store2/rtb/restoreBuild'
import { readTreeBytes } from 'src/ts/storage/store2/treeBytes'
import { assembleStore, captureExport, commitRestore, rtbWorld } from './rtbFixtures'

const layout = vi.hoisted(() => ({ MODULE_INDEX_LAYOUT: 1 }))
vi.mock('src/ts/storage/store2/codec/moduleIndexParams', () => ({ MODULE_INDEX_PARAMS: layout }))

/**
 * Kind 30 in the `.rtb` (#272 S1): the export closure carries the unit through the manifest row `fixed.chatDrafts`, a restore
 * writes it back as stored and the boot reads it, a reader built before the row takes the file as newer, and a settings-only
 * file never carries the field. The store is the fixture world's real producer output, whose profile holds drafts and a flag.
 * Labels: PIN pins a rule of a unit that does not exist before the change.
 */

const ROW = '2:fixed.chatDrafts'

describe('T1.10 the draft unit in the .rtb', () => {
    test('PIN: the export walk carries the unit and files it under the manifest row', async () => {
        const world = await rtbWorld({ layout: 1 })
        const captured = await captureExport(await world.open())
        const tails = world.keysOfType(UNIT_TYPE.chatDrafts).map(key => key.slice('store2/'.length))
        expect(tails).toHaveLength(1)
        expect(captured.frames.has(tails[0])).toBe(true)
        expect(world.refsByRow.get(ROW)).toEqual(tails)
    })

    test('PIN: a restore writes the unit back as stored, and the boot read of the restored store assembles the same drafts', async () => {
        const world = await rtbWorld({ layout: 1 })
        const captured = await captureExport(await world.open())
        const restored = await commitRestore(planRestore({
            frames: captured.frames, root: captured.root, omitted: omittedTailsOf(captured.omitted), target: { legacyKeep: null, req: [] },
        }))
        const source = assembleStore(world.store, world.manifestKey) as { chatDrafts?: unknown }
        expect(source.chatDrafts).toEqual([
            { cha: 'draft-cha', chat: 'draft-chat', shown: true, drafts: [{ m: 'id:m1', text: 'unsent edit', bh: '0123456789abcdef0123456789abcdef', at: 1_700_000_000_000 }] },
        ])
        expect((assembleStore(restored.units, restored.manifestKey) as { chatDrafts?: unknown }).chatDrafts).toEqual(source.chatDrafts)

        const original = world.keysOfType(UNIT_TYPE.chatDrafts)[0]
        const manifest = readUnit(restored.units.get(restored.manifestKey) as Uint8Array, UNIT_TYPE.manifest)
        const restoredRef = manifest.status === 'ok' ? (manifest.value.body as Manifest).fixed.chatDrafts : undefined
        expect(restoredRef).toBeDefined()
        expect(restored.units.get(keyOfRef(restoredRef ?? ['', 0, 0]))).toEqual(world.store.get(original))
        expect(manifest.status === 'ok' && (manifest.value.body as Manifest).req).toContain('chat-drafts')

        const boot = await readTreeBytes(restored.backend, restored.manifestKey)
        expect(boot.status).toBe('ok')
        expect(boot.status === 'ok' && boot.dropped).toBeUndefined()
        expect(boot.status === 'ok' && assembleDatabase(boot.tree.manifest, boot.tree.source).chatDrafts).toEqual(source.chatDrafts)
    })

    test('PIN: a reader built before the row takes a file that lists it as newer, and one that does not know the token the same', () => {
        const before = V1_REF_STRINGS.filter(text => text !== ROW)
        expect(V1_REF_STRINGS).toContain(ROW)
        expect(checkRefs([...V1_REF_STRINGS], { table: before })).toEqual({ kind: 'newer', refs: [ROW] })
        expect(checkReqTokens(['chat-drafts'], new Set([...KNOWN_REQ].filter(token => token !== 'chat-drafts')))).toEqual({ kind: 'newer', tokens: ['chat-drafts'] })
        expect(checkReqTokens(['chat-drafts'])).toEqual({ kind: 'ok' })
    })

    test('PIN: a settings-only file never carries the field', () => {
        expect((EXCLUDED_FIELDS as readonly string[]).includes('chatDrafts')).toBe(true)
        expect((SETTINGS_FIELDS as readonly string[]).includes('chatDrafts')).toBe(false)
    })
})
