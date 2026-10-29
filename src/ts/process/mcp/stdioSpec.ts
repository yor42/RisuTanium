import { sha256Hex } from "src/ts/assetHash";
import { language } from "src/lang";

export type StdioSpec = {
    command: string;
    args: string[];
    env: Record<string, string>;
};

export type ParsedMcpUrl =
    | { kind: 'stdio-spawn', spec: StdioSpec }
    | { kind: 'stdio-url', url: string }
    | { kind: 'stdio-invalid', reason: string }
    | { kind: 'other' };

/**
 * Reads an MCP URL the way the spawn site does, so that the consent gate and the spawn cannot read one URL
 * differently: a `url` key wins; otherwise a truthy `command` and `args` name a program. A command, argument or
 * environment value that is not a string never runs.
 */
export function parseMcpUrl(mcp: string): ParsedMcpUrl {
    if (!mcp.startsWith('stdio:')) {
        return { kind: 'other' };
    }
    let data: unknown;
    try {
        data = JSON.parse(mcp.slice('stdio:'.length));
    } catch (error) {
        return { kind: 'stdio-invalid', reason: String(error) };
    }
    if (typeof data !== 'object' || data === null) {
        return { kind: 'stdio-invalid', reason: 'MCP JSON does not contain a valid URL' };
    }
    const record = data as Record<string, unknown>;
    if (record.url) {
        return { kind: 'stdio-url', url: record.url as string };
    }
    if (!record.command || !record.args) {
        return { kind: 'stdio-invalid', reason: 'MCP JSON does not contain a valid URL' };
    }
    if (typeof record.command !== 'string') {
        return { kind: 'stdio-invalid', reason: 'MCP command must be a string' };
    }
    const args: unknown[] = Array.isArray(record.args) ? record.args : [record.args];
    if (!args.every((arg): arg is string => typeof arg === 'string')) {
        return { kind: 'stdio-invalid', reason: 'MCP arguments must be strings' };
    }
    const env: Record<string, string> = {};
    const rawEnv = record.env || {};
    if (typeof rawEnv !== 'object') {
        return { kind: 'stdio-invalid', reason: 'MCP env must be an object' };
    }
    for (const [key, value] of Object.entries(rawEnv)) {
        if (typeof value !== 'string') {
            return { kind: 'stdio-invalid', reason: 'MCP env values must be strings' };
        }
        env[key] = value;
    }
    return { kind: 'stdio-spawn', spec: { command: record.command, args: args as string[], env } };
}

/** SHA-256 hex of the parsed spec: JSON whitespace and key order do not change it, any change of what runs does. */
export async function stdioSpecHash(spec: StdioSpec): Promise<string> {
    const entries = Object.entries(spec.env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const text = JSON.stringify(['risu-mcp-stdio/1', spec.command, spec.args, entries]);
    return await sha256Hex(new TextEncoder().encode(text));
}

function isHiddenCode(code: number): boolean {
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x2028 && code <= 0x202e)
        || code === 0x2060 || (code >= 0x2066 && code <= 0x2069) || code === 0xfeff
}

/** A quoted literal in which quotes, backslashes, controls, bidi and zero-width characters are written as escapes. */
export function quoteForConsent(text: string): string {
    let out = '"';
    for (const ch of text) {
        if (ch === '"' || ch === '\\') {
            out += '\\' + ch;
        }
        else if (isHiddenCode(ch.charCodeAt(0))) {
            out += '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0');
        }
        else {
            out += ch;
        }
    }
    return out + '"';
}

/** The consent prompt: the module name, the program, every argument and every environment entry, one per line. */
export function formatStdioConsent(moduleName: string, spec: StdioSpec): string {
    const lines = [
        language.alerts.mcpStdioConsent(quoteForConsent(moduleName)),
        '',
        language.alerts.mcpStdioConsentCommand(quoteForConsent(spec.command)),
    ];
    spec.args.forEach((arg, i) => {
        lines.push(language.alerts.mcpStdioConsentArgument(i + 1, quoteForConsent(arg)));
    });
    for (const [key, value] of Object.entries(spec.env)) {
        lines.push(language.alerts.mcpStdioConsentEnvironment(quoteForConsent(key), quoteForConsent(value)));
    }
    lines.push('', language.alerts.mcpStdioConsentQuestion);
    return lines.join('\n');
}
