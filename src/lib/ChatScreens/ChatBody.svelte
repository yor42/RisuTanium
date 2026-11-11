<script lang="ts" module>
    // What a held evaluation returns when a surface body has no run yet. It is never assigned to `currentRun`, so
    // `commitRun` rejects it and `resolution` stays as it was.
    const HELD = Promise.resolve<string | undefined>(undefined)
</script>

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
    import { chatSurface } from "./chatSurface.svelte";
    import { UNRESOLVED_IMAGE_SELECTOR } from "./imageRepairSelector";
    import { createDeferredImageLoader } from "./deferredAssetImages";
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
        /** `null` until the caller's wrapper is bound; absent when there is none, and then no image is deferred. */
        bodyRoot?: HTMLElement|null
        modelShortName: string
        renderRawStreaming?: boolean
        rawStreamingText?: string
        /** Fixed at mount by Chats: true only while the tail's reply streams. The translation then waits for the re-mount at the stream end. */
        deferAutoTranslate?: boolean
        /** Live: true while the tail's reply streams in place. A wanted translation then waits; the parse shows untranslated text. */
        translationHold?: boolean
        /** Returns true once, for a body that replaces one showing the translated view: the first decision then keeps that view. */
        takeStartTranslated?: () => boolean
        /** The rebuild epoch of the enclosing surface row, fixed when that row was created; null outside the chat surface. */
        surfaceEpoch?: number | null
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
        deferAutoTranslate = false,
        translationHold = false,
        takeStartTranslated = undefined,
        surfaceEpoch = null,
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
    const loader = createDeferredImageLoader()
    onDestroy(() => {
        destroyed = true
        loader.dispose()
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

    const markParsing = async (data: string, charArg: string | simpleCharacterArgument, chatID: number, requestedRevision: number, deferTranslation: boolean, scriptCache: 'use' | 'bypass', tries?:number) => {
        // track 'translated' and 'retranslate' state
        translated;
        retranslate;
        // The hold is read only while a translation is wanted, so a hold flip on an untranslated row starts no parse.
        const held = (retranslate || translated) && translationHold
        let mode = 'notrim' as const
        try {
            if(deferTranslation){
                // No decision, no cache lookup and no `lastCharArg`/`lastChatId` write: the instance mounted at the stream
                // end makes the decision once and translates once.
                return await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition(), scriptCache)
            }
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
                                cache = await getLLMCache(await ParseMarkdown(data, charArg, !DBState.db.legacyTranslation ? 'pretranslate' : mode, chatID, getCbsCondition(), scriptCache))
                            }

                            translateText = cache !== null
                        }
                        else{
                            translateText = true
                        }
                    }

                    if(takeStartTranslated?.() === true){
                        translateText = true
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
            if((retranslate || translated) && !held){
                let transResult
                
                if(DBState.db.translatorType === 'llm' && DBState.db.translateBeforeHTMLFormatting){
                    await sleep(100)
                    translating = true
                    data = await translateHTML(data, false, charArg, chatID, retranslate)
                    translating = false
                    const marked = await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition(), scriptCache)
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
                    const marked = await ParseMarkdown(data, charArg, 'pretranslate', chatID, getCbsCondition(), scriptCache)
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
                    const marked = await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition(), scriptCache)
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
                const marked = await ParseMarkdown(data, charArg, mode, chatID, getCbsCondition(), scriptCache)
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
            return await markParsing(data, charArg, chatID, requestedRevision, deferTranslation, scriptCache, (tries ?? 0) + 1)
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

                if(
                    name.length > 200 ||
                    name.includes(':')
                ){
                    img.setAttribute('noimage', 'true')
                    return
                }
                
                const foundAsset = exactAssets.get(name)
                if(foundAsset){
                    img.classList.add('root-loaded-image')
                    img.classList.add('root-loaded-image-' + styl)
                    loader.assign(img, await getFileSrc(foundAsset))
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
                        loader.assign(img, got)
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

    // Untracked: the cache scope, the streaming-tail fact and the deferral are captured per run and never re-run the parse.
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
        return { scope, streamingTail, deferTranslation: deferAutoTranslate === true }
    })

    const startRun = (data: string, charArg: simpleCharacterArgument|string|null, chatID: number, revision: number, gate: boolean) => {
        const { scope, streamingTail, deferTranslation } = captureRunContext()
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
            translateRun: (retranslate || translated) && !translationHold,
            showTranslationLoading: untrack(() => !!DBState.db.showTranslationLoading),
            revisionChanged: lastRenderedRevision !== null && revision !== lastRenderedRevision,
            shown,
            lookup: seen,
        })
        currentRun = markParsing(data, charArg, chatID, revision, deferTranslation, streamingTail ? 'bypass' : 'use')
        return currentRun
    }

    // The resolution of the latest run, for any result including undefined: the display derived must re-evaluate when a
    // run resolves, and an undefined result is not a rendering but re-reads the pending display.
    let resolution = $state.raw<{ run: Promise<string | undefined>, md: string | undefined } | null>(null)

    // Only the latest run of a live instance resolves; only a string result is remembered as what this instance shows.
    const commitRun = (run: Promise<string | undefined>, md: string | undefined) => {
        if(currentRun !== run || destroyed){
            return
        }
        if(typeof md === 'string'){
            shown = md
            if(runFingerprint){
                record(runFingerprint, md)
            }
        }
        resolution = { run, md }
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

    // Surface bodies only: the inputs of the latest run, and whether the last evaluation was held.
    type RunInputs = {
        data: string | undefined
        character: simpleCharacterArgument | string | null
        idx: number
        revision: number
        gate: boolean
        translated: boolean
        retranslate: boolean
        hold: boolean
    }
    let lastRunInputs: RunInputs | null = null
    let heldSinceLastRun = false

    const sameInputs = (a: RunInputs, b: RunInputs) => a.data === b.data && a.idx === b.idx && a.revision === b.revision
        && a.gate === b.gate && a.translated === b.translated && a.retranslate === b.retranslate && a.hold === b.hold
        && isEqual(a.character, b.character)

    // Outside the surface this is the plain start of a run. Inside it the inputs are read first, so the derived keeps
    // its dependencies, and then: a dead body (its row predates a rebuild) never starts a run; while hidden nothing
    // starts; the first evaluation after a hold starts a run only if an input changed since the latest run. Both held
    // paths return the latest run, so the display stays as it was.
    let markParsingResult = $derived.by(() => {
        if(surfaceEpoch === null){
            return startRun(msgDisplay, character, idx, renderRevision, gatePending)
        }
        const inputs: RunInputs = { data: msgDisplay, character, idx, revision: renderRevision, gate: gatePending, translated, retranslate, hold: (translated || retranslate) && translationHold }
        if(surfaceEpoch !== chatSurface.rebuildEpoch){
            return currentRun ?? HELD
        }
        if(chatSurface.hidden){
            heldSinceLastRun = true
            return currentRun ?? HELD
        }
        if(heldSinceLastRun){
            heldSinceLastRun = false
            if(currentRun !== null && lastRunInputs !== null && sameInputs(lastRunInputs, inputs)){
                return currentRun
            }
        }
        lastRunInputs = inputs
        return startRun(msgDisplay, character, idx, renderRevision, gatePending)
    })

    // The latest run is read before the pending display: starting the run sets the plain facts displayNow() reads. A
    // string result of the latest run is shown as is; any other state (unresolved, undefined, superseded) shows the
    // pending display evaluated afresh.
    let display = $derived.by((): PendingDisplay => {
        const run = markParsingResult
        const done = resolution
        if(done && done.run === run && typeof done.md === 'string'){
            return { kind: 'html', html: done.md }
        }
        return displayNow()
    })

    // Two levels on purpose: the string is compared by value, so an equal result neither sanitizes again nor writes the
    // DOM. The sanitize stays a tracked read of the hooks' DB flags (hideAllImages) through `sanitized`.
    let displayHtml = $derived(htmlOf(display))
    // Large asset images wait for the load queue only where a scan can promote them: a caller that supplies `bodyRoot`.
    // The read is untracked, so the wrapper binding later does not sanitize again.
    let sanitized = $derived(addMetadataToElement(trimMarkdown(displayHtml, { deferLargeAssetImages: untrack(() => bodyRoot !== undefined) }), modelShortName))

    $effect(() => {
        if(shouldRenderRawStreaming){
            return
        }
        const run = markParsingResult
        checkImg()
        run.then((md) => {
            commitRun(run, md)
        })
    })

    // Repairs images after the DOM holds the markup: every time the html site is created or its string changes. Raw
    // streaming returns first so the parse derived is never read while no parse is wanted.
    $effect(() => {
        if(shouldRenderRawStreaming || display.kind === 'indicator'){
            return
        }
        sanitized
        untrack(() => checkImg())
    })

    // Hands deferred images to the loader. `sanitized` and `bodyRoot` are tracked: on the first mount the wrapper is
    // still null, and the effect runs again, with the markup in the document, once it is bound.
    $effect(() => {
        if(shouldRenderRawStreaming || display.kind === 'indicator'){
            return
        }
        sanitized
        const root = bodyRoot
        if(!root){
            return
        }
        // Only a scan of rendered markup ends this body's wait in an open warm hold; a blank or spinner scan does not.
        const rendered = display.kind === 'html'
        untrack(() => loader.scan(root, rendered))
    })
</script>

{#if shouldRenderRawStreaming}
    <span class="whitespace-pre-wrap">{rawStreamingText}</span>
{:else if display.kind === 'indicator'}
    <span role="status" aria-label={language.loading} class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-textcolor2 border-t-transparent align-middle"></span>
{:else}
    {@html sanitized}
{/if}
