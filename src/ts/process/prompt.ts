import { tokenizeAccurate } from "../tokenizer";
import { getDatabase, presetTemplate, setDatabase } from "../storage/database.svelte";
import { alertError, alertNormal } from "../alert";
import { language } from "../../lang";
import { fillLang } from "../../lang/fill";
import { DBState } from "../stores.svelte";
import { OobaParams, convertStFiles, detectStKind } from "./stPresetFormats";

export type PromptItem = PromptItemPlain|PromptItemTyped|PromptItemChat|PromptItemAuthorNote|PromptItemChatML|PromptItemCache
export type PromptType = PromptItem['type'];
export type PromptSettings = {
    assistantPrefill: string
    postEndInnerFormat: string
    sendChatAsSystem: boolean
    sendName: boolean
    utilOverride: boolean
    customChainOfThought?: boolean
    maxThoughtTagDepth?: number
    trimStartNewChat?: boolean
}

export type PromptRole = 'user'|'bot'|'system'

export interface PromptItemPlain {
    type: 'plain'|'jailbreak'|'cot';
    type2: 'normal'|'globalNote'|'main'
    text: string;
    role: PromptRole;
    name?: string
}

export interface PromptItemChatML {
    type: 'chatML'
    text: string
    name?: string
}

export interface PromptItemTyped {
    type: 'persona'|'description'|'lorebook'|'postEverything'|'memory'
    innerFormat?: string,
    role2?: PromptRole
    name?: string
}

export interface PromptItemAuthorNote {
    type : 'authornote'
    innerFormat?: string
    defaultText?: string
    role2?: PromptRole
    name?: string
}


export interface PromptItemChat {
    type: 'chat';
    rangeStart: number;
    rangeEnd: number|'end';
    chatAsOriginalOnSystem?: boolean;
    name?: string
}

export interface PromptItemCache {
    type: 'cache';
    name: string
    depth: number
    role: 'user'|'assistant'|'system'|'all'

}

export async function tokenizePreset(prompts:PromptItem[], consti:boolean = false){
    let total = 0
    for(const prompt of prompts){
        switch(prompt.type){
            case 'plain':
            case 'jailbreak':{
                total += await tokenizeAccurate(prompt.text, consti)
                break
            }
            case 'persona':
            case 'description':
            case 'authornote':
            case 'memory':{
                if(prompt.innerFormat){
                    total += await tokenizeAccurate(prompt.innerFormat, consti)
                }
                break
            }
        }
    }
    return total
}

export function detectPromptJSONType(text:string){
    try {
        return detectStKind(JSON.parse(text)) ?? 'NOTSUPPORTED'
    } catch (e) {}
    return 'NOTSUPPORTED'
}

export { OobaParams }

export function promptConvertion(files:{ name: string, content: string, type:string }[]){
    const result = convertStFiles(
        files.map(file => ({ name: file.name, parsed: parseStFile(file.content) })),
        safeStructuredClone(presetTemplate)
    )
    if('reason' in result){
        if(result.reason === 'conflict'){
            alertError(fillLang(language.errors.promptTypeConflict, { type: result.withType }))
        }
        else if(result.reason === 'bundleAlone'){
            alertError(language.errors.stBundleAlone)
        }
        else{
            alertError(language.errors.stNothingToImport)
        }
        return
    }

    DBState.db.botPresets.push(result.preset)

    alertNormal(result.skipped.length > 0
        ? language.alerts.presetConverted + ' ' + fillLang(language.alerts.stPartsSkipped, { sections: result.skipped.join(', ') })
        : language.alerts.presetConverted)
}

function parseStFile(content:string):unknown{
    try {
        return JSON.parse(content)
    } catch (e) {
        return null
    }
}
