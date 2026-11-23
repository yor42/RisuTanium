<script lang="ts">

    import Check from "src/lib/UI/GUI/CheckInput.svelte";
    import { language } from "src/lang";
    import { fillLang } from "src/lang/fill";
    import Help from "src/lib/Others/Help.svelte";
    
    import { DBState } from 'src/ts/stores.svelte';
    import { setCurrentPresetImage } from 'src/ts/storage/currentPreset';
    import { pickPresetIcon } from 'src/ts/presetIcon';
    import { customProviderStore } from "src/ts/plugins/plugins.svelte";
    import { downloadFile } from "src/ts/globalApi.svelte";
    import { isTauri } from "src/ts/platform"
    import { tokenizeAccurate, tokenizerList } from "src/ts/tokenizer";
    import ModelList from "src/lib/UI/ModelList.svelte";
    import ModelDataRefresh from "./Model/ModelDataRefresh.svelte";
    import DropList from "src/lib/SideBars/DropList.svelte";
    import { PlusIcon, TrashIcon, HardDriveUploadIcon, DownloadIcon, UploadIcon } from "@lucide/svelte";
    import TextInput from "src/lib/UI/GUI/TextInput.svelte";
    import KeyListInput from "src/lib/UI/GUI/KeyListInput.svelte";
    import ConnectionsLink from "src/lib/SettingsShell/connections/ConnectionsLink.svelte";
    import NumberInput from "src/lib/UI/GUI/NumberInput.svelte";
    import SliderInput from "src/lib/UI/GUI/SliderInput.svelte";
    import TextAreaInput from "src/lib/UI/GUI/TextAreaInput.svelte";
    import Button from "src/lib/UI/GUI/Button.svelte";
    import SelectInput from "src/lib/UI/GUI/SelectInput.svelte";
    import OptionInput from "src/lib/UI/GUI/OptionInput.svelte";
    import CheckInput from "src/lib/UI/GUI/CheckInput.svelte";
    import SegmentedControl from "src/lib/UI/GUI/SegmentedControl.svelte";
    import { getOpenRouterModels, toModelGridItem as orToGridItem } from "src/ts/model/openrouter";
    import { getNanoGPTModels, getNanoGPTSubscriptionModels, toModelGridItem as ngToGridItem } from "src/ts/model/nanogpt";
    import { getOllamaModels } from "src/ts/model/ollama";
    import { currentKeyForUi } from "src/ts/process/request/secretKey";
    import { proxyUrlValue, setProxyUrl, setSlotKey, slotEditorValue, slotKeyTemporarilyUnavailable } from "src/ts/connections/slotEditor";
    import ModelGrid from "src/lib/UI/ModelGrid.svelte";
    import NanoGPTDashboard from "src/lib/UI/NanoGPTDashboard.svelte";
    import NanoGPTProviderPicker from "src/lib/UI/NanoGPTProviderPicker.svelte";
    import type { ModelGridPinnedItem } from "src/ts/model/modelGrid";
    import OobaSettings from "./OobaSettings.svelte";
    import Accordion from "src/lib/UI/Accordion.svelte";
    import OpenrouterSettings from "./OpenrouterSettings.svelte";
    import ChatFormatSettings from "./ChatFormatSettings.svelte";
    import PromptSettings from "./PromptSettings.svelte";
    import { openPresetList } from "src/ts/stores.svelte";
    import { selectSingleFile } from "src/ts/util";
    import { getModelInfo, LLMFlags, LLMFormat, LLMProvider } from "src/ts/model/modellist";
    import { resolveClaudeThinkingType } from "src/ts/model/types";
    import RegexList from "src/lib/SideBars/Scripts/RegexList.svelte";
    import SettingRenderer from "../SettingRenderer.svelte";
    import { allBasicParameterItems } from "src/ts/setting/botSettingsParamsData";
    import SeparateParametersSection from "./SeparateParametersSection.svelte";
    import AuxModelSelectors from './Model/AuxModelSelectors.svelte'
    
    const openrouterPinnedItems: ModelGridPinnedItem[] = [
        { id: 'risu/free',       displayName: 'Free Auto',       providerName: 'Risu'       },
        { id: 'openrouter/auto', displayName: 'OpenRouter Auto', providerName: 'OpenRouter' },
    ]

    // Reset model selection and display name when subscription mode toggles
    let _nanogptSubModeInitialized = false
    $effect(() => {
        const _sub = DBState.db.nanogptUseSubscriptionEndpoint
        if (!_nanogptSubModeInitialized) { _nanogptSubModeInitialized = true; return }
        DBState.db.nanogptRequestModel = ''
        DBState.db.nanogptRequestModelName = ''
    })

    // Reset provider selection to Auto when the model or subscription mode changes
    let _nanogptProviderResetInitialized = false
    $effect(() => {
        const _model = DBState.db.nanogptRequestModel
        const _sub   = DBState.db.nanogptUseSubscriptionEndpoint
        if (!_nanogptProviderResetInitialized) { _nanogptProviderResetInitialized = true; return }
        DBState.db.nanogptProvider = ''
    })

    // Reset subscription mode (and related state) when API key is cleared
    let _nanogptKeyInitialized = false
    const nanoKey = $derived(slotEditorValue(DBState.db, 'nanogptKey'))
    $effect(() => {
        const _key = nanoKey
        if (!_nanogptKeyInitialized) { _nanogptKeyInitialized = true; return }
        if (!_key) {
            DBState.db.nanogptUseSubscriptionEndpoint = false
            DBState.db.nanogptSubscriptionState = ''
            DBState.db.nanogptRequestModel = ''
            DBState.db.nanogptRequestModelName = ''
            DBState.db.nanogptProvider = ''
        }
    })

    let tokens = $state({
        mainPrompt: 0,
        jailbreak: 0,
        globalNote: 0,
    })

    interface Props {
        goPromptTemplate?: any;
    }

    let { goPromptTemplate = () => {} }: Props = $props();
    const uid = $props.id()

    async function loadTokenize(){
        tokens.mainPrompt = await tokenizeAccurate(DBState.db.mainPrompt, true)
        tokens.jailbreak = await tokenizeAccurate(DBState.db.jailbreak, true)
        tokens.globalNote = await tokenizeAccurate(DBState.db.globalNote, true)
    }

    $effect.pre(() => {
        if(DBState.db.aiModel === 'textgen_webui' || DBState.db.subModel === 'mancer'){
            DBState.db.useStreaming = DBState.db.textgenWebUIStreamURL.startsWith("wss://")
        }
    });

    function clearVertexToken() {
        DBState.db.vertexAccessToken = '';
        DBState.db.vertexAccessTokenExpires = 0;
        console.log('Vertex AI token cleared');
    }


    let submenu = $state(DBState.db.useLegacyGUI ? -1 : 0)
    let modelInfo = $derived(getModelInfo(DBState.db.aiModel))
    let subModelInfo = $derived(getModelInfo(DBState.db.subModel))
    let nanogptInputMode = $state<'list' | 'manual'>(DBState.db.nanogptRequestModel && !DBState.db.nanogptRequestModelName ? 'manual' : 'list')
    // svelte-ignore state_referenced_locally
    let prevNanogptInputMode = nanogptInputMode;
    $effect(() => {
        if (nanogptInputMode !== prevNanogptInputMode) {
            DBState.db.nanogptRequestModel = '';
            DBState.db.nanogptRequestModelName = '';
            prevNanogptInputMode = nanogptInputMode;
        }
    });

    $effect(() => {
        const resolved = resolveClaudeThinkingType(modelInfo.flags, DBState.db.thinkingType)
        if (resolved !== DBState.db.thinkingType) {
            DBState.db.thinkingType = resolved
        }
    });

    let usesOllamaLocal = $derived(DBState.db.aiModel === 'ollama-hosted' || DBState.db.subModel === 'ollama-hosted')
    let usesOllamaCloud = $derived(DBState.db.aiModel === 'ollama-cloud' || DBState.db.subModel === 'ollama-cloud')
