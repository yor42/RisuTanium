import { describe, expect, it } from 'vitest'
import { hexStemToBase64url, IL_REF_V, type InlayList } from '../../store2/format'
import { assetKeyOf, buildClosureAssetKeepSet, buildInlayKeepSet, keepManifestKeys, legacyFilesOf, type Rederive } from '../../store2/sweep'
import {
    assetListOf, commitKeyOf, HEX_A, HEX_B, HEX_C, HEX_D, HEX_E, HEX_F, inlayListOf, legacyListOf, manifestKey, overflowInlayList, reasonCodes, reasonsOf, Tree, UUID_A, UUID_B,
} from './sweepFixtures'

const png = (hex: string): string => `assets/${hex}.png`

describe('assetKeyOf', () => {
    it('reads backslashes as separators and lower-cases a hash name of any case to its stem', () => {
        expect(assetKeyOf(`assets\\${HEX_A.toUpperCase()}.PNG`)).toEqual({ kind: 'hash', stem: hexStemToBase64url(HEX_A) })
        expect(assetKeyOf(`assets/${HEX_A}.png`)).toEqual({ kind: 'hash', stem: hexStemToBase64url(HEX_A) })
    })

    it('keeps any other name as a lower-cased literal and refuses an empty key', () => {
        expect(assetKeyOf('Custom-Voice-ID.WAV')).toEqual({ kind: 'literal', key: 'custom-voice-id.wav' })
        expect(assetKeyOf('assets/')).toBeNull()
        expect(assetKeyOf('')).toBeNull()
    })
})

