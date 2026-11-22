import { language } from 'src/lang'
import type { RPCToolCallContent } from './mcplib'
import type { RunSubject } from '../chatOrigin'
import { advertisedToolKey, refusedToolContent, reportToolStep, type ToolLoopState, type ToolStepOutcome } from '../request/toolLoop'
import { escapeBidiControls } from './bidiEscape'
import { classifyTool } from './toolPermission'
import { askToolApproval, TOOL_SUMMARY_LIMIT, type ToolApprovalRequest } from './toolApproval'
import { addToolGrant, hasToolGrant, toolGrantsOffered } from './toolGrants'
import { addServerChatGrant, chatKeyOf, hasServerChatGrant, isVisibleChat } from './serverChatGrants.svelte'
import type { ToolApprovalActionPart } from 'src/ts/alert'
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
 * A plain-text rendering of a call for the prompt, cut to `TOOL_SUMMARY_LIMIT` characters (code points, so a
 * surrogate pair is never split). It only reads the arguments and never throws, so describing a call cannot change
 * anything. `action` leads the text when given.
 */
export function describeToolCall(name: string, args: unknown, action?: string): string {
    let rendered: string
    try {
        rendered = JSON.stringify(args) ?? ''
    } catch {
        rendered = String(args)
    }
    const text = escapeBidiControls(`${action ? `${action}: ` : ''}${name}(${rendered})`)
    return clipCodePoints(text, TOOL_SUMMARY_LIMIT)
}

export { escapeBidiControls }

