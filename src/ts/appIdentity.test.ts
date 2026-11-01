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
        expect(conf.plugins.updater.pubkey).toBe('dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDU2ODMzOTIxMDMxOTY1MUYKUldRZlpSa0RJVG1EVmx5Vm1WYlhFM29HMEJrUTRrYmg5dDQ0RFpvdUphNDdxQmVlWXJHVmV5TEYK')
        expect(conf.plugins.updater.endpoints).toEqual([])
    })
})
