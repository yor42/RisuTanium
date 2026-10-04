import { get } from "svelte/store"
import { language } from "src/lang"
import { fillLang } from "src/lang/fill"
import { DBState, selectedCharID } from "../stores.svelte"
import { applyChatTemplate } from "./templates/chatTemplate"
import { doingChat, sendChat, type OpenAIChat, type PreviewResult } from "./index.svelte"
import { memberLabel, previewMayStart, renderPromptResult, runPreview } from "./previewRunner"
import { isComposerWindowOpen } from "./generationOwnership.svelte"

function isBusy(): boolean {
    return get(doingChat) || isComposerWindowOpen()
}

/** The markdown for a formatted preview (the messages, joined as asked, or their chat template), or undefined when the call wrote none. */
function renderFormattedPreview(
    result: PreviewResult,
    previewMode: string,
    previewJoin: string,
    instructType: string,
    instructCustom: string
): string | undefined {
    if(result.formated === undefined){
        return undefined
    }

    let md = ''
    const label = memberLabel(result.memberName)
    if(label !== undefined){
        md += '> ' + fillLang(language.devTool.previewing, { name: label }) + '\n'
    }
    const styledRole = {
        "function": "📐 Function",
        "user": "😐 User",
        "system": "⚙️ System",
        "assistant": "✨ Assistant",
    }

    let formated: OpenAIChat[] = safeStructuredClone(result.formated)

    if(previewJoin === 'yes'){
        let newFormated: OpenAIChat[] = []
        let latestRole = ''

        for(let i=0;i<formated.length;i++){
            if(formated[i].role === latestRole){
                newFormated[newFormated.length - 1].content += '\n' + formated[i].content
            }else{
                newFormated.push(formated[i])
                latestRole = formated[i].role
            }
        }

        formated = newFormated
    }

    if(previewMode === 'instruct'){
        const instructed = applyChatTemplate(formated, {
            type: instructType,
            custom: instructCustom
        })

        md += '### ' + language.devTool.instruction + '\n'
        md += '```\n' + instructed.replaceAll('```', '\\`\\`\\`') + '\n```\n'
        return md
    }

    for(let i=0;i<formated.length;i++){

        md += '### ' + (styledRole[formated[i].role] ?? '🤔 ' + language.devTool.unknownRole) + '\n'
        const modals = formated[i].multimodals

        if(modals && modals.length > 0){
            md += '> ' + fillLang(language.devTool.nonTextIncluded, { count: modals.length }) + '\n'
        }

        if(formated[i].thoughts && formated[i].thoughts.length > 0){
            md += '> ' + fillLang(language.devTool.thoughtsIncluded, { count: formated[i].thoughts.length }) + '\n'
        }

        if(formated[i].cachePoint){
            md += '> ' + language.devTool.cachePointNote + '\n'
        }

        md += '```\n' + formated[i].content.replaceAll('```', '\\`\\`\\`') + '\n```\n'
    }
    return md
}

export async function runPreviewPrompt(
    previewMode: string,
    previewJoin: string,
    instructType: string,
    instructCustom: string
){
    if(!previewMayStart()){
        return false
    }
    await runPreview({
        preview: previewJoin !== 'prompt',
        previewPrompt: previewJoin === 'prompt'
    }, (result) => {
        if(previewJoin === 'prompt'){
            return renderPromptResult(result)
        }
        return renderFormattedPreview(result, previewMode, previewJoin, instructType, instructCustom)
    })
}

export async function runAutopilot(autopilot: string[]){
    for(let i=0;i<autopilot.length;i++){
        if(isBusy()){
            return
        }
        const db = (DBState.db)
        let currentChar = db.characters[get(selectedCharID)]
        let currentChat = currentChar.chats[currentChar.chatPage]
        currentChat.message.push({
            role: 'user',
            data: autopilot[i]
        })
        currentChar.chats[currentChar.chatPage] = currentChat
        db.characters[get(selectedCharID)] = currentChar
        if(!(await sendChat(i))){
            return
        }
    }
}