/** `text` cut to `max` code points with a trailing mark; shorter text is returned as it is. */
function clipCodePoints(text: string, max: number): string {
    if(text.length <= max) {
        return text
    }
    const points = Array.from(text)
    return points.length > max ? `${points.slice(0, max).join('')}...` : text
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

function actionOf(name: string, args: unknown, url: string, subject?: RunSubject): string | undefined {
    if(url === 'internal:risuai') {
        return describeRisuaccessAction(name, args, subject)
    }
    return url === 'internal:workspace' ? describeWorkspaceAction(name, args) : undefined
}

/** The language template of each mutating `internal:workspace` tool, with `{path}` the file it names (`from` and `to` for a move). */
function workspaceActionTemplate(name: string, overwrite: boolean): string | undefined {
    switch(name) {
        case 'write_file': return language.toolApprovalActionWriteFile
        case 'edit_file': return language.toolApprovalActionEditFile
        case 'delete_file': return language.toolApprovalActionDeleteFile
        // A move that replaces its destination leads with the file that will be deleted, before the source path.
        case 'move_file': return overwrite ? language.toolApprovalActionMoveOverwrite : language.toolApprovalActionMoveFile
        default: return undefined
    }
}

/** The longest path an action line shows whole; a longer one keeps its start and end so the file name stays visible. */
const ACTION_PATH_MAX_CHARS = 200

function clipPath(path: string): string {
    if(path.length <= ACTION_PATH_MAX_CHARS) {
        return path
    }
    const points = Array.from(path)
    if(points.length <= ACTION_PATH_MAX_CHARS) {
        return path
    }
    const keep = Math.floor((ACTION_PATH_MAX_CHARS - 3) / 2)
    return `${points.slice(0, keep).join('')}...${points.slice(points.length - keep).join('')}`
}

/**
 * The action line of a mutating `internal:workspace` call naming the file it targets, taken from the arguments
 * alone so it leads the prompt even when a long text argument pushes the path past the summary limit. Undefined
 * for any other tool.
 */
export function describeWorkspaceAction(name: string, args: unknown): string | undefined {
    return workspaceActionParts(name, args)?.map(part => part.text).join('')
}

/** Whether a `move_file` call replaces its destination: it deletes a file, so a grant never covers it (MC-3614). */
function isOverwriteMove(name: string, args: unknown): boolean {
    return name === 'move_file' && !!args && typeof args === 'object' && (args as Record<string, unknown>).overwrite === true
}

/** The action line of `describeWorkspaceAction` in pieces, each path its own piece so the dialog can isolate it. */
export function workspaceActionParts(name: string, args: unknown): ToolApprovalActionPart[] | undefined {
    const template = workspaceActionTemplate(name, isOverwriteMove(name, args))
    if(!template) {
        return undefined
    }
    const parts: ToolApprovalActionPart[] = []
    let last = 0
    for(const match of template.matchAll(/\{(path|from|to)\}/g)) {
        if(match.index > last) {
            parts.push({ text: template.slice(last, match.index) })
        }
        parts.push({ text: clipPath(argText(args, match[1])), path: true })
        last = match.index + match[0].length
    }
    if(last < template.length) {
        parts.push({ text: template.slice(last) })
    }
    return parts
}

const INSTRUCTION_FILE_NAMES = new Set(['agents.md', 'skill.md'])

/** The paths a workspace call names, by tool. */
function workspacePathArgs(name: string, args: unknown): string[] {
    const keys = name === 'move_file' ? ['from', 'to'] : ['path']
    return keys.map(key => argText(args, key))
}

/** Whether a workspace call writes, deletes or moves AGENTS.md or SKILL.md, whose text steers later runs. */
function touchesInstructionFile(name: string, args: unknown): boolean {
    return workspacePathArgs(name, args).some(path => {
        const leaf = path.trim().split(/[\\/]/).pop() ?? ''
        return INSTRUCTION_FILE_NAMES.has(leaf.toLowerCase())
    })
}

/**
 * Decides one model-driven tool call before any client is looked up or started. A call with no server, outside
 * the run's advertised set, or to a workspace tool without a bound workspace is refused. `read` and `free`
 * tools go through; `mutating` and `third-party` tools need the user's answer, and a run that was stopped
 * before or during the question runs nothing. In a bound workspace a saved "always" grant for the tool skips the
 * question, except for a move that overwrites, which always asks; an "always" answer saves a grant only there.
 * Returns the content to answer the model with when the call must
 * not run, or null when it may.
 */
export async function authorizeToolCall(name: string, args: unknown, info: ToolCallInfo): Promise<RPCToolCallContent[] | null> {
    let decision: ToolDecision
    try {
        decision = await decideToolCall(name, args, info)
    } catch (error) {
        reportToolStep(info.toolLoop, name, args, 'error')
        throw error
    }
    // A call that may run is reported by `callMCPTool` after it ends, so it is the one step of that call.
    if(decision.content) {
        reportToolStep(info.toolLoop, name, args, decision.outcome)
    }
    return decision.content
}

/** The answer for the model (null when the call may run) and how the call ended for the run's step list. */
type ToolDecision = { content: RPCToolCallContent[] | null, outcome: ToolStepOutcome }

const GO: ToolDecision = { content: null, outcome: 'ran' }

function stoppedBefore(name: string): ToolDecision {
    return { content: refused(`Stopped before ${name} ran.`), outcome: 'stopped' }
}

async function decideToolCall(name: string, args: unknown, info: ToolCallInfo): Promise<ToolDecision> {
    const url = info.mcpURL
    if(!url) {
        return { content: refused(`Tool ${name} was called without a server and was not run.`), outcome: 'refused' }
    }
    const advertised = info.toolLoop?.advertised
    if(advertised && !advertised.has(advertisedToolKey(name, url))) {
        return { content: refusedToolContent(name), outcome: 'refused' }
    }
    if(url === 'internal:workspace' && !info.toolLoop?.workspace) {
        return { content: refusedToolContent(name), outcome: 'refused' }
    }
    const kind = classifyTool(url, name)
    if(kind === 'read' || kind === 'free') {
        return GO
    }
    const signal = info.toolLoop?.signal ?? null
    const stopped = () => signal?.aborted === true
    if(stopped()) {
        return stoppedBefore(name)
    }
    const workspaceId = url === 'internal:workspace' ? info.toolLoop?.workspace?.id : undefined
    // A grant covers one tool in the bound workspace, never a move that overwrites (MC-3409, MC-3614).
    const grantable = workspaceId !== undefined && kind === 'mutating' && !isOverwriteMove(name, args)
    if(grantable && await hasToolGrant(workspaceId, name)) {
        return stopped() ? stoppedBefore(name) : GO
    }
    // A server grant covers a third-party server for the chat on screen only; internal tools never get one (MC-3413).
    const serverKey = kind === 'third-party' && !url.startsWith('internal:') ? chatKeyOf(info.subject) : null
    if(serverKey !== null && hasServerChatGrant(serverKey, url)) {
        return stopped() ? stoppedBefore(name) : GO
    }
    const offerServer = serverKey !== null && isVisibleChat(serverKey)
    const request: ToolApprovalRequest = {
        tool: name,
        url,
        kind,
        summary: describeToolCall(name, args, actionOf(name, args, url, info.subject)),
    }
    if(offerServer) {
        request.view = {
            action: [],
            instructionTarget: false,
            replacement: null,
            offerAlways: false,
            offerServer: true,
        }
    }
    if(workspaceId !== undefined) {
        request.view = {
            action: workspaceActionParts(name, args) ?? [],
            instructionTarget: touchesInstructionFile(name, args),
            replacement: name === 'edit_file' && typeof (args as Record<string, unknown> | null)?.new_text === 'string'
                ? clipCodePoints((args as Record<string, string>).new_text, TOOL_SUMMARY_LIMIT)
                : null,
            offerAlways: grantable && toolGrantsOffered(),
        }
    }
    const decision = await askToolApproval(request, { signal })
    if(stopped()) {
        return stoppedBefore(name)
    }
    if(decision === 'deny') {
        return { content: refused(`Denied by the user: ${name}`), outcome: 'denied' }
    }
    if(decision === 'always' && grantable) {
        await addToolGrant(workspaceId, name)
    }
    if(decision === 'server' && offerServer) {
        // Recorded only while this is still the chat on screen; if the user left it meanwhile this call runs once.
        addServerChatGrant(serverKey, url)
    }
    return GO
}
