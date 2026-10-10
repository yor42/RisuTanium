<script lang="ts">
    import { FileMusicIcon, PlusIcon } from "@lucide/svelte";
    import { type character, type groupChat } from "src/ts/storage/database.svelte";
    import { DBState } from "src/ts/stores.svelte";
    import { getFileSrc, saveAsset } from "src/ts/globalApi.svelte";
    import { selectMultipleFile } from "src/ts/util";
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
    let assetFilePath:string[] = $state([])

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
                    getFileSrc(currentCharacter.additionalAssets[i][1]).then((filePath) => {
                        assetFilePath[i] = filePath
                    })
                }
            }
        }
    });
</script>
{#if currentCharacter.type ==='character'}
    <button class="hover:text-green-500 bg-textcolor2 flex justify-center items-center w-16 h-16 m-1 rounded-md" onclick={async () => {
        const target = currentCharacter
        if(target.type === 'character'){
            const da = await selectMultipleFile(['png', 'webp', 'mp4', 'mp3', 'gif'])
            if(!da){
                return
            }
            const busy = beginBusy('assetAdd')
            try {
                for(const f of da){
                    console.log(f)
                    const img = f.data
                    const name = f.name
                    const extension = name.split('.').pop().toLowerCase()
                    if(!isTargetLive(target)){
                        return
                    }
                    const imgp = await saveAsset(img,'',extension)
                    if(!isTargetLive(target)){
                        return
                    }
                    target.additionalAssets = target.additionalAssets ?? []
                    target.additionalAssets.push([name, imgp, extension])
                    // The target may no longer be the selected character, whose
                    // edits the selection effects would otherwise save.
                    markCharacterForSave(target.chaId)
                }
            } finally {
                busy.end()
            }
        }
    }}>
        <PlusIcon />
    </button>
    {#if currentCharacter.additionalAssets}
        {#each currentCharacter.additionalAssets as additionalAsset, i}
                <button onclick={()=>{
                    onSelect(additionalAsset)
                }}>
                    {#if assetFilePath[i]}
                        {#if assetFileExtensions[i] === 'mp4'}
                            <!-- svelte-ignore a11y_media_has_caption -->
                            <video class="w-16 h-16 m-1 rounded-md"><source src={assetFilePath[i]} type="video/mp4"></video>
                        {:else if assetFileExtensions[i] === 'mp3'}
                            <div class='w-16 h-16 m-1 rounded-md bg-slate-500 flex flex-col justify-center items-center'>
                                <FileMusicIcon/>
                                <div class='w-16 px-1 text-ellipsis whitespace-nowrap overflow-hidden'>{additionalAsset[0]}</div>
                            </div>
                            <!-- <audio controls class="w-16 h-16 m-1 rounded-md"><source src={assetPath} type="audio/mpeg"></audio> -->
                        {:else}
                        <img src={assetFilePath[i]} class="w-16 h-16 m-1 rounded-md" alt={additionalAsset[0]}/>
                        {/if}
                    {/if}
                </button>
        {/each}
    {/if}
{/if}