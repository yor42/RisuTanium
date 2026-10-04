<script lang="ts">
    import { selectedCharID } from "src/ts/stores.svelte";
    import { language } from "src/lang";
    import { fillLang } from "src/lang/fill";
    import TextInput from "../UI/GUI/TextInput.svelte";
    import NumberInput from "../UI/GUI/NumberInput.svelte";
    import Button from "../UI/GUI/Button.svelte";
    import { getRequestLog } from "src/ts/globalApi.svelte";
    import { alertMd } from "src/ts/alert";
    import Accordion from "../UI/Accordion.svelte";
    import { getCharToken, getChatToken } from "src/ts/tokenizer";
    import { tokenizePreset } from "src/ts/process/prompt";
    
    import { DBState } from 'src/ts/stores.svelte';
    import TextAreaInput from "../UI/GUI/TextAreaInput.svelte";
    import { HardDriveUploadIcon, PlusIcon, TrashIcon } from "@lucide/svelte";
    import { selectSingleFile } from "src/ts/util";
    import { runAutopilot, runPreviewPrompt } from "src/ts/process/devToolActions";
    import SelectInput from "../UI/GUI/SelectInput.svelte";
    import { chatTemplates } from "src/ts/process/templates/chatTemplate";
    import OptionInput from "../UI/GUI/OptionInput.svelte";
  import { loadLoreBookV3Prompt } from "src/ts/process/lorebook.svelte";
  import { getModules } from "src/ts/process/modules";

    let previewMode = $state('chat')
    let previewJoin = $state('yes')
    let instructType = $state('chatml')
    let instructCustom = $state('')
    
    let autopilot = $state([])
</script>

<Accordion styled name={language.devTool.variables}>
    <div class="rounded-md border border-darkborderc grid grid-cols-2 gap-2 p-2">
        {#if DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].scriptstate &&  Object.keys(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].scriptstate).length > 0}
            {#each Object.keys(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].scriptstate) as key}
                <span>{key}</span>
                {#if typeof DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].scriptstate[key] === "object"}
                    <div class="p-2 text-center">{language.devTool.object}</div>
                {:else if typeof DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].scriptstate[key] === "string"}
                    <TextInput bind:value={DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].scriptstate[key] as string} />
                {:else if typeof DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].scriptstate[key] === "number"}
                    <NumberInput bind:value={DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage].scriptstate[key] as number} />
                {/if}
            {/each}
        {:else}
            <div class="p-2 text-center">{language.devTool.noVariables}</div>
        {/if}
    </div>
</Accordion>

