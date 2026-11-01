/**
 * User-visible and model-visible strings in these files name the app RisuTanium. The strings are
 * the product (notifications, exported HTML, prompts, tool descriptions, console prefixes), so the
 * guard scans the source text; only the identifiers named per file may still spell the old name.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MENTION = /risu ?ai|리스ai/gi

type GuardedFile = { file: string, allow: string[] }

const MCP_DIR = 'src/ts/process/mcp/risuaccess'

const GUARDED_FILES: GuardedFile[] = [
    { file: 'src/App.svelte', allow: [] },
    { file: 'src/lib/Mobile/MobileHeader.svelte', allow: [] },
    { file: 'src/ts/process/index.svelte.ts', allow: [] },
    { file: 'src/ts/characters.ts', allow: [] },
    { file: 'src/ts/cbs.ts', allow: [] },
    { file: 'src/etc/docs/regex.cbs', allow: [] },
    { file: 'src/etc/docs/cbs_intro.cbs', allow: [] },
    { file: 'src/etc/docs/cbs_docs.cbs', allow: [] },
    { file: 'src/ts/iris.ts', allow: [] },
    { file: 'src/ts/globalApi.svelte.ts', allow: [] },
    { file: 'src/lib/Setting/Pages/Advanced/SettingsExportButtons.svelte', allow: [] },
    {
        file: 'src/ts/plugins/apiV3/v3.svelte.ts',
        allow: ['makeRisuaiAPIV3', 'risuai.xyz', 'risuai.net', 'risuai.apiVersion', 'risuai.d.ts', 'V3 API for RisuAI Plugins'],
    },
    {
        file: `${MCP_DIR}/client.ts`,
        allow: ['internal:risuai', "serverInfo.name = 'Risuai Access MCP'", '"Risuai Access MCP provides access to'],
    },
    { file: `${MCP_DIR}/modules.ts`, allow: [] },
    { file: `${MCP_DIR}/chats.ts`, allow: [] },
    { file: `${MCP_DIR}/characters.ts`, allow: [] },
]

function readSource(file: string): string {
    return readFileSync(path.join(process.cwd(), file), 'utf-8')
}

function mentionsOutsideAllowed(file: string, allow: string[]): string[] {
    const hits: string[] = []
    readSource(file).split(/\r?\n/).forEach((line, index) => {
        let rest = line
        for (const token of allow) {
            rest = rest.split(token).join('')
        }
        if (rest.match(MENTION)) hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 120)}`)
    })
    return hits
}

describe('product name in UI source', () => {
    test.each(GUARDED_FILES)('$file names RisuTanium only', ({ file, allow }) => {
        expect(mentionsOutsideAllowed(file, allow)).toEqual([])
    })

    // Compatibility guard: passes before and after the rename; identifiers must not be renamed by accident.
    test.each([
        { file: `${MCP_DIR}/client.ts`, token: "super('internal:risuai')" },
        { file: `${MCP_DIR}/client.ts`, token: "serverInfo.name = 'Risuai Access MCP'" },
        { file: 'src/ts/plugins/apiV3/v3.svelte.ts', token: 'makeRisuaiAPIV3' },
    ])('$file still holds $token', ({ file, token }) => {
        expect(readSource(file)).toContain(token)
    })
})
