import { MCPClientLike } from "./internalmcp";
import type { MCPTool, RPCToolCallContent } from "./mcplib";
import type { RunSubject } from "../chatOrigin";
import type { ToolLoopState } from "../request/toolLoop";
import { normalizeWorkspacePath } from "../utility/workspace/paths";
import { commitWorkspaceChange, hasWorkspace, listFiles, readText, statFile, type WorkspaceOp } from "../utility/workspace/workspaceModel.svelte";

/** At most this many UTF-8 bytes of file text come back from one `read_file` call. */
export const READ_FILE_MAX_BYTES = 64 * 1024;
/** At most this many matches come back from one `search_files` call, each cut to `SEARCH_LINE_MAX` characters. */
export const SEARCH_MATCH_MAX = 200;
export const SEARCH_LINE_MAX = 300;

const stringProp = (description: string) => ({ type: 'string', description });

/**
 * The tools of the workspace client. A Utility run that owns a workspace advertises exactly these with the URL
 * `internal:workspace`; the client itself lists none, so a role-play module that names the URL gets no tools.
 */
export const WORKSPACE_TOOLS: readonly MCPTool[] = [
    {
        name: 'list_files',
        description: 'List the files of the workspace, optionally only those under a directory.',
        inputSchema: { type: 'object', properties: { dir: stringProp('Directory to list, e.g. "notes". Omit for every file.') } },
    },
    {
        name: 'read_file',
        description: 'Read a text file of the workspace, by line range. At most 64 KiB of text come back per call; a skill\'s SKILL.md is read with this tool too.',
        inputSchema: {
            type: 'object',
            properties: {
                path: stringProp('Path of the file.'),
                offset: { type: 'integer', description: 'First line to return, starting at 1.' },
                limit: { type: 'integer', description: 'Number of lines to return.' },
            },
            required: ['path'],
        },
    },
    {
        name: 'search_files',
        description: 'Find lines containing a piece of text (plain substring, not a pattern) in the workspace files.',
        inputSchema: {
            type: 'object',
            properties: {
                query: stringProp('Text to look for.'),
                path_prefix: stringProp('Only search paths that start with this prefix.'),
                case_sensitive: { type: 'boolean', description: 'Match case. Default false.' },
            },
            required: ['query'],
        },
    },
    {
        name: 'write_file',
        description: 'Create a file or replace the whole text of an existing one.',
        inputSchema: { type: 'object', properties: { path: stringProp('Path of the file.'), text: stringProp('The new text of the file.') }, required: ['path', 'text'] },
    },
    {
        name: 'edit_file',
        description: 'Replace text in an existing file. old_text must match exactly once unless replace_all is true.',
        inputSchema: {
            type: 'object',
            properties: {
                path: stringProp('Path of the file.'),
                old_text: stringProp('The text to replace.'),
                new_text: stringProp('The replacement text.'),
                replace_all: { type: 'boolean', description: 'Replace every match. Default false.' },
            },
            required: ['path', 'old_text', 'new_text'],
        },
    },
    {
        name: 'delete_file',
        description: 'Delete a file. This cannot be undone.',
        inputSchema: { type: 'object', properties: { path: stringProp('Path of the file.') }, required: ['path'] },
    },
    {
        name: 'move_file',
        description: 'Move or rename a file. It keeps its text. An existing destination is replaced only when overwrite is true.',
        inputSchema: {
            type: 'object',
            properties: {
                from: stringProp('Current path.'),
                to: stringProp('New path.'),
                overwrite: { type: 'boolean', description: 'Replace an existing destination. Default false.' },
            },
            required: ['from', 'to'],
        },
    },
];

type ToolResult = Record<string, unknown>;

function argString(args: unknown, key: string): string | undefined {
    const value = args && typeof args === 'object' ? (args as Record<string, unknown>)[key] : undefined;
    return typeof value === 'string' ? value : undefined;
}

