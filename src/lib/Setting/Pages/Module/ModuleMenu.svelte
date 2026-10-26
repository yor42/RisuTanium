<script lang="ts">
    import { language } from "src/lang";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import type { loreBook } from "src/ts/storage/database.svelte";
    import LoreBookList from "src/lib/SideBars/LoreBook/LoreBookList.svelte";
    import { type CCLorebook, convertExternalLorebook } from "src/ts/process/lorebook.svelte";
    import type { RisuModule } from "src/ts/process/modules";
    import { beginBusy } from "src/ts/process/memory/busyActions";
    import { DownloadIcon, FileMusicIcon, FolderPlusIcon, HardDriveUploadIcon, PlusIcon, TrashIcon } from "@lucide/svelte";
    import { assetListElement, assetListUse, createWholeReadBudget, rowAssetUrl, storeRowAssetUrl, type RowAssetUrl } from "src/ts/storage/assetUrlGate";
    import RegexList from "src/lib/SideBars/Scripts/RegexList.svelte";
    import TriggerList from "src/lib/SideBars/Scripts/TriggerList.svelte";
    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import Help from "src/lib/Others/Help.svelte";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import { getFileSrc, saveAssetFromBlob, downloadFile, pickedAssetLimitBytes } from "src/ts/globalApi.svelte";
    import { reportRefusedAssets, splitByAssetLimit, warnRefusedAssets } from "src/ts/storage/pickedAssetLimit";
    import { alertNormal, alertError } from "src/ts/alert";
    import { exportRegex, importRegex } from "src/ts/process/scripts";
    import { selectMultipleFile, selectMultipleFileObjects } from "src/ts/util";
    
    import { DBState } from 'src/ts/stores.svelte';
    import { AssetList, toAssetList, toPlainAssetArray, type AssetTuple } from "src/ts/storage/assetList";
    import { untrack } from "svelte";
    import { isModuleStub } from "src/ts/storage/moduleStub";
  import { v4 } from "uuid";

    let submenu = $state(0)
    interface Props {
        currentModule: RisuModule;
    }

    let { currentModule = $bindable() }: Props = $props();
    let assetFileExtensions:string[] = $state([])
    let assetUrls:(RowAssetUrl|undefined)[] = $state([])

    // The previews depend on the asset paths and extensions only, so a rename
    // (which replaces the list but keeps every path) does not reload them.
    const assetPreviewKey = $derived.by(() => {
        if(!DBState.db.useAdditionalAssetsPreview || !currentModule?.assets){
            return null
        }
        return currentModule.assets.map((asset) => `${asset[1]}\u0000${asset[2] ?? ''}`).join('\u0001')
    })

    // Not reactive: it only numbers the runs of the effect below, so a run that was superseded cannot store a URL.
    let assetRunId = 0

    $effect.pre(() => {
        const runId = ++assetRunId
        if(assetPreviewKey === null){
            return
        }
        // One budget per run: the whole reads of the list's images together stay within the Android heap.
        const budget = createWholeReadBudget()
        untrack(() => {
            if(currentModule?.assets){
                for(let i = 0; i < currentModule.assets.length; i++){
                    if(currentModule.assets[i].length > 2 && currentModule.assets[i][2]) {
                        assetFileExtensions[i] = currentModule.assets[i][2]
                    } else
                        assetFileExtensions[i] = currentModule.assets[i][1].split('.').pop()
                    // An icon row shows a name box and needs no URL.
                    const use = assetListUse(assetListElement(assetFileExtensions[i]))
                    if(use !== null){
                        const path = currentModule.assets[i][1]
                        const urlPromise = use === 'whole' ? getFileSrc(path, use, budget) : getFileSrc(path, use)
                        urlPromise.then((url) => {
                            if(runId !== assetRunId){
                                return
                            }
                            // Read when the URL settles: the row may name another asset by now.
                            const nowPath = currentModule?.assets?.[i]?.[1]
                            const nowUse = assetListUse(assetListElement(assetFileExtensions[i]))
                            storeRowAssetUrl(assetUrls, i, { path, use, url }, nowPath, nowUse)
                        })
                    }
                }
            }
        })
    });

    // A module's asset list is replaced, never edited in place: an installed
    // `AssetList` is not reactive, so only an assignment re-renders and schedules
    // a save.
    function currentAssetTuples(): AssetTuple[] {
        const list = currentModule.assets ?? []
        return list instanceof AssetList ? toPlainAssetArray(list) : $state.snapshot(list)
    }

    function commitAssets(next: AssetTuple[]){
        currentModule.assets = toAssetList(next)
    }

    function renameAsset(index: number, name: string){
        const next = currentAssetTuples()
        if(!next[index]){
            return
        }
        const row = [...next[index]] as AssetTuple
        row[0] = name
        next[index] = row
        commitAssets(next)
    }

    function removeAsset(index: number){
        const next = currentAssetTuples()
        next.splice(index, 1)
        commitAssets(next)
    }

    function addLorebook(){
        if(Array.isArray(currentModule.lorebook)){
            currentModule.lorebook.push({
                key: '',
                comment: `New Lore`,
                content: '',
                mode: 'normal',
                insertorder: 100,
                alwaysActive: false,
                secondkey: "",
                selective: false
            })

            currentModule.lorebook = currentModule.lorebook
        }
    }

    function addLorebookFolder(){
        if(Array.isArray(currentModule.lorebook)){
            const id = v4()
            currentModule.lorebook.push({
                key: '\uf000folder:' + id,
                comment: `New Folder`,
                content: '',
                mode: 'folder',
                insertorder: 100,
                alwaysActive: false,
                secondkey: "",
                selective: false,
            })

            currentModule.lorebook = currentModule.lorebook
        }
    }

    async function exportLoreBook(){
        try {
            const lore = currentModule.lorebook        
            const stringl = Buffer.from(JSON.stringify({
                type: 'risu',
                ver: 1,
                data: lore
            }), 'utf-8')

            await downloadFile(`lorebook_export.json`, stringl)

            alertNormal(language.successExport)
        } catch (error) {
            alertError(`${error}`)
        }
    }

    async function importLoreBook(){
        let lore = currentModule.lorebook
        const lorebook = (await selectMultipleFile(['json', 'lorebook']))
        if(!lorebook){
            return
        }
        try {
            for(const f of lorebook){
                const importedlore = JSON.parse(Buffer.from(f.data).toString('utf-8'))
                if(importedlore.type === 'risu' && importedlore.data){
                    const datas:loreBook[] = importedlore.data
                    for(const data of datas){
                        lore.push(data)
                    }
                }
                else if(importedlore.entries){
                    const entries:{[key:string]:CCLorebook} = importedlore.entries
                    lore.push(...convertExternalLorebook(entries))
                }
            }
        } catch (error) {
            alertError(`${error}`)
        }
    }

    function addRegex(){
        if(Array.isArray(currentModule.regex)){
            currentModule.regex.push({
                comment: "",
                in: "",
                out: "",
                type: "editinput"
            })

            currentModule.regex = currentModule.regex
        }
    }

    function addTrigger(){
        if(Array.isArray(currentModule.trigger)){
            currentModule.trigger.push({
                conditions: [],
                type: 'start',
                comment: '',
                effect: []
            })

            currentModule.trigger = currentModule.trigger
        }
    }
