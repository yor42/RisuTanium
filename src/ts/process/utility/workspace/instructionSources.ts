import { utf8ByteLength } from './textGuard'
import { listFiles, readText } from './workspaceModel.svelte'

/** The most UTF-8 bytes of workspace instructions one request carries, truncation note included (MC-3376). */
export const INSTRUCTION_CAP_BYTES = 48 * 1024

const FRONTMATTER_MAX_BYTES = 8 * 1024
const SKILL_NAME_MAX_CHARS = 200
const SKILL_DESCRIPTION_MAX_CHARS = 500

export interface SkillIndexEntry {
    /** The workspace path of the SKILL.md. */
    path: string
    /** Frontmatter `name`, or null when it is missing or the frontmatter cannot be parsed. */
    name: string | null
    description: string | null
}

export interface WorkspaceInstructions {
    /** The text that joins the system message; empty when the workspace has no instruction source. */
    text: string
    truncated: boolean
    /** Instruction files that were skipped because their text is lost (placeholders). */
    damaged: string[]
    /** The AGENTS.md paths included, root first. */
    agentsPaths: string[]
    skills: SkillIndexEntry[]
}

function baseName(path: string): string {
    return path.slice(path.lastIndexOf('/') + 1)
}

function depthOf(path: string): number {
    return path.split('/').length
}

/** Root first: fewer directories before more, then by path, so the order never depends on how files were added. */
function rootFirst(paths: string[]): string[] {
    return [...paths].sort((a, b) => depthOf(a) - depthOf(b) || (a < b ? -1 : a > b ? 1 : 0))
}

function oneLine(value: string, max: number): string {
    const flat = value.replace(/\s+/g, ' ').trim()
    return flat.length > max ? `${flat.slice(0, max)}...` : flat
}

function frontmatterBlock(text: string): string | null {
    const lines = text.split(/\r?\n/)
    if (lines[0]?.trim() !== '---') {
        return null
    }
    for (let index = 1; index < lines.length; index++) {
        if (lines[index].trim() === '---') {
            const block = lines.slice(1, index).join('\n')
            return utf8ByteLength(block) <= FRONTMATTER_MAX_BYTES ? block : null
        }
    }
    return null
}

/** Name and description of a SKILL.md. Any parse problem degrades to nulls; this never throws. */
async function readSkill(path: string, text: string): Promise<SkillIndexEntry> {
    const entry: SkillIndexEntry = { path, name: null, description: null }
    try {
        const block = frontmatterBlock(text)
        if (block === null) {
            return entry
        }
        const { parse } = await import('yaml')
        const data: unknown = parse(block)
        if (typeof data !== 'object' || data === null) {
            return entry
        }
        const record = data as Record<string, unknown>
        if (typeof record.name === 'string' && record.name.trim() !== '') {
            entry.name = oneLine(record.name, SKILL_NAME_MAX_CHARS)
        }
        if (typeof record.description === 'string' && record.description.trim() !== '') {
            entry.description = oneLine(record.description, SKILL_DESCRIPTION_MAX_CHARS)
        }
    }
    catch {
        entry.name = null
        entry.description = null
    }
    return entry
}

function skillLine(skill: SkillIndexEntry): string {
    const dir = skill.path.includes('/') ? skill.path.slice(0, skill.path.lastIndexOf('/')) : ''
    const label = skill.name ?? (dir === '' ? skill.path : baseName(dir))
    return `- ${label}${skill.description === null ? '' : `: ${skill.description}`} (${skill.path})`
}

function truncationNote(omittedBytes: number): string {
    return `[Workspace instructions were cut at ${INSTRUCTION_CAP_BYTES / 1024} KiB; ${omittedBytes} bytes are not shown. Read the files with read_file for the rest.]`
}

/** Cuts `text` to at most `maxBytes` UTF-8 bytes without leaving a broken character. */
function cutToBytes(text: string, maxBytes: number): string {
    const bytes = new TextEncoder().encode(text).subarray(0, Math.max(0, maxBytes))
    return new TextDecoder().decode(bytes).replace(/�+$/, '')
}

/**
 * The instruction text of one workspace: every AGENTS.md root first with its path as the label, then an index of the
 * SKILL.md files (name and description only). A skill's own text is never included; the model reads it with
 * `read_file`, and no skill script is ever run. Only the workspace's own files are read, through the model's read
 * functions; a damaged (placeholder) file is skipped and named. The result is plain text: it cannot change the tools
 * a run advertises or any grant, because the caller fixes those before calling this.
 */
export async function buildWorkspaceInstructions(workspaceId: string): Promise<WorkspaceInstructions> {
    const paths = listFiles(workspaceId).map(file => file.path)
    const damaged: string[] = []
    const agentsPaths: string[] = []
    const blocks: string[] = []

    for (const path of rootFirst(paths.filter(candidate => baseName(candidate) === 'AGENTS.md'))) {
        const read = readText(workspaceId, path)
        if (read.state === 'damaged') {
            damaged.push(path)
        }
        else if (read.state === 'ok') {
            agentsPaths.push(path)
            blocks.push(`AGENTS.md (${path}):\n${read.text}`)
        }
    }

    const skills: SkillIndexEntry[] = []
    for (const path of rootFirst(paths.filter(candidate => baseName(candidate) === 'SKILL.md'))) {
        const read = readText(workspaceId, path)
        if (read.state === 'damaged') {
            damaged.push(path)
        }
        else if (read.state === 'ok') {
            skills.push(await readSkill(path, read.text))
        }
    }
    if (skills.length > 0) {
        blocks.push(`Skills in this workspace. Read a skill's SKILL.md with read_file before you use it; its scripts are never run.\n${skills.map(skillLine).join('\n')}`)
    }
    if (damaged.length > 0) {
        blocks.push(`Skipped because their text is lost: ${damaged.join(', ')}`)
    }
    if (blocks.length === 0) {
        return { text: '', truncated: false, damaged, agentsPaths, skills }
    }

    const full = blocks.join('\n\n')
    const total = utf8ByteLength(full)
    if (total <= INSTRUCTION_CAP_BYTES) {
        return { text: full, truncated: false, damaged, agentsPaths, skills }
    }
    // The note's digits never exceed those of `total`, so reserving for `total` keeps the whole result under the cap.
    const reserve = utf8ByteLength(`\n\n${truncationNote(total)}`)
    const kept = cutToBytes(full, INSTRUCTION_CAP_BYTES - reserve)
    const omitted = total - utf8ByteLength(kept)
    return { text: `${kept}\n\n${truncationNote(omitted)}`, truncated: true, damaged, agentsPaths, skills }
}
