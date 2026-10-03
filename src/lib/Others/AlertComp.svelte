<script lang="ts">
    import { untrack } from "svelte";
    import { alertGenerationInfoStore, STALE_ACCOUNT_NOTICE_ACK, type alertData } from "../../ts/alert";
    import { ANSWER_GUARD_MS, isConsentType, isPromptType } from "../../ts/alertPrompts";
    import { coversPage } from "../../ts/alertEscape";
    import { UPSTREAM_AGREEMENT_ACCEPT, UPSTREAM_AGREEMENT_DECLINE } from "../../ts/upstreamAgreement";
    
    import { DBState } from 'src/ts/stores.svelte';
    import { getCharImage } from '../../ts/characters';
    import { isHiddenSystemCharacter } from '../../ts/hiddenCharacters';
    import { ParseMarkdown } from '../../ts/parser/parser.svelte';
    import BarIcon from '../SideBars/BarIcon.svelte';
    import { ChevronRightIcon, User } from '@lucide/svelte';
    import { isCharacterHasAssets } from 'src/ts/characterCards';
    import TextInput from '../UI/GUI/TextInput.svelte';
    import { aiLawApplies, openURL, getFetchLogs } from 'src/ts/globalApi.svelte';
    import Button from '../UI/GUI/Button.svelte';
    import { XIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon, CheckIcon } from "@lucide/svelte";
    import hljs from 'highlight.js/lib/core';
    import json from 'highlight.js/lib/languages/json';
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import OptionInput from "../UI/GUI/OptionInput.svelte";
    import { language } from 'src/lang';
    import { getFetchData } from 'src/ts/globalApi.svelte';
    import { alertStore, selectedCharID } from "src/ts/stores.svelte";
    import { nearViewport } from "src/ts/gui/nearViewport.svelte";
    import { SvelteMap } from "svelte/reactivity";
    import { tokenize } from "src/ts/tokenizer";
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import ModuleChatMenu from "../Setting/Pages/Module/ModuleChatMenu.svelte";
    import { ColorSchemeTypeStore } from "src/ts/gui/colorscheme";
    import { getChatBranches } from "src/ts/gui/branches";
    import { getCurrentCharacter } from "src/ts/storage/database.svelte";
    import { translateStackTrace } from "../../ts/sourcemap";
    import { getDetailedOSLabel, getFallbackOSLabel, getRisuEnvironmentLabel } from "src/ts/platform";
    import versionData from "../../../version.json";

    let showDetails = $state(false);
    let translatedStackTrace = $state('');
    let stackTraceTranslationFailed = $state(false);
    let isTranslating = $state(false);
    let osLabel = $state(getFallbackOSLabel());
    const displayedStackTrace = $derived(translatedStackTrace || $alertStore.stackTrace || '');
    const risuVersion = versionData.version;
    const risuEnvironment = getRisuEnvironmentLabel();
    const userAgent = typeof navigator === "undefined" ? "Unknown" : navigator.userAgent || "Unknown";
    const stackTraceCodeBlock = $derived.by(() => {
        const lines = [
            `Risu version: ${risuVersion}`,
            `OS: ${osLabel}`,
            `User-Agent: ${userAgent}`,
            `Risu environment: ${risuEnvironment}`
        ]

        if (stackTraceTranslationFailed) {
            lines.push(language.stackTraceTranslationFailed)
        } else if (isTranslating) {
            lines.push(language.translating)
        }

        if (displayedStackTrace) {
            lines.push('', displayedStackTrace)
        }

        return lines.join('\n')
    });

    let btn
    let input = $state('')
    let cardExportType = $state('realm')
    let cardExportType2 = $state('')
    let cardLicense = $state('')
    let generationInfoMenuIndex = $state(0)
    let branchHover:null|{
        x:number,
        y:number,
        content:string,
    } = $state(null)
    let expandedLogs: Set<number> = $state(new Set())
    let allExpanded = $state(false)
    let copiedKey: string | null = $state(null)
    // db.characters indices near the selectChar dialog's own scroll viewport,
    // mapped to their owning element (see GridCatalog.svelte's comment on
    // `visibleIndices` for why a Map, not a Set). Keyed by index, not chaId:
    // the dialog never reorders db.characters, and it skips groups, trashed
    // and hidden system characters in place, so an index stays a valid key.
    // chaId uniqueness isn't guaranteed (older saves can lack it, and
    // duplicates/copies can collide), so a chaId key risks Svelte's
    // each_key_duplicate crash.
    let visibleSelectChars = new SvelteMap<number, Element>()

    // Register JSON language for syntax highlighting
    if (!hljs.getLanguage('json')) {
        hljs.registerLanguage('json', json)
    }

    $effect(() => {
        void loadDetailedOSLabel();
    });

    function highlightJson(code: string): string {
        try {
            return hljs.highlight(code, { language: 'json' }).value
        } catch {
            return code.replace(/</g, '&lt;').replace(/>/g, '&gt;')
        }
    }

    async function copyToClipboard(text: string, key: string) {
        try {
            await navigator.clipboard.writeText(text)
        } catch {
            // fallback
            const textarea = document.createElement('textarea')
            textarea.value = text
            document.body.appendChild(textarea)
            textarea.select()
            document.execCommand('copy')
            document.body.removeChild(textarea)
        }
        copiedKey = key
        setTimeout(() => {
            if (copiedKey === key) copiedKey = null
        }, 1500)
    }

    async function loadDetailedOSLabel() {
        try {
            osLabel = await getDetailedOSLabel();
        } catch (error) {
            console.warn("Failed to load detailed OS information:", error);
        }
    }

    $effect.pre(() => {
        showDetails = false;
        translatedStackTrace = '';
        stackTraceTranslationFailed = false;
        isTranslating = false;
        if(btn){
            btn.focus()
        }
        if($alertStore.type !== 'branches'){
            branchHover = null
        }
        if($alertStore.type !== 'requestlogs'){
            expandedLogs = new Set()
            allExpanded = false
        }
    });

    // The prompt whose dialog is kept mounted. Another alert that covers it
    // hides the dialog instead of unmounting it, so what the user typed,
    // chose or scrolled to is still there when the prompt comes back. It is
    // replaced by the next prompt object and dropped when the store closes.
    // The consent prompts are not held: they defend their own place on screen
    // and are shown like any other alert.
    let held: alertData | null = $state.raw(null)
    const promptCovered = $derived(held !== null && $alertStore !== held)

    function resetPromptState() {
        input = ''
        cardExportType = 'realm'
        cardExportType2 = ''
        cardLicense = ''
    }

    $effect.pre(() => {
        const value = $alertStore
        const keptPrompt = untrack(() => held)
        if(isPromptType(value.type) && !isConsentType(value.type)){
            if(value !== keptPrompt){
                held = value
                resetPromptState()
            }
        }
        else if(value.type === 'none' && keptPrompt !== null){
            held = null
            resetPromptState()
        }
    });

    // The consent dialogs take no click until the pause after each appearance is over, so a press
    // meant for what was on screen before cannot answer them.
    let consentSeen: alertData | null = null
    let consentShownAt = 0

    $effect.pre(() => {
        const value = $alertStore
        if(value !== consentSeen){
            consentSeen = value
            consentShownAt = performance.now()
        }
    });

    function consentPaused(): boolean {
        return performance.now() - consentShownAt < ANSWER_GUARD_MS
    }

    let root: HTMLElement | undefined
    // What the focus was last moved for. A `wait` or `progress` update is a new object every time, so
    // for those the type stands for the alert; every other alert is its object.
    let focusedFor: alertData | 'wait' | 'progress' | null = null

    // Focus goes to a box of the shown alert, never to a control: Enter or Space that opened the
    // alert would press a focused button.
    $effect(() => {
        const value = $alertStore
        if(!coversPage(value.type)){
            focusedFor = null
            return
        }
        const identity = value.type === 'wait' || value.type === 'progress' ? value.type : value
        if(identity === focusedFor){
            return
        }
        focusedFor = identity
        const box = Array.from(root?.querySelectorAll<HTMLElement>('[data-alert-box]') ?? [])
            .find((el) => el.closest('[inert]') === null)
        if(box && document.activeElement !== box){
            box.focus({ preventScroll: true })
        }
    });

    $effect(() => {
        if ($alertStore.type === 'error' && $alertStore.stackTrace && !translatedStackTrace && !stackTraceTranslationFailed && !isTranslating) {
            void loadTranslatedTrace();
        }
    });

    async function loadTranslatedTrace() {
        if (isTranslating || translatedStackTrace || stackTraceTranslationFailed || !$alertStore.stackTrace) return;
        isTranslating = true;
        try {
            const result = await translateStackTrace($alertStore.stackTrace);
            if (result.didTranslate) {
                translatedStackTrace = result.stackTrace;
            } else {
                stackTraceTranslationFailed = true;
            }
        } catch (e) {
            console.error("Failed to translate stack trace:", e);
            stackTraceTranslationFailed = true;
        } finally {
            isTranslating = false;
        }
    }

    const beautifyJSON = (data:string) =>{
        try {
            return JSON.stringify(JSON.parse(data), null, 2)
        } catch (error) {
            return data
        }
    }