describe('asset keep-set', () => {
    it('unions current, retained and pinned manifests, so each protects its own asset', async () => {
        const tree = new Tree()
        const current = tree.addManifest({ config: [png(HEX_A)] }, 1)
        const retained = tree.addManifest({ config: [png(HEX_B)] }, 2)
        const pinned = tree.addManifest({ characters: [{ u: 'c1', assets: [png(HEX_C)] }] }, 3)
        const commitKey = commitKeyOf({ current, retained: [{ key: retained, at: 0 }], pins: [{ key: pinned, reason: 'user' }] })
        const result = await buildClosureAssetKeepSet({ commitKey, reader: tree.reader })
        expect(result.status).toBe('complete')
        if (result.status === 'complete') {
            expect(result.keep.holds(png(HEX_A))).toBe(true)
            expect(result.keep.holds(png(HEX_B))).toBe(true)
            expect(result.keep.holds(png(HEX_C))).toBe(true)
            expect(result.keep.holds(png(HEX_D))).toBe(false)
        }
    })

    it('lists every manifest key once, current first', () => {
        const commitKey = commitKeyOf({ current: manifestKey(1), retained: [{ key: manifestKey(2), at: 0 }, { key: manifestKey(1), at: 0 }], pins: [{ key: manifestKey(2), reason: 'x' }] })
        expect(keepManifestKeys(commitKey)).toEqual([manifestKey(1), manifestKey(2)])
    })

    it('compares hash names case-insensitively and literals lower-cased', async () => {
        const tree = new Tree()
        const current = tree.addManifest({
            config: [png(HEX_A), 'Custom-Voice-ID.WAV'],
            modules: [{ id: 'm', assets: [png(HEX_E.toUpperCase())] }],
        }, 1)
        const result = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        expect(result.status).toBe('complete')
        if (result.status === 'complete') {
            expect(result.keep.holds(`assets/${HEX_A.toUpperCase()}.PNG`)).toBe(true)
            expect(result.keep.holds(`assets\\${HEX_E}.WEBP`)).toBe(true)
            expect(result.keep.holds('CUSTOM-VOICE-ID.wav')).toBe(true)
            // A name with no usable key cannot be compared, so it is held.
            expect(result.keep.holds('assets/')).toBe(true)
        }
    })

    it('adds the resident references and the names written this page', async () => {
        const tree = new Tree()
        const current = tree.addManifest({}, 1)
        const result = await buildClosureAssetKeepSet({
            commitKey: commitKeyOf({ current }), reader: tree.reader,
            residentRefs: [png(HEX_D)], writtenThisPage: [`assets/${HEX_F.toUpperCase()}.PNG`],
        })
        expect(result.status).toBe('complete')
        if (result.status === 'complete') {
            expect(result.keep.holds(png(HEX_D))).toBe(true)
            expect(result.keep.holds(png(HEX_F))).toBe(true)
        }
    })

    it('protects through the legacy unit', async () => {
        const tree = new Tree()
        const legacy = legacyListOf({ ...assetListOf([png(HEX_B), 'Old-File.PNG']), files: [{ key: 'database/database.bin', status: 'ok' }] })
        const current = tree.addManifest({ legacy: { list: legacy, files: [{ key: 'database/database.bin', status: 'ok' }] } }, 1)
        const result = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        expect(result.status).toBe('complete')
        if (result.status === 'complete') {
            expect(result.keep.holds(png(HEX_B))).toBe(true)
            expect(result.keep.holds('old-file.png')).toBe(true)
        }
    })

    it('is incomplete when a list is above the known version, parsed or reported ok', async () => {
        const tree = new Tree()
        const current = tree.addManifest({ characters: [{ u: 'c1', assetList: { ...assetListOf([png(HEX_A)]), v: 2 } }] }, 1)
        const parsed = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        expect(parsed.status).toBe('incomplete')
        expect(reasonCodes(parsed)).toContain('list-newer')

        // A reader that reports a newer list as readable must not make the set complete.
        const lax = new Tree()
        const laxCurrent = lax.addManifest({}, 1)
        const manifest = await lax.reader.manifest(laxCurrent)
        if (manifest.status !== 'ok') {
            throw new Error('fixture manifest did not parse')
        }
        lax.force(manifest.value.fixed.configAl[0], { status: 'ok', value: { v: 2, h: '', l: [] } })
        const forced = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current: laxCurrent }), reader: lax.reader })
        expect(forced.status).toBe('incomplete')
    })

    it('re-derives a stale list from the owner or reports incomplete', async () => {
        const tree = new Tree()
        const current = tree.addManifest({ characters: [{ u: 'c1', assetList: { ...assetListOf([png(HEX_A)]), v: 0 } }] }, 1)
        const commitKey = commitKeyOf({ current })

        const without = await buildClosureAssetKeepSet({ commitKey, reader: tree.reader })
        expect(without.status).toBe('incomplete')
        expect(reasonCodes(without)).toContain('list-stale')
        expect(reasonsOf(without)[0].owner).toMatchObject({ kind: 'character', id: 'c1' })

        const rederive: Rederive = {
            assets: async owner => (owner.id === 'c1' ? assetListOf([png(HEX_A), png(HEX_B)]) : null),
            inlays: async () => null,
        }
        const withIt = await buildClosureAssetKeepSet({ commitKey, reader: tree.reader, rederive })
        expect(withIt.status).toBe('complete')
        if (withIt.status === 'complete') {
            expect(withIt.keep.holds(png(HEX_B))).toBe(true)
        }

        const stillStale = await buildClosureAssetKeepSet({ commitKey, reader: tree.reader, rederive: { assets: async () => ({ ...assetListOf([]), v: 0 }), inlays: async () => null } })
        expect(stillStale.status).toBe('incomplete')
    })

    it('is incomplete when a node is missing or fails its CRC, naming the unit', async () => {
        const tree = new Tree()
        const current = tree.addManifest({ characters: [{ u: 'c1', assets: [png(HEX_A)] }] }, 1)
        const manifest = await tree.reader.manifest(current)
        if (manifest.status !== 'ok') {
            throw new Error('fixture manifest did not parse')
        }
        tree.fail(manifest.value.shards[0][0], 'crc-failed')
        const crc = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        expect(crc.status).toBe('incomplete')
        expect(reasonCodes(crc)).toEqual(['node-crc-failed'])

        const missing = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current: manifestKey(99) }), reader: tree.reader })
        expect(missing.status).toBe('incomplete')
        expect(reasonCodes(missing)).toEqual(['node-missing'])
    })

    it('treats a reader that throws as a node that could not be read', async () => {
        const tree = new Tree()
        const current = tree.addManifest({}, 1)
        const reader = { ...tree.reader, assetList: async (): Promise<never> => { throw new Error('io failure') } }
        const result = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current }), reader })
        expect(result.status).toBe('incomplete')
    })

    it('is incomplete without a current manifest and with an unreadable legacy file', async () => {
        const tree = new Tree()
        const none = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current: null }), reader: tree.reader })
        expect(none.status).toBe('incomplete')
        expect(reasonCodes(none)).toEqual(['no-current'])

        const legacy = legacyListOf({ files: [{ key: 'database/database.bin', status: 'ok' }] })
        const current = tree.addManifest({
            legacy: { list: legacy, files: [{ key: 'database/database.bin', status: 'ok' }, { key: 'database/dbbackup-1.bin', status: 'unreadable' }] },
        }, 1)
        const blocked = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        expect(blocked.status).toBe('incomplete')
        expect(reasonCodes(blocked)).toContain('legacy-file-unreadable')
    })

    it('stays blocked by an unreadable legacy file in a retained manifest after the current one cleared it', async () => {
        const tree = new Tree()
        const legacy = legacyListOf({})
        const retained = tree.addManifest({ legacy: { list: legacy, files: [{ key: 'a.bin', status: 'unreadable' }] } }, 1)
        const current = tree.addManifest({ legacy: { list: legacy, files: [{ key: 'a.bin', status: 'gone' }] } }, 2)
        const result = await buildClosureAssetKeepSet({ commitKey: commitKeyOf({ current, retained: [{ key: retained, at: 0 }] }), reader: tree.reader })
        expect(result.status).toBe('incomplete')
    })

    it('reads each unit once however many manifests share it', async () => {
        const tree = new Tree()
        const current = tree.addManifest({ config: [png(HEX_A)] }, 1)
        const manifest = await tree.reader.manifest(current)
        if (manifest.status !== 'ok') {
            throw new Error('fixture manifest did not parse')
        }
        const sameKey = commitKeyOf({ current, retained: [{ key: current, at: 0 }], pins: [{ key: current, reason: 'x' }] })
        await buildClosureAssetKeepSet({ commitKey: sameKey, reader: tree.reader })
        expect(tree.reads.get(manifest.value.fixed.configAl[0])).toBe(1)
    })

    it('lists the legacy files of every manifest for the fence check', async () => {
        const tree = new Tree()
        const key = tree.addManifest({ legacy: { list: legacyListOf({}), files: [{ key: 'a.bin', status: 'unreadable' }] } }, 1)
        const manifest = await tree.reader.manifest(key)
        if (manifest.status !== 'ok') {
            throw new Error('fixture manifest did not parse')
        }
        expect(legacyFilesOf([manifest.value])).toEqual([{ key: 'a.bin', status: 'unreadable' }])
    })
})

