<script lang="ts">
    import { FileMusicIcon, PlusIcon } from "@lucide/svelte";
    import { type character, type groupChat } from "src/ts/storage/database.svelte";
    import { DBState } from "src/ts/stores.svelte";
    import { getFileSrc, pickedAssetLimitBytes, saveAssetFromBlob } from "src/ts/globalApi.svelte";
    import { selectMultipleFileObjects } from "src/ts/util";
    import { assetListElement, assetListUse, createWholeReadBudget, isRowAssetUrlCurrent, rowAssetUrl, storeRowAssetUrl, type AssetUse, type RowAssetUrl } from "src/ts/storage/assetUrlGate";
    import { reportRefusedAssets, splitByAssetLimit, warnRefusedAssets } from "src/ts/storage/pickedAssetLimit";
    import { beginBusy } from "src/ts/process/memory/busyActions";
    import { markCharacterForSave } from "src/ts/storage/characterSaveMarks";
    import { language } from "src/lang";
    import { onDestroy, untrack } from "svelte";
    import { SvelteSet } from "svelte/reactivity";
    import { createWindowHost } from "src/ts/windowing/windowHost.svelte";
    import WindowedSegment from "../UI/Windowed/WindowedSegment.svelte";
    interface Props {
        currentCharacter: character|groupChat;
        onSelect: (additionalAsset:[string,string,string])=>void;
        // A vertically scrolling grid of tile rows, windowed: only the rows near the scroller's view are mounted, and
        // only mounted tiles ask for a URL. The nearest `overflow-y: auto` ancestor is the scroller. Fixed for the life
        // of the picker; without it every tile is mounted inline, as the legacy chat screen lays them out.
        grid?: boolean;
    }

    const { currentCharacter, onSelect, grid = false }: Props = $props();
    const windowed = untrack(() => grid)

    // The character list can shift or swap the slot for an archived stub while
    // the picker or a save is awaited, so a write goes to the clicked character
    // only while it is still a full character in the list.
    function isTargetLive(target: character|groupChat): boolean {
        if(DBState.db.characters.indexOf(target) === -1 || target.coldstorage){
            console.warn('Asset add dropped: the character was removed or archived while it was being made')
            return false
        }
        return true
    }

    // The extension of each asset: its stored one, else the end of its path.
    const assetFileExtensions:(string|undefined)[] = $derived.by(() => {
        if(currentCharacter.type !== 'character' || !currentCharacter.additionalAssets){
            return []
        }
        return currentCharacter.additionalAssets.map((asset) => asset.length > 2 && asset[2] ? asset[2] : asset[1].split('.').pop())
    })
    let assetUrls:(RowAssetUrl|undefined)[] = $state([])

    // A tile is the 64 px box plus its 4 px margin on each side; the add button is a tile too.
    const TILE_PX = 72
    // The columns before the grid's width is known (a 360 px phone holds 5).
    const FALLBACK_COLUMNS = 5
    let gridRoot:HTMLElement|null = $state(null)
    let columns = $state(FALLBACK_COLUMNS)
    const windowHost = windowed ? createWindowHost({ root: () => gridRoot }) : null
    onDestroy(() => windowHost?.dispose())

    $effect(() => {
        const element = gridRoot
        if(!element || typeof ResizeObserver === 'undefined'){
            return
        }
        // A width of 0 has no layout yet and keeps the columns it has.
        const read = () => {
            const width = element.clientWidth
            if(width > 0){
                columns = Math.max(1, Math.floor(width / TILE_PX))
            }
        }
        read()
        const observer = new ResizeObserver(read)
        observer.observe(element)
        return () => observer.disconnect()
    })

    // Cell 0 is the add button; cell c > 0 is asset c - 1. A grid row holds `columns` cells.
    const assetCount = $derived(currentCharacter.type === 'character' ? currentCharacter.additionalAssets?.length ?? 0 : 0)
    const rowKeys = $derived(Array.from({ length: Math.ceil((assetCount + 1) / columns) }, (_, row) => `r${row}`))
    function rowCells(row:number):number[] {
        const first = row * columns
        const end = Math.min(first + columns, assetCount + 1)
        return Array.from({ length: Math.max(0, end - first) }, (_, offset) => first + offset)
    }

    // The asset indices whose tile is mounted: in the grid only these ask for a URL.
    const mountedTiles = new SvelteSet<number>()
    function trackTile(node:HTMLElement, index:number) {
        mountedTiles.add(index)
        return {
            update(next:number) {
                mountedTiles.delete(index)
                index = next
                mountedTiles.add(index)
            },
            destroy() {
                mountedTiles.delete(index)
            },
        }
    }
    // Grid only: tile index -> the request in flight for it, so a tile that stays mounted is not asked twice.
    const pendingUrls = new Map<number, string>()
    let unmounted = false
    onDestroy(() => { unmounted = true })

    // An audio or icon row shows a name box and needs no URL.
    function rowUse(ext:string|undefined):AssetUse|null {
        const element = assetListElement(ext)
        return element === 'audio' ? null : assetListUse(element)
    }

    // The asset and use row `i` names now, read when a URL settles.
    function rowNow(i:number):{ path:string|undefined, use:AssetUse|null } {
        const asset = currentCharacter.type === 'character' ? currentCharacter.additionalAssets?.[i] : undefined
        return { path: asset?.[1], use: rowUse(assetFileExtensions[i]) }
    }

    // Not reactive: it only numbers the runs of the effect below, so a run that was superseded cannot store a URL.
    let assetRunId = 0

    $effect.pre(() => {
        const runId = ++assetRunId
        // One budget per run: the whole reads of the list's images together stay within the Android heap.
        const budget = createWholeReadBudget()
        if(currentCharacter.type ==='character'){
            if(currentCharacter.additionalAssets){
                const assets = currentCharacter.additionalAssets
                // In row order, so the budget admits the first tiles that fit.
                const indices = windowed
                    ? [...mountedTiles].filter((i) => i < assets.length).sort((a, b) => a - b)
                    : assets.map((_, i) => i)
                for(const i of indices){
                    const use = rowUse(assetFileExtensions[i])
                    if(use === null){
                        continue
                    }
                    const path = assets[i][1]
                    const request = `${use}\0${path}`
                    if(windowed){
                        // Each scroll starts a run, so a tile that has its URL or is waiting for it is not asked again.
                        if(isRowAssetUrlCurrent(untrack(() => assetUrls[i]), path, use) || pendingUrls.get(i) === request){
                            continue
                        }
                        pendingUrls.set(i, request)
                    }
                    const urlPromise = use === 'whole' ? getFileSrc(path, use, budget) : getFileSrc(path, use)
                    // Grid: a URL that could not be made is withheld (the name box), and the tile's request is settled.
                    const settled = windowed ? urlPromise.catch(() => '') : urlPromise
                    settled.then((url) => {
                        if(windowed){
                            if(pendingUrls.get(i) === request){
                                pendingUrls.delete(i)
                            }
                            // A later run does not ask for this tile again, so its result is kept; the tile check below
                            // still drops it when the tile names another asset or use by now.
                            if(unmounted){
                                return
                            }
                        } else if(runId !== assetRunId){
                            return
                        }
                        const now = rowNow(i)
                        storeRowAssetUrl(assetUrls, i, { path, use, url }, now.path, now.use)
                    })
                }
            }
        }
    });