</script>

{#snippet alertView(a: alertData)}
{#if a.type !== 'none' &&  a.type !== 'toast' &&  a.type !== 'cardexport' && a.type !== 'branches' && a.type !== 'selectModule' && a.type !== 'pukmakkurit' && a.type !== 'requestlogs'}
    <div class="absolute w-full h-full z-50 bg-black/50 flex justify-center items-center" class:vis={ a.type === 'wait2'}>
        <div class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl  max-h-full overflow-y-auto outline-none" tabindex="-1" data-alert-box>
            {#if a.type === 'error'}
                <h2 class="text-red-700 mt-0 mb-2 w-40 max-w-full">{language.error}</h2>
            {:else if a.type === 'ask'}
                <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.confirm}</h2>
            {:else if a.type === 'pluginconfirm'}
                <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.alertComp.pluginImport}</h2>
            {:else if a.type === 'selectChar'}
                <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.select}</h2>
            {:else if a.type === 'input'}
                <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.input}</h2>
            {/if}
            {#if a.type === 'markdown'}
                <div class="overflow-y-auto">
                    <span class="text-gray-300 chattext prose chattext2" class:prose-invert={$ColorSchemeTypeStore}>
                        {#await ParseMarkdown(a.msg) then msg}
                            {@html msg}                        
                        {/await}
                    </span>
                </div>
            {:else if a.type === 'tos'}
                <!-- svelte-ignore a11y_missing_attribute -->
                <!-- svelte-ignore a11y_click_events_have_key_events -->

                <div class="text-textcolor">{language.upstreamAgreementPromptBefore}<a role="button" tabindex="0" class="text-green-600 hover:text-green-500 transition-colors duration-200 cursor-pointer" onclick={() => {
                        openURL('https://account.sionyw.com/terms')
                    }}>{language.upstreamAgreementTermsOfService}</a>{language.upstreamAgreementPromptBetween}<a role="button" tabindex="0" class="text-green-600 hover:text-green-500 transition-colors duration-200 cursor-pointer" onclick={() => {
                        openURL('https://account.sionyw.com/privacy')
                    }}>{language.upstreamAgreementPrivacyPolicy}</a>{language.upstreamAgreementPromptAfter}</div>
            {:else if a.type === 'pluginconfirm'}
                {@const parts = a.msg.split('\n\n')}
                {@const mainPart = parts[0]}
                {@const confirmMessage = parts[1]}
                {@const mainParts = mainPart.split('\n')}
                {@const pluginName = mainParts[0]}
                {@const warnings = mainParts.slice(1)}
                <div class="plugin-confirm-content">
                    <p class="plugin-name">{pluginName}</p>
                    {#if warnings.length > 0}
                        <ul class="warnings-list">
                            {#each warnings as warning}
                                <li class="warning-item">{warning}</li>
                            {/each}
                        </ul>
                    {/if}
                    <p class="confirm-message">{confirmMessage}</p>
                </div>
            {:else if a.type !== 'select' && a.type !== 'requestdata' && a.type !== 'addchar' && a.type !== 'hypaV2' && a.type !== 'chatOptions'}
                <span class="text-gray-300 whitespace-pre-wrap">{a.msg}</span>
                {#if a.submsg && a.type !== 'progress'}
                    <span class="text-gray-500 text-sm">{a.submsg}</span>
                {/if}

                {#if a.type === 'error' && a.stackTrace}
                    <div class="mt-4">
                        <Button styled="outlined" size="sm" onclick={() => showDetails = !showDetails}>
                            {showDetails ? language.hideErrorDetails : language.showErrorDetails}
                            {#if showDetails}
                                <XIcon class="inline ml-2" />
                            {:else}
                                <ChevronRightIcon class="inline ml-2" />
                            {/if}
                        </Button>
                        {#if showDetails}
                            <div class="stack-trace-wrap">
                                <button
                                    class="stack-trace-copy"
                                    onclick={() => copyToClipboard(stackTraceCodeBlock, 'stack-trace')}
                                    title={language.copy}
                                    aria-label={language.copy}
                                >
                                    {#if copiedKey === 'stack-trace'}
                                        <CheckIcon size={14} />
                                    {:else}
                                        <CopyIcon size={14} />
                                    {/if}
                                </button>
                                <pre class="stack-trace">{stackTraceCodeBlock}</pre>
                            </div>
                        {/if}
                    </div>
                {/if}
            {/if}
            {#if a.type === 'wait' && a.onCancel}
                <div class="flex w-full">
                    <Button styled="outlined" className="mt-4 grow" onclick={() => {
                        a.onCancel?.()
                    }}>{language.cancel}</Button>
                </div>
            {/if}

            {#if a.type === 'progress'}
                <div class="w-full min-w-64 md:min-w-138 h-2 bg-darkbg border border-darkborderc rounded-md mt-6">
                    <div class="h-full bg-linear-to-r from-blue-500 to-purple-800 saving-animation transition-[width]" style:width={a.submsg + '%'}></div>
                </div>
                <div class="w-full flex justify-center mt-6">
                    <span class="text-gray-500 text-sm">{a.submsg + '%'}</span>
                </div>
            {/if}

            {#if a.type === 'ask' || a.type === 'pluginconfirm'}
                <div class="flex gap-2 w-full">
                    <Button className="mt-4 grow" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'yes'
                        })
                    }}>{language.alertComp.yes}</Button>
                    <Button className="mt-4 grow" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'no'
                        })
                    }}>{language.alertComp.no}</Button>
                </div>
            {:else if a.type === 'tos' && import.meta.env.VITE_RISU_LEGAL_CONFIGURED}
                <div class="flex gap-2 w-full">
                    <Button className="mt-4 grow" onclick={() => {
                        if(consentPaused()){
                            return
                        }
                        alertStore.set({
                            type: 'none',
                            msg: UPSTREAM_AGREEMENT_ACCEPT
                        })
                    }}>{language.upstreamAgreementAccept}</Button>
                    <Button styled={'outlined'} className="mt-4 grow" onclick={() => {
                        if(consentPaused()){
                            return
                        }
                        alertStore.set({
                            type: 'none',
                            msg: UPSTREAM_AGREEMENT_DECLINE
                        })
                    }}>{language.upstreamAgreementDecline}</Button>
                </div>
            {:else if a.type === 'select'}
                {@const hasDisplay = a.msg.startsWith('__DISPLAY__')}
                {#if hasDisplay}
                    {@const parts = a.msg.substring(11).split('||')}
                    <div class="mb-4 text-textcolor">{parts[0]}</div>
                    {#each parts.slice(1) as n, i}
                        <Button className="mt-4" onclick={() => {
                            alertStore.set({
                                type: 'none',
                                msg: i.toString()
                            })
                        }}>{n}</Button>
                    {/each}
                {:else}
                    {@const parts = a.msg.split('||')}
                    {#each parts as n, i}
                        <Button className="mt-4" onclick={() => {
                            alertStore.set({
                                type: 'none',
                                msg: i.toString()
                            })
                        }}>{n}</Button>
                    {/each}
                {/if}
            {:else if a.type === 'error' || a.type === 'normal' || a.type === 'markdown'}
               <Button className="mt-4" onclick={() => {
                    alertStore.set({
                        type: 'none',
                        msg: ''
                    })
                }}>{language.alertComp.ok}</Button>
            {:else if a.type === 'staleAccountNotice'}
               <Button className="mt-4" onclick={() => {
                    if(consentPaused()){
                        return
                    }
                    alertStore.set({
                        type: 'none',
                        msg: STALE_ACCOUNT_NOTICE_ACK
                    })
                }}>{language.alertComp.ok}</Button>
            {:else if a.type === 'input'}
                <TextInput value={a.defaultValue} id="alert-input" autocomplete="off" marginTop list="alert-input-list" />
                <Button className="mt-4" onclick={() => {
                    alertStore.set({
                        type: 'none',
                        //@ts-expect-error 'value' doesn't exist on Element, but target is HTMLInputElement here
                        msg: document.querySelector('#alert-input')?.value
                    })
                }}>{language.alertComp.ok}</Button>
                {#if a.datalist}
                    <datalist id="alert-input-list">
                        {#each a.datalist as item}
                            <option
                                value={item[0]}
                                label={item[1] ? item[1] : item[0]}
                            >{item[1] ? item[1] : item[0]}</option>
                        {/each}
                    </datalist>
                {/if}
            {:else if a.type === 'selectChar'}
                <div class="flex w-full items-start flex-wrap gap-2 justify-start">
                    {#each DBState.db.characters as char, i (i)}
                        {#if char.type !== 'group' && !char.trashTime && !isHiddenSystemCharacter(char)}
                            {@const imgPath = char.image}
                            {@const isVisible = visibleSelectChars.has(i)}
                            {@const avatarStyle = isVisible ? getCharImage(imgPath, 'thumbcss') : ''}
                            <div use:nearViewport={{ onChange: (v, node) => {
                                if (v) { visibleSelectChars.set(i, node) } else if (visibleSelectChars.get(i) === node) { visibleSelectChars.delete(i) }
                            } }}>
                            {#if imgPath}
                                <BarIcon onClick={() => {
                                    alertStore.set({type: 'none',msg: char.chaId})
                                }} additionalStyle={avatarStyle} />
                            {:else}
                                <BarIcon onClick={() => {
                                    alertStore.set({type: 'none',msg: char.chaId})
                                }}>
                                <User/>
                                </BarIcon>
                            {/if}
                            </div>
                        {/if}
                    {/each}
                </div>
                <div class="flex w-full">
                    <Button styled="outlined" className="mt-4 grow" onclick={() => {
                        alertStore.set({type: 'none', msg: ''})
                    }}>{language.cancel}</Button>
                </div>
            {:else if a.type === 'requestdata'}
                {#if aiLawApplies()}
                <div>
                    {language.generatedByAIDisclaimer}
                </div>
                {/if}
                <div class="flex flex-wrap gap-2">
                    <Button selected={generationInfoMenuIndex === 0} size="sm" onclick={() => {generationInfoMenuIndex = 0}}>
                        {language.tokens}
                    </Button>
                    <Button selected={generationInfoMenuIndex === 1} size="sm" onclick={() => {generationInfoMenuIndex = 1}}>
                        {language.metaData}
                    </Button>
                    <Button selected={generationInfoMenuIndex === 2} size="sm" onclick={() => {generationInfoMenuIndex = 2}}>
                        {language.log}
                    </Button>
                    <Button selected={generationInfoMenuIndex === 3} size="sm" onclick={() => {generationInfoMenuIndex = 3}}>
                        {language.prompt}
                    </Button>
                    <button class="ml-auto" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: ''
                        })
                    }}>✖</button>
                </div>
                {#if generationInfoMenuIndex === 0}
                    <div class="mt-4 flex justify-center w-full">
                        <div class="w-32 h-32 border-darkborderc border-4 rounded-lg" style:background={
                            `linear-gradient(0deg,
                            rgb(59,130,246) 0%,
                            rgb(59,130,246) ${($alertGenerationInfoStore.genInfo.inputTokens / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(34 197 94) ${($alertGenerationInfoStore.genInfo.inputTokens / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(34 197 94) ${(($alertGenerationInfoStore.genInfo.outputTokens + $alertGenerationInfoStore.genInfo.inputTokens) / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(156 163 175) ${(($alertGenerationInfoStore.genInfo.outputTokens + $alertGenerationInfoStore.genInfo.inputTokens) / $alertGenerationInfoStore.genInfo.maxContext) * 100}%,
                            rgb(156 163 175) 100%)`
                        }>

                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-y-2 gap-x-4 mt-4">
                        <span class="text-blue-500">{language.inputTokens}</span>
                        <span class="text-blue-500 justify-self-end">{$alertGenerationInfoStore.genInfo.inputTokens ?? '?'} {language.tokens}</span>
                        <span class="text-green-500">{language.outputTokens}</span>
                        <span class="text-green-500 justify-self-end">{$alertGenerationInfoStore.genInfo.outputTokens ?? '?'} {language.tokens}</span>
                        <span class="text-gray-400">{language.maxContextSize}</span>
                        <span class="text-gray-400 justify-self-end">{$alertGenerationInfoStore.genInfo.maxContext ?? '?'} {language.tokens}</span>
                    </div>
                    <span class="text-textcolor2 text-sm">{language.tokenWarning}</span>
                {/if}
                {#if generationInfoMenuIndex === 1}
                <div class="grid grid-cols-2 gap-y-2 gap-x-4 mt-4">
                    <span class="text-blue-500">{language.index}</span>
                    <span class="text-blue-500 justify-self-end">{$alertGenerationInfoStore.idx}</span>
                    <span class="text-amber-500">{language.model}</span>
                    <span class="text-amber-500 justify-self-end">{$alertGenerationInfoStore.genInfo.model}</span>
                    <span class="text-green-500">ID</span>
                    <span class="text-green-500 justify-self-end">{DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].chatId ?? language.none}</span>
                    <span class="text-red-500">GenID</span>
                    <span class="text-red-500 justify-self-end">{$alertGenerationInfoStore.genInfo.generationId}</span>
                    <span class="text-cyan-500">{language.alertComp.saying}</span>
                    <span class="text-cyan-500 justify-self-end">{DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].saying}</span>
                    <span class="text-purple-500">{language.alertComp.size}</span>
                    <span class="text-purple-500 justify-self-end">{JSON.stringify(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx]).length} Bytes</span>
                    <span class="text-yellow-500">{language.alertComp.time}</span>
                    <span class="text-yellow-500 justify-self-end">{(new Date(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].time ?? 0)).toLocaleString()}</span>
                    {#if $alertGenerationInfoStore.genInfo.stageTiming}
                        {@const stage1 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage1 ?? 0) / 1000).toFixed(1)))}
                        {@const stage2 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage2 ?? 0) / 1000).toFixed(1)))}
                        {@const stage3 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage3 ?? 0) / 1000).toFixed(1)))}
                        {@const stage4 = parseFloat(((($alertGenerationInfoStore.genInfo.stageTiming.stage4 ?? 0) / 1000).toFixed(1)))}
                        {@const totalRounded = (stage1 + stage2 + stage3 + stage4).toFixed(1)}
                        <span class="text-gray-400">{language.alertComp.timing}</span>
                        <span class="text-gray-400 justify-self-end">
                            <span style="color: #60a5fa;">{stage1}</span> + 
                            <span style="color: #db2777;">{stage2}</span> + 
                            <span style="color: #34d399;">{stage3}</span> + 
                            <span style="color: #8b5cf6;">{stage4}</span> = 
                            <span class="text-white font-bold">{totalRounded}s</span>
                        </span>
                    {/if}

                    <span class="text-green-500">{language.tokens}</span>
                    {#await tokenize(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].data)}
                        <span class="text-green-500 justify-self-end">{language.alertComp.loading}</span>
                    {:then tokens} 
                        <span class="text-green-500 justify-self-end">{tokens}</span>
                    {/await}
                </div>
                {/if}
                {#if generationInfoMenuIndex === 2}
                    {#await getFetchData(a.msg) then data} 
                        {#if !data}
                            <span class="text-gray-300 text-lg mt-2">{language.errors.requestLogRemoved}</span>
                            <span class="text-gray-500">{language.errors.requestLogRemovedDesc}</span>
                        {:else}
                            <h1 class="text-2xl font-bold my-4">URL</h1>
                            <code class="text-gray-300 border border-darkborderc p-2 rounded-md whitespace-pre-wrap">{data.url}</code>
                            <h1 class="text-2xl font-bold my-4">Request Body</h1>
                            <code class="text-gray-300 border border-darkborderc p-2 rounded-md whitespace-pre-wrap">{beautifyJSON(data.body)}</code>
                            <h1 class="text-2xl font-bold my-4">Response</h1>
                            <code class="text-gray-300 border border-darkborderc p-2 rounded-md whitespace-pre-wrap">{beautifyJSON(data.response)}</code>
                        {/if}
                    {/await}
                {/if}
                {#if generationInfoMenuIndex === 3}
                    {#if Object.keys(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo || {}).length === 0}
                        <div class="text-gray-300 text-lg mt-2">{language.promptInfoEmptyMessage}</div>
                    {:else}
                        <div class="grid grid-cols-2 gap-y-2 gap-x-4 mt-4">
                            <span class="text-blue-500">{language.alertComp.presetName}</span>
                            <span class="text-blue-500 justify-self-end">{DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptName}</span>
                            <span class="text-purple-500">{language.alertComp.toggles}</span>
                            <div class="col-span-2 max-h-32 overflow-y-auto border border-stone-500 rounded-sm p-2 bg-gray-900">
                                {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptToggles.length === 0}
                                    <div class="text-gray-500 italic text-center py-4">{language.promptInfoEmptyToggle}</div>
                                {:else}
                                    <div class="grid grid-cols-2 gap-y-2 gap-x-4">
                                        {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptToggles as toggle}
                                        <span class="text-gray-200 truncate">{toggle.key}</span>
                                        <span class="text-gray-200 justify-self-end truncate">{toggle.value}</span>
                                        {/each}
                                    </div>
                                {/if}
                            </div>
                            <span class="text-red-500">{language.alertComp.promptText}</span>
                            <div class="col-span-2 max-h-80 overflow-y-auto border border-stone-500 rounded-sm p-4 bg-gray-900">
                                {#if !DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptText}
                                    <div class="text-gray-500 italic text-center py-4">{language.promptInfoEmptyText}</div>
                                {:else}
                                    {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].message[$alertGenerationInfoStore.idx].promptInfo.promptText as block}
                                        <div class="mb-2">
                                            <div class="font-bold text-gray-600">{block.role}</div>
                                            <pre class="whitespace-pre-wrap text-sm bg-stone-900 p-2 rounded-sm border border-stone-500">{block.content}</pre>
                                        </div>
                                    {/each}
                                {/if}
                            </div>
                        </div>
                    {/if}
                {/if}
            {:else if a.type === 'hypaV2'}
                <div class="flex flex-wrap gap-2 mb-4 max-w-full w-124">
                    <Button selected={generationInfoMenuIndex === 0} size="sm" onclick={() => {generationInfoMenuIndex = 0}}>
                        Chunks
                    </Button>
                    <Button selected={generationInfoMenuIndex === 1} size="sm" onclick={() => {generationInfoMenuIndex = 1}}>
                        {language.alertComp.summarized}
                    </Button>
                    <button class="ml-auto" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: ''
                        })
                    }}>✖</button>
                </div>
                {#if generationInfoMenuIndex === 0}
                    <div class="flex flex-col gap-2 w-full">
                        {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].hypaV2Data.chunks as chunk, i}
                            <TextAreaInput bind:value={chunk.text} />
                        {/each}

                        <!-- Adding non-bound chunk is not okay, change the user flow to edit existing ones. -->
                    </div>
                {:else}
                    {#each DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].hypaV2Data.mainChunks as chunk, i} <!-- Summarized should be mainChunks, afaik. Be aware of that chunks are created with mainChunks, however this editing would not change related chunks. -->
                        <div class="flex flex-col p-2 rounded-md border-darkborderc border">
                            {#if i === 0}
                                <span class="text-green-500">{language.active}</span>
                            {:else}
                                <span>{language.alertComp.inactive}</span>
                            {/if}
                            <TextAreaInput bind:value={chunk.text} />
                        </div>
                    {/each}
                {/if}
            {:else if a.type === 'addchar'}
                <div class="w-2xl flex flex-col max-w-full">

                    <button class="border-darkborderc border py-12 px-8 flex rounded-md hover:ring-2 justify-center items-center" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'importFromRealm'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span class="text-2xl font-bold">{language.importFromRealm}</span>
                            <span class="text-textcolor2">{language.importFromRealmDesc}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={((e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'importCharacter'
                        })
                    })}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.importCharacter}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'createfromScratch'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.createfromScratch}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'createGroup'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.createGroup}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        alertStore.set({
                            type: 'none',
                            msg: 'cancel'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.cancel}</span>
                        </div>
                    </button>
                </div>
            {:else if a.type === 'chatOptions'}
                <div class="w-2xl flex flex-col max-w-full">
                    <h1 class="text-xl mb-4 font-bold">
                        {language.chatOptions}
                    </h1>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: '0'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.createCopy}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: '1'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.bindPersona}</span>
                        </div>
                        <div class="ml-9 float-right flex-1 flex justify-end">
                            <ChevronRightIcon />
                        </div>
                    </button>
                    <button class="border-darkborderc border py-2 px-8 flex rounded-md hover:ring-2 items-center mt-2" onclick={() => {
                        alertStore.set({
                            type: 'none',
                            msg: 'cancel'
                        })
                    }}>
                        <div class="flex flex-col justify-start items-start">
                            <span>{language.cancel}</span>
                        </div>
                    </button>
                </div>
            {/if}
        </div>
    </div>