</script>

<!-- A module stub has no body arrays; the tabs would create them on the stub. -->
{#if !isModuleStub(currentModule)}
<div class="flex w-full rounded-md border border-darkborderc mb-4 overflow-x-auto h-16 min-h-16 overflow-y-clip">
    <button onclick={() => {
        submenu = 0
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 0}>
        <span>{language.basicInfo}</span>
    </button>
    <button onclick={() => {
        currentModule.lorebook ??= []
        submenu = 1
    }} class="p2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 1}>
        <span>{language.loreBook}</span>
    </button>
    <button onclick={() => {
        currentModule.regex ??= []
        submenu = 2
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 2}>
        <span>{language.regexScript}</span>
    </button>
    <button onclick={() => {
        currentModule.trigger ??= [{
            comment: "",
            type: "manual",
            conditions: [],
            effect: [{
                type: "v2Header",
                code: "",
                indent: 0
            }]
        }, {
            comment: "New Event",
            type: 'manual',
            conditions: [],
            effect: []
        }]
        submenu = 3
    }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 3}>
        <span>{language.triggerScript}</span>
    </button>
    <button onclick={() => {
        if(!currentModule.assets){
            commitAssets([])
        }
        submenu = 5
    }} class="p-2 flex-1" class:bg-darkbutton={submenu === 5}>
        <span>{language.additionalAssets}</span>
    </button>
</div>

{#if submenu === 0}
    <span>{language.name}</span>
    <TextInput bind:value={currentModule.name} className="mt-1"/>
    <span class="mt-4">{language.description}</span>
    <TextInput bind:value={currentModule.description} className="mt-1" size="sm"/>
    <span class="mt-4">{language.namespace} <Help key="namespace" /></span>
    <TextInput bind:value={currentModule.namespace} className="mt-1" size="sm"/>
    <div class="flex items-center mt-4">
        <Check bind:check={() => currentModule.hideIcon ?? false, (v) => currentModule.hideIcon = v} name={language.hideChatIcon}/>
    </div>
    <span class="mt-4">{language.customPromptTemplateToggle} <Help key='customPromptTemplateToggle' /></span>
    <TextAreaInput bind:value={currentModule.customModuleToggle}/>
{/if}
{#if submenu === 1 && (Array.isArray(currentModule.lorebook))}
    <LoreBookList externalLoreBooks={currentModule.lorebook} />
    <div class="text-textcolor2 mt-2 flex">
        <button onclick={() => {addLorebook()}} class="hover:text-textcolor cursor-pointer ml-1">
            <PlusIcon />
        </button>
        <button onclick={() => {exportLoreBook()}} class="hover:text-textcolor cursor-pointer ml-2">
            <DownloadIcon />
        </button>
        <button onclick={() => {
            addLorebookFolder()
        }} class="hover:text-textcolor ml-2  cursor-pointer">
            <FolderPlusIcon />
        </button>
        <button onclick={() => {importLoreBook()}} class="hover:text-textcolor cursor-pointer ml-2">
            <HardDriveUploadIcon />
        </button>
    </div>
{/if}

{#if submenu === 2 && (Array.isArray(currentModule.regex))}
    <TextAreaInput bind:value={currentModule.backgroundEmbedding} className="mt-2" placeholder={language.backgroundHTML} size="sm"/>
    <RegexList bind:value={currentModule.regex}/>
    <div class="text-textcolor2 mt-2 flex gap-2">
        <button class="font-medium cursor-pointer hover:text-green-500" onclick={() => {
            addRegex()
        }}><PlusIcon /></button>
        <button class="font-medium cursor-pointer hover:text-green-500" onclick={() => {
            exportRegex(currentModule.regex)
        }}><DownloadIcon /></button>
        <button class="font-medium cursor-pointer hover:text-green-500" onclick={async () => {
            currentModule.regex = await importRegex(currentModule.regex)
        }}><HardDriveUploadIcon /></button>
    </div>
{/if}

{#if submenu === 5 && (Array.isArray(currentModule.assets))}
    <div class="w-full max-w-full border border-selected rounded-md p-2">
        <table class="contain w-full max-w-full tabler mt-2">
            <tbody>
            <tr>
                <th class="font-medium">{language.value}</th>
                <th class="font-medium cursor-pointer w-10">
                    <button class="hover:text-green-500" onclick={async () => {
                        const da = await selectMultipleFileObjects(['png', 'webp', 'mp4', 'mp3', 'gif', 'jpeg', 'jpg', 'ttf', 'otf', 'css', 'webm', 'woff', 'woff2', 'svg', 'avif'])
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
                                const name = f.name
                                const extension = name.split('.').pop().toLowerCase()
                                const imgp = await saveAssetFromBlob(f, extension)
                                // The list is read again after the await, so an asset
                                // added while this one was uploading is kept.
                                commitAssets([...currentAssetTuples(), [name, imgp, extension]])
                            }
                        } catch (error) {
                            warnRefusedAssets(refused, limit)
                            throw error
                        } finally {
                            busy.end()
                        }
                        reportRefusedAssets(refused, limit)
                    }}>
                        <PlusIcon />
                    </button>
                </th>
            </tr>
            {#if (!currentModule.assets) || currentModule.assets.length === 0}
                <tr>
                    <td colspan="3">{language.noData}</td>
                </tr>
            {:else}
                {#each currentModule.assets as assets, i}
                    <tr>
                        <td class="font-medium truncate">
                            {#if DBState.db.useAdditionalAssetsPreview}
                                {@const element = assetListElement(assetFileExtensions[i])}
                                {@const url = rowAssetUrl(assetUrls[i], assets[1], assetListUse(element))}
                                <!-- A URL still being made, or made for another asset or use, is undefined and shows nothing; '' is a URL that was withheld or could not be made, and shows the name box. -->
                                {#if element === 'icon' || url === ''}
                                    <div class='w-16 h-16 m-1 rounded-md bg-slate-500 flex flex-col justify-center items-center'>
                                        <FileMusicIcon/>
                                        <div class='w-16 px-1 text-ellipsis whitespace-nowrap overflow-hidden'>{assets[0]}</div>
                                    </div>
                                {:else if url}
                                    {#if element === 'video'}
                                    <!-- svelte-ignore a11y_media_has_caption -->
                                        <video controls class="mt-2 px-2 w-full m-1 rounded-md"><source src={url} type="video/mp4"></video>
                                    {:else if element === 'audio'}
                                        <audio controls class="mt-2 px-2 w-full h-16 m-1 rounded-md" loop><source src={url} type="audio/mpeg"></audio>
                                    {:else}
                                        <img src={url} class="w-16 h-16 m-1 rounded-md" alt={assets[0]}/>
                                    {/if}
                                {/if}
                            {/if}
                            <TextInput fullwidth size="sm" marginBottom bind:value={() => assets[0], (name) => renameAsset(i, name)} placeholder="..." />
                        </td>
                        
                        <th class="font-medium cursor-pointer w-10">
                            <button class="hover:text-green-500" onclick={() => {
                                removeAsset(i)
                            }}>
                                <TrashIcon />
                            </button>
                        </th>
                    </tr>
                {/each}
            {/if}
            </tbody>
        </table>
    </div>
{/if}

{#if submenu === 3 && (Array.isArray(currentModule.trigger))}
    <TriggerList bind:value={currentModule.trigger} lowLevelAble={currentModule.lowLevelAccess} />

    <div class="flex items-center mt-4">
        <Check bind:check={() => currentModule.lowLevelAccess ?? false, (v) => currentModule.lowLevelAccess = v} name={language.lowLevelAccess}/>
        <span> <Help key="lowLevelAccess" name={language.lowLevelAccess}/></span>
    </div>
{/if}
{/if}