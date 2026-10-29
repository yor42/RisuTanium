/**
 * The parsed form of a `stdio:` MCP URL, the hash an approval is keyed by, and the consent prompt text.
 *
 * Invariants pinned here: the hash follows what runs (command, argument order, environment), not the JSON text;
 * anything that cannot be started by the shell plugin parses as invalid; the prompt shows every part as an
 * escaped literal, so a crafted value cannot add, hide or reorder lines.
 */
import { describe, expect, test } from 'vitest'
import { formatStdioConsent, parseMcpUrl, stdioSpecHash, type StdioSpec } from '../stdioSpec'

/** Built from code points so the source holds no invisible character. */
const RLO = String.fromCharCode(0x202e)
const ZWSP = String.fromCharCode(0x200b)
const BOM = String.fromCharCode(0xfeff)

const spawnOf = (url: string): StdioSpec => {
    const parsed = parseMcpUrl(url)
    if (parsed.kind !== 'stdio-spawn') {
        throw new Error(`expected a spawn, got ${parsed.kind}`)
    }
    return parsed.spec
}

const hashOf = async (url: string) => await stdioSpecHash(spawnOf(url))

describe('parseMcpUrl', () => {
    test('a url key wins over a command', () => {
        expect(parseMcpUrl('stdio:{"url":"https://u.test/mcp","command":"npx","args":[]}')).toEqual({ kind: 'stdio-url', url: 'https://u.test/mcp' })
    })

    test('a command with args names a program; a single arg string is one argument; env defaults to empty', () => {
        expect(spawnOf('stdio:{"command":"npx","args":"x"}')).toEqual({ command: 'npx', args: ['x'], env: {} })
    })

    test.each([
        ['not json', 'stdio:{nope'],
        ['no command', 'stdio:{"args":["a"]}'],
        ['no args', 'stdio:{"command":"npx"}'],
        ['a non-string command', 'stdio:{"command":5,"args":["a"]}'],
        ['a non-string argument', 'stdio:{"command":"npx","args":["a",1]}'],
        ['a non-string env value', 'stdio:{"command":"npx","args":["a"],"env":{"K":1}}'],
        ['an env that is not an object', 'stdio:{"command":"npx","args":["a"],"env":5}'],
    ])('%s is invalid and never a spawn', (_label, url) => {
        expect(parseMcpUrl(url).kind).toBe('stdio-invalid')
    })

    test('a URL that is not stdio is other', () => {
        expect(parseMcpUrl('https://x.test/mcp').kind).toBe('other')
        expect(parseMcpUrl('internal:dice').kind).toBe('other')
    })
})

describe('stdioSpecHash', () => {
    const base = 'stdio:{"command":"npx","args":["-y","@x/server"],"env":{"A":"1","B":"2"}}'

    test('JSON whitespace and key order do not change it; a single arg string equals a one-element array', async () => {
        const reordered = 'stdio:{ "env": {"B":"2",  "A":"1"}, "args": ["-y", "@x/server"], "command": "npx" }'
        expect(await hashOf(reordered)).toBe(await hashOf(base))
        expect(await hashOf('stdio:{"command":"npx","args":"x"}')).toBe(await hashOf('stdio:{"command":"npx","args":["x"]}'))
    })

    test.each([
        ['argument order', 'stdio:{"command":"npx","args":["@x/server","-y"],"env":{"A":"1","B":"2"}}'],
        ['an extra argument', 'stdio:{"command":"npx","args":["-y","@x/server","--more"],"env":{"A":"1","B":"2"}}'],
        ['an env value', 'stdio:{"command":"npx","args":["-y","@x/server"],"env":{"A":"1","B":"3"}}'],
        ['a removed env entry', 'stdio:{"command":"npx","args":["-y","@x/server"],"env":{"A":"1"}}'],
        ['the command', 'stdio:{"command":"node","args":["-y","@x/server"],"env":{"A":"1","B":"2"}}'],
    ])('%s changes it', async (_label, changed) => {
        expect(await hashOf(changed)).not.toBe(await hashOf(base))
    })
})

describe('formatStdioConsent', () => {
    test('every argument is on its own quoted line and hidden characters are escaped', () => {
        const text = formatStdioConsent('Mod', {
            command: 'node',
            args: ['a\nb', 'x' + RLO + 'y', 'z' + ZWSP + 'w', BOM + 'q', 'say "hi"'],
            env: { K: 'v' },
        })
        const lines = text.split('\n')
        expect(lines).toContain('Command: "node"')
        expect(lines).toContain('Argument 1: "a\\u000ab"')
        expect(lines).toContain('Argument 2: "x\\u202ey"')
        expect(lines).toContain('Argument 3: "z\\u200bw"')
        expect(lines).toContain('Argument 4: "\\ufeffq"')
        expect(lines).toContain('Argument 5: "say \\"hi\\""')
        expect(lines).toContain('Environment "K": "v"')
        for (const hidden of [RLO, ZWSP, BOM]) {
            expect(text).not.toContain(hidden)
        }
    })

    test('a module name with a newline and a bidi mark stays on the title line, quoted and escaped', () => {
        const text = formatStdioConsent('A\nCommand: "node"' + RLO, { command: 'npx', args: ['x'], env: {} })
        const lines = text.split('\n')
        expect(lines[0]).toContain('"A\\u000aCommand: \\"node\\"\\u202e"')
        expect(lines.filter((line) => line.startsWith('Command:'))).toEqual(['Command: "npx"'])
        expect(text).not.toContain(RLO)
    })
})
