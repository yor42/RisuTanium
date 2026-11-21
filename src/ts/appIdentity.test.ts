import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

function readRepoFile(file: string): string {
    return readFileSync(path.join(process.cwd(), file), 'utf-8')
}

const tauriConfPath = 'src-tauri/tauri.conf.json'
const androidStringsPath = 'src-tauri/gen/android/app/src/main/res/values/strings.xml'

describe('app display name metadata', () => {
    test('desktop productName and mainBinaryName use the RisuTanium spelling', () => {
        const conf = JSON.parse(readRepoFile(tauriConfPath))
        expect(conf.productName).toBe('RisuTanium')
        expect(conf.mainBinaryName).toBe('RisuTanium')
    })

    test('Android app_name and main_activity_title use the RisuTanium spelling with literal quotes', () => {
        const xml = readRepoFile(androidStringsPath)
        expect(xml).toContain('<string name="app_name">"RisuTanium"</string>')
        expect(xml).toContain('<string name="main_activity_title">"RisuTanium"</string>')
    })
})

describe('app identity that must not change with the display name', () => {
    test('identifier, deep-link schemes and updater key are unchanged', () => {
        const conf = JSON.parse(readRepoFile(tauriConfPath))
        expect(conf.identifier).toBe('io.github.yor42.risutanium')
        expect(conf.plugins['deep-link'].desktop.schemes).toEqual(['risutaniumlocal', 'risuailocal'])
        // The fork's own minisign key (ID ED1D63FEDD9B600F). Updates signed by any other key,
        // upstream's included, fail verification in installed builds.
        expect(conf.plugins.updater.pubkey).toBe('dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEVEMUQ2M0ZFREQ5QjYwMEYKUldRUFlKdmQvbU1kN1ZGTStYa2J3OFY2T01KbUh3Smh5U0hLRW1LNGpuQlpqYXhlU3JTYmY5cmMK')
        // The fork's own release feed. Installed builds poll it for as long as they live, so it changes with the pubkey or not at all.
        expect(conf.plugins.updater.endpoints).toEqual(['https://github.com/yor42/RisuTanium/releases/latest/download/latest.json'])
    })

    test('release builds create updater artifacts; the keyless test build turns them off', () => {
        const conf = JSON.parse(readRepoFile(tauriConfPath))
        expect(conf.bundle.createUpdaterArtifacts).toBe(true)
        const override = JSON.parse(readRepoFile('src-tauri/tauri.test-build.conf.json'))
        expect(override).toEqual({ bundle: { createUpdaterArtifacts: false } })
    })
})
