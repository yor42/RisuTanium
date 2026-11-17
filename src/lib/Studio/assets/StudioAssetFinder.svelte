<script lang="ts" module>
    import type { CheckBytesResult, HashCache } from '../../../ts/studio/assets/assetHashJob'
    import type { AssetSizeJob } from '../../../ts/studio/assets/assetSizes'
    import type { DuplicateGroup, GroupRow } from '../../../ts/studio/assets/duplicateGroups'
    import type { SurvivorDeps } from '../../../ts/studio/edit/assetSetters'

    /** One asset row as the finder groups it. `index` is the row's place in its own array. */
    export interface FinderRow extends GroupRow {
        readonly folder: string | null
    }

    /** One array the finder groups on its own. Rows of a report-only array are listed and never changed. */
    export interface FinderArray {
        id: string
        // The module the rows come from, or null for the owner's own array.
        title: string | null
        rows: FinderRow[]
        reportOnly: boolean
    }

    export interface CheckBytesHooks {
        onPhase(phase: 'sizes' | 'hashing'): void
        onProgress(done: string, total: string): void
    }

    /** What the finder needs of the byte layer; the list supplies the production one, tests a double. */
    export interface FinderPort {
        sizes: AssetSizeJob
        hashCache: Pick<HashCache, 'get'>
        checkBytes(rows: readonly { name: string, path: string }[], signal: AbortSignal, hooks: CheckBytesHooks): Promise<Pick<CheckBytesResult, 'status' | 'hashes' | 'unreadable'>>
    }
</script>

<script lang="ts">
    import { onDestroy } from 'svelte'
    import { language } from '../../../lang'
    import { groupDuplicates, type DuplicateClass } from '../../../ts/studio/assets/duplicateGroups'
    import { survivorDepsFrom } from '../../../ts/studio/edit/assetSetters'

    // The duplicate panel of the asset list: groups by what is known of the rows, and Check bytes, which reads the
    // files that could be duplicates. It starts nothing by itself, writes nothing and only reports what the person asked
    // for; Remove extras and Merge are the list's to run.
    interface Props {
        // The owner's own array first. Read live, so a row that changes while a pass runs changes the groups at once.
        arrays: FinderArray[]
        // The enabled modules' arrays, in module order; absent leaves the scope switch out.
        moduleArrays?: () => FinderArray[]
        port: () => Promise<FinderPort>
        // The sizes the list has read.
        sizes: Record<string, number | null | undefined>
        editable: boolean
        // How many places reach this file under this name; absent counts none, so the survivor falls back to the first copy.
        references?: (name: string, path: string) => number
        onremoveextras: (array: FinderArray, group: DuplicateGroup<FinderRow>, deps: SurvivorDeps) => void
        // Merge belongs to the merge stage: without this there is no Merge button.
        onmerge?: (array: FinderArray, group: DuplicateGroup<FinderRow>) => void
        onclose: () => void
    }

    let { arrays, moduleArrays, port, sizes, editable, references, onremoveextras, onmerge, onclose }: Props = $props()

    interface Hashed {
        size: number | null
        hex: string
    }

    let includeModules = $state(false)
    let phase = $state<'idle' | 'sizes' | 'hashing'>('idle')
    let progress = $state<{ done: string, total: string } | null>(null)
    // What Check bytes learned, by path: the hash with the size it was made under, and the sizes it read.
    let hashed = $state<Record<string, Hashed>>({})
    let ownSizes = $state<Record<string, number | null>>({})
    let unreadable = $state<Record<string, true>>({})
    let loadedPort: FinderPort | null = null
    let controller: AbortController | null = null
    let destroyed = false

    // The panel ends with the list, the owner or the kind: a pass still reading stops and nothing it finds is applied.
    onDestroy(() => {
        destroyed = true
        controller?.abort()
    })

    const shownArrays = $derived(includeModules && moduleArrays ? [...arrays, ...moduleArrays()] : arrays)

    function sizeOf(path: string): number | null | undefined {
        return path in ownSizes ? ownSizes[path] : sizes[path]
    }

    // A hash counts only under the size it was made under: a file that changed since is not the file that was hashed.
    function hashesOf(rows: readonly FinderRow[]): Map<string, string> {
        const known = new Map<string, string>()
        for (const row of rows) {
            const entry = hashed[row.path]
            if (entry !== undefined && entry.size === (sizeOf(row.path) ?? null)) known.set(row.path, entry.hex)
        }
        return known
    }

    const grouped = $derived(shownArrays.map((array) => {
        const rows = array.rows.map((row) => ({ ...row, references: references?.(row.name, row.path) ?? 0 }))
        const known = new Map<string, number | null | undefined>()
        for (const row of rows) known.set(row.path, sizeOf(row.path))
        return {
            array,
            groups: groupDuplicates(rows, {
                sizes: known,
                hashes: hashesOf(rows),
                unreadable: new Set(rows.filter((row) => unreadable[row.path] === true).map((row) => row.path)),
                reportOnly: array.reportOnly,
            }),
        }
    }))
    const unreadableCount = $derived(new Set(shownArrays.flatMap((array) => array.rows.filter((row) => unreadable[row.path] === true).map((row) => row.path))).size)
    const running = $derived(phase !== 'idle')

    const classText: Record<DuplicateClass, () => string> = {
        sameFile: () => language.studioAssetDupSameFile,
        possibleDuplicate: () => language.studioAssetDupPossible,
        sizeUnknown: () => language.studioAssetDupSizeUnknown,
        sameFileDifferentNames: () => language.studioAssetDupSameFileNames,
        sameNameDifferentFile: () => language.studioAssetDupSameNameFile,
        unreadable: () => language.studioAssetDupUnreadable,
    }

    async function checkBytes(): Promise<void> {
        if (running) return
        const run = new AbortController()
        controller = run
        // The rows as they are now: the pass is for these, and what it finds is applied by path to whatever rows are live then.
        const snapshot = shownArrays.map((array) => array.rows.map((row) => ({ name: row.name, path: row.path })))
        phase = 'sizes'
        progress = null
        try {
            const bytes = loadedPort ?? (loadedPort = await port())
            for (const rows of snapshot) {
                if (run.signal.aborted || destroyed) return
                const result = await bytes.checkBytes(rows, run.signal, {
                    onPhase: (next) => { if (!destroyed && !run.signal.aborted) phase = next },
                    onProgress: (done, total) => { if (!destroyed && !run.signal.aborted) progress = { done, total } },
                })
                if (destroyed) return
                // A cancelled pass keeps what it had finished.
                for (const row of rows) {
                    const size = bytes.sizes.peek(row.path)
                    if (size !== undefined) ownSizes[row.path] = size
                }
                for (const [path, hex] of result.hashes) hashed[path] = { size: bytes.sizes.peek(path) ?? null, hex }
                for (const path of result.unreadable) unreadable[path] = true
                if (result.status === 'aborted') return
            }
        } finally {
            if (!destroyed && controller === run) {
                phase = 'idle'
                progress = null
                controller = null
            }
        }
    }

    function cancel(): void {
        controller?.abort()
    }

    function close(): void {
        controller?.abort()
        onclose()
    }

    function removeExtras(array: FinderArray, group: DuplicateGroup<FinderRow>): void {
        const bytes = loadedPort
        // Without a loaded byte layer no pass has run, so no hash exists and only identical paths count.
        const deps: SurvivorDeps = bytes ? survivorDepsFrom(bytes.hashCache, (path) => bytes.sizes.peek(path) ?? null) : { hashOf: () => undefined }
        onremoveextras(array, group, deps)
    }

    const buttonClass = 'min-h-11 rounded-md border border-darkborderc px-3 hover:bg-selected cursor-pointer disabled:cursor-default disabled:opacity-50'
