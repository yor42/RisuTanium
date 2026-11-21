<script lang="ts">
    import { warnOnReject } from "src/ts/warnOnReject";
    import { language } from "../../lang";
    import { tokenizeAccurate } from "../../ts/tokenizer";
    import { getCurrentCharacter, type character, type groupChat } from "../../ts/storage/database.svelte";
    import { DBState } from 'src/ts/stores.svelte';
    import { untrack } from 'svelte';
    import { CharConfigSubMenu, selectedCharID, hypaV3ModalOpen } from "../../ts/stores.svelte";
    import { PlusIcon, SmileIcon, TrashIcon, UserIcon, ActivityIcon, BookIcon, User, Braces, Volume2Icon, DownloadIcon, HardDriveUploadIcon, Share2Icon, ImageIcon, ImageOffIcon, ArrowUp, ArrowDown, FileMusicIcon } from '@lucide/svelte'
    import { assetListElement, assetListUse, createWholeReadBudget, rowAssetUrl, storeRowAssetUrl, type RowAssetUrl, type WholeReadBudget } from 'src/ts/storage/assetUrlGate'
    import Check from "../UI/GUI/CheckInput.svelte";
    import { useCharImageLookups } from "../../ts/media/charImageLookups";
    import { addCharEmotion, addingEmotion, getCharImage, rmCharEmotion, selectCharImg, makeGroupImage, removeChar, changeCharImage } from "../../ts/characters";
    import { postTrashUndo } from "../../ts/libraryUndo";
    import LoreBook from "./LoreBook/LoreBookSetting.svelte";
    import { alertConfirm, alertError, alertNormal, showHypaV2Alert } from "../../ts/alert";
    import { SecretRefError } from "src/ts/secretRef";
    import BarIcon from "./BarIcon.svelte";
    import { findCharacterbyId, getAuthorNoteDefaultText, selectMultipleFileObjects, selectSingleFileObject } from "../../ts/util";
    import { beginBusy } from "../../ts/process/memory/busyActions";
    import Help from "../Others/Help.svelte";
    import { exportChar, openRealmUpload } from "src/ts/characterCards";
    import { fetchFishSpeechModels, getElevenTTSVoices, getWebSpeechTTSVoices, getVOICEVOXVoices, oaiVoices, getNovelAIVoices } from "src/ts/process/tts";
    import { createFishSpeechDefaults, createNovelAIVoiceDefaults } from "src/ts/process/ttsDefaults";
    import { getFileSrc, pickedAssetLimitBytes, saveAssetFromBlob } from "src/ts/globalApi.svelte";
    import { reportRefusedAssets, splitByAssetLimit, warnRefusedAssets } from "src/ts/storage/pickedAssetLimit";
    import { addGroupChar, rmCharFromGroup } from "src/ts/process/group";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import NumberInput from "../UI/GUI/NumberInput.svelte";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import Button from "../UI/GUI/Button.svelte";
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import OptionInput from "../UI/GUI/OptionInput.svelte";
    import RegexList from "./Scripts/RegexList.svelte";
    import TriggerList from "./Scripts/TriggerList.svelte";
    import CheckInput from "../UI/GUI/CheckInput.svelte";
    import { updateInlayScreen } from "src/ts/process/inlayScreen";
    import { registerOnnxModel } from "src/ts/process/transformers";
    import MultiLangInput from "../UI/GUI/MultiLangInput.svelte";
    import { applyModule } from "src/ts/process/modules";
    import { exportRegex, importRegex } from "src/ts/process/scripts";
    import SliderInput from "../UI/GUI/SliderInput.svelte";
    import Toggles from "./Toggles.svelte";
    import { convertCharacterToModule } from "src/ts/interchangeability";
    import { writeLiveCharacter } from "src/ts/liveCharacterWrite";
    import StudioEntryRow from "../Studio/StudioEntryRow.svelte";
    import StudioToggleLink from "../Studio/StudioToggleLink.svelte";

    interface Props {
        // The Studio row sits at the top; a host that already offers Studio itself passes false.
        studioEntry?: boolean;
    }

    let { studioEntry = true }: Props = $props();
    const uid = $props.id()

    // One hold per image position (group member, group icon, character icon, additional icon row); they end with the page.
    const lookups = useCharImageLookups();

    let iconRemoveMode = $state(false)
    let viewSubMenu = $state(0)
    let emos:[string, string][] = $state([])
    let iconButtonSize = window.innerWidth > 360 ? 24 as const : 20 as const
    let tokens = $state({
        desc: 0,
        firstMsg: 0,
        localNote: 0,
        charaNote: 0
    })

    let lasttokens = {
        desc: '',
        firstMsg: '',
        localNote: '',
        charaNote: ''
    }

    async function loadTokenize(
        desc: string | null,
        firstMsg: string | null,
        localNote: string
    ) {
        if (desc !== null && lasttokens.desc !== desc) {
            lasttokens.desc = desc
            tokens.desc = await tokenizeAccurate(desc)
        }
        if (firstMsg !== null && lasttokens.firstMsg !== firstMsg) {
            lasttokens.firstMsg = firstMsg
            tokens.firstMsg = await tokenizeAccurate(firstMsg)
        }
        if (lasttokens.localNote !== localNote) {
            lasttokens.localNote = localNote
            tokens.localNote = await tokenizeAccurate(localNote)
        }
    }


    let assetFileExtensions:string[] = $state([])
    let assetUrls:(RowAssetUrl|undefined)[] = $state([])
    let licensed = $state((DBState.db.characters[$selectedCharID].type === 'character') ? (DBState.db.characters[$selectedCharID] as character).license : '')

    $effect.pre(() => {
        emos = DBState.db.characters[$selectedCharID].emotionImages
    });

    $effect.pre(() => {
        const chara = DBState.db.characters[$selectedCharID]
        const desc = chara.type !== 'group' ? (chara as character).desc : null
        const firstMsg = chara.type !== 'group' ? chara.firstMessage : null
        const localNote = chara.chats[chara.chatPage].note

        untrack(() => {
            loadTokenize(desc, firstMsg, localNote)
        })
    });

    // Not reactive: it only numbers the runs of the effect below, so a run that was superseded cannot store a URL.
    let assetRunId = 0

    $effect.pre(() => {
        const runId = ++assetRunId
        // One budget per run: the whole reads of the list's images together stay within the Android heap.
        const budget = createWholeReadBudget()
        if(DBState.db.characters[$selectedCharID].type ==='character' && DBState.db.useAdditionalAssetsPreview){
            if((DBState.db.characters[$selectedCharID] as character).additionalAssets){
                for(let i = 0; i < (DBState.db.characters[$selectedCharID] as character).additionalAssets.length; i++){
                    if((DBState.db.characters[$selectedCharID] as character).additionalAssets[i].length > 2 && (DBState.db.characters[$selectedCharID] as character).additionalAssets[i][2]) {
                        assetFileExtensions[i] = (DBState.db.characters[$selectedCharID] as character).additionalAssets[i][2]
                    } else
                        assetFileExtensions[i] = (DBState.db.characters[$selectedCharID] as character).additionalAssets[i][1].split('.').pop()
                    const use = assetListUse(assetListElement(assetFileExtensions[i], { knownImagesOnly: true }))
                    if(use !== null){
                        const path = (DBState.db.characters[$selectedCharID] as character).additionalAssets[i][1]
                        const urlPromise = use === 'whole' ? getFileSrc(path, use, budget) : getFileSrc(path, use)
                        urlPromise.then((url) => {
                            if(runId !== assetRunId){
                                return
                            }
                            // Read when the URL settles: the row may name another asset by now.
                            const nowChar = DBState.db.characters[$selectedCharID]
                            const nowPath = nowChar?.type === 'character' ? nowChar.additionalAssets?.[i]?.[1] : undefined
                            const nowUse = assetListUse(assetListElement(assetFileExtensions[i], { knownImagesOnly: true }))
                            storeRowAssetUrl(assetUrls, i, { path, use, url }, nowPath, nowUse)
                        })
                    }
                }
            }
        }
    });

    let emotionUrls:(RowAssetUrl|undefined)[] = $state([])
    // Not reactive: it only numbers the runs of the emotion effect below.
    let emotionRunId = 0

    // The full-size image of an emotion row: like `getCharImage(loc, 'plain')`, but a whole read joins the run's budget.
    async function emotionImageSrc(loc:string, budget:WholeReadBudget):Promise<string|null> {
        if(DBState.db.hideAllImages || !loc){
            return await getCharImage(loc, 'plain')
        }
        return await getFileSrc(loc, 'whole', budget)
    }

    $effect.pre(() => {
        const runId = ++emotionRunId
        // One budget per run of the table, joined in row order.
        const budget = createWholeReadBudget()
        if($CharConfigSubMenu !== 1 || viewSubMenu !== 1){
            return
        }
        const chara = DBState.db.characters[$selectedCharID]
        if(chara.type === 'group' || chara.viewScreen !== 'emotion' || !chara.emotionImages){
            return
        }
        for(let i = 0; i < chara.emotionImages.length; i++){
            const path = chara.emotionImages[i][1]
            const settled = emotionImageSrc(path, budget).then((url) => {
                if(runId !== emotionRunId || url === null){
                    return
                }
                // Read when the URL settles: the row may name another image by now.
                const nowChar = DBState.db.characters[$selectedCharID]
                const nowPath = nowChar?.type === 'character' ? nowChar.emotionImages?.[i]?.[1] : undefined
                storeRowAssetUrl(emotionUrls, i, { path, use: 'whole', url }, nowPath, 'whole')
            })
            // warnOnReject logs a rejection once; the row then stays blank.
            Promise.resolve(warnOnReject('CharConfig: emotion image rejected', settled)).catch(() => {})
        }
    });

    $effect.pre(() => {
        licensed = (DBState.db.characters[$selectedCharID].type === 'character') ? (DBState.db.characters[$selectedCharID] as character).license : ''
    });
    $effect.pre(() => {
        if (DBState.db.characters[$selectedCharID].ttsMode === 'novelai' && (DBState.db.characters[$selectedCharID] as character).naittsConfig === undefined) {
            (DBState.db.characters[$selectedCharID] as character).naittsConfig = createNovelAIVoiceDefaults();
        }
    });
    $effect.pre(() => {
        if (DBState.db.characters[$selectedCharID].ttsMode === 'gptsovits' && (DBState.db.characters[$selectedCharID] as character).gptSoVitsConfig === undefined) {
            (DBState.db.characters[$selectedCharID] as character).gptSoVitsConfig = {
                url: '',
                use_auto_path: false,
                ref_audio_path: '',
                use_long_audio: false,
                ref_audio_data: {
                    fileName: '',
                    assetId: ''  
                },
                volume: 1.0,
                text_lang: 'auto',
                text: 'en',
                use_prompt: false,
                prompt_lang: 'en',
                top_p: 1,
                temperature: 0.7,
                speed: 1,
                top_k: 5,
                text_split_method: 'cut0',
            };
        }
    });

    let fishSpeechModels:{
        _id:string,
        title:string,
        description:string
    }[] = $state([])

    $effect.pre(() => {
        if (DBState.db.characters[$selectedCharID].ttsMode === 'fishspeech' && (DBState.db.characters[$selectedCharID] as character).fishSpeechConfig === undefined) {
            (DBState.db.characters[$selectedCharID] as character).fishSpeechConfig = createFishSpeechDefaults();
        }
    });

    $effect.pre(() => {
        if (DBState.db.characters[$selectedCharID].ttsMode === 'openai' && (DBState.db.characters[$selectedCharID] as character).oaiTTSConfig === undefined) {
            (DBState.db.characters[$selectedCharID] as character).oaiTTSConfig = {
                enabled: false,
                format: 'mp3',
            };
        }
    });

    $effect.pre(() => {
        if(DBState.db.characters[$selectedCharID].type === 'group' && ($CharConfigSubMenu === 4 || $CharConfigSubMenu === 5)){
            $CharConfigSubMenu = 0
        }

    });

    // The forms bind directly to these configs, and blocks can update before
    // $effect.pre runs, so hold a form back until the effects above have created its config.
    const ttsConfigReady = $derived.by(() => {
        const chara = DBState.db.characters[$selectedCharID] as character
        switch (chara.ttsMode) {
            case 'novelai': return chara.naittsConfig !== undefined
            case 'gptsovits': return chara.gptSoVitsConfig !== undefined
            case 'fishspeech': return chara.fishSpeechConfig !== undefined
            case 'openai': return chara.oaiTTSConfig !== undefined
            default: return true
        }
    })

    async function getFishSpeechModels() {
        try {
            fishSpeechModels = await fetchFishSpeechModels(DBState.db.fishSpeechKey);
        } catch (error) {
            if (error instanceof SecretRefError) {
                alertError(error.message);
            } else {
                console.error('Error fetching fish speech models:', error);
            }
            fishSpeechModels = [];
        }
    }

    function moveAlternateGreetingUp(index: number) {
        if(index === 0) return
        if(DBState.db.characters[$selectedCharID].type === 'character'){
            let alternateGreetings = DBState.db.characters[$selectedCharID].alternateGreetings
            let temp = alternateGreetings[index]
            alternateGreetings[index] = alternateGreetings[index - 1]
            alternateGreetings[index - 1] = temp
            DBState.db.characters[$selectedCharID].alternateGreetings = alternateGreetings
        }
    }

    function moveAlternateGreetingDown(index: number) {
        if(index === DBState.db.characters[$selectedCharID].alternateGreetings.length - 1) return
        if(DBState.db.characters[$selectedCharID].type === 'character'){
            let alternateGreetings = DBState.db.characters[$selectedCharID].alternateGreetings
            let temp = alternateGreetings[index]
            alternateGreetings[index] = alternateGreetings[index + 1]
            alternateGreetings[index + 1] = temp
            DBState.db.characters[$selectedCharID].alternateGreetings = alternateGreetings
        }
    }

