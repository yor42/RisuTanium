// Test-only text reading of the two modules that name every component the setting renderer can mount (settingRegistry.ts and
// customComponents.ts). The settings part census roots its component closure at these records, so a component that enters one in a
// form this reader does not recognise must fail closed. Loading the modules instead would load the app; settingsRegistryRoots.svelte.test.ts
// does that under the mounted-screen mocks and checks the loaded record against what is read here.
import { readFileSync } from 'node:fs'

export interface RegistryForms {
    /** The local names of the module's default `.svelte` imports. */
    readonly imported: ReadonlySet<string>
    /** The identifier each recognised entry maps to, in order. */
    readonly values: readonly string[]
    /** The lines of the record literal that are neither a `key: Identifier` entry nor a comment: a spread, a shorthand, a computed key, a call. */
    readonly unrecognised: readonly string[]
}

/** The record literal of `export const <name>`, read by name, not by position in the file. Throws when the module has no such export. */
export function registryForms(file: string, name: string): RegistryForms {
    const text = readFileSync(file, 'utf8')
    const imported = new Set([...text.matchAll(/^import\s+(\w+)\s+from\s+['"][^'"]+\.svelte['"]/gm)].map((m) => m[1]))
    const at = text.indexOf(`export const ${name}`)
    if (at < 0) throw new Error(`${file} has no export const ${name}`)
    const literal = text.slice(text.indexOf('= {', at))
    const body = literal.slice(literal.indexOf('{') + 1, literal.indexOf('\n}'))
    const values: string[] = []
    const unrecognised: string[] = []
    for (const line of body.split('\n')) {
        if (line.trim() === '' || /^\s*\/\//.test(line)) continue
        const entry = /^\s+['"]?[\w-]+['"]?\s*:\s*(\w+),?\s*(?:\/\/.*)?$/.exec(line)
        if (entry) values.push(entry[1])
        else unrecognised.push(line.trim())
    }
    return { imported, values, unrecognised }
}

/** A write to either registry object outside its literal: an indexed or property assignment, `Object.assign` and its relatives, or `delete`. */
export const REGISTRY_WRITE = /\b(?:customComponents|settingRegistry)\s*(?:\[[^\]]*\]|\.\w+)\s*(?:=(?!=)|\+=|\|\|=|\?\?=)|Object\.(?:assign|defineProperty|defineProperties|setPrototypeOf)\(\s*(?:customComponents|settingRegistry)\b|\bdelete\s+(?:customComponents|settingRegistry)\b/
