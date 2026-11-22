<script lang="ts">
    import { language } from 'src/lang'
    import { alertConfirm, alertSelect } from 'src/ts/alert'
    import { downloadFile } from 'src/ts/globalApi.svelte'
    import {
        commitWorkspaceChange,
        createWorkspace,
        deleteWorkspace,
        listFiles,
        listWorkspaces,
        renameWorkspace,
        WORKSPACE_LIMITS,
        type WorkspaceChangeError,
    } from 'src/ts/process/utility/workspace/workspaceModel.svelte'
    import {
        exportWorkspaceZip,
        importZipIntoWorkspace,
        ZIP_UNPACKED_LIMIT,
        type CollisionChoice,
        type ZipArchiveRefusal,
        type ZipRefusedEntry,
    } from 'src/ts/process/utility/workspace/workspaceZip'
    import { escapeBidiControls } from 'src/ts/process/mcp/bidiEscape'
    import Button from '../UI/GUI/Button.svelte'
    import TextInput from '../UI/GUI/TextInput.svelte'
    import { formatBytes, importPickedFiles, type PickedFile } from './workspaceFiles'

    const text = $derived(language.utility.workspaces)
    const COLLISIONS_SHOWN = 10

    // The picker module is loaded when a pick starts, so opening the screen does not pull in the whole app utility module.
    async function pickFiles(extensions: string[]): Promise<File[] | null> {
        return (await import('src/ts/util')).selectMultipleFileObjects(extensions)
    }

    async function pickOneFile(extensions: string[]): Promise<File | null> {
        return (await import('src/ts/util')).selectSingleFileObject(extensions)
    }

    let selectedId = $state<string | null>(null)
    let newName = $state('')
    let notice = $state('')
    let refused = $state<ZipRefusedEntry[]>([])
    let busy = $state(false)

    const summaries = $derived(listWorkspaces())
    const selected = $derived(summaries.find((summary) => summary.id === selectedId))
    const files = $derived(selected ? listFiles(selected.id) : [])
    const totalBytes = $derived(summaries.reduce((sum, summary) => sum + summary.bytes, 0))

    function usageLine(files: number, bytes: number): string {
        return text.usage(files, WORKSPACE_LIMITS.workspaceFiles, formatBytes(bytes), formatBytes(WORKSPACE_LIMITS.workspaceBytes))
    }

    function reasonLabel(reason: ZipRefusedEntry['reason']): string {
        return text.reason[reason]
    }

    function capsCause(error: WorkspaceChangeError): string {
        switch (error.code) {
            case 'file-too-large':
            case 'workspace-too-large':
            case 'too-many-files':
            case 'total-too-large':
                return text.caps[error.code]
            default:
                return text.caps.other
        }
    }

    function createNew() {
        const id = createWorkspace(newName.trim() || text.defaultName)
        newName = ''
        selectedId = id
        notice = ''
        refused = []
    }

    function select(id: string) {
        selectedId = id
        notice = ''
        refused = []
    }

    function rename(id: string, value: string) {
        renameWorkspace(id, value.trim() || text.defaultName)
    }

    async function removeWorkspace(id: string, name: string, fileCount: number) {
        if (!await alertConfirm(text.deleteWorkspaceConfirm(name, fileCount))) {
            return
        }
        deleteWorkspace(id)
        if (selectedId === id) {
            selectedId = null
            notice = ''
            refused = []
        }
    }

    async function removeFile(id: string, path: string) {
        if (!await alertConfirm(text.deleteFileConfirm(escapeBidiControls(path)))) {
            return
        }
        const result = commitWorkspaceChange(id, [{ kind: 'delete', path }])
        // Any other failure means the file is already gone, and the list shows that without a notice.
        notice = result.ok === false && result.error.code === 'no-workspace' ? text.workspaceGone : ''
    }

    // One question for the whole import, however many paths collide.
    async function askCollision(collisions: readonly string[]): Promise<CollisionChoice> {
        const shown = collisions.slice(0, COLLISIONS_SHOWN).join('\n')
        const list = collisions.length > COLLISIONS_SHOWN ? `${shown}\n...` : shown
        const answer = await alertSelect(
            [text.collisionReplace, text.collisionKeep, text.collisionCancel],
            text.collisionPrompt(collisions.length, list),
            { cancel: '2' },
        )
        return answer === '0' ? 'replace' : answer === '1' ? 'keep' : 'cancel'
    }

    interface ImportOutcome {
        notice: string
        refused: ZipRefusedEntry[]
    }

    function archiveNotice(reason: ZipArchiveRefusal): string {
        return text.archive[reason]
    }

    async function guarded(run: () => Promise<ImportOutcome | null>) {
        if (busy) {
            return
        }
        busy = true
        notice = ''
        refused = []
        try {
            const outcome = await run()
            if (outcome) {
                notice = outcome.notice
                refused = outcome.refused
            }
        }
        finally {
            busy = false
        }
    }

    async function addFiles(id: string) {
        await guarded(async () => {
            const picked = await pickFiles(['*'])
            if (!picked) {
                return null
            }
            // The caps are checked before any file is read, over the files that will be read: a file past the per-file
            // cap is only listed as refused, so it never counts and an oversized pick never fills memory.
            const readableFiles = picked.filter((file) => file.size <= WORKSPACE_LIMITS.fileBytes)
            if (readableFiles.length > WORKSPACE_LIMITS.workspaceFiles) {
                return { notice: text.capsRefused(text.caps['too-many-files']), refused: [] }
            }
            if (readableFiles.reduce((sum, file) => sum + file.size, 0) > WORKSPACE_LIMITS.workspaceBytes) {
                return { notice: text.capsRefused(text.caps['workspace-too-large']), refused: [] }
            }
            // A file past the cap is never read into memory; it is listed as refused like any other entry.
            const tooLarge: ZipRefusedEntry[] = []
            const readable: PickedFile[] = []
            for (const file of picked) {
                if (file.size > WORKSPACE_LIMITS.fileBytes) {
                    tooLarge.push({ name: file.name, reason: 'too-large', detail: '' })
                }
                else {
                    readable.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) })
                }
            }
            const result = await importPickedFiles(id, readable, askCollision)
            if (result.ok === false) {
                if (result.reason === 'cancelled') {
                    return null
                }
                if (result.reason === 'caps') {
                    return { notice: text.capsRefused(capsCause(result.error)), refused: [...tooLarge, ...result.refused] }
                }
                return { notice: result.reason === 'changed' ? text.changedDuringImport : text.workspaceGone, refused: tooLarge }
            }
            return {
                notice: result.written.length + result.keptExisting.length > 0 ? text.importDone(result.written.length, result.keptExisting.length) : text.importNothing,
                refused: [...tooLarge, ...result.refused],
            }
        })
    }

    async function importZip(id: string) {
        await guarded(async () => {
            const file = await pickOneFile(['zip'])
            if (!file) {
                return null
            }
            if (file.size > ZIP_UNPACKED_LIMIT) {
                return { notice: archiveNotice('unpacked-too-large'), refused: [] }
            }
            const result = await importZipIntoWorkspace(id, new Uint8Array(await file.arrayBuffer()), askCollision)
            if (result.ok === false) {
                switch (result.reason) {
                    case 'cancelled':
                        return null
                    case 'archive':
                        return { notice: archiveNotice(result.archive), refused: [] }
                    case 'caps':
                        return { notice: text.capsRefused(capsCause(result.error)), refused: result.refused }
                    case 'changed':
                        return { notice: text.changedDuringImport, refused: [] }
                    default:
                        return { notice: text.workspaceGone, refused: [] }
                }
            }
            return {
                notice: result.written.length + result.keptExisting.length > 0 ? text.importDone(result.written.length, result.keptExisting.length) : text.importNothing,
                refused: result.refused,
            }
        })
    }

    async function exportZip(id: string, name: string) {
        notice = ''
        refused = []
        let result = exportWorkspaceZip(id)
        if (result.ok === false) {
            if (result.reason !== 'damaged') {
                notice = text.workspaceGone
                return
            }
            // The archive would silently lack these files, so the user hears which ones before anything is written.
            if (!await alertConfirm(text.exportOmitConfirm(result.paths.join('\n')))) {
                return
            }
            result = exportWorkspaceZip(id, { omitDamaged: true })
            if (result.ok === false) {
                notice = text.workspaceGone
                return
            }
        }
        const fileName = `${name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || text.defaultName}.zip`
        if (await downloadFile(fileName, result.bytes)) {
            notice = text.exportDone
        }
    }