function argInteger(args: unknown, key: string): number | undefined {
    const value = args && typeof args === 'object' ? (args as Record<string, unknown>)[key] : undefined;
    return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

function argFlag(args: unknown, key: string): boolean {
    return args && typeof args === 'object' && (args as Record<string, unknown>)[key] === true;
}

function fail(error: string, code?: string): ToolResult {
    return code ? { error, code } : { error };
}

function pathArg(args: unknown, key: string): { path: string } | { error: ToolResult } {
    const raw = argString(args, key);
    if (raw === undefined) {
        return { error: fail(`"${key}" must be a string.`) };
    }
    const normalized = normalizeWorkspacePath(raw);
    if (normalized.ok === false) {
        return { error: fail(`The path "${raw}" is not allowed (${normalized.reason}).`, 'bad-path') };
    }
    return { path: normalized.path };
}

/** The text of a file, or the error to answer with. A damaged file never reads as empty. */
function textOfFile(workspaceId: string, path: string): { text: string } | { error: ToolResult } {
    const read = readText(workspaceId, path);
    if (read.state === 'ok') {
        return { text: read.text };
    }
    if (read.state === 'damaged') {
        return { error: fail(`"${path}" is damaged and its text could not be read. It can be replaced with write_file or deleted.`, 'damaged') };
    }
    return { error: fail(`"${path}" does not exist.`, 'not-found') };
}

function splitLines(text: string): string[] {
    if (text === '') {
        return [];
    }
    const lines = text.split('\n');
    if (text.endsWith('\n')) {
        lines.pop();
    }
    return lines;
}

const encoder = new TextEncoder();

function cutToBytes(text: string, maxBytes: number): string {
    let cut = text;
    while (cut.length > 0 && encoder.encode(cut).length > maxBytes) {
        cut = cut.slice(0, Math.max(0, Math.floor(cut.length * 0.9) - 1));
    }
    const last = cut.charCodeAt(cut.length - 1);
    return last >= 0xD800 && last <= 0xDBFF ? cut.slice(0, -1) : cut;
}

function listTool(workspaceId: string, args: unknown): ToolResult {
    const rawDir = argString(args, 'dir');
    let prefix = '';
    if (rawDir !== undefined && rawDir !== '' && rawDir !== '/' && rawDir !== '.') {
        const dir = normalizeWorkspacePath(rawDir.replace(/\/+$/, ''));
        if (dir.ok === false) {
            return fail(`The directory "${rawDir}" is not allowed (${dir.reason}).`, 'bad-path');
        }
        prefix = `${dir.path}/`;
    }
    const files = listFiles(workspaceId)
        .filter(file => file.path.startsWith(prefix))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
        .map(file => file.placeholder
            ? { path: file.path, size: file.size, mtime: file.mtime, damaged: true }
            : { path: file.path, size: file.size, mtime: file.mtime });
    return { files };
}

function readTool(workspaceId: string, args: unknown): ToolResult {
    const target = pathArg(args, 'path');
    if ('error' in target) {
        return target.error;
    }
    const content = textOfFile(workspaceId, target.path);
    if ('error' in content) {
        return content.error;
    }
    const lines = splitLines(content.text);
    const offset = argInteger(args, 'offset');
    const limit = argInteger(args, 'limit');
    if ((offset !== undefined && offset < 1) || (limit !== undefined && limit < 1)) {
        return fail('"offset" and "limit" must be at least 1.');
    }
    const startIndex = (offset ?? 1) - 1;
    const wanted = lines.slice(startIndex, limit === undefined ? undefined : startIndex + limit);
    const kept: string[] = [];
    let bytes = 0;
    let cutLine = false;
    for (const line of wanted) {
        const lineBytes = encoder.encode(line).length + (kept.length > 0 ? 1 : 0);
        if (bytes + lineBytes > READ_FILE_MAX_BYTES) {
            if (kept.length === 0) {
                kept.push(cutToBytes(line, READ_FILE_MAX_BYTES));
                cutLine = true;
            }
            break;
        }
        kept.push(line);
        bytes += lineBytes;
    }
    const endLine = kept.length === 0 ? 0 : startIndex + kept.length;
    return {
        path: target.path,
        size: statFile(workspaceId, target.path)?.size ?? 0,
        totalLines: lines.length,
        startLine: kept.length === 0 ? 0 : startIndex + 1,
        endLine,
        text: kept.join('\n'),
        truncated: cutLine || (kept.length > 0 && endLine < Math.min(lines.length, limit === undefined ? lines.length : startIndex + limit)),
    };
}

function searchTool(workspaceId: string, args: unknown): ToolResult {
    const query = argString(args, 'query');
    if (query === undefined || query === '') {
        return fail('"query" must be a non-empty string.');
    }
    const caseSensitive = argFlag(args, 'case_sensitive');
    const prefix = argString(args, 'path_prefix') ?? '';
    const needle = caseSensitive ? query : query.toLowerCase();
    const matches: { path: string, line: number, text: string }[] = [];
    const damaged: string[] = [];
    let truncated = false;
    const files = listFiles(workspaceId)
        .filter(file => file.path.startsWith(prefix))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    scan: for (const file of files) {
        const read = readText(workspaceId, file.path);
        if (read.state !== 'ok') {
            damaged.push(file.path);
            continue;
        }
        const lines = splitLines(read.text);
        for (let index = 0; index < lines.length; index++) {
            const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
            if (!haystack.includes(needle)) {
                continue;
            }
            if (matches.length >= SEARCH_MATCH_MAX) {
                truncated = true;
                break scan;
            }
            matches.push({ path: file.path, line: index + 1, text: lines[index].slice(0, SEARCH_LINE_MAX) });
        }
    }
    return damaged.length > 0 ? { matches, truncated, damaged } : { matches, truncated };
}

function commit(workspaceId: string, ops: WorkspaceOp[]): ToolResult | undefined {
    const result = commitWorkspaceChange(workspaceId, ops);
    return result.ok === true ? undefined : fail(result.error.detail, result.error.code);
}

function writeTool(workspaceId: string, args: unknown): ToolResult {
    const target = pathArg(args, 'path');
    if ('error' in target) {
        return target.error;
    }
    const text = argString(args, 'text');
    if (text === undefined) {
        return fail('"text" must be a string.');
    }
    const created = statFile(workspaceId, target.path) === undefined;
    const failure = commit(workspaceId, [{ kind: 'write', path: target.path, text }]);
    if (failure) {
        return failure;
    }
    return { path: target.path, size: statFile(workspaceId, target.path)?.size ?? 0, created };
}

function editTool(workspaceId: string, args: unknown): ToolResult {
    const target = pathArg(args, 'path');
    if ('error' in target) {
        return target.error;
    }
    const oldText = argString(args, 'old_text');
    const newText = argString(args, 'new_text');
    if (oldText === undefined || oldText === '' || newText === undefined) {
        return fail('"old_text" must be a non-empty string and "new_text" a string.');
    }
    const content = textOfFile(workspaceId, target.path);
    if ('error' in content) {
        return content.error;
    }
    const pieces = content.text.split(oldText);
    const replacements = pieces.length - 1;
    if (replacements === 0) {
        return fail(`"old_text" was not found in "${target.path}".`, 'no-match');
    }
    if (replacements > 1 && !argFlag(args, 'replace_all')) {
        return fail(`"old_text" matches ${replacements} times in "${target.path}"; make it unique or set replace_all.`, 'ambiguous-match');
    }
    const failure = commit(workspaceId, [{ kind: 'write', path: target.path, text: pieces.join(newText) }]);
    if (failure) {
        return failure;
    }
    return { path: target.path, size: statFile(workspaceId, target.path)?.size ?? 0, replacements };
}

function deleteTool(workspaceId: string, args: unknown): ToolResult {
    const target = pathArg(args, 'path');
    if ('error' in target) {
        return target.error;
    }
    return commit(workspaceId, [{ kind: 'delete', path: target.path }]) ?? { path: target.path, deleted: true };
}

function moveTool(workspaceId: string, args: unknown): ToolResult {
    const from = pathArg(args, 'from');
    if ('error' in from) {
        return from.error;
    }
    const to = pathArg(args, 'to');
    if ('error' in to) {
        return to.error;
    }
    const ops: WorkspaceOp[] = [];
    if (argFlag(args, 'overwrite') && from.path !== to.path && statFile(workspaceId, to.path) !== undefined) {
        ops.push({ kind: 'delete', path: to.path });
    }
    ops.push({ kind: 'move', from: from.path, to: to.path });
    return commit(workspaceId, ops) ?? { from: from.path, to: to.path };
}

const HANDLERS: Readonly<Record<string, (workspaceId: string, args: unknown) => ToolResult>> = {
    list_files: listTool,
    read_file: readTool,
    search_files: searchTool,
    write_file: writeTool,
    edit_file: editTool,
    delete_file: deleteTool,
    move_file: moveTool,
};

function asContent(result: ToolResult): RPCToolCallContent[] {
    return [{ type: 'text', text: JSON.stringify(result) }];
}

/**
 * The tools a Utility run uses on its own workspace. The workspace is the one the run is bound to
 * (`toolLoop.workspace`), never one named in the arguments, and every access goes through the workspace model.
 * Failures are answered as `{error}` results so the model can react; nothing here throws.
 */
export class WorkspaceClient extends MCPClientLike {
    constructor() {
        super("internal:workspace");
        this.serverInfo.serverInfo.name = "Workspace";
        this.serverInfo.serverInfo.version = "1.0.0";
        this.serverInfo.instructions = "Read and edit the text files of the workspace this conversation is bound to.";
    }

    // The run advertises `WORKSPACE_TOOLS` itself; a module that merely names this URL must not gain tools.
    async getToolList(): Promise<MCPTool[]> {
        return [];
    }

    async callTool(toolName: string, args: any, ctx?: { subject?: RunSubject, toolLoop?: ToolLoopState }): Promise<RPCToolCallContent[]> {
        const workspaceId = ctx?.toolLoop?.workspace?.id;
        if (!workspaceId) {
            return asContent(fail('No workspace is bound to this run.'));
        }
        if (!hasWorkspace(workspaceId)) {
            return asContent(fail('The workspace no longer exists.'));
        }
        const handler = Object.hasOwn(HANDLERS, toolName) ? HANDLERS[toolName] : undefined;
        if (!handler) {
            return asContent(fail(`Unknown workspace tool: ${toolName}`));
        }
        try {
            return asContent(handler(workspaceId, args));
        } catch (error) {
            return asContent(fail(`${toolName} failed: ${error instanceof Error ? error.message : String(error)}`));
        }
    }
}
