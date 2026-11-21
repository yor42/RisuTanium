import type { RPCToolCallContent } from './mcplib'
import type { RunSubject } from '../chatOrigin'
import { advertisedToolKey, refusedToolContent, type ToolLoopState } from '../request/toolLoop'
import { classifyTool } from './toolPermission'
import { askToolApproval, TOOL_SUMMARY_LIMIT } from './toolApproval'
import { DBState } from 'src/ts/stores.svelte'

/** What an authorization needs to know about the call. */
export type ToolCallInfo = {
    subject?: RunSubject
    mcpURL?: string
    toolLoop?: ToolLoopState
}

function refused(text: string): RPCToolCallContent[] {
    return [{ type: 'text', text }]
}

/**
 * A plain-text rendering of a call for the prompt, cut to `TOOL_SUMMARY_LIMIT` characters. It only reads the
 * arguments and never throws, so describing a call cannot change anything. `action` leads the text when given.
 */
export function describeToolCall(name: string, args: unknown, action?: string): string {
    let rendered: string
    try {
        rendered = JSON.stringify(args) ?? ''
    } catch {
        rendered = String(args)
    }
    const text = `${action ? `${action}: ` : ''}${name}(${rendered})`
    return text.length > TOOL_SUMMARY_LIMIT ? `${text.slice(0, TOOL_SUMMARY_LIMIT)}...` : text
}

function argText(args: unknown, key: string): string {
    const value = args && typeof args === 'object' ? (args as Record<string, unknown>)[key] : undefined
    return typeof value === 'string' ? value : ''
}

/** What each mutating `internal:risuai` tool does, with `{target}` for the character or module and `{item}` for the named part. */
const RISUACCESS_ACTIONS: Readonly<Record<string, { kind: 'character' | 'module', action: string, item?: string }>> = {
    'risu-set-character-info': { kind: 'character', action: 'modify character ({target}) information' },
    'risu-set-character-lorebook': { kind: 'character', action: 'add/modify character ({target}) global lorebook ({item})', item: 'name' },
    'risu-delete-character-lorebook': { kind: 'character', action: 'delete character ({target}) global lorebook ({item})', item: 'name' },
    'risu-set-character-regex-scripts': { kind: 'character', action: 'add/modify character ({target}) regex script ({item})', item: 'name' },
    'risu-delete-character-regex-scripts': { kind: 'character', action: 'delete character ({target}) regex script ({item})', item: 'name' },
    'risu-delete-character-additional-assets': { kind: 'character', action: 'delete character ({target}) additional asset ({item})', item: 'assetName' },
    'risu-set-character-lua-script': { kind: 'character', action: 'modify character ({target}) lua script' },
    'risu-set-module-info': { kind: 'module', action: 'modify module ({target}) information' },
    'risu-set-module-lorebook': { kind: 'module', action: 'add/modify module ({target}) lorebook ({item})', item: 'name' },
    'risu-delete-module-lorebook': { kind: 'module', action: 'delete module ({target}) lorebook ({item})', item: 'name' },
    'risu-set-module-regex-script': { kind: 'module', action: 'add/modify module ({target}) regex script ({item})', item: 'name' },
    'risu-delete-module-regex-script': { kind: 'module', action: 'delete module ({target}) regex script ({item})', item: 'name' },
    'risu-set-module-lua-script': { kind: 'module', action: 'modify module ({target}) lua script' },
}

/**
 * The action line of a mutating `internal:risuai` call naming the character or module it targets, found by a
 * read-only lookup in the loaded lists: nothing is loaded, restored or marked, so a placeholder is named by its
 * own name. Undefined for any other tool.
 */
export function describeRisuaccessAction(name: string, args: unknown, subject?: RunSubject): string | undefined {
    const entry = RISUACCESS_ACTIONS[name]
    if(!entry) {
        return undefined
    }
    const id = argText(args, 'id')
    let target = id
    try {
        if(entry.kind === 'module') {
            target = DBState.db?.modules?.find(m => m.id === id)?.name ?? id
        } else if(id) {
            target = DBState.db?.characters?.find(c => c.chaId === id || c.name === id)?.name ?? id
        } else {
            target = subject?.resolve()?.owner?.name ?? 'the current character'
        }
    } catch {
        target = id
    }
    return entry.action
        .replace('{target}', () => target)
        .replace('{item}', () => argText(args, entry.item ?? ''))
}

/**
 * Decides one model-driven tool call before any client is looked up or started. A call with no server, outside
 * the run's advertised set, or to a workspace tool without a bound workspace is refused. `read` and `free`
 * tools go through; `mutating` and `third-party` tools need the user's answer, and a run that was stopped
 * before or during the question runs nothing. Returns the content to answer the model with when the call must
 * not run, or null when it may.
 */
export async function authorizeToolCall(name: string, args: unknown, info: ToolCallInfo): Promise<RPCToolCallContent[] | null> {
    const url = info.mcpURL
    if(!url) {
        return refused(`Tool ${name} was called without a server and was not run.`)
    }
    const advertised = info.toolLoop?.advertised
    if(advertised && !advertised.has(advertisedToolKey(name, url))) {
        return refusedToolContent(name)
    }
    if(url === 'internal:workspace' && !info.toolLoop?.workspace) {
        return refusedToolContent(name)
    }
    const kind = classifyTool(url, name)
    if(kind === 'read' || kind === 'free') {
        return null
    }
    const signal = info.toolLoop?.signal ?? null
    const stopped = () => signal?.aborted === true
    if(stopped()) {
        return refused(`Stopped before ${name} ran.`)
    }
    const decision = await askToolApproval({
        tool: name,
        url,
        kind,
        summary: describeToolCall(name, args, url === 'internal:risuai' ? describeRisuaccessAction(name, args, info.subject) : undefined),
    }, { signal })
    if(stopped()) {
        return refused(`Stopped before ${name} ran.`)
    }
    if(decision === 'deny') {
        return refused(`Denied by the user: ${name}`)
    }
    return null
}