</script>

<div class="flex flex-col gap-3 text-textcolor" data-testid="workspace-manager">
    <h2 class="text-xl font-bold">{text.heading}</h2>
    <p class="text-sm text-textcolor2">{text.intro}</p>

    <div class="flex flex-wrap items-center gap-2">
        <span id="workspace-new-name-label" class="sr-only">{text.nameLabel}</span>
        <TextInput labelId="workspace-new-name-label" placeholder={text.defaultName} className="min-h-11 min-w-48 flex-1" bind:value={newName} />
        <Button className="min-h-11" onclick={createNew}>{text.create}</Button>
    </div>

    {#if summaries.length === 0}
        <p class="text-textcolor2" data-testid="workspace-empty">{text.empty}</p>
    {:else}
        <div class="flex flex-col gap-2" data-testid="workspace-list">
            {#each summaries as summary (summary.id)}
                <button
                    class="flex min-h-11 flex-col items-start rounded-md border px-4 py-2 text-left risu-focus-ring {summary.id === selectedId ? 'border-borderc bg-darkbutton' : 'border-darkborderc bg-darkbg hover:bg-darkbutton'}"
                    aria-pressed={summary.id === selectedId}
                    data-testid="workspace-row"
                    onclick={() => select(summary.id)}
                >
                    <span class="min-w-0 max-w-full break-words font-bold">{summary.name}</span>
                    <span class="text-sm text-textcolor2">{usageLine(summary.fileCount, summary.bytes)}</span>
                </button>
            {/each}
        </div>
        <p class="text-sm text-textcolor2" data-testid="workspace-total">{text.totalUsage(formatBytes(totalBytes), formatBytes(WORKSPACE_LIMITS.totalBytes))}</p>
    {/if}

    {#if selected}
        <div class="flex flex-col gap-3 rounded-md border border-darkborderc bg-darkbg p-4" data-testid="workspace-detail">
            <label id="workspace-name-label" class="text-textcolor2" for="workspace-name">{text.nameLabel}</label>
            <TextInput id="workspace-name" labelId="workspace-name-label" fullwidth className="min-h-11" value={selected.name} onchange={(event) => rename(selected.id, event.currentTarget.value)} />
            <p class="text-sm text-textcolor2">{usageLine(selected.fileCount, selected.bytes)}</p>

            <div class="flex flex-wrap gap-2">
                <Button className="min-h-11" disabled={busy} onclick={() => addFiles(selected.id)}>{text.addFiles}</Button>
                <Button className="min-h-11" styled="outlined" disabled={busy} onclick={() => importZip(selected.id)}>{text.importZip}</Button>
                <Button className="min-h-11" styled="outlined" disabled={busy} onclick={() => exportZip(selected.id, selected.name)}>{text.exportZip}</Button>
            </div>

            {#if notice}
                <p class="text-sm text-textcolor" role="status" data-testid="workspace-notice">{notice}</p>
            {/if}
            {#if refused.length > 0}
                <div class="rounded-md border border-draculared p-2 text-draculared" role="alert" data-testid="workspace-refused">
                    <p>{text.refusedHeading(refused.length)}</p>
                    <ul class="list-disc pl-6">
                        {#each refused as entry}
                            <li class="break-all">{text.refusedLine(entry.name, reasonLabel(entry.reason))}</li>
                        {/each}
                    </ul>
                </div>
            {/if}

            <h3 class="font-bold">{text.files}</h3>
            {#if files.length === 0}
                <p class="text-textcolor2" data-testid="workspace-no-files">{text.noFiles}</p>
            {:else}
                <ul class="flex flex-col gap-2" data-testid="workspace-files">
                    {#each files as file (file.id)}
                        <li class="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 {file.placeholder ? 'border-draculared' : 'border-darkborderc'}" data-testid="workspace-file">
                            <div class="flex min-w-0 flex-1 flex-col">
                                <span class="break-all" data-testid="workspace-file-path">{escapeBidiControls(file.path)}</span>
                                {#if file.placeholder}
                                    <span class="text-sm font-bold text-draculared" data-testid="workspace-file-damaged">{text.damaged}</span>
                                    <span class="text-sm text-draculared">{text.damagedNote}</span>
                                {:else}
                                    <span class="text-sm text-textcolor2">{formatBytes(file.size)}</span>
                                {/if}
                            </div>
                            <Button className="min-h-11" styled="danger" onclick={() => removeFile(selected.id, file.path)}>{text.deleteFile}</Button>
                        </li>
                    {/each}
                </ul>
            {/if}

            <div>
                <Button className="min-h-11" styled="danger" onclick={() => removeWorkspace(selected.id, selected.name, selected.fileCount)}>{text.deleteWorkspace}</Button>
            </div>
        </div>
    {:else if summaries.length > 0}
        <p class="text-textcolor2">{text.choose}</p>
    {/if}
</div>