</script>

<section data-part="studio-asset-dup-panel" aria-busy={running ? 'true' : undefined} class="flex flex-col gap-3 rounded-md border border-darkborderc p-3">
    <div class="flex flex-wrap items-center gap-2">
        <h3 class="min-w-0 flex-1 font-bold">{language.studioAssetFindDuplicates}</h3>
        {#if running}
            <span data-part="studio-asset-check-status" role="status" class="text-sm text-textcolor2">{phase === 'sizes' || progress === null ? language.loading : language.studioAssetCheckProgress(progress.done, progress.total)}</span>
            <button type="button" data-part="studio-asset-check-cancel" class={buttonClass} onclick={cancel}>{language.cancel}</button>
        {:else}
            <button type="button" data-part="studio-asset-check-bytes" class={buttonClass} onclick={() => void checkBytes()}>{language.studioAssetCheckBytes}</button>
        {/if}
        <button type="button" data-part="studio-asset-dup-close" class={buttonClass} onclick={close}>{language.uiCommon.close}</button>
    </div>
    {#if moduleArrays}
        <label class="flex min-h-11 items-center gap-2 cursor-pointer">
            <input type="checkbox" data-part="studio-asset-dup-modules" class="h-5 w-5 cursor-pointer" bind:checked={includeModules} />
            <span>{language.studioAssetDupIncludeModules}</span>
        </label>
    {/if}
    {#if unreadableCount > 0}
        <p data-part="studio-asset-dup-unreadable" role="status" class="text-sm text-textcolor2">{language.studioAssetDupUnreadableCount(unreadableCount)}</p>
    {/if}
    {#each grouped as { array, groups } (array.id)}
        <div data-part="studio-asset-dup-array" data-array={array.id} class="flex flex-col gap-2">
            {#if array.title !== null}
                <p class="font-bold">{array.title}</p>
            {/if}
            {#if array.reportOnly}
                <p class="text-sm text-textcolor2">{language.studioAssetDupReportOnly}</p>
            {/if}
            {#each groups as group}
                <div data-part="studio-asset-dup-group" data-class={group.cls} class="flex flex-col gap-1 rounded-md border border-darkborderc p-2">
                    <p class="font-bold">{classText[group.cls]()}</p>
                    <ul class="flex flex-col gap-1 text-sm text-textcolor2">
                        {#each group.rows as row (row.index)}
                            <li data-part="studio-asset-dup-row" class="break-all">{row.name}{row.folder !== null ? ` · ${row.folder}` : ''} · {row.path}</li>
                        {/each}
                    </ul>
                    {#if group.removable}
                        <div>
                            <button type="button" data-part="studio-asset-remove-extras" class={buttonClass} disabled={!editable} onclick={() => removeExtras(array, group)}>{language.studioAssetRemoveExtras}</button>
                        </div>
                    {:else if group.mergeCandidate && onmerge}
                        <div>
                            <button type="button" data-part="studio-asset-dup-merge" class={buttonClass} disabled={!editable} onclick={() => onmerge(array, group)}>{language.studioAssetMerge}</button>
                        </div>
                    {/if}
                </div>
            {/each}
        </div>
    {/each}
</section>