</script>

{#if studioEntry}
    <StudioEntryRow />
{/if}

{#if licensed !== 'private'}
    <div class="flex mb-2" class:gap-2={iconButtonSize === 24} class:gap-1={iconButtonSize < 24}>
        <button class={$CharConfigSubMenu === 0 ? 'text-textcolor ' : 'text-textcolor2'} aria-label={language.basicInfo} title={language.basicInfo} aria-current={$CharConfigSubMenu === 0 ? 'true' : undefined} onclick={() => {$CharConfigSubMenu = 0}}>
            <UserIcon size={iconButtonSize} aria-hidden="true" />
        </button>
        <button class={$CharConfigSubMenu === 1 ? 'text-textcolor' : 'text-textcolor2'} aria-label={language.characterDisplay} title={language.characterDisplay} aria-current={$CharConfigSubMenu === 1 ? 'true' : undefined} onclick={() => {$CharConfigSubMenu = 1}}>
            <SmileIcon size={iconButtonSize} aria-hidden="true" />
        </button>
        <button class={$CharConfigSubMenu === 3 ? 'text-textcolor' : 'text-textcolor2'} aria-label={language.loreBook} title={language.loreBook} aria-current={$CharConfigSubMenu === 3 ? 'true' : undefined} onclick={() => {$CharConfigSubMenu = 3}}>
            <BookIcon size={iconButtonSize} aria-hidden="true" />
        </button>
        {#if DBState.db.characters[$selectedCharID].type === 'character'}
            <button class={$CharConfigSubMenu === 5 ? 'text-textcolor' : 'text-textcolor2'} aria-label={language.Speech} title={language.Speech} aria-current={$CharConfigSubMenu === 5 ? 'true' : undefined} onclick={() => {$CharConfigSubMenu = 5}}>
                <Volume2Icon size={iconButtonSize} aria-hidden="true" />
            </button>
            <button class={$CharConfigSubMenu === 4 ? 'text-textcolor' : 'text-textcolor2'} aria-label={language.scripts} title={language.scripts} aria-current={$CharConfigSubMenu === 4 ? 'true' : undefined} onclick={() => {$CharConfigSubMenu = 4}}>
                <Braces size={iconButtonSize} aria-hidden="true" />
            </button>
        {/if}
        <button class={$CharConfigSubMenu === 2 ? 'text-textcolor' : 'text-textcolor2'} aria-label={language.advancedSettings} title={language.advancedSettings} aria-current={$CharConfigSubMenu === 2 ? 'true' : undefined} onclick={() => {$CharConfigSubMenu = 2}}>
            <ActivityIcon size={iconButtonSize} aria-hidden="true" />
        </button>
        {#if DBState.db.characters[$selectedCharID].type === 'character'}
            <button class={$CharConfigSubMenu === 6 ? 'text-textcolor' : 'text-textcolor2'} aria-label={language.shareExport} title={language.shareExport} aria-current={$CharConfigSubMenu === 6 ? 'true' : undefined} onclick={() => {$CharConfigSubMenu = 6}}>
                <Share2Icon size={iconButtonSize} aria-hidden="true" />
            </button>
        {/if}
    </div>
{/if}


{#if $CharConfigSubMenu === 0}
    {#if DBState.db.characters[$selectedCharID].type !== 'group' && licensed !== 'private'}
        <TextInput size="xl" marginBottom placeholder={language.sidebarUi.characterName} label={language.sidebarUi.characterName} bind:value={DBState.db.characters[$selectedCharID].name} />
        <span class="text-textcolor"><span id="{uid}-desc">{language.description}</span> <Help key="charDesc"/></span>
        <TextAreaInput highlight margin="both" autocomplete="off" labelId="{uid}-desc" bind:value={(DBState.db.characters[$selectedCharID] as character).desc}></TextAreaInput>
        <span class="text-textcolor2 mb-6 text-sm">{tokens.desc} {language.tokens}</span>
        <span class="text-textcolor"><span id="{uid}-first-message">{language.firstMessage}</span> <Help key="charFirstMessage"/></span>
        <TextAreaInput highlight margin="both" autocomplete="off" labelId="{uid}-first-message" bind:value={DBState.db.characters[$selectedCharID].firstMessage}></TextAreaInput>
        <span class="text-textcolor2 mb-6 text-sm">{tokens.firstMsg} {language.tokens}</span>

    {:else if licensed !== 'private' && DBState.db.characters[$selectedCharID].type === 'group'}
        <TextInput size="xl" marginBottom placeholder={language.sidebarUi.groupName} label={language.sidebarUi.groupName} bind:value={DBState.db.characters[$selectedCharID].name} />
        <span class="text-textcolor">{language.character}</span>
        <div class="p-4 gap-2 bg-bgcolor rounded-lg char-grid">
            {#if (DBState.db.characters[$selectedCharID] as groupChat).characters.length === 0}
                <span class="text-textcolor2">{language.sidebarUi.noCharacter}</span>
            {:else}
                <div></div>
                <div class="text-center">{language.talkness}</div>
                <div class="text-center">{language.active}</div>
                {#each (DBState.db.characters[$selectedCharID] as groupChat).characters as char, i}
                    {#await warnOnReject('CharConfig: group member icon rejected', lookups.get('member:' + i, findCharacterbyId(char).image, 'css'))}
                        <BarIcon label={language.remove} onClick={() => {
                            rmCharFromGroup(i)
                        }}>
                            <User aria-hidden="true"/>
                        </BarIcon>
                    {:then im}
                        <BarIcon label={language.remove} onClick={() => {
                            rmCharFromGroup(i)
                        }} additionalStyle={im} />
                    {:catch}
                        <BarIcon label={language.remove} onClick={() => {
                            rmCharFromGroup(i)
                        }}>
                            <User aria-hidden="true"/>
                        </BarIcon>
                    {/await}
                    <div class="flex items-center px-2 py-3">
                        {#each [1,2,3,4,5,6] as barIndex}
                            <button class="h-full flex-1 border-r-bgcolor border-r"
                                aria-label={language.groupTalkLevel(barIndex)}
                                class:bg-textcolor2={(DBState.db.characters[$selectedCharID] as groupChat).characterTalks[i] >= (1 / 6 * barIndex)}
                                class:bg-selected={(DBState.db.characters[$selectedCharID] as groupChat).characterTalks[i] < (1 / 6 * barIndex)}
                                class:rounded-l-lg={barIndex === 1}
                                class:rounded-r-lg={barIndex === 6}
                                onclick={() => {
                                    if(DBState.db.characters[$selectedCharID].type === 'group'){
                                        (DBState.db.characters[$selectedCharID] as groupChat).characterTalks[i] = (1 / 6 * barIndex)
                                    }
                                }}
                            ></button>
                        {/each}
                    </div>
                    <div class="flex items-center justify-center">
                        <Check margin={false} label={findCharacterbyId(char).name} bind:check={(DBState.db.characters[$selectedCharID] as groupChat).characterActive[i]} />
                    </div>
                {/each}
            {/if}
        </div>
        <div class="text-textcolor2 mt-1 flex mb-6">
            <button onclick={addGroupChar} aria-label={language.addCharacter} title={language.addCharacter} class="hover:text-textcolor cursor-pointer">
                <PlusIcon aria-hidden="true" />
            </button>
        </div>

    {/if}
    <span class="text-textcolor"><span id="{uid}-author-note">{language.authorNote}</span> <Help key="chatNote"/></span>
    <TextAreaInput
        margin="both"
        autocomplete="off"
        labelId="{uid}-author-note"
        bind:value={DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].note}
        highlight
        placeholder={getAuthorNoteDefaultText()}
    />
    <span class="text-textcolor2 mb-6 text-sm">{tokens.localNote} {language.tokens}</span>

    <Toggles bind:chara={DBState.db.characters[$selectedCharID]} noContainer />

    {#if DBState.db.characters[$selectedCharID].type === 'group'}
        <div class="flex mt-2 items-center">
            <Check bind:check={() => (DBState.db.characters[$selectedCharID] as groupChat).orderByOrder ?? false, (v) => (DBState.db.characters[$selectedCharID] as groupChat).orderByOrder = v} name={language.orderByOrder}/>
        </div>
    {/if}
{:else if licensed === 'private'}
    <span>{language.sidebarUi.notAllowed}</span>
    {(() => {
        $CharConfigSubMenu = 0
    })()}
{:else if $CharConfigSubMenu === 1}
    <h2 class="mb-2 text-2xl font-bold mt-2">{language.characterDisplay}</h2>

    <div class="flex w-full rounded-md border border-selected mb-4">
        <button onclick={() => {
            viewSubMenu = 0
        }} class="p-2 flex-1" class:bg-selected={viewSubMenu === 0}>
            <span>{DBState.db.characters[$selectedCharID].type !== 'group' ? language.charIcon : language.groupIcon}</span>
        </button>
        <button onclick={() => {
            viewSubMenu = 1
        }} class="p2 flex-1 border-r border-l border-selected" class:bg-selected={viewSubMenu === 1}>
            <span>{language.viewScreen}</span>
        </button>
        <button onclick={() => {
            viewSubMenu = 2
        }} class="p-2 flex-1" class:bg-selected={viewSubMenu === 2}>
            <span>{language.additionalAssets}</span>
        </button>
    </div>

    {#if viewSubMenu === 0}
        {#if DBState.db.characters[$selectedCharID].type === 'group'}
            <button aria-label={language.groupIcon} onclick={async () => {await selectCharImg($selectedCharID)}}>
                {#await warnOnReject('CharConfig: group icon rejected', lookups.get('groupIcon', DBState.db.characters[$selectedCharID].image, 'css'))}
                    <div class="rounded-md h-24 w-24 shadow-lg bg-textcolor2 cursor-pointer ring-3"></div>
                {:then im}
                    <div class="rounded-md h-24 w-24 shadow-lg bg-textcolor2 cursor-pointer ring-3" style={im}></div>
                {:catch}
                    <div class="rounded-md h-24 w-24 shadow-lg bg-textcolor2 cursor-pointer ring-3"></div>
                {/await}
            </button>
        {:else}
            <div class="p-2 border-darkborderc border rounded-md flex flex-wrap gap-2">
                {#if DBState.db.characters[$selectedCharID].image !== '' && DBState.db.characters[$selectedCharID].image}
                    <button aria-label={language.charIcon} onclick={() => {
                        if(
                            DBState.db.characters[$selectedCharID].type === 'character' &&
                            DBState.db.characters[$selectedCharID].image !== '' &&
                            DBState.db.characters[$selectedCharID].image &&
                            iconRemoveMode
                        ){
                            DBState.db.characters[$selectedCharID].image = ''
                            if((DBState.db.characters[$selectedCharID] as character).ccAssets && (DBState.db.characters[$selectedCharID] as character).ccAssets.length > 0){
                                changeCharImage($selectedCharID, 0)
                            }
                            iconRemoveMode = false
                        }
                    }}>
                        {#await warnOnReject('CharConfig: character icon rejected', lookups.get('charIcon', DBState.db.characters[$selectedCharID].image, (DBState.db.characters[$selectedCharID] as character).largePortrait ? 'lgcss' : 'css'))}
                            <div
                                class="rounded-md h-24 w-24 shadow-lg bg-textcolor2 cursor-pointer ring-3 transition-shadow"
                                class:ring-draculared={iconRemoveMode}
    ></div>
                        {:then im}
                            <div
                                class="rounded-md h-24 w-24 shadow-lg bg-textcolor2 cursor-pointer ring-3 transition-shadow"
                                class:ring-draculared={iconRemoveMode}
                                style={im}
    ></div>
                        {:catch}
                            <div
                                class="rounded-md h-24 w-24 shadow-lg bg-textcolor2 cursor-pointer ring-3 transition-shadow"
                                class:ring-draculared={iconRemoveMode}
    ></div>
                        {/await}
                    </button>
                {/if}
                {#if (DBState.db.characters[$selectedCharID] as character).ccAssets}
                    {#each (DBState.db.characters[$selectedCharID] as character).ccAssets as assets, i}
                        <button aria-label={language.charIcon + ' ' + (i + 2)} onclick={async () => {
                            if(!iconRemoveMode){
                                changeCharImage($selectedCharID, i)
                            }
                            else if(DBState.db.characters[$selectedCharID].type === 'character'){
                                (DBState.db.characters[$selectedCharID] as character).ccAssets.splice(i, 1)
                                iconRemoveMode = false
                            }
                        }}>
                            {#await warnOnReject('CharConfig: additional asset icon rejected', lookups.get('asset:' + i, assets.uri, (DBState.db.characters[$selectedCharID] as character).largePortrait ? 'lgcss' : 'css'))}
                                <div
                                    class="rounded-md h-24 w-24 shadow-lg bg-textcolor2 cursor-pointer hover:ring-3 transition-shadow"
                                    class:ring-draculared={iconRemoveMode} class:ring-3={iconRemoveMode}
    ></div>
                            {:then im}
                                <div
                                    class="rounded-md h-24 w-24 shadow-lg bg-textcolor2 cursor-pointer hover:ring-3 transition-shadow"
                                    style={im} class:ring-draculared={iconRemoveMode} class:ring-3={iconRemoveMode}
    ></div>
                            {:catch}
                                <div
                                    class="rounded-md h-24 w-24 shadow-lg bg-textcolor2 cursor-pointer hover:ring-3 transition-shadow"
                                    class:ring-draculared={iconRemoveMode} class:ring-3={iconRemoveMode}
    ></div>
                            {/await}
                        </button>
                    {/each}
                {/if}
                <button aria-label={language.add} onclick={async () => {await selectCharImg($selectedCharID);}}>
                    <div
                        class="rounded-md h-24 w-24 cursor-pointer border-darkborderc border border-dashed flex justify-center items-center hover:border-borderc"
                        style={(DBState.db.characters[$selectedCharID] as character).largePortrait ? 'height: 10.66rem;' : ''}
                    >
                        <PlusIcon aria-hidden="true" />
                    </div>
                </button>
            </div>
            <div class="flex w-full items-end justify-end mt-2">
                <button class={iconRemoveMode ? "text-draculared rounded-sm ring-1 ring-borderc" : "text-textcolor2 hover:text-textcolor"} aria-label={language.removeIconsMode} aria-pressed={iconRemoveMode} onclick={() => {
                    iconRemoveMode = !iconRemoveMode
                }}>
                    <TrashIcon size="18" aria-hidden="true" />
                </button>
            </div>
        {/if}

        {#if DBState.db.characters[$selectedCharID].type === 'character' && DBState.db.characters[$selectedCharID].image !== ''}
            <div class="flex items-center mt-4">
                <Check bind:check={() => (DBState.db.characters[$selectedCharID] as character).largePortrait ?? false, (v) => (DBState.db.characters[$selectedCharID] as character).largePortrait = v} name={language.largePortrait}/>
            </div>
        {/if}

        {#if DBState.db.characters[$selectedCharID].type === 'group'}
            <Button onclick={makeGroupImage}>
                {language.createGroupImg}
            </Button>
        {/if}


    {:else if viewSubMenu === 1}
        <!-- svelte-ignore block_empty -->

        {#if DBState.db.characters[$selectedCharID].type !== 'group'}
            <SelectInput className="mb-2" label={language.viewScreen} bind:value={DBState.db.characters[$selectedCharID].viewScreen} onchange={() => {
                if(DBState.db.characters[$selectedCharID].type === 'character'){
                    DBState.db.characters[$selectedCharID] = updateInlayScreen((DBState.db.characters[$selectedCharID] as character))
                }
            }}>
                <OptionInput value="none">{language.none}</OptionInput>
                <OptionInput value="emotion">{language.emotionImage}</OptionInput>
                <OptionInput value="imggen">{language.imageGeneration}</OptionInput>
            </SelectInput>
        {:else}
            <SelectInput className="mb-2" label={language.viewScreen} bind:value={DBState.db.characters[$selectedCharID].viewScreen}>
                <OptionInput value="none">{language.none}</OptionInput>
                <OptionInput value="single">{language.singleView}</OptionInput>
                <OptionInput value="multiple">{language.SpacedView}</OptionInput>
                <OptionInput value="emp">{language.emphasizedView}</OptionInput>

            </SelectInput>
        {/if}

        {#if DBState.db.characters[$selectedCharID].viewScreen === 'emotion'}
            <span class="text-textcolor mt-6">{language.emotionImage} <Help key="emotion"/></span>
            <span class="text-textcolor2 text-xs">{language.emotionWarn}</span>

            <div class="w-full max-w-full border border-selected p-2 rounded-md">

                <table class="w-full max-w-full tabler">
                    <tbody>
                    <tr>
                        <th class="font-medium w-1/3">{language.image}</th>
                        <th class="font-medium w-1/2">{language.emotion}</th>
                        <th class="font-medium"></th>
                    </tr>
                    {#if DBState.db.characters[$selectedCharID].emotionImages.length === 0}
                        <tr>
                            <td colspan="3">{language.noImages}</td>
                        </tr>
                    {:else}
                        {#each emos as emo, i}
                            {@const emotionUrl = rowAssetUrl(emotionUrls[i], emo[1], 'whole')}
                            <tr>
                                <!-- A URL still being made, or made for another image, is undefined and shows an empty cell; '' is a URL that was withheld or could not be made, and shows the name box. -->
                                <td class="font-medium truncate w-1/3">
                                    {#if emotionUrl === ''}
                                        <div class='w-16 h-16 m-1 rounded-md bg-darkbutton flex flex-col justify-center items-center' data-part="asset-name-box">
                                            <FileMusicIcon aria-hidden="true"/>
                                            <div class='w-16 px-1 text-ellipsis whitespace-nowrap overflow-hidden'>{emo[0]}</div>
                                        </div>
                                    {:else if emotionUrl}
                                        <img src={emotionUrl} alt={language.sidebarUi.imageAlt} class="w-full">
                                    {/if}
                                </td>
                                <td class="font-medium truncate w-1/2">
                                    <TextInput marginBottom size='lg' label={language.emotion} bind:value={DBState.db.characters[$selectedCharID].emotionImages[i][0]} />
                                </td>
                                <td>
                                    <button class="font-medium cursor-pointer hover:text-textcolor2" aria-label={language.remove} onclick={() => {
                                        rmCharEmotion($selectedCharID,i)
                                    }}><TrashIcon aria-hidden="true" /></button>
                                </td>

                            </tr>
                        {/each}
                    {/if}
                    </tbody>
                </table>

            </div>

            <div class="text-textcolor2 hover:text-textcolor mt-2 flex">
                {#if !$addingEmotion}
                    <button class="cursor-pointer hover:text-textcolor" aria-label={language.add} onclick={() => {addCharEmotion($selectedCharID)}}>
                        <PlusIcon aria-hidden="true" />
                    </button>
                {:else}
                    <span>{language.loadingEllipsis}</span>
                {/if}
            </div>

            {#if (DBState.db.characters[$selectedCharID] as character).inlayViewScreen}
                <span id="{uid}-emotion-instructions" class="text-textcolor mt-2">{language.emotionInstructions}</span>
                <TextAreaInput highlight labelId="{uid}-emotion-instructions" bind:value={(DBState.db.characters[$selectedCharID] as character).newGenData.emotionInstructions} />
            {/if}

            <CheckInput bind:check={() => (DBState.db.characters[$selectedCharID] as character).inlayViewScreen ?? false, (v) => (DBState.db.characters[$selectedCharID] as character).inlayViewScreen = v} name={language.inlayViewScreen} onChange={() => {
                if(DBState.db.characters[$selectedCharID].type === 'character'){
                    if((DBState.db.characters[$selectedCharID] as character).inlayViewScreen && (DBState.db.characters[$selectedCharID] as character).additionalAssets === undefined){
                        (DBState.db.characters[$selectedCharID] as character).additionalAssets = []
                    }else if(!(DBState.db.characters[$selectedCharID] as character).inlayViewScreen && (DBState.db.characters[$selectedCharID] as character).additionalAssets.length === 0){
                        (DBState.db.characters[$selectedCharID] as character).additionalAssets = undefined
                    }
                    
                    DBState.db.characters[$selectedCharID] = updateInlayScreen((DBState.db.characters[$selectedCharID] as character))
                }
            }}/>
        {/if}
        {#if DBState.db.characters[$selectedCharID].viewScreen === 'imggen'}
            <span class="text-textcolor mt-6">{language.imageGeneration} <Help key="imggen"/></span>
            <span class="text-textcolor2 text-xs">{language.emotionWarn}</span>
            
            <span id="{uid}-img-prompt" class="text-textcolor mt-2">{language.imgGenPrompt}</span>
            <TextAreaInput highlight labelId="{uid}-img-prompt" bind:value={(DBState.db.characters[$selectedCharID] as character).newGenData.prompt} />
            <span id="{uid}-img-negatives" class="text-textcolor mt-2">{language.imgGenNegatives}</span>
            <TextAreaInput highlight labelId="{uid}-img-negatives" bind:value={(DBState.db.characters[$selectedCharID] as character).newGenData.negative} />
            <span id="{uid}-img-instructions" class="text-textcolor mt-2">{language.imgGenInstructions}</span>
            <TextAreaInput highlight labelId="{uid}-img-instructions" bind:value={(DBState.db.characters[$selectedCharID] as character).newGenData.instructions} />

            <CheckInput bind:check={() => (DBState.db.characters[$selectedCharID] as character).inlayViewScreen ?? false, (v) => (DBState.db.characters[$selectedCharID] as character).inlayViewScreen = v} name={language.inlayViewScreen} onChange={() => {
                if((DBState.db.characters[$selectedCharID] as character).type === 'character'){
                    (DBState.db.characters[$selectedCharID] as character) = updateInlayScreen((DBState.db.characters[$selectedCharID] as character))
                }
            }}/>
        {/if}
    {:else if viewSubMenu === 2}

            {#if DBState.db.newImageHandlingBeta}
            <CheckInput bind:check={() => DBState.db.characters[$selectedCharID].prebuiltAssetCommand ?? false, (v) => DBState.db.characters[$selectedCharID].prebuiltAssetCommand = v} name={language.insertAssetPrompt}/>

            <span id="{uid}-asset-style" class="text-textcolor mt-2">{language.assetStyle}</span>
            <SelectInput className="mb-2" labelId="{uid}-asset-style" bind:value={DBState.db.characters[$selectedCharID].prebuiltAssetStyle}>
                <OptionInput value="">{language.static}</OptionInput>
                <OptionInput value="dynamic">{language.dynamic}</OptionInput>
            </SelectInput>
            {/if}
            <div class="w-full max-w-full border border-selected rounded-md p-2 mt-2">
                <table class="contain w-full max-w-full tabler mt-2">
                <tbody>
                    <tr>
                        <th class="font-medium">{language.value}</th>
                        <th class="font-medium cursor-pointer w-10">
                            <button class="hover:text-textcolor2" aria-label={language.add} onclick={async () => {
                                if(DBState.db.characters[$selectedCharID].type === 'character'){
                                    const chaId = DBState.db.characters[$selectedCharID].chaId
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
                                            const landed = writeLiveCharacter(chaId, (c) => {
                                                if(c.type === 'character'){
                                                    c.additionalAssets ??= []
                                                    c.additionalAssets.push([name, imgp, extension])
                                                }
                                            })
                                            if(!landed){
                                                break
                                            }
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
                        </th>
                    </tr>
                    {#if (!DBState.db.characters[$selectedCharID].additionalAssets) || DBState.db.characters[$selectedCharID].additionalAssets.length === 0}
                        <tr>
                            <td class="text-textcolor2"> {language.sidebarUi.noAssets}</td>
                        </tr>
                    {:else}
                        {#each DBState.db.characters[$selectedCharID].additionalAssets as assets, i}
                            <tr>
                                <td class="font-medium truncate">
                                    {#if DBState.db.useAdditionalAssetsPreview}
                                        {@const element = assetListElement(assetFileExtensions[i], { knownImagesOnly: true })}
                                        {@const url = rowAssetUrl(assetUrls[i], assets[1], assetListUse(element))}
                                        <!-- A URL still being made, or made for another asset or use, is undefined and shows nothing; '' is a URL that was withheld or could not be made, and shows the name box. -->
                                        {#if element !== 'none' && url === ''}
                                            <div class='w-16 h-16 m-1 rounded-md bg-darkbutton flex flex-col justify-center items-center' data-part="asset-name-box">
                                                <FileMusicIcon aria-hidden="true"/>
                                                <div class='w-16 px-1 text-ellipsis whitespace-nowrap overflow-hidden'>{assets[0]}</div>
                                            </div>
                                        {:else if url}
                                            {#if element === 'video'}
                                            <!-- svelte-ignore a11y_media_has_caption -->
                                                <video controls class="mt-2 px-2 w-full m-1 rounded-md"><source src={url} type="video/mp4"></video>
                                            {:else if element === 'audio'}
                                                <audio controls class="mt-2 px-2 w-full h-16 m-1 rounded-md" loop><source src={url} type="audio/mpeg"></audio>
                                            {:else if element === 'image'}
                                                <img src={url} class="w-16 h-16 m-1 rounded-md" alt={assets[0]}/>
                                            {/if}
                                        {/if}
                                    {/if}
                                    <TextInput size="sm" marginBottom label={language.name} bind:value={DBState.db.characters[$selectedCharID].additionalAssets[i][0]} placeholder="..." />
                                </td>
                                
                                <th class="font-medium cursor-pointer w-10">
                                    <button class="hover:text-textcolor2" aria-label={language.remove} onclick={() => {
                                        if(DBState.db.characters[$selectedCharID].type === 'character'){
                                            DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].fmIndex = -1
                                            let additionalAssets = DBState.db.characters[$selectedCharID].additionalAssets
                                            additionalAssets.splice(i, 1)
                                            DBState.db.characters[$selectedCharID].additionalAssets = additionalAssets
                                        }
                                    }}>
                                        <TrashIcon aria-hidden="true" />
                                    </button>
                                    {#if DBState.db.useAdditionalAssetsPreview}
                                        <!-- The excluded state rests on textcolor2, so its hover goes up to textcolor; the included state goes down to textcolor2. -->
                                        <button class:hover:text-textcolor2={!DBState.db.characters[$selectedCharID].prebuiltAssetExclude?.includes?.(assets[1])} class:hover:text-textcolor={DBState.db.characters[$selectedCharID].prebuiltAssetExclude?.includes?.(assets[1])} class:text-textcolor2={DBState.db.characters[$selectedCharID].prebuiltAssetExclude?.includes?.(assets[1])} aria-label={language.assetInPrompt} aria-pressed={!DBState.db.characters[$selectedCharID].prebuiltAssetExclude?.includes?.(assets[1])} onclick={() => {
                                            DBState.db.characters[$selectedCharID].prebuiltAssetExclude ??= []
                                            if(DBState.db.characters[$selectedCharID].prebuiltAssetExclude.includes(assets[1])){
                                                DBState.db.characters[$selectedCharID].prebuiltAssetExclude = DBState.db.characters[$selectedCharID].prebuiltAssetExclude.filter((e) => e !== assets[1])
                                            }
                                            else {
                                                DBState.db.characters[$selectedCharID].prebuiltAssetExclude.push(assets[1])
                                            }
                                        }}>
                                            {#if DBState.db.characters[$selectedCharID]?.prebuiltAssetExclude?.includes?.(assets[1])}
                                                <ImageOffIcon aria-hidden="true" />
                                            {:else}
                                                <ImageIcon aria-hidden="true" />
                                            {/if}
                                        </button>
                                    {/if}
                                </th>
                            </tr>
                        {/each}
                    {/if}
                </tbody>
                </table>
            </div>
    {/if}
{:else if $CharConfigSubMenu === 3}
    <h2 class="mb-2 text-2xl font-bold mt-2">{language.loreBook} <Help key="lorebook"/></h2>
    <LoreBook />
{:else if $CharConfigSubMenu === 4}
    {#if DBState.db.characters[$selectedCharID].type === 'character'}
        <h2 class="mb-2 text-2xl font-bold mt-2">{language.scripts}</h2>

        <span class="text-textcolor mt-2"><span id="{uid}-background-html">{language.backgroundHTML}</span> <Help key="backgroundHTML" /></span>
        <TextAreaInput highlight margin="both" autocomplete="off" labelId="{uid}-background-html" bind:value={DBState.db.characters[$selectedCharID].backgroundHTML}></TextAreaInput>

        <span class="text-textcolor mt-4">{language.regexScript} <Help key="regexScript"/></span>
        <RegexList bind:value={DBState.db.characters[$selectedCharID].customscript} />
        <div class="text-textcolor2 mt-2 flex gap-2">
            <button class="font-medium cursor-pointer hover:text-textcolor" aria-label={language.add} onclick={() => {
                if(DBState.db.characters[$selectedCharID].type === 'character'){
                    let script = DBState.db.characters[$selectedCharID].customscript
                    script.push({
                    comment: "",
                    in: "",
                    out: "",
                    type: "editinput"
                    })
                    DBState.db.characters[$selectedCharID].customscript = script
                }
            }}><PlusIcon aria-hidden="true" /></button>
            <button class="font-medium cursor-pointer hover:text-textcolor" aria-label={language.export} onclick={() => {
                exportRegex(DBState.db.characters[$selectedCharID].customscript)
            }}><DownloadIcon aria-hidden="true" /></button>
            <button class="font-medium cursor-pointer hover:text-textcolor" aria-label={language.import} onclick={async () => {
                const chaId = DBState.db.characters[$selectedCharID].chaId
                const added = await importRegex([])
                if(added.length === 0){
                    return
                }
                writeLiveCharacter(chaId, (c) => {
                    c.customscript = [...(c.customscript ?? []), ...added]
                })
            }}><HardDriveUploadIcon aria-hidden="true" /></button>
        </div>

        <span class="text-textcolor mt-4">{language.triggerScript} <Help key="triggerScript"/></span>
        <TriggerList bind:value={(DBState.db.characters[$selectedCharID] as character).triggerscript} lowLevelAble={DBState.db.characters[$selectedCharID].lowLevelAccess} />


        {#if DBState.db.characters[$selectedCharID].virtualscript || DBState.db.showUnrecommended}
            <span class="text-textcolor mt-4"><span id="{uid}-charjs">{language.charjs}</span> <Help key="charjs" unrecommended/></span>
            <TextAreaInput margin="both" autocomplete="off" labelId="{uid}-charjs" bind:value={DBState.db.characters[$selectedCharID].virtualscript}></TextAreaInput>
        {/if}
    {/if}
{:else if $CharConfigSubMenu === 6}

    {#if DBState.db.characters[$selectedCharID].license !== 'CC BY-NC-SA 4.0'
    && DBState.db.characters[$selectedCharID].license !== 'CC BY-SA 4.0'
    }
        <Button size="lg" onclick={async () => {
            await openRealmUpload('character')
        }} className="mt-2">
            {language.shareCloud}
        </Button>
    {/if}

    {#if DBState.db.characters[$selectedCharID].license !== 'CC BY-NC-SA 4.0'
        && DBState.db.characters[$selectedCharID].license !== 'CC BY-SA 4.0'
        && DBState.db.characters[$selectedCharID].license !== 'CC BY-ND 4.0'
        && DBState.db.characters[$selectedCharID].license !== 'CC BY-NC-ND 4.0'
        }
        <Button size="sm" onclick={async () => {
            const res = await exportChar($selectedCharID)
        }} className="mt-2">{language.exportCharacter}</Button>
    {/if}

    <Button onclick={async () => {
        const selected = DBState.db.characters[$selectedCharID]
        removeChar(selected, selected.name, 'normal', { onTrashed: postTrashUndo })
    }} className="mt-2" size="sm">{ DBState.db.characters[$selectedCharID].type === 'group' ? language.removeGroup : language.removeCharacter}</Button>
    
{:else if $CharConfigSubMenu === 5}
    {#if DBState.db.characters[$selectedCharID].type === 'character'}
        <h2 class="mb-2 text-2xl font-bold mt-2">TTS</h2>
        <span id="{uid}-tts-provider" class="text-textcolor">{language.provider}</span>
        <SelectInput className="mb-4 mt-2" labelId="{uid}-tts-provider" bind:value={DBState.db.characters[$selectedCharID].ttsMode} onchange={(e) => {
            if(DBState.db.characters[$selectedCharID].type === 'character'){
                (DBState.db.characters[$selectedCharID] as character).ttsSpeech = ''
            }
        }}>
            <OptionInput value="">{language.disabled}</OptionInput>
            <OptionInput value="elevenlab">ElevenLabs</OptionInput>
            <OptionInput value="webspeech">Web Speech</OptionInput>
            <OptionInput value="VOICEVOX">VOICEVOX</OptionInput>
            <OptionInput value="openai">OpenAI</OptionInput>
            <OptionInput value="novelai">NovelAI</OptionInput>
            <OptionInput value="huggingface">Huggingface</OptionInput>
            <OptionInput value="vits">VITS</OptionInput>
            <OptionInput value="gptsovits">GPT-SoVITS</OptionInput>
            <OptionInput value="fishspeech">fish-speech</OptionInput>
        </SelectInput>
        

        {#if DBState.db.characters[$selectedCharID].ttsMode === 'webspeech'}
            {#if !speechSynthesis}
                <span class="text-textcolor">{language.sidebarUi.webSpeechUnsupported}</span>
            {:else}
                <span id="{uid}-tts-speech" class="text-textcolor">{language.Speech}</span>
                <SelectInput className="mb-4 mt-2" labelId="{uid}-tts-speech" bind:value={(DBState.db.characters[$selectedCharID] as character).ttsSpeech}>
                    <OptionInput value="">{language.optAuto}</OptionInput>
                    {#each getWebSpeechTTSVoices() as voice}
                        <OptionInput value={voice}>{voice}</OptionInput>
                    {/each}
                </SelectInput>
                {#if (DBState.db.characters[$selectedCharID] as character).ttsSpeech !== ''}
                    <span class="text-draculared text-sm">{language.sidebarUi.webSpeechAutoHint}</span>
                {/if}
            {/if}
        {:else if DBState.db.characters[$selectedCharID].ttsMode === 'elevenlab'}
            <span class="text-sm mb-2 text-textcolor2">{language.ttsElevenLabsKeyHint}</span>
            {#await getElevenTTSVoices() then voices}
                <span id="{uid}-tts-eleven-speech" class="text-textcolor">{language.Speech}</span>
                <SelectInput className="mb-4 mt-2" labelId="{uid}-tts-eleven-speech" bind:value={(DBState.db.characters[$selectedCharID] as character).ttsSpeech}>
                    <OptionInput value="">{language.sidebarUi.unset}</OptionInput>
                        {#each voices as voice}
                            <OptionInput value={voice.voice_id}>{voice.name}</OptionInput>
                        {/each}
                </SelectInput>
            {:catch error}
                <span class="text-draculared">{error instanceof Error ? error.message : String(error)}</span>
            {/await}
         {:else if DBState.db.characters[$selectedCharID].ttsMode === 'VOICEVOX'}
                <span id="{uid}-vv-speaker" class="text-textcolor">{language.sidebarUi.ttsSpeaker}</span>
                <SelectInput className="mb-4 mt-2" labelId="{uid}-vv-speaker" bind:value={DBState.db.characters[$selectedCharID].voicevoxConfig.speaker}>
                    {#await getVOICEVOXVoices() then voices}
                        {#each voices as voice}
                            <OptionInput value={voice.list}  selected={DBState.db.characters[$selectedCharID].voicevoxConfig.speaker === voice.list}>{voice.name}</OptionInput>
                        {/each}
                    {/await}
                </SelectInput>
                {#if DBState.db.characters[$selectedCharID].voicevoxConfig.speaker}
                <span id="{uid}-vv-style" class="text-textcolor">{language.sidebarUi.ttsStyle}</span>
                <SelectInput className="mb-4 mt-2" labelId="{uid}-vv-style" bind:value={DBState.db.characters[$selectedCharID].ttsSpeech}>
                {#each JSON.parse(DBState.db.characters[$selectedCharID].voicevoxConfig.speaker) as styles}
                        <OptionInput value={styles.id} selected={DBState.db.characters[$selectedCharID].ttsSpeech === styles.id}>{styles.name}</OptionInput>
                {/each}
                </SelectInput>
                {/if}
                <span id="{uid}-vv-speed-scale" class="text-textcolor">Speed scale</span>
                <NumberInput size={"sm"} marginBottom labelId="{uid}-vv-speed-scale" bind:value={DBState.db.characters[$selectedCharID].voicevoxConfig.SPEED_SCALE}/>

                <span id="{uid}-vv-pitch-scale" class="text-textcolor">Pitch scale</span>
                <NumberInput size={"sm"} marginBottom labelId="{uid}-vv-pitch-scale" bind:value={DBState.db.characters[$selectedCharID].voicevoxConfig.PITCH_SCALE}/>

                <span id="{uid}-vv-volume-scale" class="text-textcolor">Volume scale</span>
                <NumberInput size={"sm"} marginBottom labelId="{uid}-vv-volume-scale" bind:value={DBState.db.characters[$selectedCharID].voicevoxConfig.VOLUME_SCALE}/>

                <span id="{uid}-vv-intonation-scale" class="text-textcolor">Intonation scale</span>
                <NumberInput size={"sm"} marginBottom labelId="{uid}-vv-intonation-scale" bind:value={DBState.db.characters[$selectedCharID].voicevoxConfig.INTONATION_SCALE}/>
                <span class="text-sm mb-2 text-textcolor2">{language.sidebarUi.voicevoxHint}</span>
        {:else if DBState.db.characters[$selectedCharID].ttsMode === 'novelai' && ttsConfigReady}
            <span class="text-textcolor">{language.sidebarUi.ttsCustomVoiceSeed}</span>
            <Check label={language.sidebarUi.ttsCustomVoiceSeed} bind:check={DBState.db.characters[$selectedCharID].naittsConfig.customvoice}/>
            {#if !DBState.db.characters[$selectedCharID].naittsConfig.customvoice}
                <span id="{uid}-novelai-voice-select" class="text-textcolor">{language.sidebarUi.ttsVoice}</span>
                <SelectInput className="mb-4 mt-2" labelId="{uid}-novelai-voice-select" bind:value={DBState.db.characters[$selectedCharID].naittsConfig.voice}>
                    {#await getNovelAIVoices() then voices}
                        {#each voices as voiceGroup}
                            <optgroup label={voiceGroup.gender} class="bg-darkbg appearance-none">
                                {#each voiceGroup.voices as voice}
                                    <OptionInput value={voice} selected={DBState.db.characters[$selectedCharID].naittsConfig.voice === voice}>{voice}</OptionInput>
                                {/each}
                            </optgroup>
                        {/each}
                    {/await}
                </SelectInput>
            {:else}
                <span id="{uid}-novelai-voice" class="text-textcolor">{language.sidebarUi.ttsVoice}</span>
                <TextInput size={"sm"} labelId="{uid}-novelai-voice" bind:value={DBState.db.characters[$selectedCharID].naittsConfig.voice}/>
            {/if}
            <span id="{uid}-novelai-version" class="text-textcolor">{language.sidebarUi.ttsVersion}</span>
            <SelectInput className="mb-4 mt-2" labelId="{uid}-novelai-version" bind:value={DBState.db.characters[$selectedCharID].naittsConfig.version}>
                <OptionInput value="v1">v1</OptionInput>
                <OptionInput value="v2">v2</OptionInput>
            </SelectInput>
        {:else if DBState.db.characters[$selectedCharID].ttsMode === 'openai' && ttsConfigReady}
            <span id="{uid}-openai-voice" class="text-textcolor">{language.sidebarUi.ttsVoice}</span>
            {#if !DBState.db.characters[$selectedCharID].oaiTTSConfig?.enabled}
                <SelectInput className="mb-4 mt-2" labelId="{uid}-openai-voice" bind:value={DBState.db.characters[$selectedCharID].oaiVoice}>
                    <OptionInput value="">{language.sidebarUi.unset}</OptionInput>
                    {#each oaiVoices as voice}
                        <OptionInput value={voice}>{voice}</OptionInput>
                    {/each}
                </SelectInput>
            {:else}
                <TextInput className="mb-4 mt-2"
                    labelId="{uid}-openai-voice"
                    bind:value={DBState.db.characters[$selectedCharID].oaiTTSConfig.voice}
                    placeholder={DBState.db.characters[$selectedCharID].oaiVoice || 'alloy'} />
            {/if}

            <span class="text-textcolor">{language.sidebarUi.ttsAdvancedEndpoint}</span>
            <Check label={language.sidebarUi.ttsAdvancedEndpoint} bind:check={DBState.db.characters[$selectedCharID].oaiTTSConfig.enabled} />

            {#if DBState.db.characters[$selectedCharID].oaiTTSConfig?.enabled}
                <span id="{uid}-openai-base-url" class="text-textcolor">Base URL</span>
                <TextInput className="mb-4 mt-2"
                    labelId="{uid}-openai-base-url"
                    bind:value={DBState.db.characters[$selectedCharID].oaiTTSConfig.baseURL}
                    placeholder="https://api.openai.com/v1" />

                <span id="{uid}-openai-api-key" class="text-textcolor">{language.sidebarUi.apiKeyOverridesGlobal}</span>
                <TextInput className="mb-4 mt-2" hideText
                    labelId="{uid}-openai-api-key"
                    bind:value={DBState.db.characters[$selectedCharID].oaiTTSConfig.apiKey}
                    placeholder={language.sidebarUi.apiKeyEmptyPlaceholder} />

                <span id="{uid}-openai-model" class="text-textcolor">{language.model}</span>
                <TextInput className="mb-4 mt-2"
                    labelId="{uid}-openai-model"
                    bind:value={DBState.db.characters[$selectedCharID].oaiTTSConfig.model}
                    placeholder="tts-1" />

                <span id="{uid}-openai-format" class="text-textcolor">Response Format</span>
                <SelectInput className="mb-4 mt-2"
                    labelId="{uid}-openai-format"
                    bind:value={DBState.db.characters[$selectedCharID].oaiTTSConfig.format}>
                    <OptionInput value="mp3">mp3</OptionInput>
                    <OptionInput value="opus">opus</OptionInput>
                    <OptionInput value="aac">aac</OptionInput>
                    <OptionInput value="flac">flac</OptionInput>
                    <OptionInput value="wav">wav</OptionInput>
                    <OptionInput value="pcm">pcm</OptionInput>
                </SelectInput>
            {/if}
        {:else if DBState.db.characters[$selectedCharID].ttsMode === 'huggingface'}
            <span id="{uid}-hf-model" class="text-textcolor">{language.model}</span>
            <TextInput className="mb-4 mt-2" labelId="{uid}-hf-model" bind:value={DBState.db.characters[$selectedCharID].hfTTS.model} />

            <span id="{uid}-hf-language" class="text-textcolor">{language.language}</span>
            <TextInput className="mb-4 mt-2" labelId="{uid}-hf-language" bind:value={DBState.db.characters[$selectedCharID].hfTTS.language} placeholder="en" />
        {:else if DBState.db.characters[$selectedCharID].ttsMode === 'vits'}
            {#if DBState.db.characters[$selectedCharID].vits}
                <span class="text-textcolor">{DBState.db.characters[$selectedCharID].vits.name ?? language.sidebarUi.unnamedVitsModel}</span>
            {:else}
                <span class="text-textcolor">{language.sidebarUi.noModel}</span>
            {/if}
            <Button onclick={async () => {
                if(DBState.db.characters[$selectedCharID].type !== 'character'){
                    return
                }
                const chaId = DBState.db.characters[$selectedCharID].chaId
                const model = await registerOnnxModel()
                if(model){
                    writeLiveCharacter(chaId, (c) => {
                        if(c.type === 'character'){
                            c.vits = model
                        }
                    })
                }
            }}>{language.selectModel}</Button>
        {:else if DBState.db.characters[$selectedCharID].ttsMode === 'gptsovits' && ttsConfigReady}
            <span id="{uid}-gsv-volume" class="text-textcolor">{language.sidebarUi.ttsVolume}</span>
            <SliderInput min={0.0} max={1.0} step={0.01} fixed={2} labelId="{uid}-gsv-volume" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.volume}/>
            <span id="{uid}-gsv-url" class="text-textcolor">URL</span>
            <TextInput className="mb-4 mt-2" labelId="{uid}-gsv-url" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.url}/>

            <span class="text-textcolor">{language.sidebarUi.ttsUseAutoPath}</span>
            <Check label={language.sidebarUi.ttsUseAutoPath} bind:check={DBState.db.characters[$selectedCharID].gptSoVitsConfig.use_auto_path}/>

            {#if !DBState.db.characters[$selectedCharID].gptSoVitsConfig.use_auto_path}
                <span id="{uid}-gsv-ref-path" class="text-textcolor">{language.sidebarUi.ttsRefAudioPath}</span>
                <TextInput className="mb-4 mt-2" labelId="{uid}-gsv-ref-path" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.ref_audio_path}/>
            {/if}

            <span class="text-textcolor">{language.sidebarUi.ttsUseLongAudio}</span>
            <Check label={language.sidebarUi.ttsUseLongAudio} bind:check={DBState.db.characters[$selectedCharID].gptSoVitsConfig.use_long_audio}/>

            <span class="text-textcolor">{language.sidebarUi.ttsRefAudioData}</span>
            <Button onclick={async () => {
                const chaId = DBState.db.characters[$selectedCharID].chaId
                const audio = await selectSingleFileObject([
                    'wav',
                    'ogg',
                    'aac',
                    'mp3'
                ])
                if(!audio){
                    return null
                }
                const limit = await pickedAssetLimitBytes()
                if(audio.size > limit){
                    reportRefusedAssets([audio], limit)
                    return null
                }
                const saveId = await saveAssetFromBlob(audio)
                writeLiveCharacter(chaId, (c) => {
                    if(c.type === 'character'){
                        c.gptSoVitsConfig.ref_audio_data = {
                            fileName: audio.name,
                            assetId: saveId
                        }
                    }
                })

            }}
            className="h-10">
                
                {#if DBState.db.characters[$selectedCharID].gptSoVitsConfig.ref_audio_data.assetId === '' || DBState.db.characters[$selectedCharID].gptSoVitsConfig.ref_audio_data.assetId === undefined}
                    {language.selectFile}
                {:else}
                    {DBState.db.characters[$selectedCharID].gptSoVitsConfig.ref_audio_data.fileName}
                {/if}
            </Button>
            <span id="{uid}-gsv-text-lang" class="text-textcolor">{language.sidebarUi.ttsTextLanguage}</span>
            <SelectInput className="mb-4 mt-2" labelId="{uid}-gsv-text-lang" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.text_lang}>
                <OptionInput value="auto">{language.sidebarUi.ttsLangMultiMixed}</OptionInput>
                <OptionInput value="auto_yue">{language.sidebarUi.ttsLangMultiMixedCantonese}</OptionInput>
                <OptionInput value="en">{language.languageNameEnglish}</OptionInput>
                <OptionInput value="zh">{language.sidebarUi.ttsLangZhEnMixed}</OptionInput>
                <OptionInput value="ja">{language.sidebarUi.ttsLangJaEnMixed}</OptionInput>
                <OptionInput value="yue">{language.sidebarUi.ttsLangYueEnMixed}</OptionInput>
                <OptionInput value="ko">{language.sidebarUi.ttsLangKoEnMixed}</OptionInput>
                <OptionInput value="all_zh">{language.languageNameChinese}</OptionInput>
                <OptionInput value="all_ja">{language.languageNameJapanese}</OptionInput>
                <OptionInput value="all_yue">{language.sidebarUi.ttsLangCantonese}</OptionInput>
                <OptionInput value="all_ko">{language.languageNameKorean}</OptionInput>
            </SelectInput>

            {#if !DBState.db.characters[$selectedCharID].gptSoVitsConfig.use_long_audio}
                <span class="text-textcolor">{language.sidebarUi.ttsUseRefAudioScript}</span>
                <Check label={language.sidebarUi.ttsUseRefAudioScript} bind:check={DBState.db.characters[$selectedCharID].gptSoVitsConfig.use_prompt}/>
            {/if}

            {#if DBState.db.characters[$selectedCharID].gptSoVitsConfig.use_prompt && !DBState.db.characters[$selectedCharID].gptSoVitsConfig.use_long_audio}
                <span id="{uid}-gsv-ref-script" class="text-textcolor">{language.sidebarUi.ttsRefAudioScript}</span>
                <TextAreaInput className="mb-4 mt-2" labelId="{uid}-gsv-ref-script" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.prompt}/>
            {/if}

            <span id="{uid}-gsv-prompt-lang" class="text-textcolor">{language.sidebarUi.ttsRefAudioLanguage}</span>
            <SelectInput className="mb-4 mt-2" labelId="{uid}-gsv-prompt-lang" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.prompt_lang}>
                <OptionInput value="auto">{language.sidebarUi.ttsLangMultiMixed}</OptionInput>
                <OptionInput value="auto_yue">{language.sidebarUi.ttsLangMultiMixedCantonese}</OptionInput>
                <OptionInput value="en">{language.languageNameEnglish}</OptionInput>
                <OptionInput value="zh">{language.sidebarUi.ttsLangZhEnMixed}</OptionInput>
                <OptionInput value="ja">{language.sidebarUi.ttsLangJaEnMixed}</OptionInput>
                <OptionInput value="yue">{language.sidebarUi.ttsLangYueEnMixed}</OptionInput>
                <OptionInput value="ko">{language.sidebarUi.ttsLangKoEnMixed}</OptionInput>
                <OptionInput value="all_zh">{language.languageNameChinese}</OptionInput>
                <OptionInput value="all_ja">{language.languageNameJapanese}</OptionInput>
                <OptionInput value="all_yue">{language.sidebarUi.ttsLangCantonese}</OptionInput>
                <OptionInput value="all_ko">{language.languageNameKorean}</OptionInput>
            </SelectInput>
            <span id="{uid}-gsv-top-p" class="text-textcolor">Top P</span>
            <SliderInput min={0.0} max={1.0} step={0.05} fixed={2} labelId="{uid}-gsv-top-p" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.top_p}/>

            <span id="{uid}-gsv-temperature" class="text-textcolor">{language.temperature}</span>
            <SliderInput min={0.0} max={1.0} step={0.05} fixed={2} labelId="{uid}-gsv-temperature" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.temperature}/>

            <span id="{uid}-gsv-speed" class="text-textcolor">{language.sidebarUi.ttsSpeed}</span>
            <SliderInput min={0.6} max={1.65} step={0.05} fixed={2} labelId="{uid}-gsv-speed" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.speed}/>

            <span id="{uid}-gsv-top-k" class="text-textcolor">Top K</span>
            <SliderInput min={1} max={100} step={1} labelId="{uid}-gsv-top-k" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.top_k}/>

            <span id="{uid}-gsv-split" class="text-textcolor">{language.sidebarUi.ttsTextSplitMethod}</span>
            <SelectInput className="mb-4 mt-2" labelId="{uid}-gsv-split" bind:value={DBState.db.characters[$selectedCharID].gptSoVitsConfig.text_split_method}>
                <OptionInput value="cut0">{language.sidebarUi.ttsCut0}</OptionInput>
                <OptionInput value="cut1">{language.sidebarUi.ttsCut1}</OptionInput>
                <OptionInput value="cut2">{language.sidebarUi.ttsCut2}</OptionInput>
                <OptionInput value="cut3">{language.sidebarUi.ttsCut3}</OptionInput>
                <OptionInput value="cut4">{language.sidebarUi.ttsCut4}</OptionInput>
                <OptionInput value="cut5">{language.sidebarUi.ttsCut5}</OptionInput>
            </SelectInput>        
        {:else if DBState.db.characters[$selectedCharID].ttsMode === 'fishspeech' && ttsConfigReady}
            {#await getFishSpeechModels()}
                <span class="text-textcolor">{language.loadingEllipsis}</span>
            {:then}
                <span id="{uid}-fish-model" class="text-textcolor">{language.model}</span>
                <SelectInput className="mb-4 mt-2" labelId="{uid}-fish-model" bind:value={DBState.db.characters[$selectedCharID].fishSpeechConfig.model._id}>
                    <OptionInput value="">{language.sidebarUi.notSelected}</OptionInput>
                    {#each fishSpeechModels as model}
                        <OptionInput value={model._id}>
                            <div class="flex items-center">
                                <span>{model.title}</span>
                                <span class="text-sm text-textcolor2">{model.description}</span>
                            </div>
                        </OptionInput>
                    {/each}
                </SelectInput>
            {:catch}
                <span class="text-textcolor">{language.sidebarUi.modelsFetchError}</span>
            {/await}

            <span id="{uid}-fish-chunk-length" class="text-textcolor">Chunk Length</span>
            <NumberInput className="mb-4 mt-2" labelId="{uid}-fish-chunk-length" bind:value={DBState.db.characters[$selectedCharID].fishSpeechConfig.chunk_length}/>

            <span class="mt-2 text-textcolor">Normalize</span>
            <Check className="mb-4 mt-2" label="Normalize" bind:check={DBState.db.characters[$selectedCharID].fishSpeechConfig.normalize}/>
        {/if}
        {#if DBState.db.characters[$selectedCharID].ttsMode}
            <div class="flex items-center mt-2">
                <Check bind:check={() => DBState.db.characters[$selectedCharID].ttsReadOnlyQuoted ?? false, (v) => DBState.db.characters[$selectedCharID].ttsReadOnlyQuoted = v} name={language.ttsReadOnlyQuoted}/>
            </div>
        {/if}
    {/if}
{:else if $CharConfigSubMenu === 2}
    <h2 class="mb-2 text-2xl font-bold mt-2">{language.advancedSettings}</h2>
        {#if DBState.db.characters[$selectedCharID].type !== 'group'}
        <span class="text-textcolor mt-2">{language.sidebarUi.bias} <Help key="bias"/></span>
        <div class="w-full max-w-full border border-selected rounded-md p-2 mb-2">

        <table class="w-full max-w-full tabler mt-2">
            <tbody>
            <tr>
                <th class="font-medium w-1/2">{language.sidebarUi.bias}</th>
                <th class="font-medium w-1/3">{language.value}</th>
                <th>
                    <button class="font-medium cursor-pointer hover:text-textcolor2" aria-label={language.add} onclick={() => {
                        if(DBState.db.characters[$selectedCharID].type === 'character'){
                            (DBState.db.characters[$selectedCharID] as character).bias.push(['', 0])
                        }
                    }}><PlusIcon aria-hidden="true" /></button>
                </th>
            </tr>
            {#if (DBState.db.characters[$selectedCharID] as character).bias.length === 0}
                <tr>
                    <td colspan="3">{language.noBias}</td>

                </tr>
            {/if}
            {#each (DBState.db.characters[$selectedCharID] as character).bias as bias, i}
                <tr class="align-middle text-center">
                    <td class="font-medium truncate w-1/2">
                        <TextInput fullh fullwidth label={language.sidebarUi.bias} bind:value={(DBState.db.characters[$selectedCharID] as character).bias[i][0]} placeholder={language.sidebarUi.biasTokenPlaceholder} />
                    </td> 
                    <td class="font-medium truncate w-1/3">
                        <NumberInput fullh fullwidth label={language.value} bind:value={(DBState.db.characters[$selectedCharID] as character).bias[i][1]} max={100} min={-100} />
                    </td>
                    <td>
                        <button class="font-medium flex justify-center items-center w-full h-full cursor-pointer hover:text-textcolor2" aria-label={language.remove} onclick={() => {
                            if(DBState.db.characters[$selectedCharID].type === 'character'){
                                (DBState.db.characters[$selectedCharID] as character).bias.splice(i, 1)
                            }
                        }}><TrashIcon aria-hidden="true" /></button>
                    </td>
                </tr>
            {/each}
            </tbody>
            
        </table>
        </div>

        <span class="text-textcolor"><span id="{uid}-example-message">{language.exampleMessage}</span> <Help key="exampleMessage"/></span>
        <TextAreaInput highlight margin="both" autocomplete="off" labelId="{uid}-example-message" bind:value={DBState.db.characters[$selectedCharID].exampleMessage}></TextAreaInput>

        <span class="text-textcolor"><span id="{uid}-creator-notes">{language.creatorNotes}</span> <Help key="creatorQuotes"/></span>
        <MultiLangInput labelId="{uid}-creator-notes" bind:value={DBState.db.characters[$selectedCharID].creatorNotes} className="my-2" onInput={() => {
            DBState.db.characters[$selectedCharID].removedQuotes = false
        }}></MultiLangInput>

        <span class="text-textcolor"><span id="{uid}-system-prompt">{language.systemPrompt}</span> <Help key="systemPrompt"/></span>
        <TextAreaInput highlight margin="both" autocomplete="off" labelId="{uid}-system-prompt" bind:value={DBState.db.characters[$selectedCharID].systemPrompt}></TextAreaInput>

        <span class="text-textcolor"><span id="{uid}-replace-global-note">{language.replaceGlobalNote}</span> <Help key="replaceGlobalNote"/></span>
        <TextAreaInput highlight margin="both" autocomplete="off" labelId="{uid}-replace-global-note" bind:value={DBState.db.characters[$selectedCharID].replaceGlobalNote}></TextAreaInput>

        <span class="text-textcolor mt-2"><span id="{uid}-additional-text">{language.additionalText}</span> <Help key="additionalText" /></span>
        <TextAreaInput highlight margin="both" autocomplete="off" labelId="{uid}-additional-text" bind:value={DBState.db.characters[$selectedCharID].additionalText}></TextAreaInput>

        {#if DBState.db.showUnrecommended || DBState.db.characters[$selectedCharID].personality.length > 3}
            <span class="text-textcolor"><span id="{uid}-personality">{language.personality}</span> <Help key="personality" unrecommended/></span>
            <TextAreaInput highlight margin="both" autocomplete="off" labelId="{uid}-personality" bind:value={DBState.db.characters[$selectedCharID].personality}></TextAreaInput>
        {/if}
        {#if DBState.db.showUnrecommended || DBState.db.characters[$selectedCharID].scenario.length > 3}
            <span class="text-textcolor"><span id="{uid}-scenario">{language.scenario}</span> <Help key="scenario" unrecommended/></span>
            <TextAreaInput highlight margin="both" autocomplete="off" labelId="{uid}-scenario" bind:value={DBState.db.characters[$selectedCharID].scenario}></TextAreaInput>
        {/if}

        <span class="text-textcolor mt-2"><span id="{uid}-default-variables">{language.defaultVariables}</span> <Help key="defaultVariables" /></span>
        <TextAreaInput margin="both" autocomplete="off" labelId="{uid}-default-variables" bind:value={DBState.db.characters[$selectedCharID].defaultVariables}></TextAreaInput>

        <span class="text-textcolor mt-2"><span id="{uid}-translator-note">{language.translatorNote}</span> <Help key="translatorNote" /></span>
        <TextAreaInput margin="both" autocomplete="off" labelId="{uid}-translator-note" bind:value={DBState.db.characters[$selectedCharID].translatorNote}></TextAreaInput>

        <span class="text-textcolor mt-2"><span id="{uid}-custom-toggle">{language.customPromptTemplateToggle}</span> <Help key="customPromptTemplateToggle" /></span>
        <StudioToggleLink owner={{ type: 'character' }} />
        <TextAreaInput margin="both" autocomplete="off" labelId="{uid}-custom-toggle" bind:value={DBState.db.characters[$selectedCharID].customModuleToggle}></TextAreaInput>

        <span id="{uid}-creator" class="text-textcolor">{language.creator}</span>
        <TextInput size="sm" autocomplete="off" labelId="{uid}-creator" bind:value={DBState.db.characters[$selectedCharID].additionalData.creator} />

        <span id="{uid}-char-version" class="text-textcolor">{language.CharVersion}</span>
        <TextInput size="sm" labelId="{uid}-char-version" bind:value={DBState.db.characters[$selectedCharID].additionalData.character_version}/>

        <span class="text-textcolor"><span id="{uid}-nickname">{language.nickname}</span> <Help key="nickname" /></span>
        <TextInput size="sm" labelId="{uid}-nickname" bind:value={DBState.db.characters[$selectedCharID].nickname}/>

        <span id="{uid}-depth-prompt" class="text-textcolor">{language.depthPrompt}</span>
        <div class="flex justify-center items-center">
            <NumberInput size="sm" label={language.depth} bind:value={DBState.db.characters[$selectedCharID].depth_prompt.depth} className="w-12"/>
            <TextInput size="sm" labelId="{uid}-depth-prompt" bind:value={DBState.db.characters[$selectedCharID].depth_prompt.prompt} className="flex-1"/>
        </div>

        <span class="text-textcolor mt-2">{language.altGreet}</span>
        <div class="w-full max-w-full border border-selected rounded-md p-2">
            <table class="contain w-full max-w-full tabler mt-2">
                <tbody>
                <tr>
                    <th class="font-medium">{language.value}</th>
                    <th class="font-medium cursor-pointer w-8">
                        <button class="hover:text-textcolor2" aria-label={language.add} onclick={() => {
                            if(DBState.db.characters[$selectedCharID].type === 'character'){
                                let alternateGreetings = DBState.db.characters[$selectedCharID].alternateGreetings
                                alternateGreetings.push('')
                                DBState.db.characters[$selectedCharID].alternateGreetings = alternateGreetings
                            }
                        }}>
                            <PlusIcon aria-hidden="true" />
                        </button>
                    </th>
                </tr>
                {#if DBState.db.characters[$selectedCharID].alternateGreetings.length === 0}
                    <tr>
                        <td colspan="3">{language.noData}</td>
                    </tr>
                {/if}
                {#each DBState.db.characters[$selectedCharID].alternateGreetings as bias, i}
                    <tr>
                        <td class="font-medium truncate">
                            <TextAreaInput highlight label={language.altGreet} bind:value={DBState.db.characters[$selectedCharID].alternateGreetings[i]} placeholder="..." fullwidth />
                        </td>
                        <th class="font-medium cursor-pointer w-8">
                            <div class="flex flex-col items-center">
                                <button class="hover:text-textcolor2 p-1" aria-label={language.chatShellMoveUp} onclick={() => moveAlternateGreetingUp(i)} disabled={i === 0}>
                                    <ArrowUp size={16} aria-hidden="true" />
                                </button>
                                <button class="hover:text-textcolor2 p-1" aria-label={language.chatShellMoveDown} onclick={() => moveAlternateGreetingDown(i)} disabled={i === DBState.db.characters[$selectedCharID].alternateGreetings.length - 1}>
                                    <ArrowDown size={16} aria-hidden="true" />
                                </button>
                                <button class="hover:text-draculared p-1" aria-label={language.remove} onclick={() => {
                                    if(DBState.db.characters[$selectedCharID].type === 'character'){
                                        DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].fmIndex = -1
                                        let alternateGreetings = DBState.db.characters[$selectedCharID].alternateGreetings
                                        alternateGreetings.splice(i, 1)
                                        DBState.db.characters[$selectedCharID].alternateGreetings = alternateGreetings
                                    }
                                }}>
                                    <TrashIcon size={16} aria-hidden="true" />
                                </button>
                            </div>
                        </th>
                    </tr>
                {/each}
            </tbody>
            </table>
        </div>

        <div class="flex items-center mt-4">
            <!-- Optional top-level boolean flags of the character use function bindings: binding an absent flag directly makes Svelte write `false` into the character on mount. -->
            <Check bind:check={() => DBState.db.characters[$selectedCharID].lowLevelAccess ?? false, (v) => DBState.db.characters[$selectedCharID].lowLevelAccess = v} name={language.lowLevelAccess}/>
            <span> <Help key="lowLevelAccess" name={language.lowLevelAccess}/></span>
        </div>

        <div class="flex items-center mt-4">
            <Check bind:check={() => DBState.db.characters[$selectedCharID].hideChatIcon ?? false, (v) => DBState.db.characters[$selectedCharID].hideChatIcon = v} name={language.hideChatIcon}/>
        </div>

        <div class="flex items-center mt-4">
            <Check bind:check={DBState.db.characters[$selectedCharID].utilityBot} name={language.utilityBot}/>
            <span> <Help key="utilityBot" name={language.utilityBot}/></span>
        </div>

        <div class="flex items-center mt-4">
            <Check bind:check={() => (DBState.db.characters[$selectedCharID] as character).escapeOutput ?? false, (v) => (DBState.db.characters[$selectedCharID] as character).escapeOutput = v} name={language.escapeOutput}/>
        </div>

        {#if DBState.db.supaModelType !== 'none' && DBState.db.hypav2}
            <Button
                onclick={() => {
                    DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].hypaV2Data ??= {
                        lastMainChunkID: 0,
                        mainChunks: [],
                        chunks: [],
                    }
                    showHypaV2Alert()
                }}
                className="mt-4"
            >
                {language.hypaMemoryV2Modal}
            </Button>
        {:else if DBState.db.hypaV3}
            <Button
                onclick={() => {
                    $hypaV3ModalOpen = true
                }}
                className="mt-4"
            >
                {language.hypaMemoryV3Modal}
            </Button>
        {:else if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].supaMemoryData && DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].supaMemoryData.length > 4 || DBState.db.characters[$selectedCharID].supaMemory}
            <span id="{uid}-super-memory" class="text-textcolor mt-4">{language.SuperMemory}</span>
            <TextAreaInput margin="both" autocomplete="off" labelId="{uid}-super-memory" bind:value={DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].supaMemoryData}></TextAreaInput>
            <Button
                onclick={async () => {
                    const chat = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                    if(!await alertConfirm(language.resetSupaMemoryConfirm)){
                        return
                    }
                    chat.supaMemoryData = ''
                    delete chat.supaMemoryCoveredId
                }}
                className="mt-2"
            >
                {language.resetSupaMemory}
            </Button>
        {/if}

        <Button
            onclick={applyModule}
            className="mt-4"
        >
            {language.applyModule}
        </Button>

        <Button
            onclick={async () => {
                const char = getCurrentCharacter()
                if(char.type === 'group'){
                    return
                }
                const m = convertCharacterToModule(char)
                DBState.db.modules.push(m)
                alertNormal(language.successfullyConverted)
            }}
            className="mt-4"
        >
            {language.convertToModule}
        </Button>
    {:else}
        {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].supaMemoryData && DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].supaMemoryData.length > 4 || DBState.db.characters[$selectedCharID].supaMemory}
            <span id="{uid}-super-memory" class="text-textcolor mt-4">{language.SuperMemory}</span>
            <TextAreaInput margin="both" autocomplete="off" labelId="{uid}-super-memory" bind:value={DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].supaMemoryData}></TextAreaInput>
            <Button
                onclick={async () => {
                    const chat = DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage]
                    if(!await alertConfirm(language.resetSupaMemoryConfirm)){
                        return
                    }
                    chat.supaMemoryData = ''
                    delete chat.supaMemoryCoveredId
                }}
                className="mt-2"
            >
                {language.resetSupaMemory}
            </Button>
        {/if}

        <div class="flex items-center mt-4">
            <Check bind:check={() => DBState.db.characters[$selectedCharID].lowLevelAccess ?? false, (v) => DBState.db.characters[$selectedCharID].lowLevelAccess = v} name={language.lowLevelAccess}/>
            <span> <Help key="lowLevelAccess" name={language.lowLevelAccess}/></span>
        </div>
    {/if}
{/if}


<style>

    .tabler {
    table-layout: fixed;
    }

    .tabler td {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .char-grid{
        display: grid;
        grid-template-columns: auto 1fr auto;
    }
</style>