{:else if a.type === 'cardexport'}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div  class="fixed top-0 left-0 h-full w-full bg-black/50 flex flex-col z-50 items-center justify-center" role="button" tabindex="0" onclick={close}>
        <div class="bg-darkbg rounded-md p-4 max-w-full flex flex-col w-2xl" role="button" tabindex="0" onclick={(e) => {
            e.stopPropagation()
        }}>
            <h1 class="font-bold text-2xl w-full outline-none" tabindex="-1" data-alert-box>
                <span>
                    {language.shareExport}
                </span>
                <button class="float-right text-textcolor2 hover:text-green-500" onclick={() => {
                    alertStore.set({
                        type: 'none',
                        msg: JSON.stringify({
                            type: 'cancel',
                            type2: cardExportType2
                        })
                    })
                }}>
                    <XIcon />
                </button>
            </h1>
            <span class="text-textcolor mt-4">{language.type}</span>
            {#if cardExportType === ''}
                {#if a.submsg === 'module'}
                    <span class="text-textcolor2 text-sm">{language.risuMDesc}</span>
                {:else if a.submsg === 'preset'}
                    <span class="text-textcolor2 text-sm">{language.risupresetDesc}</span>
                    {#if cardExportType2 === 'preset' && (DBState.db.botPresets[DBState.db.botPresetsId].image || DBState.db.botPresets[DBState.db.botPresetsId].regex?.length > 0)}
                        <span class="text-red-500 text-sm">{language.alertComp.realmShareNotice}</span>
                    {/if}
                {:else}
                    <span class="text-textcolor2 text-sm">{language.ccv3Desc}</span>
                    {#if cardExportType2 !== 'charx' && cardExportType2 !== 'charxJpeg' && isCharacterHasAssets(DBState.db.characters[$selectedCharID])}
                        <span class="text-red-500 text-sm">{language.notCharxWarn}</span>
                    {/if}
                {/if}
            {:else if cardExportType === 'json'}
                <span class="text-textcolor2 text-sm">{language.jsonDesc}</span>
            {:else if cardExportType === 'ccv2'}
                <span class="text-textcolor2 text-sm">{language.ccv2Desc}</span>
                <span class="text-red-500 text-sm">{language.v2Warning}</span>
            {:else}
                <span class="text-textcolor2 text-sm">{language.realmDesc}</span>
            {/if}
            <div class="flex items-center flex-wrap mt-2">
                {#if a.submsg === 'preset'}
                    <button class="bg-bgcolor px-2 py-4 rounded-lg flex-1" class:ring-1={cardExportType === 'realm'} onclick={() => {cardExportType = 'realm'}}>RisuRealm</button>
                    <button class="bg-bgcolor px-2 py-4 rounded-lg ml-2 flex-1" class:ring-1={cardExportType === ''} onclick={() => {cardExportType = ''}}>Risupreset</button>
                {:else if a.submsg === 'module'}
                    <button class="bg-bgcolor px-2 py-4 rounded-lg ml-2 flex-1" class:ring-1={cardExportType === 'realm'} onclick={() => {cardExportType = 'realm'}}>RisuRealm</button>
                    <button class="bg-bgcolor px-2 py-4 rounded-lg flex-1" class:ring-1={cardExportType === ''} onclick={() => {cardExportType = ''}}>RisuM</button>
                {:else}
                    <button class="bg-bgcolor px-2 py-4 rounded-lg flex-1" class:ring-1={cardExportType === 'realm'} onclick={() => {cardExportType = 'realm'}}>RisuRealm</button>
                    <button class="bg-bgcolor px-2 py-4 rounded-lg ml-2 flex-1" class:ring-1={cardExportType === ''} onclick={() => {
                        cardExportType = ''
                        cardExportType2 = 'charxJpeg'
                    }}>Character Card V3</button>
                    <button class="bg-bgcolor px-2 py-4 rounded-lg ml-2 flex-1" class:ring-1={cardExportType === 'ccv2'} onclick={() => {cardExportType = 'ccv2'}}>Character Card V2</button>
                {/if}
            </div>
            {#if a.submsg === '' && cardExportType === ''}
                <span class="text-textcolor mt-4">{language.format}</span>
                <SelectInput bind:value={cardExportType2} className="mt-2">
                    <OptionInput value="charx">CHARX</OptionInput>
                    <OptionInput value="charxJpeg">CHARX-JPEG</OptionInput>
                    <OptionInput value="">PNG</OptionInput>
                    <OptionInput value="json">JSON</OptionInput>
                </SelectInput>
            {/if}
            <Button className="mt-4" onclick={() => {
                alertStore.set({
                    type: 'none',
                    msg: JSON.stringify({
                        type: cardExportType,
                        type2: cardExportType2
                    })
                })
            }}>{cardExportType === 'realm' ? language.shareCloud : language.export}</Button>
        </div>
    </div>

{:else if a.type === 'toast'}
    <div class="toast-anime absolute right-0 bottom-0 bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl  max-h-11/12 overflow-y-auto z-50 text-textcolor"
        onanimationend={() => {
            alertStore.set({
                type: 'none',
                msg: ''
            })
        }}
    >{a.msg}</div>
{:else if a.type === 'selectModule'}
    <ModuleChatMenu alertMode close={(d) => {
        alertStore.set({
            type: 'none',
            msg: d
        })
    }} />
{:else if a.type === 'pukmakkurit'}
    <!-- Log Generator by dootaang, GPL3 -->
    <!-- Svelte, Typescript version by Kwaroran -->
    
    <div class="absolute w-full h-full z-50 bg-black/50 flex justify-center items-center">
        <div class="bg-darkbg p-4 break-any rounded-md flex flex-col max-w-3xl  max-h-full overflow-y-auto outline-none" tabindex="-1" data-alert-box>
            <h2 class="text-green-700 mt-0 mb-2 w-40 max-w-full">{language.preview}</h2>

        </div>
    </div>
{:else if a.type === 'branches'}
    <div class="absolute w-full h-full z-50 bg-black/80 flex justify-center items-center overflow-x-auto overflow-y-auto outline-none" tabindex="-1" data-alert-box>
        {#if branchHover !== null}
            <div class="z-30 whitespace-pre-wrap p-4 text-textcolor bg-darkbg border-darkborderc border rounded-md absolute" style="top: {branchHover.y * 80 + 24}px; left: {(branchHover.x + 1) * 80 + 24}px">
                {branchHover.content}
            </div>
        {/if}

        <div class="x-50 right-2 top-2 absolute">
            <button class="bg-darkbg border-darkborderc border p-2 rounded-md" onclick={() => {
                alertStore.set({
                    type: 'none',
                    msg: ''
                })
            }}>
                <XIcon />
            </button>
        </div>

        {#each getChatBranches() as obj}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <div
                role="table"
                class="peer w-12 h-12 z-20 bg-bgcolor border border-darkborderc rounded-full flex justify-center items-center overflow-y-auto absolute"
                style="top: {obj.y * 80 + 24}px; left: {obj.x * 80 + 24}px"
                onmouseenter={() => {
                    if(branchHover === null){
                        const char = getCurrentCharacter()
                        branchHover = {
                            x: obj.x,
                            y: obj.y,
                            content: char.chats[obj.chatId].message[obj.y - 1].data
                        }
                    }
                }}
                onclick={() => {
                    if(branchHover === null){
                        const char = getCurrentCharacter()
                        branchHover = {
                            x: obj.x,
                            y: obj.y,
                            content: char.chats[obj.chatId].message[obj.y - 1].data
                        }
                    }
                }}
                onmouseleave={() => {
                    branchHover = null
                }}
            >
                
            </div>
            {#if obj.connectX === obj.x}
                {#if obj.multiChild}
                    <div class="w-0 h-20 border-x border-x-red-500 absolute" style="top: {(obj.y-1) * 80 + 24}px; left: {obj.x * 80 + 45}px">

                    </div>
                {:else}
                    <div class="w-0 h-20 border-x border-x-blue-500 absolute" style="top: {(obj.y-1) * 80 + 24}px; left: {obj.x * 80 + 45}px">

                    </div>
                {/if}
            {:else if obj.connectX !== -1}
                <div class="w-0 h-10 border-x border-x-red-500 absolute" style="top: {(obj.y) * 80}px; left: {obj.x * 80 + 45}px">

                </div>
                <div class="h-0 border-y border-y-red-500 absolute" style="top: {(obj.y) * 80}px; left: {obj.connectX * 80 + 46}px" style:width={Math.abs((obj.x - obj.connectX) * 80) + 'px'}>

                </div>
            {/if}
        {/each}
    </div>
{:else if a.type === 'requestlogs'}
    {@const logs = getFetchLogs()}
    <div class="fixed inset-0 z-50 bg-black/80 flex justify-center items-start overflow-y-auto p-4 outline-none" tabindex="-1" data-alert-box>
        <div class="bg-darkbg rounded-lg w-full max-w-4xl my-4 flex flex-col max-h-[90vh]">
            <div class="flex items-center justify-between p-4 border-b border-darkborderc sticky top-0 bg-darkbg z-10">
                <h1 class="text-xl font-bold text-textcolor">{language.ShowLog}</h1>
                <div class="flex items-center gap-2">
                    <Button size="sm" onclick={() => {
                        if(allExpanded) {
                            expandedLogs = new Set()
                        } else {
                            expandedLogs = new Set(logs.map((_, i) => i))
                        }
                        allExpanded = !allExpanded
                    }}>
                        {allExpanded ? language.collapseAll : language.expandAll}
                    </Button>
                    <button class="text-textcolor2 hover:text-textcolor p-1" onclick={() => {
                        alertStore.set({ type: 'none', msg: '' })
                    }}>
                        <XIcon />
                    </button>
                </div>
            </div>
            <div class="flex-1 overflow-y-auto p-4">
                {#if logs.length === 0}
                    <div class="text-textcolor2 text-center py-8">{language.noRequestLogs}</div>
                {:else}
                    <div class="flex flex-col gap-2">
                        {#each logs as log, i}
                            {@const isExpanded = expandedLogs.has(i)}
                            <div class="border border-darkborderc rounded-lg overflow-hidden">
                                <button
                                    class="w-full flex items-center justify-between p-3 hover:bg-bgcolor/50 transition-colors"
                                    onclick={() => {
                                        const newSet = new Set(expandedLogs)
                                        if(isExpanded) {
                                            newSet.delete(i)
                                        } else {
                                            newSet.add(i)
                                        }
                                        expandedLogs = newSet
                                    }}
                                >
                                    <div class="flex items-center gap-3 min-w-0 flex-1">
                                        <span class="px-2 py-1 rounded text-xs font-bold font-mono {log.success ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}">
                                            {log.status ?? (log.success ? 'OK' : 'ERR')}
                                        </span>
                                        <span class="text-textcolor text-sm truncate flex-1 text-left font-mono" title={log.url}>
                                            {log.url}
                                        </span>
                                        <span class="text-textcolor text-xs whitespace-nowrap opacity-70">{log.date}</span>
                                    </div>
                                    <div class="ml-2 text-textcolor">
                                        {#if isExpanded}
                                            <ChevronUpIcon size={20} />
                                        {:else}
                                            <ChevronDownIcon size={20} />
                                        {/if}
                                    </div>
                                </button>
                                {#if isExpanded}
                                    <div class="border-t border-darkborderc p-4 bg-bgcolor/30">
                                        <div class="space-y-4">
                                            <div>
                                                <div class="flex items-center justify-between mb-2">
                                                    <span class="text-textcolor text-sm font-semibold">URL</span>
                                                    <button
                                                        class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${i}-url` ? 'text-green-500' : 'text-textcolor2 hover:text-textcolor'}"
                                                        onclick={(e) => { e.stopPropagation(); copyToClipboard(log.url, `${i}-url`) }}
                                                        title={language.copy}
                                                    >
                                                        {#if copiedKey === `${i}-url`}
                                                            <CheckIcon size={14} />
                                                        {:else}
                                                            <CopyIcon size={14} />
                                                        {/if}
                                                    </button>
                                                </div>
                                                <pre class="request-log-code hljs text-sm">{log.url}</pre>
                                            </div>
                                            <div>
                                                <div class="flex items-center justify-between mb-2">
                                                    <span class="text-textcolor text-sm font-semibold">Request Body</span>
                                                    <button
                                                        class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${i}-body` ? 'text-green-500' : 'text-textcolor2 hover:text-textcolor'}"
                                                        onclick={(e) => { e.stopPropagation(); copyToClipboard(log.body, `${i}-body`) }}
                                                        title={language.copy}
                                                    >
                                                        {#if copiedKey === `${i}-body`}
                                                            <CheckIcon size={14} />
                                                        {:else}
                                                            <CopyIcon size={14} />
                                                        {/if}
                                                    </button>
                                                </div>
                                                <pre class="request-log-code hljs">{@html highlightJson(log.body)}</pre>
                                            </div>
                                            <div>
                                                <div class="flex items-center justify-between mb-2">
                                                    <span class="text-textcolor text-sm font-semibold">Request Header</span>
                                                    <button
                                                        class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${i}-header` ? 'text-green-500' : 'text-textcolor2 hover:text-textcolor'}"
                                                        onclick={(e) => { e.stopPropagation(); copyToClipboard(log.header, `${i}-header`) }}
                                                        title={language.copy}
                                                    >
                                                        {#if copiedKey === `${i}-header`}
                                                            <CheckIcon size={14} />
                                                        {:else}
                                                            <CopyIcon size={14} />
                                                        {/if}
                                                    </button>
                                                </div>
                                                <pre class="request-log-code hljs max-h-32">{@html highlightJson(log.header)}</pre>
                                            </div>
                                            <div>
                                                <div class="flex items-center justify-between mb-2">
                                                    <span class="text-textcolor text-sm font-semibold">Response</span>
                                                    <button
                                                        class="p-1 rounded hover:bg-bgcolor transition-colors {copiedKey === `${i}-response` ? 'text-green-500' : 'text-textcolor2 hover:text-textcolor'}"
                                                        onclick={(e) => { e.stopPropagation(); copyToClipboard(log.response, `${i}-response`) }}
                                                        title={language.copy}
                                                    >
                                                        {#if copiedKey === `${i}-response`}
                                                            <CheckIcon size={14} />
                                                        {:else}
                                                            <CopyIcon size={14} />
                                                        {/if}
                                                    </button>
                                                </div>
                                                <pre class="request-log-code hljs max-h-64">{@html highlightJson(log.response)}</pre>
                                            </div>
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        {/each}
                    </div>
                {/if}
            </div>
        </div>
    </div>
{/if}
{/snippet}

<div class="contents" data-alert-root bind:this={root}>
    <!-- A prompt stays mounted, hidden and inert, while another alert covers it. -->
    {#if held}
        {#key held}
            <div style="display: contents" style:visibility={promptCovered ? 'hidden' : null} inert={promptCovered}>
                {@render alertView(held)}
            </div>
        {/key}
    {/if}
    {#if $alertStore !== held && $alertStore.type !== 'none'}
        {@render alertView($alertStore)}
    {/if}
</div>

<style>
    .plugin-confirm-content .plugin-name {
        font-size: 1.25rem;
        font-weight: bold;
        color: white;
    }
    .plugin-confirm-content .warnings-list {
        list-style-type: disc;
        list-style-position: inside;
        margin-top: 0.5rem;
        margin-bottom: 0.5rem;
        padding-left: 1rem;
        color: #f87171; /* red-400 */
    }
    .plugin-confirm-content .warning-item {
        margin-bottom: 0.25rem;
    }
    .plugin-confirm-content .confirm-message {
        margin-top: 1rem;
        color: #d1d5db; /* gray-300 */
    }
    .break-any{
        word-break: normal;
        overflow-wrap: anywhere;
    }
    @keyframes toastAnime {
        0% {
            opacity: 0;
        }
        50% {
            opacity: 1;
        }
        100% {
            opacity: 0;
        }
    }

    .toast-anime {
        animation: toastAnime 1s ease-out;
    }

    .vis{
        opacity: 1 !important;
        --tw-bg-opacity: 1 !important;
    }

    .stack-trace-wrap {
        position: relative;
        margin-top: 0.5rem;
    }

    .stack-trace {
        background-color: var(--risu-theme-bgcolor);
        color: var(--risu-theme-textcolor2);
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 0.25rem;
        padding: 0.75rem 2.75rem 0.75rem 0.75rem;
        font-family: monospace;
        font-size: 0.75rem;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 200px;
        overflow-y: auto;
    }

    .stack-trace-copy {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.75rem;
        height: 1.75rem;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 0.375rem;
        background-color: var(--risu-theme-darkbg);
        color: var(--risu-theme-textcolor2);
        transition: background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease;
    }

    .stack-trace-copy:hover {
        background-color: var(--risu-theme-bgcolor);
        color: var(--risu-theme-textcolor);
    }

    .request-log-code {
        background-color: #1a1a2e;
        color: #e0e0e0;
        border: 1px solid var(--risu-theme-darkborderc);
        border-radius: 0.375rem;
        padding: 0.75rem;
        font-family: 'Consolas', 'Monaco', 'Courier New', monospace;
        font-size: 0.75rem;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 12rem;
        overflow: auto;
    }
</style>