</script>
{#snippet addButton()}
    <button class="hover:bg-darkbutton bg-textcolor2 flex justify-center items-center w-16 h-16 m-1 rounded-md" aria-label={language.add} onclick={async () => {
        const target = currentCharacter
        if(target.type === 'character'){
            const da = await selectMultipleFileObjects(['png', 'webp', 'mp4', 'mp3', 'gif'])
            if(!da){
                return
            }
            const limit = await pickedAssetLimitBytes()
            const { within, refused } = splitByAssetLimit(da, limit)
            if(within.length === 0){
                reportRefusedAssets(refused, limit)
                return
            }
            const busy = beginBusy('assetAdd')
            try {
                for(const f of within){
                    console.log(f)
                    const name = f.name
                    const extension = name.split('.').pop().toLowerCase()
                    if(!isTargetLive(target)){
                        return
                    }
                    const imgp = await saveAssetFromBlob(f, extension)
                    if(!isTargetLive(target)){
                        return
                    }
                    target.additionalAssets = target.additionalAssets ?? []
                    target.additionalAssets.push([name, imgp, extension])
                    // The target may no longer be the selected character, whose
                    // edits the selection effects would otherwise save.
                    markCharacterForSave(target.chaId)
                }
            } catch (error) {
                warnRefusedAssets(refused, limit)
                throw error
            } finally {
                busy.end()
            }
            reportRefusedAssets(refused, limit)
        }
    }}>
        <PlusIcon aria-hidden="true" />
    </button>
{/snippet}
{#snippet assetTile(additionalAsset:[string,string,string], i:number)}
    {@const element = assetListElement(assetFileExtensions[i])}
    {@const url = rowAssetUrl(assetUrls[i], additionalAsset[1], rowUse(assetFileExtensions[i]))}
    <!-- In the grid the button keeps the tile's size while its URL is being made, so every row is one tile tall. -->
    <button aria-label={additionalAsset[0]} class={windowed ? 'flex-none w-[72px] h-[72px]' : undefined} use:trackTile={i} onclick={()=>{
        onSelect(additionalAsset)
    }}>
        <!-- A URL still being made, or made for another asset or use, is undefined and shows nothing; '' is a URL that was withheld or could not be made, and shows the name box. -->
        {#if element === 'audio' || element === 'icon' || url === ''}
            <div data-part="asset-name-box" class='w-16 h-16 m-1 rounded-md bg-darkbutton flex flex-col justify-center items-center'>
                <FileMusicIcon aria-hidden="true"/>
                <div class='w-16 px-1 text-ellipsis whitespace-nowrap overflow-hidden'>{additionalAsset[0]}</div>
            </div>
        {:else if url}
            {#if element === 'video'}
                <!-- svelte-ignore a11y_media_has_caption -->
                <video class="w-16 h-16 m-1 rounded-md"><source src={url} type="video/mp4"></video>
            {:else}
            <img src={url} class="w-16 h-16 m-1 rounded-md" alt={additionalAsset[0]}/>
            {/if}
        {/if}
    </button>
{/snippet}
{#if currentCharacter.type ==='character'}
    {#if windowHost}
        {@const assets = currentCharacter.additionalAssets ?? []}
        <div bind:this={gridRoot}>
            <WindowedSegment host={windowHost} keys={rowKeys} height={{ fixed: TILE_PX }}>
                {#snippet item(_key, row)}
                    <div class="flex">
                        {#each rowCells(row) as cell (cell)}
                            {#if cell === 0}
                                {@render addButton()}
                            {:else}
                                {@render assetTile(assets[cell - 1], cell - 1)}
                            {/if}
                        {/each}
                    </div>
                {/snippet}
            </WindowedSegment>
        </div>
    {:else}
        {@render addButton()}
        {#if currentCharacter.additionalAssets}
            {#each currentCharacter.additionalAssets as additionalAsset, i}
                {@render assetTile(additionalAsset, i)}
            {/each}
        {/if}
    {/if}
{/if}