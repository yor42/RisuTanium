// @vitest-environment jsdom

/**
 * Which files the app registers with the operating system. Android takes its intent filters from the generated block
 * of `AndroidManifest.xml`, which the build script writes from the base `fileAssociations` of `tauri.conf.json` only;
 * Windows and Linux replace that array through their own platform file (a JSON merge patch replaces arrays whole).
 * These tests read the committed files, so a config edit that leaves the manifest stale, or a platform file that
 * widens or narrows the wrong target, fails here before a build shows it.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

//Vitest runs from the repository root.
const tauriDir = (name: string) => resolve(process.cwd(), 'src-tauri', name)
const manifestPath = tauriDir('gen/android/app/src/main/AndroidManifest.xml')

interface Association {
    ext: string[]
    role?: string
    rank?: string
    mimeType?: string
}
interface TauriConfig {
    bundle?: { fileAssociations?: Association[] }
}

function readConfig(name: string): TauriConfig | null {
    const path = tauriDir(name)
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as TauriConfig : null
}

/** The effective array on a platform: a platform file that sets `bundle.fileAssociations` replaces the base array whole (RFC 7396). */
function effectiveAssociations(platformFile: string): Association[] {
    const base = readConfig('tauri.conf.json')?.bundle?.fileAssociations ?? []
    return readConfig(platformFile)?.bundle?.fileAssociations ?? base
}

const extensionsOf = (associations: Association[]) => associations.flatMap((a) => a.ext).sort()

const ALL_EXTENSIONS = ['byaf', 'charx', 'jpeg', 'jpg', 'json', 'png', 'risum', 'risup'].sort()
const WINDOWS_EXTENSIONS = ['byaf', 'charx', 'risum', 'risup']

describe('the Android manifest', () => {
    const doc = new DOMParser().parseFromString(readFileSync(manifestPath, 'utf8'), 'text/xml')
    const activity = Array.from(doc.getElementsByTagName('activity')).find((a) => a.getAttribute('android:name') === '.MainActivity')!
    const filters = Array.from(activity.getElementsByTagName('intent-filter'))
    const namesOf = (filter: Element, tag: string) => Array.from(filter.getElementsByTagName(tag)).map((n) => n.getAttribute('android:name'))
    const mimeTypesOf = (filter: Element) => Array.from(filter.getElementsByTagName('data')).map((d) => d.getAttribute('android:mimeType')).filter((m) => m !== null)
    const actionsOf = (filter: Element) => namesOf(filter, 'action').map((a) => a!.replace('android.intent.action.', '')).sort()

    test.each(['image/png', 'image/jpeg', 'application/json'])('%s is offered for open-with, share and multi-share, with no scheme but content', (mimeType) => {
        const matching = filters.filter((f) => mimeTypesOf(f).includes(mimeType))
        expect(matching).toHaveLength(1)
        const filter = matching[0]
        expect(actionsOf(filter)).toEqual(['SEND', 'SEND_MULTIPLE', 'VIEW'])
        expect(namesOf(filter, 'category')).toContain('android.intent.category.DEFAULT')
        const schemes = Array.from(filter.getElementsByTagName('data')).map((d) => d.getAttribute('android:scheme')).filter((s) => s !== null)
        expect(schemes.filter((s) => s !== 'content')).toEqual([])
    })

    test('the hand-written octet-stream and zip filters are unchanged (guard)', () => {
        const generic = ['application/octet-stream', 'application/zip', 'application/x-zip-compressed']
        const handWritten = filters.filter((f) => mimeTypesOf(f).includes('application/octet-stream'))
        expect(handWritten.map(actionsOf)).toEqual([['VIEW'], ['SEND'], ['SEND_MULTIPLE']])
        for (const filter of handWritten) {
            expect(mimeTypesOf(filter)).toEqual(generic)
        }
        expect(activity.getAttribute('android:launchMode')).toBe('singleTask')
        expect(activity.getAttribute('android:exported')).toBe('true')
    })

    test('the generated block lists every base extension as a path pattern', () => {
        const patterns = filters.flatMap((f) => Array.from(f.getElementsByTagName('data')).map((d) => d.getAttribute('android:pathPattern')).filter((p) => p !== null))
        expect(patterns.map((p) => p!.replace('.*\\\\.', '')).sort()).toEqual(ALL_EXTENSIONS)
    })
})

describe('the base file associations', () => {
    const base = readConfig('tauri.conf.json')!.bundle!.fileAssociations!

    test('together they name exactly the eight extensions, which the generated Android block and macOS use', () => {
        expect(extensionsOf(base)).toEqual(ALL_EXTENSIONS)
    })

    // Mirrors the table of tauri-build 2.7.1 `mobile.rs` (`extension_to_mime_type`), restricted to the extensions used here.
    const inferredMime: { [ext: string]: string } = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', json: 'application/json' }

    // Guard: passes before and after. The generator collects the types of one association into a hash set, whose order differs on every build.
    test('each association infers at most one MIME type, so the generated block is the same on every build', () => {
        for (const association of base) {
            const mimes = new Set(association.ext.map((e) => inferredMime[e]).filter((m) => m !== undefined))
            expect(mimes.size, association.ext.join(',')).toBeLessThanOrEqual(1)
        }
    })

    test('the image and JSON associations are alternates, so macOS lists the app without making it the default', () => {
        const media = base.filter((a) => a.ext.some((e) => inferredMime[e] !== undefined))
        expect(media).toHaveLength(3)
        for (const association of media) {
            expect(association.role, association.ext.join(',')).toBe('Viewer')
            expect(association.rank, association.ext.join(',')).toBe('Alternate')
        }
    })
})

describe('the platform files', () => {
    test('Windows registers risum, risup, charx and byaf only', () => {
        expect(extensionsOf(effectiveAssociations('tauri.windows.conf.json'))).toEqual(WINDOWS_EXTENSIONS)
    })

    test('Linux registers all eight and names the MIME type of the image and JSON associations', () => {
        const linux = effectiveAssociations('tauri.linux.conf.json')
        expect(extensionsOf(linux)).toEqual(ALL_EXTENSIONS)
        const mimeOf = (ext: string) => linux.find((a) => a.ext.includes(ext))?.mimeType
        expect(mimeOf('png')).toBe('image/png')
        expect(mimeOf('jpg')).toBe('image/jpeg')
        expect(mimeOf('jpeg')).toBe('image/jpeg')
        expect(mimeOf('json')).toBe('application/json')
        expect(mimeOf('byaf')).toBeUndefined()
    })

    // Guard: passes before and after. Android merges only an Android platform file, and none may exist.
    test('no Android platform file exists, and the Windows and Linux files set nothing but the file associations', () => {
        for (const name of ['tauri.android.conf.json', 'tauri.android.conf.json5', 'Tauri.android.toml']) {
            expect(existsSync(tauriDir(name)), name).toBe(false)
        }
        for (const name of ['tauri.windows.conf.json', 'tauri.linux.conf.json']) {
            const config = readConfig(name)
            if (config === null) {
                continue
            }
            expect(Object.keys(config), name).toEqual(['bundle'])
            expect(Object.keys(config.bundle ?? {}), name).toEqual(['fileAssociations'])
        }
    })
})