describe('inlay keep-set', () => {
    const ownerList = (over: Partial<InlayList>): InlayList => ({ ...inlayListOf({}), ...over })

    it('unions il, module il, fixed.il and the legacy inlay list, lower-casing uuids', async () => {
        const tree = new Tree()
        const legacy = legacyListOf({ i: inlayListOf({ u: [UUID_B], o: ['legacy-token'] }) })
        const current = tree.addManifest({
            characters: [{ u: 'c1', il: inlayListOf({ u: [UUID_A.toUpperCase()] }) }],
            modules: [{ id: 'm1', il: inlayListOf({ h: hexStemToBase64url(HEX_A) }) }],
            configIl: inlayListOf({ o: ['config-token'] }),
            legacy: { list: legacy, files: [{ key: 'a.bin', status: 'ok' }] },
        }, 1)
        const result = await buildInlayKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        expect(result.status).toBe('complete')
        if (result.status === 'complete') {
            expect([...result.keep.uuids].sort()).toEqual([UUID_A, UUID_B].sort())
            expect([...result.keep.stems]).toEqual([hexStemToBase64url(HEX_A)])
            expect([...result.keep.others].sort()).toEqual(['config-token', 'legacy-token'])
            expect(result.keep.owners.map(o => o.kind).sort()).toEqual(['character', 'config', 'legacy', 'module'])
            expect(result.keep.unknownOwners).toEqual([])
        }
    })

    it('does not read the asset lists', async () => {
        const tree = new Tree()
        const current = tree.addManifest({ config: [png(HEX_A)], characters: [{ u: 'c1', assets: [png(HEX_B)] }] }, 1)
        const manifest = await tree.reader.manifest(current)
        if (manifest.status !== 'ok') {
            throw new Error('fixture manifest did not parse')
        }
        tree.fail(manifest.value.fixed.configAl[0], 'crc-failed')
        const result = await buildInlayKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        expect(result.status).toBe('complete')
    })

    it('protects through a retained and a pinned manifest', async () => {
        const tree = new Tree()
        const current = tree.addManifest({}, 1)
        const retained = tree.addManifest({ characters: [{ u: 'c1', il: inlayListOf({ u: [UUID_A] }) }] }, 2)
        const pinned = tree.addManifest({ characters: [{ u: 'c1', il: inlayListOf({ u: [UUID_B] }) }] }, 3)
        const result = await buildInlayKeepSet({
            commitKey: commitKeyOf({ current, retained: [{ key: retained, at: 0 }], pins: [{ key: pinned, reason: 'x' }] }), reader: tree.reader,
        })
        expect(result.status === 'complete' && result.keep.uuids.has(UUID_A) && result.keep.uuids.has(UUID_B)).toBe(true)
    })

    it('reports an overflow owner as unknown, and a re-derived exact list clears it', async () => {
        const tree = new Tree()
        const current = tree.addManifest({ characters: [{ u: 'c1', il: overflowInlayList() }] }, 1)
        const commitKey = commitKeyOf({ current })
        const unknown = await buildInlayKeepSet({ commitKey, reader: tree.reader })
        expect(unknown.status).toBe('complete')
        if (unknown.status === 'complete') {
            expect(unknown.keep.unknownOwners).toMatchObject([{ kind: 'character', id: 'c1' }])
        }

        const rederive: Rederive = { assets: async () => null, inlays: async () => inlayListOf({ u: [UUID_A] }) }
        const cleared = await buildInlayKeepSet({ commitKey, reader: tree.reader, rederive })
        expect(cleared.status === 'complete' && cleared.keep.unknownOwners.length === 0 && cleared.keep.uuids.has(UUID_A)).toBe(true)
    })

    it('keeps an owner unknown when a stale list re-derives as an overflow', async () => {
        const tree = new Tree()
        const current = tree.addManifest({ characters: [{ u: 'c1', il: ownerList({ v: 0 }) }] }, 1)
        const result = await buildInlayKeepSet({
            commitKey: commitKeyOf({ current }), reader: tree.reader,
            rederive: { assets: async () => null, inlays: async () => overflowInlayList() },
        })
        expect(result.status).toBe('complete')
        if (result.status === 'complete') {
            expect(result.keep.unknownOwners).toMatchObject([{ kind: 'character', id: 'c1' }])
        }
    })

    it('is incomplete for a list above the known version and for a stale list that cannot be re-derived', async () => {
        const tree = new Tree()
        const newer = tree.addManifest({ configIl: ownerList({ v: IL_REF_V + 1 }) }, 1)
        const above = await buildInlayKeepSet({ commitKey: commitKeyOf({ current: newer }), reader: tree.reader })
        expect(above.status).toBe('incomplete')
        expect(reasonCodes(above)).toContain('list-newer')

        const stale = tree.addManifest({ characters: [{ u: 'c1', il: ownerList({ v: 0 }) }] }, 2)
        const refused = await buildInlayKeepSet({ commitKey: commitKeyOf({ current: stale }), reader: tree.reader })
        expect(refused.status).toBe('incomplete')
        expect(reasonCodes(refused)).toContain('list-stale')
        const derived = await buildInlayKeepSet({
            commitKey: commitKeyOf({ current: stale }), reader: tree.reader,
            rederive: { assets: async () => null, inlays: async () => inlayListOf({ u: [UUID_A] }) },
        })
        expect(derived.status === 'complete' && derived.keep.uuids.has(UUID_A)).toBe(true)
    })

    it('is incomplete for a legacy unit whose inlay version is above the known one, and for an unreadable legacy file', async () => {
        const tree = new Tree()
        const legacy = legacyListOf({ iv: IL_REF_V })
        const forced = tree.addManifest({ legacy: { list: legacy, files: [{ key: 'a.bin', status: 'ok' }] } }, 1)
        const manifest = await tree.reader.manifest(forced)
        if (manifest.status !== 'ok' || manifest.value.fixed.legacyKeep === null) {
            throw new Error('fixture manifest did not parse')
        }
        tree.force(manifest.value.fixed.legacyKeep.unit[0], { status: 'ok', value: { ...legacy, iv: IL_REF_V + 1 } })
        const above = await buildInlayKeepSet({ commitKey: commitKeyOf({ current: forced }), reader: tree.reader })
        expect(above.status).toBe('incomplete')

        const blocked = tree.addManifest({ legacy: { list: legacyListOf({}), files: [{ key: 'a.bin', status: 'unreadable' }] } }, 2)
        const result = await buildInlayKeepSet({ commitKey: commitKeyOf({ current: blocked }), reader: tree.reader })
        expect(result.status).toBe('incomplete')
    })

    it('is incomplete when a node fails its CRC', async () => {
        const tree = new Tree()
        const current = tree.addManifest({ characters: [{ u: 'c1', il: inlayListOf({ u: [UUID_A] }) }] }, 1)
        const manifest = await tree.reader.manifest(current)
        if (manifest.status !== 'ok') {
            throw new Error('fixture manifest did not parse')
        }
        tree.fail(manifest.value.shards[0][0], 'crc-failed')
        const result = await buildInlayKeepSet({ commitKey: commitKeyOf({ current }), reader: tree.reader })
        expect(result.status).toBe('incomplete')
    })
})
