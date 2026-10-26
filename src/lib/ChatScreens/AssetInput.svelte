<script lang="ts">
    import { FileMusicIcon, PlusIcon } from "@lucide/svelte";
    import { type character, type groupChat } from "src/ts/storage/database.svelte";
    import { DBState } from "src/ts/stores.svelte";
    import { getFileSrc, pickedAssetLimitBytes, saveAssetFromBlob } from "src/ts/globalApi.svelte";
    import { selectMultipleFileObjects } from "src/ts/util";
    import { assetListElement, assetListUse, rowAssetUrl, storeRowAssetUrl, type AssetUse, type RowAssetUrl } from "src/ts/storage/assetUrlGate";
    import { reportRefusedAssets, splitByAssetLimit, warnRefusedAssets } from "src/ts/storage/pickedAssetLimit";
    import { beginBusy } from "src/ts/process/memory/busyActions";
    import { markCharacterForSave } from "src/ts/storage/characterSaveMarks";
    interface Props {
        currentCharacter: character|groupChat;
        onSelect: (additionalAsset:[string,string,string])=>void;
    }

    const { currentCharacter, onSelect }: Props = $props();

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

    let assetFileExtensions:string[] = $state([])
    let assetUrls:(RowAssetUrl|undefined)[] = $state([])

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

    $effect.pre(() => {
        if(currentCharacter.type ==='character'){
            if(currentCharacter.additionalAssets){
                for(let i = 0; i < currentCharacter.additionalAssets.length; i++){
                    // console.log('check content type ...', currentCharacter.additionalAssets[i][0], currentCharacter.additionalAssets[i][1]);
                    if(currentCharacter.additionalAssets[i].length > 2 && currentCharacter.additionalAssets[i][2]) {
                        assetFileExtensions[i] = currentCharacter.additionalAssets[i][2]
                    } else {
                        assetFileExtensions[i] = currentCharacter.additionalAssets[i][1].split('.').pop()
                    }
                    const use = rowUse(assetFileExtensions[i])
                    if(use !== null){
                        const path = currentCharacter.additionalAssets[i][1]
                        getFileSrc(path, use).then((url) => {
                            const now = rowNow(i)
                            storeRowAssetUrl(assetUrls, i, { path, use, url }, now.path, now.use)
                        })
                    }
                }
            }
        }
    });
</script>
{#if currentCharacter.type ==='character'}
    <button class="hover:text-green-500 bg-textcolor2 flex justify-center items-center w-16 h-16 m-1 rounded-md" onclick={async () => {
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
        <PlusIcon />
    </button>
    {#if currentCharacter.additionalAssets}
        {#each currentCharacter.additionalAssets as additionalAsset, i}
                {@const element = assetListElement(assetFileExtensions[i])}
                {@const url = rowAssetUrl(assetUrls[i], additionalAsset[1], rowUse(assetFileExtensions[i]))}
                <button onclick={()=>{
                    onSelect(additionalAsset)
                }}>
                    <!-- A URL still being made, or made for another asset or use, is undefined and shows nothing; '' is a URL that was withheld or could not be made, and shows the name box. -->
                    {#if element === 'audio' || element === 'icon' || url === ''}
                        <div class='w-16 h-16 m-1 rounded-md bg-slate-500 flex flex-col justify-center items-center'>
                            <FileMusicIcon/>
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
        {/each}
    {/if}
{/if}