</script>
<h2 class="mb-2 text-2xl font-bold mt-2">{language.chatBot}</h2>

{#if submenu !== -1}
    <div class="flex w-full rounded-md border border-darkborderc mb-4">
        <button onclick={() => {
            submenu = 0
        }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 0}>
            <span>{language.model}</span>
        </button>
        <button onclick={() => {
            submenu = 1
        }} class="p2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 1}>
            <span>{language.parameters}</span>
        </button>
        <button onclick={() => {
            submenu = 2
        }} class="p-2 flex-1 border-r border-darkborderc" class:bg-darkbutton={submenu === 2}>
            <span>{language.prompt}</span>
        </button>
        <button onclick={() => {
            submenu = 3
        }} class="p-2 flex-1" class:bg-darkbutton={submenu === 3}>
            <span>{language.others}</span>
        </button>
    </div>
{/if}

{#if submenu === 0 || submenu === -1}
    <span class="text-textcolor mt-4">{language.model} <Help key="model"/></span>
    <ModelList bind:value={DBState.db.aiModel}/>

    <span class="text-textcolor mt-2">{language.submodel} <Help key="submodel"/></span>
    <ModelList bind:value={DBState.db.subModel}/>
    <ModelDataRefresh />

    <p class="text-textcolor2 text-sm mt-4 mb-2" data-testid="api-key-env-ref-note">{language.settingsPage.apiKeyEnvRefNote}</p>
    <ConnectionsLink />

    {#if modelInfo.provider === LLMProvider.GoogleCloud || subModelInfo.provider === LLMProvider.GoogleCloud}
        <span class="text-textcolor" id="{uid}-keyGoogle">{fillLang(language.settingsPage.nameApiKey, { name: 'GoogleAI' })}</span>
        <KeyListInput labelId="{uid}-keyGoogle" marginBottom={true} size={"sm"} placeholder="..." hideText unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'google.accessToken')} bind:value={() => slotEditorValue(DBState.db, 'google.accessToken'), (v) => { void setSlotKey(DBState.db, 'google.accessToken', v) }}/>
    {/if}
    {#if modelInfo.provider === LLMProvider.VertexAI || subModelInfo.provider === LLMProvider.VertexAI}
        <span class="text-textcolor" id="{uid}-f1">{language.settingsPage.projectId}</span>
        <TextInput labelId="{uid}-f1" marginBottom={true} size={"sm"} placeholder="..." bind:value={DBState.db.google.projectId} oninput={clearVertexToken}/>
        <span class="text-textcolor" id="{uid}-f2">{fillLang(language.settingsPage.nameClientEmail, { name: 'Vertex' })}</span>
        <TextInput labelId="{uid}-f2" marginBottom={true} size={"sm"} placeholder="..." bind:value={DBState.db.vertexClientEmail} oninput={clearVertexToken}/>
        <span class="text-textcolor" id="{uid}-f3">{fillLang(language.settingsPage.namePrivateKey, { name: 'Vertex' })}</span>
        <TextInput labelId="{uid}-f3" marginBottom={true} size={"sm"} placeholder="..." hideText bind:value={() => slotEditorValue(DBState.db, 'vertexPrivateKey'), (v) => { void setSlotKey(DBState.db, 'vertexPrivateKey', v) }} oninput={clearVertexToken}/>
        {#if slotKeyTemporarilyUnavailable(DBState.db, 'vertexPrivateKey')}
            <div class="text-textcolor2 text-xs mb-2">{language.vaultKeyTemporarilyUnavailableHint}</div>
        {/if}
        <span class="text-textcolor" id="{uid}-vertexRegion">{language.settingsPage.region}</span>
        <SelectInput labelId="{uid}-vertexRegion" value={DBState.db.vertexRegion} onchange={(e) => {
            DBState.db.vertexRegion = e.currentTarget.value
            clearVertexToken()
        }}>
            <OptionInput value={'global'}>
                global
            </OptionInput>
            <OptionInput value={'us-central1'}>
                us-central1
            </OptionInput>
            <OptionInput value={'us-west1'}>
                us-west1
            </OptionInput>
        </SelectInput>    
    {/if}
    {#if modelInfo.provider === LLMProvider.NovelList || subModelInfo.provider === LLMProvider.NovelList}
        <span class="text-textcolor" id="{uid}-keyNovelList">NovelList {language.apiKey}</span>
        <KeyListInput labelId="{uid}-keyNovelList" hideText marginBottom={true} size={"sm"} placeholder="..." unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'novellistAPI')} bind:value={() => slotEditorValue(DBState.db, 'novellistAPI'), (v) => { void setSlotKey(DBState.db, 'novellistAPI', v) }}/>
    {/if}
    {#if DBState.db.aiModel.startsWith('mancer') || DBState.db.subModel.startsWith('mancer')}
        <span class="text-textcolor" id="{uid}-keyMancer">Mancer {language.apiKey}</span>
        <KeyListInput labelId="{uid}-keyMancer" hideText marginBottom={true} size={"sm"} placeholder="..." unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'mancerHeader')} bind:value={() => slotEditorValue(DBState.db, 'mancerHeader'), (v) => { void setSlotKey(DBState.db, 'mancerHeader', v) }}/>
    {/if}
    {#if modelInfo.provider === LLMProvider.Anthropic || subModelInfo.provider === LLMProvider.Anthropic
            || modelInfo.provider === LLMProvider.AWS || subModelInfo.provider === LLMProvider.AWS }
        <span class="text-textcolor" id="{uid}-keyClaude">Claude {language.apiKey}</span>
        <KeyListInput labelId="{uid}-keyClaude" hideText marginBottom={true} size={"sm"} placeholder="..." unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'claudeAPIKey')} bind:value={() => slotEditorValue(DBState.db, 'claudeAPIKey'), (v) => { void setSlotKey(DBState.db, 'claudeAPIKey', v) }}/>
    {/if}
    {#if modelInfo.provider === LLMProvider.Mistral || subModelInfo.provider === LLMProvider.Mistral}
        <span class="text-textcolor" id="{uid}-keyMistral">Mistral {language.apiKey}</span>
        <KeyListInput labelId="{uid}-keyMistral" hideText marginBottom={true} size={"sm"} placeholder="..." unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'mistralKey')} bind:value={() => slotEditorValue(DBState.db, 'mistralKey'), (v) => { void setSlotKey(DBState.db, 'mistralKey', v) }}/>
    {/if}
    {#if modelInfo.provider === LLMProvider.NovelAI || subModelInfo.provider === LLMProvider.NovelAI}
        <span class="text-textcolor" id="{uid}-keyNovelAI">{fillLang(language.settingsPage.nameBearerToken, { name: 'NovelAI' })}</span>
        <KeyListInput labelId="{uid}-keyNovelAI" unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'novelai.token')} bind:value={() => slotEditorValue(DBState.db, 'novelai.token'), (v) => { void setSlotKey(DBState.db, 'novelai.token', v) }}/>
    {/if}
    {#if DBState.db.aiModel === 'reverse_proxy' || DBState.db.subModel === 'reverse_proxy'}
        <span class="text-textcolor mt-2"><span id="{uid}-f4">URL</span> <Help key="forceUrl"/></span>
        <TextInput labelId="{uid}-f4" marginBottom={false} size={"sm"} bind:value={() => proxyUrlValue(DBState.db), (v) => { setProxyUrl(DBState.db, v) }} placeholder="https//..." />
        <span class="text-textcolor mt-4" id="{uid}-keyProxy"> {language.proxyAPIKey}</span>
        <KeyListInput labelId="{uid}-keyProxy" hideText marginBottom={false} size={"sm"} placeholder={language.settingsPage.proxyKeyPlaceholder} unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'proxyKey')} bind:value={() => slotEditorValue(DBState.db, 'proxyKey'), (v) => { void setSlotKey(DBState.db, 'proxyKey', v) }} />
        <span class="text-textcolor mt-4" id="{uid}-f5"> {language.proxyRequestModel}</span>
        <TextInput labelId="{uid}-f5" marginBottom={false} size={"sm"} bind:value={DBState.db.customProxyRequestModel} placeholder={language.name} />
        <span class="text-textcolor mt-4" id="{uid}-customApiFormat"> {language.format}</span>
        <SelectInput labelId="{uid}-customApiFormat" value={DBState.db.customAPIFormat.toString()} onchange={(e) => {
            DBState.db.customAPIFormat = parseInt(e.currentTarget.value) as LLMFormat
        }}>
            <OptionInput value={LLMFormat.OpenAICompatible.toString()}>
                OpenAI Compatible
            </OptionInput>
            <OptionInput value={LLMFormat.OpenAIResponseAPI.toString()}>
                OpenAI Response API
            </OptionInput>
            <OptionInput value={LLMFormat.Anthropic.toString()}>
                Anthropic Claude
            </OptionInput>
            <OptionInput value={LLMFormat.Mistral.toString()}>
                Mistral
            </OptionInput>
            <OptionInput value={LLMFormat.GoogleCloud.toString()}>
                Google Cloud
            </OptionInput>
            <OptionInput value={LLMFormat.Cohere.toString()}>
                Cohere
            </OptionInput>
        </SelectInput>
    {/if}
    {#if modelInfo.provider === LLMProvider.Cohere || subModelInfo.provider === LLMProvider.Cohere}
        <span class="text-textcolor mt-4" id="{uid}-keyCohere">Cohere {language.apiKey}</span>
        <KeyListInput labelId="{uid}-keyCohere" hideText marginBottom={false} size={"sm"} unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'cohereAPIKey')} bind:value={() => slotEditorValue(DBState.db, 'cohereAPIKey'), (v) => { void setSlotKey(DBState.db, 'cohereAPIKey', v) }} />
    {/if}
    {#if usesOllamaLocal || usesOllamaCloud}
        {#if usesOllamaLocal}
        <span class="text-textcolor mt-4" id="{uid}-f6">{fillLang(language.settingsPage.nameUrl, { name: 'Ollama' })}</span>
        <TextInput labelId="{uid}-f6" marginBottom={false} size={"sm"} bind:value={DBState.db.ollamaURL} />
        {/if}

        {#if usesOllamaCloud}
        <span class="text-textcolor mt-4" id="{uid}-ollamaModel">Ollama {language.model}</span>
        <SegmentedControl
            bind:value={DBState.db.ollamaInputMode}
            options={[
                { value: 'list', label: language.nanoGPTSelectFromList },
                { value: 'manual', label: language.nanoGPTManualInput }
            ]}
            size="md"
        />

        {#if DBState.db.ollamaInputMode === 'manual'}
            <TextInput labelId="{uid}-ollamaModel" marginBottom={false} size={"sm"} bind:value={DBState.db.ollamaCloudModel} placeholder={language.model} oninput={() => DBState.db.ollamaCloudModelName = ''} />
        {:else}
            {#await getOllamaModels(DBState.db.ollamaURL, 'cloud', currentKeyForUi('ollamaApiKey', DBState.db))}
                <ModelGrid bind:value={DBState.db.ollamaCloudModel} loading={true} />
            {:then cloudModels}
                <ModelGrid
                    bind:value={DBState.db.ollamaCloudModel}
                    items={cloudModels ?? []}
                    selectedLabelOverride={DBState.db.ollamaCloudModel ? fillLang(language.settingsPage.cloudModelLabel, { name: DBState.db.ollamaCloudModelName || DBState.db.ollamaCloudModel }) : undefined}
                    onselect={(_id, name) => {
                        DBState.db.ollamaModelSource = 'cloud'
                        DBState.db.ollamaCloudModelName = name
                    }}
                />
            {:catch error}
                <span class="text-draculared">{error instanceof Error ? error.message : String(error)}</span>
            {/await}
        {/if}

            <span class="text-textcolor mt-4" id="{uid}-keyOllama">Ollama {language.apiKey}</span>
            <KeyListInput labelId="{uid}-keyOllama" hideText marginBottom={false} size={"sm"} unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'ollamaApiKey')} bind:value={() => slotEditorValue(DBState.db, 'ollamaApiKey'), (v) => { void setSlotKey(DBState.db, 'ollamaApiKey', v) }} />

            <span class="text-textcolor mt-4" id="{uid}-ollamaFormat">Ollama {language.format}</span>
            <SelectInput labelId="{uid}-ollamaFormat" value={DBState.db.ollamaRequestFormat.toString()} onchange={(e) => {
                DBState.db.ollamaRequestFormat = parseInt(e.currentTarget.value) as LLMFormat
            }}>
                <OptionInput value={LLMFormat.Ollama.toString()}>
                    Ollama SDK
                </OptionInput>
                <OptionInput value={LLMFormat.OpenAICompatible.toString()}>
                    OpenAI Compatible
                </OptionInput>
                <OptionInput value={LLMFormat.OpenAIResponseAPI.toString()}>
                    OpenAI Response API
                </OptionInput>
                <OptionInput value={LLMFormat.Anthropic.toString()}>
                    Anthropic Claude
                </OptionInput>
            </SelectInput>

            <div class="mt-2">
                <CheckInput bind:check={DBState.db.useStreaming} name={fillLang(language.settingsPage.responseStreaming, { streaming: language.streaming })} />
            </div>
        {/if}

        {#if usesOllamaLocal}
        <span class="text-textcolor mt-4" id="{uid}-f7">{fillLang(language.settingsPage.nameModel, { name: 'Ollama' })}</span>
        <TextInput labelId="{uid}-f7" marginBottom={false} size={"sm"} bind:value={DBState.db.ollamaModel} placeholder={language.model} oninput={() => { DBState.db.ollamaModelSource = 'local'; DBState.db.ollamaModelName = '' }} />
        {/if}

        {#if usesOllamaLocal || (usesOllamaCloud && DBState.db.ollamaRequestFormat === LLMFormat.Ollama)}
        <span class="text-textcolor mt-4" id="{uid}-ollamaThinking">{fillLang(language.settingsPage.nameThinking, { name: 'Ollama' })}</span>
        <SelectInput labelId="{uid}-ollamaThinking" bind:value={DBState.db.ollamaThinkingMode}>
            <OptionInput value="auto">
                {language.optAuto}
            </OptionInput>
            <OptionInput value="off">
                {language.optOff}
            </OptionInput>
            <OptionInput value="on">
                {language.optOn}
            </OptionInput>
            <OptionInput value="low">
                {language.optLow}
            </OptionInput>
            <OptionInput value="medium">
                {language.optMedium}
            </OptionInput>
            <OptionInput value="high">
                {language.optHigh}
            </OptionInput>
        </SelectInput>
        {/if}
    {/if}
    {#if DBState.db.aiModel === 'nanogpt' || DBState.db.subModel === 'nanogpt'}
        <span class="text-textcolor mt-4" id="{uid}-keyNanoGPT">NanoGPT {language.apiKey}</span>
        <KeyListInput labelId="{uid}-keyNanoGPT" hideText marginBottom={false} size={"sm"} unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'nanogptKey')} bind:value={() => slotEditorValue(DBState.db, 'nanogptKey'), (v) => { void setSlotKey(DBState.db, 'nanogptKey', v) }} />

        <NanoGPTDashboard apiKey={currentKeyForUi('nanogptKey', DBState.db)} />

        {#if DBState.db.nanogptSubscriptionState === 'active' || DBState.db.nanogptSubscriptionState === 'grace'}
            <div class="flex items-center mt-3">
                <CheckInput bind:check={DBState.db.nanogptUseSubscriptionEndpoint} name={language.nanoGPTUseSubscriptionEndpoint} />
            </div>
        {/if}

        <span class="text-textcolor mt-4" id="{uid}-nanoModel">NanoGPT {language.model}</span>
        <SegmentedControl
            bind:value={nanogptInputMode}
            options={[
                { value: 'list', label: language.nanoGPTSelectFromList },
                { value: 'manual', label: language.nanoGPTManualInput }
            ]}
            size="md"
        />

        {#if nanogptInputMode === 'manual'}
            <TextInput labelId="{uid}-nanoModel" marginBottom={false} size={"sm"} bind:value={DBState.db.nanogptRequestModel} placeholder={language.nanoGPTManualModelSelect} oninput={() => DBState.db.nanogptRequestModelName = ''}/>
        {:else}
            {#await Promise.all([getNanoGPTModels(), getNanoGPTSubscriptionModels(currentKeyForUi('nanogptKey', DBState.db))])}
                <ModelGrid bind:value={DBState.db.nanogptRequestModel} loading={true} />
            {:then [regular, sub]}
                <ModelGrid
                    bind:value={DBState.db.nanogptRequestModel}
                    items={DBState.db.nanogptUseSubscriptionEndpoint ? (sub ?? []).map(ngToGridItem) : (regular ?? []).map(ngToGridItem)}
                    showSubBadge={DBState.db.nanogptUseSubscriptionEndpoint}
                    selectedLabelOverride={DBState.db.nanogptRequestModel && !DBState.db.nanogptRequestModelName ? DBState.db.nanogptRequestModel : undefined}
                    onselect={(_id, name) => { DBState.db.nanogptRequestModelName = name }}
                />
                {#if !DBState.db.nanogptUseSubscriptionEndpoint}
                    <NanoGPTProviderPicker
                        apiKey={currentKeyForUi('nanogptKey', DBState.db)}
                        modelId={DBState.db.nanogptRequestModel}
                        bind:value={DBState.db.nanogptProvider}
                    />
                {/if}
            {/await}
        {/if}
    {/if}
    {#if DBState.db.aiModel === 'openrouter' || DBState.db.subModel === 'openrouter'}
        <span class="text-textcolor mt-4" id="{uid}-keyOpenRouter">OpenRouter {language.apiKey}</span>
        <KeyListInput labelId="{uid}-keyOpenRouter" hideText marginBottom={false} size={"sm"} unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'openrouterKey')} bind:value={() => slotEditorValue(DBState.db, 'openrouterKey'), (v) => { void setSlotKey(DBState.db, 'openrouterKey', v) }} />

        <span class="text-textcolor mt-4">OpenRouter {language.model}</span>
        {#await getOpenRouterModels()}
            <ModelGrid bind:value={DBState.db.openrouterRequestModel} pinnedItems={openrouterPinnedItems} loading={true} />
        {:then m}
            <ModelGrid bind:value={DBState.db.openrouterRequestModel} items={(m ?? []).map(orToGridItem)} pinnedItems={openrouterPinnedItems} />
        {/await}
    {/if}
    {#if DBState.db.aiModel === 'openrouter' || DBState.db.aiModel === 'reverse_proxy'}
        <span class="text-textcolor" id="{uid}-tokenizer">{language.tokenizer}</span>
        <SelectInput labelId="{uid}-tokenizer" bind:value={DBState.db.customTokenizer}>
            {#each tokenizerList as entry}
                <OptionInput value={entry[0]}>{entry[1]}</OptionInput>
            {/each}
        </SelectInput>
    {/if}
    {#if modelInfo.provider === LLMProvider.OpenAI || subModelInfo.provider === LLMProvider.OpenAI}
        <span class="text-textcolor"><span id="{uid}-keyOpenAI">OpenAI {language.apiKey}</span> <Help key="oaiapikey"/></span>
        <KeyListInput labelId="{uid}-keyOpenAI" hideText marginBottom={false} size={"sm"} unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'openAIKey')} bind:value={() => slotEditorValue(DBState.db, 'openAIKey'), (v) => { void setSlotKey(DBState.db, 'openAIKey', v) }} placeholder="sk-XXXXXXXXXXXXXXXXXXXX"/>
    {/if}

    {#if modelInfo.keyIdentifier}
        <span class="text-textcolor" id="{uid}-keyModel">{modelInfo.name} {language.apiKey}</span>
        <KeyListInput labelId="{uid}-keyModel" hideText marginBottom={false} size={"sm"} unavailable={slotKeyTemporarilyUnavailable(DBState.db, `OaiCompAPIKeys:${modelInfo.keyIdentifier}`)} bind:value={() => slotEditorValue(DBState.db, `OaiCompAPIKeys:${modelInfo.keyIdentifier}`), (v) => { void setSlotKey(DBState.db, `OaiCompAPIKeys:${modelInfo.keyIdentifier}`, v) }} placeholder="..."/>
    {/if}

    {#if subModelInfo.keyIdentifier && subModelInfo.keyIdentifier !== modelInfo.keyIdentifier}
        <span class="text-textcolor" id="{uid}-keySubModel">{subModelInfo.name} {language.apiKey}</span>
        <KeyListInput labelId="{uid}-keySubModel" hideText marginBottom={false} size={"sm"} unavailable={slotKeyTemporarilyUnavailable(DBState.db, `OaiCompAPIKeys:${subModelInfo.keyIdentifier}`)} bind:value={() => slotEditorValue(DBState.db, `OaiCompAPIKeys:${subModelInfo.keyIdentifier}`), (v) => { void setSlotKey(DBState.db, `OaiCompAPIKeys:${subModelInfo.keyIdentifier}`, v) }} placeholder="..."/>
    {/if}

    <div class="py-2 flex flex-col gap-2 mb-4">
        {#if !usesOllamaCloud && (modelInfo.flags.includes(LLMFlags.hasStreaming) || subModelInfo.flags.includes(LLMFlags.hasStreaming))}
            <Check bind:check={DBState.db.useStreaming} name={fillLang(language.settingsPage.responseStreaming, { streaming: language.streaming })}/>
            
            {#if DBState.db.useStreaming && (modelInfo.flags.includes(LLMFlags.geminiThinking) || subModelInfo.flags.includes(LLMFlags.geminiThinking))}
                <Check bind:check={DBState.db.streamGeminiThoughts} name={language.settingsPage.streamGeminiThoughts}/>
            {/if}
        {/if}

        {#if DBState.db.aiModel === 'reverse_proxy' || DBState.db.subModel === 'reverse_proxy'}
            <Check bind:check={DBState.db.reverseProxyOobaMode} name={`${language.reverseProxyOobaMode}`}/>
        {/if}
        {#if modelInfo.provider === LLMProvider.NovelAI || subModelInfo.provider === LLMProvider.NovelAI}
            <Check bind:check={DBState.db.NAIadventure} name={language.textAdventureNAI}/>

            <Check bind:check={DBState.db.NAIappendName} name={language.appendNameNAI}/>
        {/if}
    </div>

    {#if DBState.db.aiModel === 'custom' || DBState.db.subModel === 'custom'}
        <span class="text-textcolor mt-2" id="{uid}-pluginProvider">{language.plugin}</span>
        <SelectInput labelId="{uid}-pluginProvider" className="mt-2 mb-4" bind:value={DBState.db.currentPluginProvider}>
            <OptionInput value="">{language.none}</OptionInput>
            {#each $customProviderStore as plugin}
                <OptionInput value={plugin}>{plugin}</OptionInput>
            {/each}
        </SelectInput>
    {/if}

    {#if DBState.db.aiModel === "kobold" || DBState.db.subModel === "kobold"}
        <span class="text-textcolor" id="{uid}-f8">{fillLang(language.settingsPage.nameUrl, { name: 'Kobold' })}</span>
        <TextInput labelId="{uid}-f8" marginBottom={true} bind:value={DBState.db.koboldURL} />
    {/if}

    {#if DBState.db.aiModel === 'echo_model' || DBState.db.subModel === 'echo_model'}
        <span class="text-textcolor mt-2" id="{uid}-f9">{language.settingsPage.echoMessage}</span>
        <TextAreaInput labelId="{uid}-f9" margin="bottom" bind:value={DBState.db.echoMessage} placeholder={language.settingsPage.echoMessagePlaceholder}/>
        <span class="text-textcolor mt-2" id="{uid}-echoDelay">{language.settingsPage.echoDelaySeconds}</span>
        <NumberInput labelId="{uid}-echoDelay" marginBottom={true} bind:value={DBState.db.echoDelay} min={0}/>
    {/if}

    {#if DBState.db.aiModel.startsWith("horde") || DBState.db.subModel.startsWith("horde") }
        <span class="text-textcolor" id="{uid}-keyHorde">Horde {language.apiKey}</span>
        <KeyListInput labelId="{uid}-keyHorde" hideText marginBottom={true} unavailable={slotKeyTemporarilyUnavailable(DBState.db, 'hordeConfig.apiKey')} bind:value={() => slotEditorValue(DBState.db, 'hordeConfig.apiKey'), (v) => { void setSlotKey(DBState.db, 'hordeConfig.apiKey', v) }} />
    {/if}
    {#if DBState.db.aiModel === 'textgen_webui' || DBState.db.subModel === 'textgen_webui'
        || DBState.db.aiModel === 'mancer' || DBState.db.subModel === 'mancer'}
        <span class="text-textcolor mt-2" id="{uid}-f10">{fillLang(language.settingsPage.blockingProviderUrl, { url: language.providerURL })}</span>
        <TextInput labelId="{uid}-f10" marginBottom={true} bind:value={DBState.db.textgenWebUIBlockingURL} placeholder="https://..."/>
        <span class="text-draculared text-xs mb-2">{language.settingsPage.textgenPublicApiNotice}</span>
        <span class="text-textcolor mt-2" id="{uid}-f11">{fillLang(language.settingsPage.streamProviderUrl, { url: language.providerURL })}</span>
        <TextInput labelId="{uid}-f11" marginBottom={true} bind:value={DBState.db.textgenWebUIStreamURL} placeholder="wss://..."/>
        {#if !isTauri}
            <span class="text-draculared text-xs mb-2">{language.settingsPage.webuiTunnelNotice}</span>
        {/if}
        <span class="text-draculared text-xs mb-2">{language.settingsPage.oobaVersionWarning}</span>
    {/if}
    {#if DBState.db.aiModel === 'ooba' || DBState.db.subModel === 'ooba'}
        <span class="text-textcolor mt-2" id="{uid}-f12">Ooba {language.providerURL}</span>
        <TextInput labelId="{uid}-f12" marginBottom={true} bind:value={DBState.db.textgenWebUIBlockingURL} placeholder="https://..."/>
    {/if}
    {#if DBState.db.aiModel.startsWith("horde") || DBState.db.aiModel === 'kobold' }
        <ChatFormatSettings />
    {/if}

    <AuxModelSelectors />
{/if}

{#if submenu === 1 || submenu === -1}
    <!-- Data-driven basic parameters -->
    <SettingRenderer items={allBasicParameterItems} {modelInfo} {subModelInfo} />
    {#if DBState.db.aiModel === 'textgen_webui' || DBState.db.aiModel === 'mancer' || DBState.db.aiModel.startsWith('local_') || DBState.db.aiModel.startsWith('hf:::')}
        <span class="text-textcolor" id="{uid}-oobaRepetitionPenalty">Repetition Penalty</span>
        <SliderInput labelId="{uid}-oobaRepetitionPenalty" min={1} max={1.5} step={0.01} fixed={2} marginBottom bind:value={DBState.db.ooba.repetition_penalty}/>
        <span class="text-textcolor" id="{uid}-oobaLengthPenalty">Length Penalty</span>
        <SliderInput labelId="{uid}-oobaLengthPenalty" min={-5} max={5} step={0.05} marginBottom fixed={2} bind:value={DBState.db.ooba.length_penalty}/>
        <span class="text-textcolor" id="{uid}-oobaTopK">Top K</span>
        <SliderInput labelId="{uid}-oobaTopK" min={0} max={100} step={1} marginBottom bind:value={DBState.db.ooba.top_k} />
        <span class="text-textcolor" id="{uid}-oobaTopP">Top P</span>
        <SliderInput labelId="{uid}-oobaTopP" min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={DBState.db.ooba.top_p}/>
        <span class="text-textcolor" id="{uid}-oobaTypicalP">Typical P</span>
        <SliderInput labelId="{uid}-oobaTypicalP" min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={DBState.db.ooba.typical_p}/>
        <span class="text-textcolor" id="{uid}-oobaTopA">Top A</span>
        <SliderInput labelId="{uid}-oobaTopA" min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={DBState.db.ooba.top_a}/>
        <span class="text-textcolor" id="{uid}-oobaNoRepeatNgram">No Repeat n-gram Size</span>
        <SliderInput labelId="{uid}-oobaNoRepeatNgram" min={0} max={20} step={1} marginBottom bind:value={DBState.db.ooba.no_repeat_ngram_size}/>
        <div class="flex items-center mt-4">
            <Check bind:check={DBState.db.ooba.do_sample} name={'Do Sample'}/>
        </div>
        <div class="flex items-center mt-4">
            <Check bind:check={DBState.db.ooba.add_bos_token} name={'Add BOS Token'}/>
        </div>
        <div class="flex items-center mt-4">
            <Check bind:check={DBState.db.ooba.ban_eos_token} name={'Ban EOS Token'}/>
        </div>
        <div class="flex items-center mt-4">
            <Check bind:check={DBState.db.ooba.skip_special_tokens} name={'Skip Special Tokens'}/>
        </div>
        <div class="flex items-center mt-4">
            <Check check={!!DBState.db.localStopStrings} name={language.customStopWords} onChange={() => {
                if(!DBState.db.localStopStrings){
                    DBState.db.localStopStrings = []
                }
                else{
                    DBState.db.localStopStrings = null
                }
            }} />
        </div>
        {#if DBState.db.localStopStrings}
            <div class="flex flex-col p-2 rounded-sm border border-selected mt-2 gap-1">
                <div class="p-2">
                    <button aria-label={language.add} class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-textcolor2 w-full" onclick={() => {
                        let localStopStrings = DBState.db.localStopStrings
                        localStopStrings.push('')
                        DBState.db.localStopStrings = localStopStrings
                    }}><PlusIcon aria-hidden="true" /></button>
                </div>
                {#each DBState.db.localStopStrings as stopString, i}
                    <div class="flex w-full">
                        <div class="grow">
                            <TextInput label={language.customStopWords} marginBottom bind:value={DBState.db.localStopStrings[i]} fullwidth fullh/>
                        </div>
                        <div>
                            <button aria-label={language.remove} class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-textcolor2 w-full" onclick={() => {
                                let localStopStrings = DBState.db.localStopStrings
                                localStopStrings.splice(i, 1)
                                DBState.db.localStopStrings = localStopStrings
                            }}><TrashIcon aria-hidden="true" /></button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
        <div class="flex flex-col p-3 rounded-md border-selected border mt-4">
            <ChatFormatSettings />
        </div>
        <Check bind:check={DBState.db.ooba.formating.useName} name={language.useNamePrefix}/>
    
    {:else if modelInfo.format === LLMFormat.NovelAI}
        <div class="flex flex-col p-3 bg-darkbg mt-4">
            <span class="text-textcolor" id="{uid}-f13">{language.settingsPage.starter}</span>
            <TextInput labelId="{uid}-f13" bind:value={DBState.db.NAIsettings.starter} placeholder={'⁂'} />
            <span class="text-textcolor" id="{uid}-f14">{language.settingsPage.seperator}</span>
            <TextInput labelId="{uid}-f14" bind:value={DBState.db.NAIsettings.seperator} placeholder={"\\n"}/>
        </div>
        <span class="text-textcolor" id="{uid}-naiTopP">Top P</span>
        <SliderInput labelId="{uid}-naiTopP" min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={DBState.db.NAIsettings.topP}/>
        <span class="text-textcolor" id="{uid}-naiTopK">Top K</span>
        <SliderInput labelId="{uid}-naiTopK" min={0} max={100} step={1} marginBottom bind:value={DBState.db.NAIsettings.topK}/>
        <span class="text-textcolor" id="{uid}-naiTopA">Top A</span>
        <SliderInput labelId="{uid}-naiTopA" min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={DBState.db.NAIsettings.topA}/>
        <span class="text-textcolor" id="{uid}-naiTailfree">Tailfree Sampling</span>
        <SliderInput labelId="{uid}-naiTailfree" min={0} max={1} step={0.001} marginBottom fixed={3} bind:value={DBState.db.NAIsettings.tailFreeSampling}/>
        <span class="text-textcolor" id="{uid}-naiTypicalP">Typical P</span>
        <SliderInput labelId="{uid}-naiTypicalP" min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={DBState.db.NAIsettings.typicalp}/>
        <span class="text-textcolor" id="{uid}-naiRepetitionPenalty">Repetition Penalty</span>
        <SliderInput labelId="{uid}-naiRepetitionPenalty" min={0} max={3} step={0.01} marginBottom fixed={2} bind:value={DBState.db.NAIsettings.repetitionPenalty}/>
        <span class="text-textcolor" id="{uid}-naiRepetitionPenaltyRange">Repetition Penalty Range</span>
        <SliderInput labelId="{uid}-naiRepetitionPenaltyRange" min={0} max={8192} step={1} marginBottom fixed={0} bind:value={DBState.db.NAIsettings.repetitionPenaltyRange}/>
        <span class="text-textcolor" id="{uid}-naiRepetitionPenaltySlope">Repetition Penalty Slope</span>
        <SliderInput labelId="{uid}-naiRepetitionPenaltySlope" min={0} max={10} step={0.01} marginBottom fixed={2} bind:value={DBState.db.NAIsettings.repetitionPenaltySlope}/>
        <span class="text-textcolor" id="{uid}-naiFrequencyPenalty">Frequency Penalty</span>
        <SliderInput labelId="{uid}-naiFrequencyPenalty" min={-2} max={2} step={0.01} marginBottom fixed={2} bind:value={DBState.db.NAIsettings.frequencyPenalty}/>
        <span class="text-textcolor" id="{uid}-naiPresencePenalty">Presence Penalty</span>
        <SliderInput labelId="{uid}-naiPresencePenalty" min={-2} max={2} step={0.01} marginBottom fixed={2} bind:value={DBState.db.NAIsettings.presencePenalty}/>
        <span class="text-textcolor" id="{uid}-naiMirostatLr">Mirostat LR</span>
        <SliderInput labelId="{uid}-naiMirostatLr" min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={DBState.db.NAIsettings.mirostat_lr}/>
        <span class="text-textcolor" id="{uid}-naiMirostatTau">Mirostat Tau</span>
        <SliderInput labelId="{uid}-naiMirostatTau" min={0} max={6} step={0.01} marginBottom fixed={2} bind:value={DBState.db.NAIsettings.mirostat_tau}/>
        <span class="text-textcolor" id="{uid}-naiCfgScale">Cfg Scale</span>
        <SliderInput labelId="{uid}-naiCfgScale" min={1} max={3} step={0.01} marginBottom fixed={2} bind:value={DBState.db.NAIsettings.cfg_scale}/>

    {:else if modelInfo.format === LLMFormat.NovelList}
        <span class="text-textcolor" id="{uid}-ainTopP">Top P</span>
        <SliderInput labelId="{uid}-ainTopP" min={0} max={2} step={0.01} marginBottom fixed={2} bind:value={DBState.db.ainconfig.top_p}/>
        <span class="text-textcolor" id="{uid}-ainRepPen">Reputation Penalty</span>
        <SliderInput labelId="{uid}-ainRepPen" min={0} max={2} step={0.01} marginBottom fixed={2} bind:value={DBState.db.ainconfig.rep_pen}/>
        <span class="text-textcolor" id="{uid}-ainRepPenRange">Reputation Penalty Range</span>
        <SliderInput labelId="{uid}-ainRepPenRange" min={0} max={2048} step={1} marginBottom fixed={2} bind:value={DBState.db.ainconfig.rep_pen_range}/>
        <span class="text-textcolor" id="{uid}-ainRepPenSlope">Reputation Penalty Slope</span>
        <SliderInput labelId="{uid}-ainRepPenSlope" min={0} max={10} step={0.1} marginBottom fixed={2} bind:value={DBState.db.ainconfig.rep_pen_slope}/>
        <span class="text-textcolor" id="{uid}-ainTopK">Top K</span>
        <SliderInput labelId="{uid}-ainTopK" min={1} max={500} step={1} marginBottom fixed={2} bind:value={DBState.db.ainconfig.top_k}/>
        <span class="text-textcolor" id="{uid}-ainTopA">Top A</span>
        <SliderInput labelId="{uid}-ainTopA" min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={DBState.db.ainconfig.top_a}/>
        <span class="text-textcolor" id="{uid}-ainTypicalP">Typical P</span>
        <SliderInput labelId="{uid}-ainTypicalP" min={0} max={1} step={0.01} marginBottom fixed={2} bind:value={DBState.db.ainconfig.typical_p}/>
    {:else}
        <!-- Standard parameters now handled by SettingRenderer above -->
    {/if}

    {#if (DBState.db.reverseProxyOobaMode && DBState.db.aiModel === 'reverse_proxy') || (DBState.db.aiModel === 'ooba')}
        <OobaSettings instructionMode={DBState.db.aiModel === 'ooba'} />
    {/if}

    {#if DBState.db.aiModel.startsWith('openrouter')}
        <OpenrouterSettings />
    {/if}

    <!-- Separate Parameters - handled by custom component -->
    <SeparateParametersSection />
{/if}

{#if submenu === 3 || submenu === -1}
    <Accordion styled name="{language.settingsPage.bias} " help="bias">
        <table class="contain w-full max-w-full tabler">
            <tbody>
            <tr>
                <th class="font-medium">{language.settingsPage.bias}</th>
                <th class="font-medium">{language.value}</th>
                <th>
                    <button aria-label={language.add} class="font-medium cursor-pointer hover:text-textcolor2 w-full flex justify-center items-center" onclick={() => {
                        let bia = DBState.db.bias
                        bia.push(['', 0])
                        DBState.db.bias = bia
                    }}><PlusIcon aria-hidden="true" /></button>
                </th>
            </tr>
            {#if DBState.db.bias.length === 0}
                <tr>
                    <td colspan="3" class="text-textcolor2">{language.noBias}</td>
                </tr>
            {/if}
            {#each DBState.db.bias as bias, i}
                <tr>
                    <td class="font-medium truncate">
                        <TextInput label={language.settingsPage.bias} bind:value={DBState.db.bias[i][0]} size="lg" fullwidth/>
                    </td>
                    <td class="font-medium truncate">
                        <NumberInput label={language.value} bind:value={DBState.db.bias[i][1]} max={100} min={-101} size="lg" fullwidth/>
                    </td>
                    <td>
                        <button aria-label={language.remove} class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-textcolor2 w-full" onclick={() => {
                            let bia = DBState.db.bias
                            bia.splice(i, 1)
                            DBState.db.bias = bia
                        }}><TrashIcon aria-hidden="true" /></button>
                    </td>
                </tr>
            {/each}
            </tbody>
        </table>
        <div class="text-textcolor2 mt-2 flex items-center gap-2">
            <button aria-label={language.export} class="font-medium cursor-pointer hover:text-textcolor gap-2" onclick={() => {
                const data = JSON.stringify(DBState.db.bias, null, 2)
                downloadFile('bias.json', data)
            }}><DownloadIcon aria-hidden="true" /></button>
            <button aria-label={language.import} class="font-medium cursor-pointer hover:text-textcolor" onclick={async () => {
                const sel = await selectSingleFile(['json'])
                if(!sel){
                    return
                }
                const utf8 = new TextDecoder().decode(sel.data)
                if(Array.isArray(JSON.parse(utf8))){
                    DBState.db.bias = JSON.parse(utf8)
                }
            }}><HardDriveUploadIcon aria-hidden="true" /></button>
        </div>
    </Accordion>

    <Accordion styled name="{language.additionalParams} " help="additionalParams">
        <table class="contain w-full max-w-full tabler">
            <tbody>
            <tr>
                <th class="font-medium">{language.key}</th>
                <th class="font-medium">{language.value}</th>
                <th>
                    <button aria-label={language.add} class="font-medium cursor-pointer hover:text-textcolor2 w-full flex justify-center items-center" onclick={() => {
                        DBState.db.additionalParams.push(['', ''])
                    }}><PlusIcon aria-hidden="true" /></button>
                </th>
            </tr>
            {#if DBState.db.additionalParams.length === 0}
                <tr class="text-textcolor2">
                    <td colspan="3">{language.noData}</td>
                </tr>
            {/if}
            {#each DBState.db.additionalParams as additionalParams, i}
                <tr>
                    <td class="font-medium truncate">
                        <TextInput label={language.key} bind:value={DBState.db.additionalParams[i][0]} size="lg" fullwidth/>
                    </td>
                    <td class="font-medium truncate">
                        <TextInput label={language.value} bind:value={DBState.db.additionalParams[i][1]} size="lg" fullwidth/>
                    </td>
                    <td>
                        <button aria-label={language.remove} class="font-medium flex justify-center items-center h-full cursor-pointer hover:text-textcolor2 w-full" onclick={() => {
                            let additionalParams = DBState.db.additionalParams
                            additionalParams.splice(i, 1)
                            DBState.db.additionalParams = additionalParams
                        }}><TrashIcon aria-hidden="true" /></button>
                    </td>
                </tr>
            {/each}
            </tbody>
        </table>
    </Accordion>


    <Accordion styled name={language.promptTemplate}>
        {#if DBState.db.promptTemplate}
            {#if submenu !== -1}
                <PromptSettings mode='inline' subMenu={1} />
            {/if}
        {:else}
            <Check check={false} name={language.usePromptTemplate} onChange={() => {
                DBState.db.promptTemplate = []
            }}/>
        {/if}
    </Accordion>

    {#snippet CustomFlagButton(name:string,flag:number)}
        <Button className="mt-2" onclick={(e) => {
            if(DBState.db.customFlags.includes(flag as LLMFlags)){
                DBState.db.customFlags = DBState.db.customFlags.filter((f) => f !== flag)
            }
            else{
                DBState.db.customFlags.push(flag as LLMFlags)
            }
        }} styled={DBState.db.customFlags.includes(flag as LLMFlags) ? 'primary' : 'outlined'}>
            {name}
        </Button>
    {/snippet}

    <Accordion styled name={language.customFlags}>
        <Check bind:check={DBState.db.enableCustomFlags} name={language.enableCustomFlags}/>


        {#if DBState.db.enableCustomFlags}
            {@render CustomFlagButton('hasImageInput', 0)}
            {@render CustomFlagButton('hasImageOutput', 1)}
            {@render CustomFlagButton('hasAudioInput', 2)}
            {@render CustomFlagButton('hasAudioOutput', 3)}
            {@render CustomFlagButton('hasPrefill', 4)}
            {@render CustomFlagButton('hasCache', 5)}
            {@render CustomFlagButton('hasFullSystemPrompt', 6)}
            {@render CustomFlagButton('hasFirstSystemPrompt', 7)}
            {@render CustomFlagButton('hasStreaming', 8)}
            {@render CustomFlagButton('requiresAlternateRole', 9)}
            {@render CustomFlagButton('mustStartWithUserInput', 10)}
            {@render CustomFlagButton('hasVideoInput', 12)}
            {@render CustomFlagButton('OAICompletionTokens', 13)}
            {@render CustomFlagButton('DeveloperRole', 14)}
            {@render CustomFlagButton('geminiThinking', 15)}
            {@render CustomFlagButton('geminiBlockOff', 16)}
            {@render CustomFlagButton('deepSeekPrefix', 17)}
            {@render CustomFlagButton('deepSeekThinkingInput', 18)}
            {@render CustomFlagButton('deepSeekThinkingOutput', 19)}
            {@render CustomFlagButton('noCivilIntegrity', 20)}
            {@render CustomFlagButton('claudeThinking', 21)}
            {@render CustomFlagButton('claudeAdaptiveThinking', 22)}
            {@render CustomFlagButton('claudeXHighEffort', 23)}
            {@render CustomFlagButton('deepSeekThinkingToggle', 24)}

        {/if}
    </Accordion>

    <Accordion styled name={language.moduleIntergration} help="moduleIntergration">
        <TextAreaInput label={language.moduleIntergration} bind:value={DBState.db.moduleIntergration} fullwidth height={"32"} autocomplete="off"/>
    </Accordion>

    <Accordion styled name={language.tools}>
        <Check name={language.search} check={DBState.db.modelTools.includes('search')} onChange={() => {
            if(DBState.db.modelTools.includes('search')){
                DBState.db.modelTools = DBState.db.modelTools.filter((tool) => tool !== 'search')
            }
            else{
                DBState.db.modelTools.push('search')
            }
        }} />
    </Accordion>
    
    <Accordion styled name={language.regexScript}>
        <RegexList bind:value={DBState.db.presetRegex} buttons />
    </Accordion>

    <Accordion styled name={language.icon}>
        <div class="p-2 rounded-md border border-darkborderc flex flex-col items-center gap-2">
            <span>
                {language.preview}
            </span>
            <div class="flex items-center justify-center gap-2">
                {#if DBState.db.botPresets[DBState.db.botPresetsId]?.image}
                    <img src={DBState.db.botPresets[DBState.db.botPresetsId]?.image} alt={language.settingsPage.iconAlt} class="w-6 h-6 rounded-md" decoding="async"/>
                    <span class="text-textcolor2">{DBState.db.botPresets[DBState.db.botPresetsId]?.name}</span>
                {:else}
                    <span class="text-textcolor2">{language.noImages}</span>
                {/if}
            </div>
        </div>
        <button aria-label={language.chooseIconImage} class="mt-2 text-textcolor2 hover:text-textcolor focus-within:text-textcolor" onclick={async () => {
            const data = await pickPresetIcon()
            if(data === null){
                return
            }
            setCurrentPresetImage(DBState.db, data)
        }}>
            <UploadIcon aria-hidden="true" />
        </button>
    </Accordion>
    {#if submenu !== -1}
        <Button onclick={() => {$openPresetList = true}} className="mt-4">{language.presets}</Button>
    {/if}
{/if}

{#if submenu === 2 || submenu === -1}
    {#if !DBState.db.promptTemplate}
        <span class="text-textcolor"><span id="{uid}-f15">{language.mainPrompt}</span> <Help key="mainprompt"/></span>
        <TextAreaInput labelId="{uid}-f15" fullwidth autocomplete="off" height={"32"} bind:value={DBState.db.mainPrompt}></TextAreaInput>
        <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.mainPrompt} {language.tokens}</span>
        <span class="text-textcolor"><span id="{uid}-f16">{language.jailbreakPrompt}</span> <Help key="jailbreak"/></span>
        <TextAreaInput labelId="{uid}-f16" fullwidth autocomplete="off" height={"32"} bind:value={DBState.db.jailbreak}></TextAreaInput>
        <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.jailbreak} {language.tokens}</span>
        <span class="text-textcolor"><span id="{uid}-f17">{language.globalNote}</span> <Help key="globalNote"/></span>
        <TextAreaInput labelId="{uid}-f17" fullwidth autocomplete="off" height={"32"} bind:value={DBState.db.globalNote}></TextAreaInput>
        <span class="text-textcolor2 mb-6 text-sm mt-2">{tokens.globalNote} {language.tokens}</span>  
        <span class="text-textcolor mb-2 mt-4">{language.formatingOrder} <Help key="formatOrder"/></span>
        <DropList bind:list={DBState.db.formatingOrder} />
        <div class="flex items-center mt-4">
            <Check bind:check={DBState.db.promptPreprocess} name={language.promptPreprocess}/>
        </div>
    {:else if submenu === 2}
        <PromptSettings mode='inline' />
    {/if}
{/if}


{#if DBState.db.promptTemplate && submenu === -1}
    <div class="mt-2">
        <Button onclick={goPromptTemplate} size="sm">{language.promptTemplate}</Button>
    </div>
{/if}
{#if submenu === -1}
    <Button onclick={() => {$openPresetList = true}} className="mt-4">{language.presets}</Button>
{/if}
