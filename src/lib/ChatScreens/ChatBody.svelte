<script lang="ts">
    import { onDestroy, untrack } from "svelte"
    import isEqual from "lodash/isEqual"
    import { DBState, selectedCharID } from 'src/ts/stores.svelte'
    import { sleep } from "src/ts/util"
    import { alertError } from "../../ts/alert"
    import { language } from "src/lang"
    import { fillLang } from "src/lang/fill"
    import { addMetadataToElement, getDistance, ParseMarkdown, postTranslationParse, trimMarkdown, type CbsConditions, type simpleCharacterArgument } from "../../ts/parser/parser.svelte"
    import { getLLMCache, translateHTML, waitForTranslatorModules } from "../../ts/translator/translator"
    import { getModuleAssets } from "src/ts/process/modules";
    import { getCurrentChat, getCurrentCharacter } from "src/ts/storage/database.svelte";
    import { getFileSrc } from "src/ts/globalApi.svelte";
    import { moduleRunVersion, selectedModulesPending } from "src/ts/process/moduleEnsure";
    import { UNRESOLVED_IMAGE_SELECTOR } from "./imageRepairSelector";
    import {
        AWAITING, lookup, pendingDisplay, record, runShowsSpinner, scopeOf, slotKeyOf,
        type CacheLookup, type PendingDisplay, type RenderFingerprint,
    } from "./chatBodyRenderCache";

    interface Props {
        character?: simpleCharacterArgument|string|null
        firstMessage?: boolean
        idx?: number
        msgDisplay?: string
        name?: string
        role: string|null
        translated: boolean
        translating: boolean
        retranslate: boolean
        renderRevision?: number
        bodyRoot?: HTMLElement|null
        modelShortName: string
        renderRawStreaming?: boolean
        rawStreamingText?: string
    }

    let {
        character = null,
        idx = 0,
        firstMessage = false,
        msgDisplay,
        role,
        translated = $bindable(false),
        translating = $bindable(false),
        retranslate = $bindable(false),
        renderRevision = 0,
        bodyRoot,
        modelShortName = '',
        renderRawStreaming = false,
        rawStreamingText = '',
    }: Props =  $props()

    const SPINNER_HTML = `<div style="display:flex;justify-content:center;align-items:center;height:48px;"><div style="animation: spin 1s linear infinite; border-radius: 50%; height: 32px; width: 32px; border: 2px solid #3b82f6; border-top: 2px solid transparent;"></div></div><style>@keyframes spin { to { transform: rotate(360deg); } }</style>`

    // Plain state, read when a pending or empty branch is created: this instance's own last rendered string (written only
    // by a string result) and the facts of its latest run, captured when that run started.
    let shown: string | null = null
    let runSpinner = false
    let runPending = false
    let runStreamingTail = false
    let runFingerprint: RenderFingerprint | null = null
    let currentRun: Promise<string | undefined> | null = null
    let lastCharArg:string|simpleCharacterArgument = null
    let lastChatId = -10
    let lastRenderedRevision: number | null = null
    // Plain on purpose: a run resuming after a module wait reads it untracked. A module load remounts this component
    // and destroys this instance before its waiting run resumes, so a destroyed run stops and only the new instance sends.
    let destroyed = false
    onDestroy(() => {
        destroyed = true
    })

    function getCbsCondition(){
        try{
            const cbsConditions:CbsConditions = {
                firstmsg: firstMessage ?? false,
                chatRole: role,
            }
            return cbsConditions
        }
        catch(e){
            return {
                firstmsg: firstMessage ?? false,
                chatRole: null,
            }
        }
    }

    let shouldRenderRawStreaming = $derived(renderRawStreaming && !translated && !retranslate)

    const markParsing = async (data: string, charArg: string | simpleCharacterArgument, chatID: number, requestedRevision: number, tries?:number) => {
        // track 'translated' and 'retranslate' state
        translated;
        retranslate;
        let mode = 'notrim' as const
        try {
            if((!isEqual(lastCharArg, charArg)) || (chatID !== lastChatId)){
                lastCharArg = charArg
                lastChatId = chatID
                let translateText = false
                try {
                    if(DBState.db.autoTranslate){
                        if(DBState.db.autoTranslateCachedOnly && DBState.db.translatorType === 'llm'){
                            let cache: string | null
                            if(DBState.db.translateBeforeHTMLFormatting){
                                cache = await getLLMCache(data)
                            }
                            else{
                                // The lookup key must be the post-load text the translator will later request with.
                                await waitForTranslatorModules()
                                if(destroyed){
                                    return
                                }
                                cache = await getLLMCache(await ParseMarkdown(data, charArg, !DBState.db.legacyTranslation ? 'pretranslate' : mode, chatID, getCbsCondition()))
                            }

                            translateText = cache !== null
                        }
                        else{
                            translateText = true
                        }
                    }

                    const lastTranslated = translated

                    setTimeout(() => {
                            translated = translateText
                    }, 10)

                    // State change of `translated` triggers markParsing again,
                    // causing redundant translation attempts
                    if (lastTranslated !== translateText) {
                        return;
                    }
                } catch (error) {
                    console.error(error)
                }
            }
            if(retranslate || translated){
                let transResult
                
                if(DBState.db.translatorType === 'llm' && DBState.db.translateBeforeHTMLFormatting){
                    await sleep(100)
                    translating = true
                    data = await translateHTML(data, false, charArg, chatID, retranslate)
                    translating = false
                    const marked = await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition())
                    lastCharArg = charArg
                    transResult = marked
                }
                else if(!DBState.db.legacyTranslation){
                    if(DBState.db.translatorType === 'llm'){
                        await waitForTranslatorModules()
                        if(destroyed){
                            return
                        }
                    }
                    const marked = await ParseMarkdown(data, charArg, 'pretranslate', chatID, getCbsCondition())
                    translating = true
                    const translated = await postTranslationParse(await translateHTML(marked, false, charArg, chatID, retranslate))
                    translating = false
                    lastCharArg = charArg
                    transResult = translated
                }
                else{
                    if(DBState.db.translatorType === 'llm'){
                        await waitForTranslatorModules()
                        if(destroyed){
                            return
                        }
                    }
                    const marked = await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition())
                    translating = true
                    const translated = await translateHTML(marked, false, charArg, chatID, retranslate)
                    translating = false
                    lastCharArg = charArg
                    transResult = translated
                }

                setTimeout(() => {
                    retranslate = false
                }, 10);

                return transResult
            }
            else{
                const marked = await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition())
                lastCharArg = charArg
                return marked
            }   
        } catch (error) {
            //retry
            if(tries > 2){
                const wrapped = new Error(fillLang(language.errors.chatParseFailed, { translated: `${translated}`, message: error?.message ?? `${error}`, stack: '' }))
                // The alert shows the Error's stack in its own block, so the message omits it.
                if(error instanceof Error){
                    wrapped.stack = error.stack
                }
                alertError(wrapped)
                return data
            }
            return await markParsing(data, charArg, chatID, requestedRevision, (tries ?? 0) + 1)
        }
        finally{
            lastRenderedRevision = requestedRevision
        }
    }

    const checkImg = () => {
        if(!DBState.db.newImageHandlingBeta || !bodyRoot){
            return
        }
        const imgs = bodyRoot.querySelectorAll(UNRESOLVED_IMAGE_SELECTOR) as NodeListOf<HTMLImageElement>
        
        if (imgs.length > 0) {
            const currentCharacter = getCurrentCharacter()
            const styl = currentCharacter.prebuiltAssetStyle
            const assets = getModuleAssets().concat(currentCharacter.additionalAssets ?? [])
            const normalizedAssets = assets.map((asset) => {
                return {
                    name: asset[0].toLocaleLowerCase(),
                    path: asset[1]
                }
            })
            const exactAssets = new Map(normalizedAssets.map((asset) => [asset.name, asset.path]))

            imgs.forEach(async (img) => {
                const name = img.getAttribute('src')?.toLocaleLowerCase() || ''
                console.log(name)

                if(
                    name.length > 200 ||
                    name.includes(':')
                ){
                    img.setAttribute('noimage', 'true')
                    return
                }
                
                const foundAsset = exactAssets.get(name)
                console.log('Checking image:', name, 'Assets:', assets)
                if(foundAsset){
                    img.classList.add('root-loaded-image')
                    img.classList.add('root-loaded-image-' + styl)
                    img.src = await getFileSrc(foundAsset)
                    return
                }

                if(name.length < 3){
                    img.setAttribute('noimage', 'true')
                    return
                }
                const prefixLoc = name.lastIndexOf('.')
                const prefix = prefixLoc > 0 ? name.substring(0, prefixLoc) : ''
                let currentDistance = 1000
                let currentFound = ''
                for(const asset of normalizedAssets){
                    if(!asset.name.startsWith(prefix)){
                        continue
                    }
                    const distance = getDistance(name, asset.name)
                    if(distance < currentDistance){
                        currentDistance = distance
                        currentFound = asset.path
                    }
                }
                if(currentDistance > DBState.db.assetMaxDifference){
                    currentFound = ''
                }
                if(currentFound){
                    const got = await getFileSrc(currentFound)
                    const name2 = img.getAttribute('src')?.toLocaleLowerCase() || ''
                    if(name === name2){
                        img.setAttribute('src', got)
                    }

                    if(img.classList.length === 0){
                        img.classList.add('root-loaded-image')
                        img.classList.add('root-loaded-image-' + styl)
                    }
                    img.removeAttribute('noimage')
                }
                else{
                    img.setAttribute('noimage', 'true')
                }
            })
        }
    }

    // The selection and the run version are read first and unconditionally, so the derived re-evaluates when the chat
    // changes or a load ends even though the pending check itself is synchronous.
    let gatePending = $derived.by(() => {
        $selectedCharID
        $moduleRunVersion
        return selectedModulesPending()
    })

    // Untracked: the cache scope and the streaming-tail fact are captured per run and never re-run the parse.
    const captureRunContext = () => untrack(() => {
        let scope: string | null = null
        let streamingTail = false
        try {
            const owner = getCurrentCharacter()
            const chat = getCurrentChat()
            if(owner && chat){
                scope = scopeOf(owner.chaId, chat.id, owner.chatPage)
                streamingTail = !!chat.isStreaming && idx >= 0 && idx === chat.message.length - 1
            }
        } catch (error) {
            scope = null
        }
        return { scope, streamingTail }
    })

    const startRun = (data: string, charArg: simpleCharacterArgument|string|null, chatID: number, revision: number, gate: boolean) => {
        const { scope, streamingTail } = captureRunContext()
        const fingerprint: RenderFingerprint | null = scope === null ? null : untrack(() => ({
            scope,
            slot: slotKeyOf(firstMessage, chatID, charArg),
            source: data,
            role,
            charArg,
        }))
        const seen: CacheLookup = fingerprint ? lookup(fingerprint) : { kind: 'none' }
        runFingerprint = fingerprint
        runPending = gate
        runStreamingTail = streamingTail
        if(gate){
            // No parse and no translation start while the selected modules load. This instance has no correct render for
            // the fingerprint, so its own string must not come back after the gate opens.
            runSpinner = false
            if(fingerprint && seen.kind !== 'html'){
                record(fingerprint, AWAITING)
                shown = null
            }
            currentRun = Promise.resolve(undefined)
            return currentRun
        }
        runSpinner = runShowsSpinner({
            translateRun: retranslate || translated,
            showTranslationLoading: untrack(() => !!DBState.db.showTranslationLoading),
            revisionChanged: lastRenderedRevision !== null && revision !== lastRenderedRevision,
            shown,
            lookup: seen,
        })
        currentRun = markParsing(data, charArg, chatID, revision)
        return currentRun
    }

    // Only the latest run of a live instance records what its {:then} renders, and only a string result: an
    // undefined result renders the pending display instead, so it is not a rendering.
    const commitRun = (run: Promise<string | undefined>, md: string | undefined) => {
        if(currentRun !== run || destroyed || typeof md !== 'string'){
            return
        }
        shown = md
        if(runFingerprint){
            record(runFingerprint, md)
        }
    }

    const displayNow = (): PendingDisplay => pendingDisplay({
        pending: runPending,
        runSpinner,
        shown,
        lookup: runFingerprint ? lookup(runFingerprint) : { kind: 'none' },
        streamingTail: runStreamingTail,
    })

    const htmlOf = (display: PendingDisplay): string => {
        if(display.kind === 'html'){
            return display.html
        }
        return display.kind === 'spinner' ? SPINNER_HTML : ''
    }

    let markParsingResult = $derived.by(() => startRun(msgDisplay, character, idx, renderRevision, gatePending))

    $effect(() => {
        if(shouldRenderRawStreaming){
            return
        }
        const run = markParsingResult
        checkImg()
        run.then((md) => {
            commitRun(run, md)
            checkImg()
        })
    })
</script>

{#snippet showing(display: PendingDisplay)}
    {#if display.kind === 'indicator'}
        <span role="status" aria-label={language.loading} class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-textcolor2 border-t-transparent align-middle"></span>
    {:else}
        {@html addMetadataToElement(trimMarkdown(htmlOf(display)), modelShortName)}
    {/if}
{/snippet}

{#if shouldRenderRawStreaming}
    <span class="whitespace-pre-wrap">{rawStreamingText}</span>
{:else}
    {#await markParsingResult}
        {@render showing(displayNow())}
    {:then md}
        {#if md === undefined}
            <!-- Two consecutive runs can both resolve undefined, which keeps this branch and its value unchanged; the key
                 makes every run re-evaluate the display. -->
            {#key markParsingResult}
                {@render showing(displayNow())}
            {/key}
        {:else}
            {@html addMetadataToElement(trimMarkdown(md), modelShortName)}
        {/if}
    {/await}
{/if}
