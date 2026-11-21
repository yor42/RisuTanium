/**
 * The Tauri CLI refuses to build when an npm `@tauri-apps/*` package and its
 * Rust crate resolve to different major.minor releases. `src-tauri/Cargo.lock`
 * is not tracked, so a fresh checkout resolves each crate from its
 * `Cargo.toml` range alone: only a tilde range on the npm package's
 * major.minor keeps that resolution buildable.
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

interface PackageJson {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
}

function crateFor(npmName: string): string | null {
    if (npmName === '@tauri-apps/api') return 'tauri'
    const plugin = /^@tauri-apps\/plugin-(.+)$/.exec(npmName)
    return plugin ? `tauri-plugin-${plugin[1]}` : null
}

function crateRange(cargoToml: string, crate: string): string | null {
    const line = new RegExp(`^${crate}\\s*=\\s*(?:"([^"]+)"|\\{[^}]*\\bversion\\s*=\\s*"([^"]+)")`, 'm').exec(cargoToml)
    return line ? (line[1] ?? line[2]) : null
}

function majorMinor(version: string): string {
    const match = /^[~^=]?(\d+)\.(\d+)/.exec(version)
    if (!match) throw new Error(`unparsable version ${version}`)
    return `${match[1]}.${match[2]}`
}

async function readPairs(): Promise<{ npmName: string, npmVersion: string, crate: string, range: string | null }[]> {
    const pkg = JSON.parse(await readFile(resolve(process.cwd(), 'package.json'), 'utf8')) as PackageJson
    const cargoToml = await readFile(resolve(process.cwd(), 'src-tauri/Cargo.toml'), 'utf8')
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    return Object.entries(deps).flatMap(([npmName, npmVersion]) => {
        const crate = crateFor(npmName)
        return crate ? [{ npmName, npmVersion, crate, range: crateRange(cargoToml, crate) }] : []
    })
}

describe('npm and Rust Tauri package versions', () => {
    test('every npm Tauri runtime package has a crate on the same major.minor through a tilde range', async () => {
        const pairs = await readPairs()

        expect(pairs.map(p => p.crate)).toContain('tauri')
        expect(pairs.map(p => p.crate)).toContain('tauri-plugin-updater')
        for (const pair of pairs) {
            expect(pair.range, `${pair.crate} in src-tauri/Cargo.toml`).not.toBeNull()
            expect(pair.range!.startsWith('~'), `${pair.crate} range ${pair.range} must be a tilde range`).toBe(true)
            expect(majorMinor(pair.range!), `${pair.crate} vs ${pair.npmName}`).toBe(majorMinor(pair.npmVersion))
        }
    })
})
