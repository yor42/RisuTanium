// @vitest-environment node
// The built-in packs: metadata and chat sheet equal the frozen golden packs they were built from. T3B-1.
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import * as builtinsModule from './builtins'
import { BUILTIN_PACKS, builtinPackById } from './builtins'
import { judgeAreaSheet, preprocessCss } from './index'

const GOLDENS = new URL('./goldens/', import.meta.url)

interface GoldenManifest { id: string; name: string; version: string; license: string; attribution: string; modes: string[] }

function golden(slug: string): { manifest: GoldenManifest; chat: string } {
    const entries = unzipSync(new Uint8Array(readFileSync(new URL(`${slug}.risutheme`, GOLDENS))))
    return { manifest: JSON.parse(strFromU8(entries['manifest.json'])) as GoldenManifest, chat: strFromU8(entries['chat.css']) }
}

describe('T3B-1 the built-in packs', () => {
    it('are exactly the two chat themes, with the ids the settings and I2 use', () => {
        expect(BUILTIN_PACKS.map((pack) => pack.id)).toEqual(['builtin:origin-navy', 'builtin:banana-cocoa'])
        expect(BUILTIN_PACKS.map((pack) => pack.slug)).toEqual(['origin-navy', 'banana-cocoa'])
    })

    it.each(BUILTIN_PACKS.map((pack) => [pack.slug, pack] as const))('%s: the metadata equals its golden manifest and the sheet equals its golden chat.css', (slug, pack) => {
        const { manifest, chat } = golden(slug)
        expect(manifest.id).toBe(`risutanium.${slug}`)
        expect({ name: pack.name, version: pack.version, license: pack.license, attribution: pack.attribution, modes: [...pack.modes] })
            .toEqual({ name: manifest.name, version: manifest.version, license: manifest.license, attribution: manifest.attribution, modes: manifest.modes })
        expect(preprocessCss(pack.chatCss)).toBe(chat)
    })

    it.each(BUILTIN_PACKS.map((pack) => [pack.slug, pack] as const))('%s: the chat sheet is accepted by the validator and bundles no file', (_slug, pack) => {
        const judged = judgeAreaSheet('chat', pack.chatCss)
        expect(judged.result.errors).toEqual([])
        expect(judged.result.ok).toBe(true)
        expect(judged.resources).toHaveLength(0)
    })

    it('carry a chat sheet only: no studio, settings or home sheet is bundled or exported', () => {
        expect(Object.keys(builtinsModule).sort()).toEqual(['BUILTIN_PACKS', 'builtinPackById'])
        for (const pack of BUILTIN_PACKS) {
            expect(Object.keys(pack).sort()).toEqual(['attribution', 'chatCss', 'id', 'license', 'modes', 'name', 'slug', 'version'])
        }
    })

    it('builtinPackById matches the id exactly and nothing else', () => {
        expect(builtinPackById('builtin:origin-navy')).toBe(BUILTIN_PACKS[0])
        expect(builtinPackById('builtin:banana-cocoa')).toBe(BUILTIN_PACKS[1])
        for (const id of ['builtin:nope', 'origin-navy', 'builtin:origin-navy ', 'BUILTIN:ORIGIN-NAVY', 'builtin:', '', 'archive:origin-navy']) {
            expect(builtinPackById(id), id).toBeNull()
        }
    })
})