<Accordion styled name={language.tokens}>
    <div class="rounded-md border border-darkborderc grid grid-cols-2 gap-2 p-2">
        {#await getCharToken(DBState.db.characters[$selectedCharID])}
            <span>{language.devTool.characterPersistant}</span>
            <div class="p-2 text-center">{language.loadingEllipsis}</div>
            <span>{language.devTool.characterDynamic}</span>
            <div class="p-2 text-center">{language.loadingEllipsis}</div>
        {:then token}
            <span>{language.devTool.characterPersistant}</span>
            <div class="p-2 text-center">{fillLang(language.devTool.tokenCount, { count: token.persistant })}</div>
            <span>{language.devTool.characterDynamic}</span>
            <div class="p-2 text-center">{fillLang(language.devTool.tokenCount, { count: token.dynamic })}</div>
        {/await}
        {#await getChatToken(DBState.db.characters[$selectedCharID].chats[DBState.db.characters[$selectedCharID].chatPage])}
            <span>{language.devTool.currentChat}</span>
            <div class="p-2 text-center">{language.loadingEllipsis}</div>
        {:then token}
            <span>{language.devTool.currentChat}</span>
            <div class="p-2 text-center">{fillLang(language.devTool.tokenCount, { count: token })}</div>
        {/await}
        {#if DBState.db.promptTemplate}
            {#await tokenizePreset(DBState.db.promptTemplate)}
                <span>{language.promptTemplate}</span>
                <div class="p-2 text-center">{language.loadingEllipsis}</div>
            {:then token}
                <span>{language.promptTemplate}</span>
                <div class="p-2 text-center">{fillLang(language.devTool.tokenCount, { count: token })}</div>
            {/await}
        {/if}
    </div>
    <span class="text-sm text-textcolor2">{language.devTool.estimateNote}</span>
</Accordion>

<Accordion styled name={language.devTool.autopilot}>
    <div class="flex flex-col p-2 border border-darkborderc rounded-md">
        {#each autopilot as text, i}
            <TextAreaInput bind:value={autopilot[i]} />
        {/each}
    </div>
    <div class="flex justify-end">
        <button class="text-textcolor2 hover:text-textcolor" onclick={() => {
            autopilot.pop()
            autopilot = autopilot
        }}>
            <TrashIcon />
        </button>

        <button class="text-textcolor2 hover:text-textcolor" onclick={() => {
            autopilot.push('')
            autopilot = autopilot
        }}>
            <PlusIcon />
        </button>

        <button class="text-textcolor2 hover:text-textcolor" onclick={async () => {
            const selected = await selectSingleFile([
                'txt', 'csv', 'json'
            ])
            if(!selected){
                return
            }
            const file = new TextDecoder().decode(selected.data)
            if(selected.name.endsWith('.json')){
                const parsed = JSON.parse(file)
                if(Array.isArray(parsed)){
                    autopilot = parsed
                }
            }
            if(selected.name.endsWith('.csv')){
                autopilot = file.split('\n').map(x => {
                    return x.replace(/\r/g, '')
                        .replace(/\\n/g, '\n')
                        .replace(/\\t/g, '\t')
                        .replace(/\\r/g, '\r')
                })
            }
            if(selected.name.endsWith('.txt')){
                autopilot = file.split('\n')
            }
        }}>
            <HardDriveUploadIcon />
        </button>
    </div>
    <Button className="mt-2" onclick={async () => {
        await runAutopilot(autopilot)
    }}>{language.run}</Button>
</Accordion>


<Accordion styled name={language.devTool.previewPrompt}>
    <span>{language.type}</span>
    <SelectInput bind:value={previewMode}>
        <OptionInput value="chat">{language.Chat}</OptionInput>
        <OptionInput value="instruct">{language.devTool.instruct}</OptionInput>
    </SelectInput>
    {#if previewMode === 'instruct'}
        <span>{language.devTool.instructionType}</span>
        <SelectInput bind:value={instructType}>
            {#each Object.keys(chatTemplates) as template}
                <OptionInput value={template}>{template}</OptionInput>
            {/each}
            <OptionInput value="jinja">{language.devTool.customJinja}</OptionInput>
        </SelectInput>
        {#if instructType === 'jinja'}
            <span>{language.devTool.customJinja}</span>
            <TextAreaInput bind:value={instructCustom} />
        {/if}
    {/if}
    <span>{language.devTool.join}</span>
    <SelectInput bind:value={previewJoin}>
        <OptionInput value="yes">{language.devTool.withJoin}</OptionInput>
        <OptionInput value="no">{language.devTool.withoutJoin}</OptionInput>
        <OptionInput value="prompt">{language.devTool.asRequest}</OptionInput>
    </SelectInput>
    <Button className="mt-2" onclick={() => {runPreviewPrompt(previewMode, previewJoin, instructType, instructCustom)}}>{language.run}</Button>
</Accordion>

<Accordion styled name={language.devTool.previewLorebook}>
    <Button className="mt-2" onclick={async () => {
        const lorebookResult = await loadLoreBookV3Prompt()
        const html = `
        ${lorebookResult.actives.map((v) => {
            return `## ${v.source}\n\n\`\`\`\n${v.prompt}\n\`\`\`\n`
        }).join('\n')}
        `.trim()
        alertMd(html)
    }}>{language.devTool.testLore}</Button>
    <Button className="mt-2" onclick={async () => {
        const lorebookResult = await loadLoreBookV3Prompt()
        const html = `
        <table>
            <thead>
                <tr>
                    <th>${language.devTool.key}</th>
                    <th>${language.devTool.source}</th>
                </tr>
            </thead>
            <tbody>
                ${lorebookResult.matchLog.map((v) => {
                    return `<tr>
                        <td><pre>${v.activated.trim()}</pre></td>
                        <td><pre>${v.source.trim()}</pre></td>
                    </tr>`
                }).join('\n')}
            </tbody>
        </table>
        `.trim()
        alertMd(html)
    }}>{language.devTool.matchSources}</Button>
</Accordion>

<Button className="mt-2" onclick={() => {
    const modules = getModules()
    const html = `
    ${modules.map((v) => {
        return `## ${v.name}\n\n\`\`\`\n${v.description}\n\`\`\`\n`
    }).join('\n')}
    `.trim()
    alertMd(html)
}}>{language.devTool.previewModule}</Button>

<Button className="mt-2" onclick={() => {
    alertMd(getRequestLog())
}}>{language.devTool.requestLog}</Button>