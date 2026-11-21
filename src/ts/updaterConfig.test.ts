/**
 * `src-tauri/tauri.conf.json` is the only place the desktop updater's endpoint
 * and signing identity live, and the Rust plugin enforces it for every caller,
 * including a raw `plugin:updater|check` IPC call that bypasses `update.ts`.
 *
 * Tests titled `guard:` pin behaviour that must be preserved and pass before
 * and after the change; they are not proof of a fix.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

interface TauriConf {
    bundle?: { createUpdaterArtifacts?: unknown }
    plugins?: {
        updater?: {
            pubkey?: unknown
            endpoints?: unknown
            requireSignedVersion?: unknown
        }
    }
}

async function readTauriConf(): Promise<TauriConf> {
    const path = resolve(process.cwd(), 'src-tauri/tauri.conf.json')
    return JSON.parse(await readFile(path, 'utf8')) as TauriConf
}

describe('tauri.conf.json updater settings', () => {
    test('the updater polls exactly the fork release feed, never an upstream one', async () => {
        const conf = await readTauriConf()

        expect(conf.plugins?.updater?.endpoints).toEqual(['https://github.com/yor42/RisuTanium/releases/latest/download/latest.json'])
    })

    test('release builds create updater artifacts, which the signing key signs', async () => {
        const conf = await readTauriConf()

        expect(conf.bundle?.createUpdaterArtifacts).toBe(true)
    })

    test('the updater accepts only a release whose signature also signs its version, so a signed older build cannot be offered under a higher version', async () => {
        const conf = await readTauriConf()

        expect(conf.plugins?.updater?.requireSignedVersion).toBe(true)
    })

    test('guard: the updater block keeps a non-empty pubkey, because the registered plugin requires one in its config', async () => {
        const conf = await readTauriConf()
        const updater = conf.plugins?.updater

        expect(typeof updater?.pubkey).toBe('string')
        expect((updater?.pubkey as string).length).toBeGreaterThan(0)
    })
})
