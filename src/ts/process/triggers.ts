import { parseChatML } from "../parser/chatML";
import { risuChatParser } from "../parser/parser.svelte";
import { promptViewOfMessages, type PromptView } from "../cbs";
import { getDatabase, type Chat, type character } from "../storage/database.svelte";
import { tokenize } from "../tokenizer";
import { getModuleTriggers } from "./modules";
import { get } from "svelte/store";
import { ReloadChatPointer, ReloadGUIPointer, CurrentTriggerIdStore, DBState } from "../stores.svelte";
import { processMultiCommand, type CommandContext } from "./command";
import { parseKeyValue, sleep } from "../util";
import { alertError, alertInput, alertNormal, alertSelect } from "../alert";
import type { OpenAIChat } from "./index.svelte";
import { HypaProcesser } from "./memory/hypamemory";
import { requestChatData } from "./request/request";
import { generateAIImage } from "./stableDiff";
import { writeInlayImage } from "./files/inlays";
import { runScripted } from "./scriptings";
import { calcString } from "./infunctions";
import { createRunSubject, type Origin } from "./chatOrigin";
import { LOW_LEVEL_NESTED_TRIGGER_LIMIT, NORMAL_NESTED_TRIGGER_LIMIT } from "./triggerLimits";


export interface triggerscript{
    comment: string;
    type: 'start'|'manual'|'output'|'input'|'display'|'request'
    conditions: triggerCondition[]
    effect:triggerEffect[]
    lowLevelAccess?: boolean
}

export type triggerCondition = triggerConditionsVar|triggerConditionsExists|triggerConditionsChatIndex

export type triggerEffect = triggerEffectV1|triggerCode|triggerEffectV2
export type triggerEffectV1 = triggerEffectCutChat|triggerEffectModifyChat|triggerEffectImgGen|triggerEffectRegex|triggerEffectRunLLM|triggerEffectCheckSimilarity|triggerEffectSendAIprompt|triggerEffectShowAlert|triggerEffectSetvar|triggerEffectSystemPrompt|triggerEffectImpersonate|triggerEffectCommand|triggerEffectStop|triggerEffectRunTrigger|triggerEffectRunAxLLM
export type triggerEffectV2 =   triggerV2Header|triggerV2IfVar|triggerV2Else|triggerV2EndIndent|triggerV2SetVar|triggerV2Loop|triggerV2BreakLoop|
                                triggerV2RunTrigger|triggerV2ConsoleLog|triggerV2StopTrigger|triggerV2CutChat|triggerV2ModifyChat|triggerV2SystemPrompt|triggerV2Impersonate|
                                triggerV2Command|triggerV2SendAIprompt|triggerV2ImgGen|triggerV2CheckSimilarity|triggerV2RunLLM|triggerV2ShowAlert|triggerV2ExtractRegex|
                                triggerV2GetLastMessage|triggerV2GetMessageAtIndex|triggerV2GetMessageCount|
                                triggerV2ModifyLorebook|triggerV2GetLorebook|triggerV2GetLorebookCount|triggerV2GetLorebookEntry|
                                triggerV2SetLorebookActivation|triggerV2GetLorebookIndexViaName|triggerV2LoopNTimes|triggerV2Random|triggerV2GetCharAt|
                                triggerV2GetCharCount|triggerV2ToLowerCase|triggerV2ToUpperCase|triggerV2SetCharAt|triggerV2SplitString|triggerV2JoinArrayVar|triggerV2GetCharacterDesc|
                                triggerV2SetCharacterDesc|triggerV2GetPersonaDesc|triggerV2SetPersonaDesc|triggerV2MakeArrayVar|triggerV2GetArrayVarLength|triggerV2GetArrayVar|triggerV2SetArrayVar|
                                triggerV2PushArrayVar|triggerV2PopArrayVar|triggerV2ShiftArrayVar|triggerV2UnshiftArrayVar|triggerV2SpliceArrayVar|triggerV2GetFirstMessage|
                                triggerV2SliceArrayVar|triggerV2GetIndexOfValueInArrayVar|triggerV2RemoveIndexFromArrayVar|triggerV2ConcatString|triggerV2GetLastUserMessage|
                                triggerV2GetLastCharMessage|triggerV2GetAlertInput|triggerV2GetAlertSelect|triggerV2GetDisplayState|triggerV2SetDisplayState|triggerV2UpdateGUI|triggerV2UpdateChatAt|triggerV2Wait|
                                triggerV2GetRequestState|triggerV2SetRequestState|triggerV2GetRequestStateRole|triggerV2SetRequestStateRole|triggerV2GetRequestStateLength|triggerV2IfAdvanced|
                                triggerV2QuickSearchChat|triggerV2StopPromptSending|triggerV2Tokenize|triggerV2GetAllLorebooks|triggerV2GetLorebookByName|triggerV2GetLorebookByIndex|
                                triggerV2CreateLorebook|triggerV2ModifyLorebookByIndex|triggerV2DeleteLorebookByIndex|triggerV2GetLorebookCountNew|triggerV2SetLorebookAlwaysActive|
                                triggerV2RegexTest|triggerV2GetReplaceGlobalNote|triggerV2SetReplaceGlobalNote|
                                triggerV2GetAuthorNote|triggerV2SetAuthorNote|triggerV2MakeDictVar|triggerV2GetDictVar|triggerV2SetDictVar|triggerV2DeleteDictKey|
                                triggerV2HasDictKey|triggerV2ClearDict|triggerV2GetDictSize|triggerV2GetDictKeys|triggerV2GetDictValues|triggerV2Calculate|triggerV2ReplaceString|triggerV2Comment|
                                triggerV2DeclareLocalVar

export type triggerConditionsVar = {
    type:'var'|'value'
    var:string
    value:string
    operator:'='|'!='|'>'|'<'|'>='|'<='|'null'|'true'
}

export type triggerCode = {
    type: 'triggercode'|'triggerlua',
    code: string
}

export type triggerConditionsChatIndex = {
    type:'chatindex'
    value:string
    operator:'='|'!='|'>'|'<'|'>='|'<='|'null'|'true'
}

export type triggerConditionsExists ={
    type: 'exists'
    value:string
    type2: 'strict'|'loose'|'regex',
    depth: number
}

export interface triggerEffectSetvar{
    type: 'setvar',
    operator: '='|'+='|'-='|'*='|'/='
    var:string
    value:string
}

export interface triggerEffectCutChat{
    type: 'cutchat',
    start: string,
    end: string
}

export interface triggerEffectModifyChat{
    type: 'modifychat',
    index: string,
    value: string
}

export interface triggerEffectSystemPrompt{
    type: 'systemprompt',
    location: 'start'|'historyend'|'promptend',
    value:string
}

export interface triggerEffectImpersonate{
    type: 'impersonate'
    role: 'user'|'char',
    value:string
}

type triggerMode = 'start'|'manual'|'output'|'input'|'display'|'request'

export interface triggerEffectCommand{
    type: 'command',
    value: string
}

export interface triggerEffectRegex{
    type: 'extractRegex',
    value: string
    regex: string
    flags: string
    result: string
    inputVar: string
}

export interface triggerEffectShowAlert{
    type: 'showAlert',
    alertType: string
    value: string
    inputVar: string
}

export interface triggerEffectRunTrigger{
    type: 'runtrigger',
    value: string
}

export interface triggerEffectStop{
    type: 'stop'
}

export interface triggerEffectSendAIprompt{
    type: 'sendAIprompt'
}

export interface triggerEffectImgGen{
    type: 'runImgGen',
    value: string,
    negValue: string,
    inputVar: string
}


export interface triggerEffectCheckSimilarity{
    type: 'checkSimilarity',
    source: string,
    value: string,
    inputVar: string
}

export interface triggerEffectRunLLM{
    type: 'runLLM',
    value: string,
    inputVar: string
}

export interface triggerEffectRunAxLLM{
    type: 'runAxLLM',
    value: string,
    inputVar: string
}

export type additonalSysPrompt = {
    start:string,
    historyend: string,
    promptend: string
}

export type triggerV2Header = {
    type: 'v2Header',
    code?: string,
    indent: number
}

export type triggerV2IfVar = {
    type: 'v2If',
    condition: '='|'!='|'>'|'<'|'>='|'<=',
    targetType: 'var'|'value',
    target: string,
    source: string,
    indent: number
}

export type triggerV2Else = {
    type: 'v2Else'
    indent: number
}

export type triggerV2EndIndent = {
    type: 'v2EndIndent',
    endOfLoop?: boolean,
    indent: number
}

export type triggerV2SetVar = {
    type: 'v2SetVar',
    operator: '='|'+='|'-='|'*='|'/='|'%=',
    var: string,
    valueType: 'var'|'value',
    value: string,
    indent: number
}

export type triggerV2Loop = {
    type: 'v2Loop',
    indent: number
}

export type triggerV2LoopNTimes = {
    type: 'v2LoopNTimes',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2BreakLoop = {
    type: 'v2BreakLoop',
    indent: number
}

export type triggerV2RunTrigger = {
    type: 'v2RunTrigger',
    target: string,
    indent: number
}

export type triggerV2ConsoleLog = {
    type: 'v2ConsoleLog',
    sourceType: 'var'|'value',
    source: string,
    indent: number
}

export type triggerV2StopTrigger = {
    type: 'v2StopTrigger',
    indent: number
}

export type triggerV2CutChat = {
    type: 'v2CutChat',
    start: string,
    startType: 'var'|'value',
    end: string,
    endType: 'var'|'value',
    indent: number
}

export type triggerV2ModifyChat = {
    type: 'v2ModifyChat',
    index: string,
    indexType: 'var'|'value',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2SystemPrompt = {
    type: 'v2SystemPrompt',
    location: 'start'|'historyend'|'promptend',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2Impersonate = {
    type: 'v2Impersonate',
    role: 'user'|'char',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2Command = {
    type: 'v2Command',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2SendAIprompt = {
    type: 'v2SendAIprompt',
    indent: number
}

export type triggerV2ImgGen = {
    type: 'v2ImgGen',
    value: string,
    valueType: 'var'|'value',
    negValue: string,
    negValueType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2CheckSimilarity = {
    type: 'v2CheckSimilarity',
    source: string,
    sourceType: 'var'|'value',
    value: string,
    valueType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2RunLLM = {
    type: 'v2RunLLM',
    value: string,
    valueType: 'var'|'value',
    model: 'model'|'submodel',
    streaming?: boolean,
    outputVar: string,
    indent: number
}

export type triggerV2ShowAlert = {
    type: 'v2ShowAlert',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2ExtractRegex = {
    type: 'v2ExtractRegex',
    value: string,
    valueType: 'var'|'value',
    regex: string,
    regexType: 'var'|'value',
    flags: string,
    flagsType: 'var'|'value',
    result: string,
    resultType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetLastMessage = {
    type: 'v2GetLastMessage',
    outputVar: string,
    indent: number
}

export type triggerV2GetMessageAtIndex = {
    type: 'v2GetMessageAtIndex',
    index: string,
    indexType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetMessageCount = {
    type: 'v2GetMessageCount',
    outputVar: string,
    indent: number
}

export type triggerV2ModifyLorebook = {
    type: 'v2ModifyLorebook',
    target: string,
    targetType: 'var'|'value',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2GetLorebook = {
    type: 'v2GetLorebook',
    target: string,
    targetType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetLorebookCount = {
    type: 'v2GetLorebookCount',
    outputVar: string,
    indent: number
}

export type triggerV2GetLorebookEntry = {
    type: 'v2GetLorebookEntry',
    index: string,
    indexType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2SetLorebookActivation = {
    type: 'v2SetLorebookActivation',
    index: string,
    indexType: 'var'|'value',
    value: boolean,
    indent: number
}

export type triggerV2GetLorebookIndexViaName = {
    type: 'v2GetLorebookIndexViaName',
    name: string,
    nameType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2Random = {
    type: 'v2Random',
    min: string,
    minType: 'var'|'value',
    max: string,
    maxType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetCharAt = {
    type: 'v2GetCharAt',
    source: string,
    sourceType: 'var'|'value',
    index: string,
    indexType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetCharCount = {
    type: 'v2GetCharCount',
    source: string,
    sourceType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2ToLowerCase = {
    type: 'v2ToLowerCase',
    source: string,
    sourceType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2ToUpperCase = {
    type: 'v2ToUpperCase',
    source: string,
    sourceType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2SetCharAt = {
    type: 'v2SetCharAt',
    source: string,
    sourceType: 'var'|'value',
    index: string,
    indexType: 'var'|'value',
    value: string,
    valueType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2SplitString = {
    type: 'v2SplitString',
    source: string,
    sourceType: 'var'|'value',
    delimiter: string,
    delimiterType: 'var'|'value'|'regex',
    outputVar: string,
    indent: number
}

export type triggerV2JoinArrayVar = {
    type: 'v2JoinArrayVar',
    var: string,
    varType: 'var'|'value',
    delimiter: string,
    delimiterType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetCharacterDesc = {
    type: 'v2GetCharacterDesc',
    outputVar: string,
    indent: number
}

export type triggerV2SetCharacterDesc = {
    type: 'v2SetCharacterDesc',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2GetPersonaDesc = {
    type: 'v2GetPersonaDesc',
    outputVar: string,
    indent: number
}

export type triggerV2SetPersonaDesc = {
    type: 'v2SetPersonaDesc',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2MakeArrayVar = {
    type: 'v2MakeArrayVar',
    var: string,
    indent: number
}

export type triggerV2GetArrayVarLength = {
    type: 'v2GetArrayVarLength',
    var: string,
    outputVar: string,
    indent: number
}

export type triggerV2GetArrayVar = {
    type: 'v2GetArrayVar',
    var: string,
    index: string,
    indexType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2SetArrayVar = {
    type: 'v2SetArrayVar',
    var: string,
    index: string,
    indexType: 'var'|'value',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2PushArrayVar = {
    type: 'v2PushArrayVar',
    var: string,
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2PopArrayVar = {
    type: 'v2PopArrayVar',
    var: string,
    outputVar: string,
    indent: number
}

export type triggerV2ShiftArrayVar = {
    type: 'v2ShiftArrayVar',
    var: string,
    outputVar: string,
    indent: number
}

export type triggerV2UnshiftArrayVar = {
    type: 'v2UnshiftArrayVar',
    var: string,
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2SpliceArrayVar = {
    type: 'v2SpliceArrayVar',
    var: string,
    start: string,
    startType: 'var'|'value',
    item: string,
    itemType: 'var'|'value',
    indent: number
}

export type triggerV2SliceArrayVar = {
    type: 'v2SliceArrayVar',
    var: string,
    start: string,
    startType: 'var'|'value',
    end: string,
    endType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetIndexOfValueInArrayVar = {
    type: 'v2GetIndexOfValueInArrayVar',
    var: string,
    value: string,
    valueType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2RemoveIndexFromArrayVar = {
    type: 'v2RemoveIndexFromArrayVar',
    var: string,
    index: string,
    indexType: 'var'|'value',
    indent: number
}

export type triggerV2ConcatString = {
    type: 'v2ConcatString',
    source1: string,
    source1Type: 'var'|'value',
    source2: string,
    source2Type: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetLastUserMessage = {
    type: 'v2GetLastUserMessage',
    outputVar: string,
    indent: number
}

export type triggerV2GetLastCharMessage = {
    type: 'v2GetLastCharMessage',
    outputVar: string,
    indent: number
}

export type triggerV2GetFirstMessage = {
    type: 'v2GetFirstMessage',
    outputVar: string,
    indent: number
}

export type triggerV2GetAlertInput = {
    type: 'v2GetAlertInput',
    display: string,
    displayType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetDisplayState = {
    type: 'v2GetDisplayState',
    outputVar: string,
    indent: number
}

export type triggerV2SetDisplayState = {
    type: 'v2SetDisplayState',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2GetRequestState = {
    type: 'v2GetRequestState',
    outputVar: string,
    index: string,
    indexType: 'var'|'value',
    indent: number
}

export type triggerV2GetRequestStateRole = {
    type: 'v2GetRequestStateRole',
    outputVar: string,
    index: string,
    indexType: 'var'|'value',
    indent: number
}

export type triggerV2SetRequestState = {
    type: 'v2SetRequestState',
    value: string,
    valueType: 'var'|'value',
    index: string,
    indexType: 'var'|'value',
    indent: number
}

export type triggerV2SetRequestStateRole = {
    type: 'v2SetRequestStateRole',
    value: string,
    valueType: 'var'|'value',
    index: string,
    indexType: 'var'|'value',
    indent: number
}

export type triggerV2GetRequestStateLength = {
    type: 'v2GetRequestStateLength',
    outputVar: string,
    indent: number
}

export type triggerV2UpdateGUI = {
    type: 'v2UpdateGUI',
    indent: number
}

export type triggerV2UpdateChatAt = {
    type: 'v2UpdateChatAt',
    index: string,
    indent: number
}

export type triggerV2Wait = {
    type: 'v2Wait',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2IfAdvanced = {
    type: 'v2IfAdvanced',
    condition: '='|'!='|'>'|'<'|'>='|'<='|'≒'|'∋'|'∈'|'∌'|'∉'|'≡'
    targetType: 'var'|'value',
    target: string,
    sourceType: 'var'|'value',
    source: string,
    indent: number
}

export type triggerV2QuickSearchChat = {
    type: 'v2QuickSearchChat',
    value: string,
    valueType: 'var'|'value',
    condition: 'loose'|'strict'|'regex',
    depth: string,
    depthType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2StopPromptSending = {
    type: 'v2StopPromptSending',
    indent: number
}

export type triggerV2Tokenize = {
    type: 'v2Tokenize',
    indent: number,
    value: string
    valueType: "var"|"value"
    outputVar:string
}

export type triggerV2GetAllLorebooks = {
    type: 'v2GetAllLorebooks',
    outputVar: string,
    indent: number
}
export type triggerV2RegexTest = {
    type: 'v2RegexTest',
    value: string,
    valueType: 'var'|'value',
    regex: string,
    regexType: 'var'|'value',
    flags: string,
    flagsType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetLorebookByName = {
    type: 'v2GetLorebookByName',
    name: string,
    nameType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetLorebookByIndex = {
    type: 'v2GetLorebookByIndex',
    index: string,
    indexType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2CreateLorebook = {
    type: 'v2CreateLorebook',
    name: string,
    nameType: 'var'|'value',
    key: string,
    keyType: 'var'|'value',
    content: string,
    contentType: 'var'|'value',
    insertOrder: string,
    insertOrderType: 'var'|'value',
    indent: number
}

export type triggerV2ModifyLorebookByIndex = {
    type: 'v2ModifyLorebookByIndex',
    index: string,
    indexType: 'var'|'value',
    name: string,
    nameType: 'var'|'value',
    key: string,
    keyType: 'var'|'value',
    content: string,
    contentType: 'var'|'value',
    insertOrder: string,
    insertOrderType: 'var'|'value',
    indent: number
}

export type triggerV2DeleteLorebookByIndex = {
    type: 'v2DeleteLorebookByIndex',
    index: string,
    indexType: 'var'|'value',
    indent: number
}

export type triggerV2GetLorebookCountNew = {
    type: 'v2GetLorebookCountNew',
    outputVar: string,
    indent: number
}

export type triggerV2SetLorebookAlwaysActive = {
    type: 'v2SetLorebookAlwaysActive',
    index: string,
    indexType: 'var'|'value',
    value: boolean,
    indent: number
}

export type triggerV2GetAlertSelect = {
    type: 'v2GetAlertSelect',
    display: string,
    displayType: 'var'|'value',
    value: string,
    valueType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetReplaceGlobalNote = {
    type: 'v2GetReplaceGlobalNote',
    outputVar: string,
    indent: number
}

export type triggerV2SetReplaceGlobalNote = {
    type: 'v2SetReplaceGlobalNote',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2GetAuthorNote = {
    type: 'v2GetAuthorNote',
    outputVar: string,
    indent: number
}

export type triggerV2SetAuthorNote = {
    type: 'v2SetAuthorNote',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2MakeDictVar = {
    type: 'v2MakeDictVar',
    var: string,
    indent: number
}

export type triggerV2GetDictVar = {
    type: 'v2GetDictVar',
    var: string,
    varType: 'var'|'value',
    key: string,
    keyType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2SetDictVar = {
    type: 'v2SetDictVar',
    var: string,
    varType: 'var'|'value',
    key: string,
    keyType: 'var'|'value',
    value: string,
    valueType: 'var'|'value',
    indent: number
}

export type triggerV2DeleteDictKey = {
    type: 'v2DeleteDictKey',
    var: string,
    varType: 'var'|'value',
    key: string,
    keyType: 'var'|'value',
    indent: number
}

export type triggerV2HasDictKey = {
    type: 'v2HasDictKey',
    var: string,
    varType: 'var'|'value',
    key: string,
    keyType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2ClearDict = {
    type: 'v2ClearDict',
    var: string,
    indent: number
}

export type triggerV2GetDictSize = {
    type: 'v2GetDictSize',
    var: string,
    varType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetDictKeys = {
    type: 'v2GetDictKeys',
    var: string,
    varType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2GetDictValues = {
    type: 'v2GetDictValues',
    var: string,
    varType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2Calculate = {
    type: 'v2Calculate',
    expression: string,
    expressionType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2ReplaceString = {
    type: 'v2ReplaceString',
    source: string,
    sourceType: 'var'|'value',
    regex: string,
    regexType: 'var'|'value',
    result: string,
    resultType: 'var'|'value',
    replacement: string,
    replacementType: 'var'|'value',
    flags: string,
    flagsType: 'var'|'value',
    outputVar: string,
    indent: number
}

export type triggerV2Comment = {
    type: 'v2Comment',
    value: string,
    indent: number
}

export type triggerV2DeclareLocalVar = {
    type: 'v2DeclareLocalVar',
    var: string,
    value: string,
    valueType: 'var'|'value',
    indent: number
}

const safeSubset = [
    'v2SetVar',
    'v2If',
    'v2IfAdvanced',
    'v2Else',
    'v2EndIndent',
    'v2LoopNTimes',
    'v2BreakLoop',
    'v2ConsoleLog',
    'v2StopTrigger',
    'v2Random',
    'v2ExtractRegex',
    'v2RegexTest',
    'v2GetCharAt',
    'v2GetCharCount',
    'v2ToLowerCase',
    'v2ToUpperCase',
    'v2SetCharAt',
    'v2SplitString',
    'v2JoinArrayVar',
    'v2ConcatString',
    'v2MakeArrayVar',
    'v2GetArrayVarLength',
    'v2GetArrayVar',
    'v2SetArrayVar',
    'v2PushArrayVar',
    'v2PopArrayVar',
    'v2ShiftArrayVar',
    'v2UnshiftArrayVar',
    'v2SpliceArrayVar',
    'v2SliceArrayVar',
    'v2GetIndexOfValueInArrayVar',
    'v2RemoveIndexFromArrayVar',
    'v2Calculate',
    'v2Comment',
    'v2DeclareLocalVar'
]

export const displayAllowList = [
    'v2GetDisplayState',
    'v2SetDisplayState',
    ...safeSubset
]

export const requestAllowList = [
    'v2GetRequestState',
    'v2SetRequestState',
    'v2GetRequestStateRole',
    'v2SetRequestStateRole',
    'v2GetRequestStateLength',
    ...safeSubset
]

async function collectStreamingText(stream: ReadableStream<{ [key: string]: string }>): Promise<string> {
    const reader = stream.getReader()
    let lastChunk = ''

    while (true) {
        const { done, value } = await reader.read()
        if (value) {
            const firstKey = Object.keys(value)[0]
            if (firstKey) {
                lastChunk = value[firstKey] ?? lastChunk
            }
        }
        if (done) {
            break
        }
    }

    return lastChunk
}

// A non-display run has no snapshot to commit: every effect writes straight
// through its own origin, so it must be given one. A display run from the chat
// screen keeps reading and writing the objects its own caller passed it and so
// carries no origin; a request run made for a send or a trigger-run model call
// carries one, so that everything it reads follows that chat.
type RunTriggerLiveArg = {
    chat: Chat
    recursiveCount?: number
    additonalSysPrompt?: additonalSysPrompt
    stopSending?: boolean
    manualName?: string
    triggerId?: string
    displayMode?: false
    displayData?: string
    tempVars?: Record<string, string>
    origin: Origin
    promptFirstSent?: boolean
    signal?: AbortSignal
    ownsWindow?: boolean
}
type RunTriggerDisplayArg = {
    chat: Chat
    recursiveCount?: number
    additonalSysPrompt?: additonalSysPrompt
    stopSending?: boolean
    manualName?: string
    triggerId?: string
    displayMode: true
    displayData?: string
    tempVars?: Record<string, string>
    origin?: Origin
    promptFirstSent?: undefined
    signal?: AbortSignal
    ownsWindow?: boolean
}
// `promptFirstSent` is set only on the run the send makes for its start
// trigger, with the send's own decision on whether the first message is sent;
// every run it starts through `runtrigger` or `v2RunTrigger` carries it on. The
// system-prompt text of such a run is parsed as part of the prompt.
// `signal` stops the run's command lines before their next command and the run
// itself before its next trigger, effect or loop step (the effect already
// running finishes), and `ownsWindow` marks work that opened the composer's
// window; both are carried on by every run this one starts.
export type RunTriggerArg = RunTriggerLiveArg | RunTriggerDisplayArg

export async function runTrigger(char:character,mode:triggerMode, arg: RunTriggerArg){
    arg.recursiveCount ??= 0
    let varChanged = false
    let stopSending = arg.stopSending ?? false
    const CharacterlowLevelAccess = char.lowLevelAccess ?? false
    let sendAIprompt = false
    let additonalSysPrompt:additonalSysPrompt = arg.additonalSysPrompt ?? {
        start:'',
        historyend: '',
        promptend: ''
    }
    // Every persistent read and write in a non-display run goes through the
    // run's own origin, re-resolved at the moment of use -- never through a
    // reference held since before an `await`. Every case below that awaits
    // and then reads or writes `char`/`chat`/`runner` calls `refreshSubject`
    // again first, since the memo behind it does not survive that `await`.
    // A display run with no origin keeps reading/writing its caller's
    // `char`/`chat` directly, unchanged.
    const subject = arg.origin ? createRunSubject(arg.origin) : null

    // A run never writes back onto a trigger definition: every entry
    // carries a shallow copy of the module's or character's own
    // `lowLevelAccess`, computed for this run only. The module list itself
    // is taken once here, before any effect runs, from the origin rather
    // than the selection.
    const triggers = char.triggerscript.map((v): triggerscript => {
        return { ...v, lowLevelAccess: CharacterlowLevelAccess }
    }).concat(getModuleTriggers(subject))
    const db = getDatabase()
    const defaultVariables = parseKeyValue(char.defaultVariables).concat(parseKeyValue(db.templateDefaultVariables))
    let chat: Chat = arg.chat ?? char.chats[char.chatPage]

    // The character whose own fields an effect that needs one real
    // character -- a nested trigger, `generateImage`'s image effects --
    // should act on: the member in a group run, the owner otherwise, and
    // `char` unchanged when there is no subject at all. Kept apart from
    // `char`, which falls back to the owner for reads, because `runner`
    // must not: a gone or ambiguous group member makes it `null`, and a
    // caller of it must skip rather than substitute the group.
    let runner: character | null = null

    // The parser option for the text a system-prompt effect hands to the
    // prompt. The hidden messages are those of the list as it stands now, since
    // an earlier effect may have replaced or edited it.
    function promptOption(): { promptView?: PromptView } {
        if(arg.promptFirstSent === undefined){
            return {}
        }
        return { promptView: promptViewOfMessages(chat.message, arg.promptFirstSent) }
    }

    // Refreshes `char`, `chat` and `runner` from the origin for the run's
    // current synchronous stretch. Returns false, changing none of them,
    // when the origin itself is gone or ambiguous -- callers stop the run
    // cleanly on false. A gone or ambiguous group member does not fail this:
    // `char` still falls back to the owner and `chat` is still the group's,
    // only `runner` becomes null.
    function refreshSubject(): boolean {
        if (!subject) {
            runner = char
            return true
        }
        if (subject.status() !== 'ok') {
            return false
        }
        const ctx = subject.resolve()
        if (!ctx) {
            return false
        }
        char = (ctx.member ?? ctx.owner) as character
        chat = ctx.chat
        runner = arg.origin?.memberChaId ? (ctx.member as character | null) : (ctx.owner as character)
        return true
    }

    // True only for a group member's run whose member is itself gone or
    // ambiguous -- the v2 character and lorebook effects skip rather than
    // falling back to the group. A run with no member concept at all
    // (no `origin.memberChaId`) is never "member required but gone".
    function memberRequiredButGone(): boolean {
        return runner === null
    }

    // Marks the origin's owner -- and its member, whenever it resolved --
    // for save. A display or request run writes only run-local variables and
    // so marks nothing.
    function markWrite(): void {
        subject?.mark()
    }

    // The context a command line of this run acts in: the run's own chat, its
    // cancel signal, whether it owns the composer's window, and the run's own
    // recursion count, which the line's `/trigger`s advance.
    function commandContext(lowLevelAccess: boolean | undefined): CommandContext | null {
        if (!arg.origin) {
            return null
        }
        return {
            origin: arg.origin,
            signal: arg.signal,
            ownsWindow: arg.ownsWindow,
            recursion: {
                get count() { return arg.recursiveCount ?? 0 },
                set count(value: number) { arg.recursiveCount = value },
            },
            lowLevelAccess,
        }
    }

    const previousTriggerId = get(CurrentTriggerIdStore)
    const shouldSetTriggerId = !arg.displayMode && mode !== 'display'
    if (shouldSetTriggerId) {
        CurrentTriggerIdStore.set(arg.triggerId || null)
    }

    if((!triggers) || (triggers.length === 0)){
        if (shouldSetTriggerId) {
            CurrentTriggerIdStore.set(previousTriggerId)
        }
        return null
    }

    let tempVars:Record<string, string> = arg.tempVars ?? {}
    
    let localVarScopes: Record<number, Record<string, string>>[] = [{}]
    let currentIndent = 0
    

    function getLocalVar(key: string): string | null {
        if (!localVarScopes || localVarScopes.length === 0) {
            return null
        }
        const currentScope = localVarScopes[localVarScopes.length - 1]
        if (!currentScope) {
            return null
        }
        for (let indent = currentIndent; indent >= 0; indent--) {
            if (currentScope[indent] && currentScope[indent][key] !== undefined) {
                const value = currentScope[indent][key]
                return value
            }
        }
        return null
    }
    
    function setLocalVar(key: string, value: string, indent: number): boolean {
        if (!localVarScopes || localVarScopes.length === 0) {
            localVarScopes = [{}]
        }
        const currentScope = localVarScopes[localVarScopes.length - 1]
        if (!currentScope) {
            return false
        }
        
        const finalValue = (value === null || value === undefined) ? 'null' : value
        
        let foundIndent = -1
        for (let i = indent; i >= 0; i--) {
            if (currentScope[i] && currentScope[i][key] !== undefined) {
                foundIndent = i
                break
            }
        }
        
        const targetIndent = foundIndent !== -1 ? foundIndent : indent
        
        if (!currentScope[targetIndent]) {
            currentScope[targetIndent] = {}
        }

        if(currentScope[targetIndent][key] === finalValue){
            return false
        }
        
        currentScope[targetIndent][key] = finalValue
        return true
    }
    
    function declareLocalVar(key: string, value: string, indent: number) {
        setLocalVar(key, value, indent)
    }
    
    function clearLocalVarsAtIndent(indent: number) {
        if (!localVarScopes || localVarScopes.length === 0) {
            return
        }
        const currentScope = localVarScopes[localVarScopes.length - 1]
        if (!currentScope) {
            return
        }
        const indentsToDelete: string[] = []
        for (const scopeIndent in currentScope) {
            if (Number(scopeIndent) >= indent) {
                indentsToDelete.push(scopeIndent)
            }
        }
        indentsToDelete.forEach(indentKey => {
            delete currentScope[indentKey]
        })
    }

    function getVar(key:string){
        const localVar = getLocalVar(key)
        if(localVar !== null){
            return localVar
        }

        const targetChat = subject ? subject.resolve()?.chat : chat
        const state = targetChat?.scriptstate?.['$' + key]
        if(state === undefined || state === null){
            const findResult = defaultVariables.find((f) => {
                return f[0] === key
            })
            if(findResult){
                return findResult[1]
            }
            if(arg.displayMode){
                return tempVars[key] ?? 'null'
            }
            return 'null'
        }
        return state.toString()
    }

    function setVar(key:string, value:string): boolean {
        if(arg.displayMode){
            if(tempVars[key] === value){
                return false
            }
            tempVars[key] = value
            return true
        }
        
        const localVar = getLocalVar(key)
        if(localVar !== null){
            return setLocalVar(key, value, currentIndent)
        }

        const targetChat = subject ? subject.resolve()?.chat : chat
        if(!targetChat){
            return false
        }
        targetChat.scriptstate ??= {}
        const stateKey = '$' + key
        if(targetChat.scriptstate[stateKey] === value){
            return false
        }

        varChanged = true
        targetChat.scriptstate[stateKey] = value
        markWrite()
        return true
    }
    
    
    triggerLoop:
    for(const trigger of triggers){
        let tempVars:Record<string, number> = {}

        if(trigger.effect[0]?.type === 'triggercode' || trigger.effect[0]?.type === 'triggerlua'){
            //
        }
        else if(arg.manualName){
            if(trigger.comment !== arg.manualName){
                continue
            }
        }
        else if(mode !== trigger.type){
            continue
        }

        // The run stops here, cleanly and silently (a warning only for an
        // ambiguous origin), the moment its origin is gone or ambiguous, or
        // its signal is aborted: no further effect runs.
        if(arg.signal?.aborted || !refreshSubject()){
            break triggerLoop
        }

        let pass = true
        for(const condition of trigger.conditions){
            if(condition.type === 'var' || condition.type === 'chatindex' || condition.type === 'value'){
                let varValue =  (condition.type === 'var') ? (getVar(condition.var) ?? 'null') :
                                (condition.type === 'chatindex') ? (chat.message.length.toString()) :
                                (condition.type === 'value') ? condition.var : null
                                
                if(varValue === undefined || varValue === null){
                    pass = false
                    break
                }
                else{
                    const conditionValue = risuChatParser(condition.value,{chara:char, subject})
                    varValue = risuChatParser(varValue,{chara:char, subject})
                    switch(condition.operator){
                        case 'true': {
                            if(varValue !== 'true' && varValue !== '1'){
                                pass = false
                            }
                            break
                        }
                        case '=':
                            if(varValue !== conditionValue){
                                pass = false
                            }
                            break
                        case '!=':
                            if(varValue === conditionValue){
                                pass = false
                            }
                            break
                        case '>':
                            if(Number(varValue) <= Number(conditionValue)){
                                pass = false
                            }
                            break
                        case '<':
                            if(Number(varValue) >= Number(conditionValue)){
                                pass = false
                            }
                            break
                        case '>=':
                            if(Number(varValue) < Number(conditionValue)){
                                pass = false
                            }
                            break
                        case '<=':
                            if(Number(varValue) > Number(conditionValue)){
                                pass = false
                            }
                            break
                        case 'null':
                            if(varValue !== 'null'){
                                pass = false
                            }
                            break
                    }
                }
            }
            else if(condition.type === 'exists'){
                const conditionValue = risuChatParser(condition.value,{chara:char, subject})
                const val = risuChatParser(conditionValue,{chara:char, subject})
                let da =  chat.message.slice(0-condition.depth).map((v)=>v.data).join(' ')
                if(condition.type2 === 'strict'){
                    pass = da.split(' ').includes(val)
                }
                else if(condition.type2 === 'loose'){
                    pass = da.toLowerCase().includes(val.toLowerCase())
                }
                else if(condition.type2 === 'regex'){
                    pass = new RegExp(val).test(da)
                }
            }
            if(!pass){
                break
            }
        }
        if(!pass){
            continue
        }

        for(let index = 0; index < trigger.effect.length; index++){
            const effect = trigger.effect[index]
            if(mode === 'display' && !displayAllowList.includes(effect.type)){
                continue
            }
            if(mode === 'request' && !requestAllowList.includes(effect.type)){
                continue
            }

            // The effect already running when the signal aborts finishes. A loop
            // step re-enters here, and a nested run carries the same signal, so
            // both end at their next effect too.
            if(arg.signal?.aborted || !refreshSubject()){
                break triggerLoop
            }

            if(effect && 'indent' in effect && typeof effect.indent === 'number' && effect.indent >= 0){
                currentIndent = effect.indent
            } else if(!effect || !('indent' in effect)) {
                currentIndent = 0
            }
            
            switch(effect.type){
                case'setvar': {
                    const effectValue = risuChatParser(effect.value,{chara:char, subject})
                    const varKey  = risuChatParser(effect.var,{chara:char, subject})
                    let originalVar = Number(getVar(varKey))
                    if(Number.isNaN(originalVar)){
                        originalVar = 0
                    }
                    let resultValue = ''
                    switch(effect.operator){
                        case '=':{
                            resultValue = effectValue
                            break
                        }
                        case '+=':{
                            resultValue = (originalVar + Number(effectValue)).toString()
                            break
                        }
                        case '-=':{
                            resultValue = (originalVar - Number(effectValue)).toString()
                            break
                        }
                        case '*=':{
                            resultValue = (originalVar * Number(effectValue)).toString()
                            break
                        }
                        case '/=':{
                            resultValue = (originalVar / Number(effectValue)).toString()
                            break
                        }
                    }
                    setVar(varKey, resultValue)
                    break
                }
                case 'systemprompt':{
                    const effectValue = risuChatParser(effect.value,{chara:char, subject, ...promptOption()})
                    additonalSysPrompt[effect.location] += effectValue + "\n\n"
                    break
                }
                case 'impersonate':{
                    const effectValue = risuChatParser(effect.value,{chara:char, subject})
                    if(effect.role === 'user'){
                        chat.message.push({role: 'user', data: effectValue})
                    }
                    else if(effect.role === 'char'){
                        chat.message.push({role: 'char', data: effectValue})
                    }
                    markWrite()
                    break
                }
                case 'command':{
                    const effectValue = risuChatParser(effect.value,{chara:char, subject})
                    const commandCtx = commandContext(trigger.lowLevelAccess)
                    if(commandCtx){
                        await processMultiCommand(effectValue, commandCtx)
                    }
                    break
                }
                case 'stop':
                case 'v2StopPromptSending':{
                    stopSending = true
                    break
                }
                case 'runtrigger':{
                    if(runner === null){
                        break
                    }
                    if(arg.recursiveCount < (trigger.lowLevelAccess ? LOW_LEVEL_NESTED_TRIGGER_LIMIT : NORMAL_NESTED_TRIGGER_LIMIT)){
                        arg.recursiveCount++
                        const r = await runTrigger(runner,'manual',{
                            chat,
                            recursiveCount: arg.recursiveCount,
                            additonalSysPrompt,
                            stopSending,
                            manualName: effect.value,
                            origin: arg.origin as Origin,
                            promptFirstSent: arg.promptFirstSent,
                            signal: arg.signal,
                            ownsWindow: arg.ownsWindow,
                        })
                        if(r){
                            additonalSysPrompt = r.additonalSysPrompt
                            stopSending = r.stopSending
                        }
                    }
                    break
                }
                case 'cutchat':{
                    const start = Number(risuChatParser(effect.start,{chara:char, subject}))
                    const end = Number(risuChatParser(effect.end,{chara:char, subject}))
                    chat.message = chat.message.slice(start,end)
                    markWrite()
                    break
                }
                case 'modifychat':{
                    const index = Number(risuChatParser(effect.index,{chara:char, subject}))
                    const value = risuChatParser(effect.value,{chara:char, subject})
                    if(chat.message[index]){
                        chat.message[index].data = value
                        markWrite()
                    }
                    break
                }

                // low level access only
                case 'showAlert':{
                    if(!trigger.lowLevelAccess){
                        break
                    }

                    if(arg.displayMode){
                        return
                    }

                    const effectValue = risuChatParser(effect.value,{chara:char, subject})
                    const inputVar = risuChatParser(effect.inputVar,{chara:char, subject})

                    switch(effect.alertType){
                        case 'normal':{
                            alertNormal(effectValue)
                            break
                        }
                        case 'error':{
                            alertError(effectValue)
                            break
                        }
                        case 'input':{
                            const val = await alertInput(effectValue)
                            setVar(inputVar, val)
                            break;
                        }
                        case 'select':{
                            const val = await alertSelect(effectValue.split('§'))
                            setVar(inputVar, val)
                        }
                    }
                    break
                }

                case 'sendAIprompt':{
                    if(!trigger.lowLevelAccess){
                        break
                    }
                    sendAIprompt = true
                    break
                }

                case 'runLLM':
                case 'runAxLLM':{
                    if(!trigger.lowLevelAccess){
                        break
                    }
                    const effectValue = risuChatParser(effect.value,{chara:char, subject})
                    const varName = effect.inputVar
                    let promptbody:OpenAIChat[] = parseChatML(effectValue)
                    if(!promptbody){
                        promptbody = [{role:'user', content:effectValue}]
                    }
                    const result = await requestChatData({
                        formated: promptbody,
                        bias: {},
                        useStreaming: false,
                        noMultiGen: true,
                        subject: subject ?? undefined,
                    }, effect.type === 'runAxLLM' ? 'otherAx' : 'model')

                    if(result.type === 'fail' || result.type === 'streaming' || result.type === 'multiline'){
                        setVar(varName, 'Error: ' + result.result)
                    }
                    else{
                        setVar(varName, result.result)
                    }

                    break
                }

                case 'checkSimilarity':{
                    if(!trigger.lowLevelAccess){
                        break
                    }

                    const processer = new HypaProcesser()
                    const effectValue = risuChatParser(effect.value,{chara:char, subject})
                    const source = risuChatParser(effect.source,{chara:char, subject})
                    await processer.addText(effectValue.split('§'))
                    const val = await processer.similaritySearch(source)
                    setVar(effect.inputVar, val.join('§'))
                    break
                }

                case 'extractRegex':{
                    if(!trigger.lowLevelAccess){
                        break
                    }

                    const effectValue = risuChatParser(effect.value,{chara:char, subject})
                    const regex = new RegExp(effect.regex, effect.flags)
                    const regexResult = regex.exec(effectValue)
                    const result = effect.result.replace(/\$[0-9]+/g, (match) => {
                        const index = Number(match.slice(1))
                        return regexResult[index]
                    }).replace(/\$&/g, regexResult[0]).replace(/\$\$/g, '$')

                    setVar(effect.inputVar, result)
                    break
                }

                case 'runImgGen':{
                    if(!trigger.lowLevelAccess){
                        break
                    }
                    if(runner === null){
                        break
                    }

                    const effectValue = risuChatParser(effect.value,{chara:char, subject})
                    const negValue = risuChatParser(effect.negValue,{chara:char, subject})
                    const gen = await generateAIImage(effectValue, runner, negValue, 'inlay')
                    if(!gen){
                        setVar(effect.inputVar, 'Error: Image generation failed')
                        break
                    }
                    const imgHTML = new Image()
                    imgHTML.src = gen
                    const inlay = await writeInlayImage(imgHTML)
                    const res = `{{inlay::${inlay}}}`
                    setVar(effect.inputVar, res)
                    break
                }

                case 'triggerlua':{
                    const triggerCodeResult = await runScripted(effect.code,{
                        lowLevelAccess: trigger.lowLevelAccess,
                        mode: mode === 'manual' ? arg.manualName : mode,
                        setVar: setVar,
                        getVar: getVar,
                        char: char,
                        chat: chat,
                        origin: arg.origin,
                    })

                    if(triggerCodeResult.stopSending){
                        stopSending = true
                    }
                    // Every write a Lua call may have made -- messages,
                    // `setChatVar`, the character fields, `localLore` --
                    // already landed on its own live target; mark both the
                    // owner and the member (whichever resolved) rather than
                    // trying to tell which of them the call actually wrote.
                    markWrite()
                    break
                }

                //V2 triggers
                case 'v2Header':{
                    //Header for V2 triggers to identify the start of a new trigger
                    break
                }
                case 'v2SetVar':{
                    const effectValue = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    const varKey  = risuChatParser(effect.var,{chara:char, subject})
                    let originalVar = Number(getVar(varKey))
                    if(Number.isNaN(originalVar)){
                        originalVar = 0
                    }
                    let resultValue = ''
                    switch(effect.operator){
                        case '=':{
                            resultValue = effectValue
                            break
                        }
                        case '+=':{
                            resultValue = (originalVar + Number(effectValue)).toString()
                            break
                        }
                        case '-=':{
                            resultValue = (originalVar - Number(effectValue)).toString()
                            break
                        }
                        case '*=':{
                            resultValue = (originalVar * Number(effectValue)).toString()
                            break
                        }
                        case '/=':{
                            resultValue = (originalVar / Number(effectValue)).toString()
                            break
                        }
                        case '%=':{
                            resultValue = (originalVar % Number(effectValue)).toString()
                            break
                        }
                    }
                    setVar(varKey, resultValue)
                    break
                }
                case 'v2DeclareLocalVar':{
                    const effectValue = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    const varKey = risuChatParser(effect.var,{chara:char, subject})
                    const finalValue = (effectValue === null || effectValue === undefined) ? 'null' : effectValue
                    declareLocalVar(varKey, finalValue, effect.indent)
                    break
                }
                case 'v2If':
                case 'v2IfAdvanced':{
                    const sourceValue = (effect.type === 'v2If' || effect.sourceType === 'var') ? getVar(risuChatParser(effect.source,{chara:char, subject})) : risuChatParser(effect.source,{chara:char, subject})
                    const targetValue = effect.targetType === 'value' ? risuChatParser(effect.target,{chara:char, subject}) : getVar(risuChatParser(effect.target,{chara:char, subject}))
                    let pass = false
                    switch(effect.condition){
                        case '=':{                            
                            if(!isNaN(Number(sourceValue)) && !isNaN(Number(targetValue))){ //to check like 1.0 = 1
                                pass = Number(sourceValue) === Number(targetValue)
                            }
                            else{
                                pass = sourceValue === targetValue
                            }
                            break
                        }
                        case '!=':{
                            if(!isNaN(Number(sourceValue)) && !isNaN(Number(targetValue))){ //to check like 1.0 = 1
                                pass = Number(sourceValue) !== Number(targetValue)
                            }
                            else{
                                pass = sourceValue !== targetValue
                            }
                            break
                        }
                        case '>':{
                            pass = Number(sourceValue) > Number(targetValue)
                            break
                        }
                        case '<':{
                            pass = Number(sourceValue) < Number(targetValue)
                            break
                        }
                        case '>=':{
                            pass = Number(sourceValue) >= Number(targetValue)
                            break
                        }
                        case '<=':{
                            pass = Number(sourceValue) <= Number(targetValue)
                            break
                        }
                        case '∈':{
                            try {
                                pass = JSON.parse(targetValue).includes(sourceValue)
                            } catch (error) {
                                pass = false
                            }
                            break
                        }
                        case '∋':{
                            try {
                                pass = JSON.parse(sourceValue).includes(targetValue)
                            } catch (error) {
                                pass = false
                            }
                            break
                        }
                        case '∉':{
                            try {
                                pass = !JSON.parse(targetValue).includes(sourceValue)
                            } catch (error) {
                                pass = true
                            }
                            break
                        }
                        case '∌':{
                            try {
                                pass = !JSON.parse(sourceValue).includes(targetValue)
                            } catch (error) {
                                pass = true
                            }
                            break
                        }
                        case '≒':{
                            const num1 = Number(sourceValue)
                            const num2 = Number(targetValue)
                            if(Number.isNaN(num1) || Number.isNaN(num2)){
                                pass = sourceValue.toLocaleLowerCase().replace(/ /g,'') === targetValue.toLocaleLowerCase().replace(/ /g,'')
                            }
                            else{
                                pass = Math.abs(num1 - num2) < 0.0001
                            }
                            break
                        }
                        case '≡':{
                            if(targetValue === 'true'){
                                pass = sourceValue === 'true' || sourceValue === '1'
                            }
                            else if(targetValue === 'false'){
                                pass = !(sourceValue === 'true' || sourceValue === '1')
                            }
                            else{
                                pass = sourceValue === targetValue
                            }
                        }
                    }


                    if(!pass){
                        let indent = effect.indent + 1
                        for(; index < trigger.effect.length; index++){
                            const ef = trigger.effect[index] as triggerEffectV2
                            if(ef.type === 'v2EndIndent' && indent === ef.indent){
                                const nextEf = trigger.effect[index + 1] as triggerEffectV2
                                indent--
                                if(nextEf?.type === 'v2Else' && nextEf?.indent === indent){
                                    index++
                                }

                                break
                            }
                        }
                    }
                    break
                }
                case 'v2Else':{
                    //since if handles the else if the if is false, we can skip the else
                    const indent = effect.indent + 1
                    for(; index < trigger.effect.length; index++){
                        const ef = trigger.effect[index] as triggerEffectV2
                        if(ef.type === 'v2EndIndent' && indent === ef.indent){
                            break
                        }
                    }
                    break
                }
                case 'v2EndIndent':{
                    if(effect.endOfLoop){
                        const indent = effect.indent - 1
                        const originalIndex = index
                        for(; index >= 0; index--){
                            const ef = trigger.effect[index] as triggerEffectV2
                            if((ef.type === 'v2Loop' || ef.type === 'v2LoopNTimes') && indent === ef.indent){
                                
                                if(ef.type === 'v2LoopNTimes'){
                                    let value = ef.valueType === 'value' ? risuChatParser(ef.value,{chara:char, subject}) : getVar(risuChatParser(ef.value,{chara:char, subject}))
                                    let valueNum = Number(value)
                                    if(Number.isNaN(valueNum)){
                                        valueNum = 0
                                    }
                                    tempVars[index + 'LoopNTimes'] = (tempVars[index + 'LoopNTimes'] ?? 0) + 1
                                    if(tempVars[index + 'LoopNTimes'] >= valueNum){
                                        index = originalIndex
                                    }
                                    else{
                                        break
                                    }
                                }

                                break
                            }
                        }
                        
                        //this is for preventing lagging
                        tempVars['loopTimes'] = (tempVars['loopTimes'] ?? 0) + 1
                        if(tempVars['loopTimes'] > 100){
                            await sleep(1)
                            tempVars['loopTimes'] = 0
                        }
                    }
                    
                    clearLocalVarsAtIndent(effect.indent)
                    
                    break
                }
                case 'v2Loop':
                case 'v2LoopNTimes':{
                    //Looping is handled by the v2EndIndent
                    break
                }
                case 'v2BreakLoop':{
                    for(; index < trigger.effect.length; index++){
                        const ef = trigger.effect[index] as triggerEffectV2
                        if(ef.type === 'v2EndIndent' && ef.endOfLoop){
                            break
                        }
                    }
                    break
                }
                case 'v2RunTrigger':{
                    if(runner === null){
                        break
                    }
                    if(arg.recursiveCount < (trigger.lowLevelAccess ? LOW_LEVEL_NESTED_TRIGGER_LIMIT : NORMAL_NESTED_TRIGGER_LIMIT)){
                        arg.recursiveCount++
                        const r = await runTrigger(runner,'manual',{
                            chat,
                            recursiveCount: arg.recursiveCount,
                            additonalSysPrompt,
                            stopSending,
                            manualName: effect.target,
                            origin: arg.origin as Origin,
                            promptFirstSent: arg.promptFirstSent,
                            signal: arg.signal,
                            ownsWindow: arg.ownsWindow,
                        })
                        if(r){
                            additonalSysPrompt = r.additonalSysPrompt
                            stopSending = r.stopSending
                        }
                    }
                    break
                }
                case 'v2ConsoleLog':{
                    const sourceValue = effect.sourceType === 'value' ? risuChatParser(effect.source,{chara:char, subject}) : getVar(risuChatParser(effect.source,{chara:char, subject}))
                    console.log(sourceValue)
                    break
                }
                case 'v2StopTrigger':{
                    index = trigger.effect.length
                    break
                }
                case 'v2CutChat':{
                    let start = effect.startType === 'value' ? Number(risuChatParser(effect.start,{chara:char, subject})) : Number(getVar(risuChatParser(effect.start,{chara:char, subject})))
                    let end = effect.endType === 'value' ? Number(risuChatParser(effect.end,{chara:char, subject})) : Number(getVar(risuChatParser(effect.end,{chara:char, subject})))
                    if(isNaN(start)){
                        start = 0
                    }
                    if(isNaN(end)){
                        end = chat.message.length
                    }

                    chat.message = chat.message.slice(start,end)
                    markWrite()
                    break
                }
                case 'v2ModifyChat':{
                    let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    if(chat.message[index]){
                        chat.message[index].data = value
                        markWrite()
                    }
                    break
                }
                case 'v2SystemPrompt':{
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject, ...promptOption()}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    additonalSysPrompt[effect.location] += value + "\n\n"
                    break
                }
                case 'v2Impersonate':{
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    if(effect.role === 'user'){
                        chat.message.push({role: 'user', data: value})
                    }
                    else if(effect.role === 'char'){
                        chat.message.push({role: 'char', data: value})
                    }
                    markWrite()
                    break
                }
                case 'v2Command':{
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    const commandCtx = commandContext(trigger.lowLevelAccess)
                    if(commandCtx){
                        await processMultiCommand(value, commandCtx)
                    }
                    break
                }
                case 'v2SendAIprompt':{
                    if(!trigger.lowLevelAccess){
                        break
                    }
                    sendAIprompt = true
                    break
                }
                case 'v2ImgGen':{
                    if(!trigger.lowLevelAccess){
                        break
                    }
                    if(runner === null){
                        break
                    }
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    let negValue = effect.negValueType === 'value' ? risuChatParser(effect.negValue,{chara:char, subject}) : getVar(risuChatParser(effect.negValue,{chara:char, subject}))
                    let gen = await generateAIImage(value, runner, negValue, 'inlay')
                    if(!refreshSubject()){
                        break triggerLoop
                    }
                    if(!gen){
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), 'null')
                        break
                    }
                    let imgHTML = new Image()
                    imgHTML.src = gen
                    let inlay = await writeInlayImage(imgHTML)
                    if(!refreshSubject()){
                        break triggerLoop
                    }
                    let res = `{{inlay::${inlay}}}`
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), res)
                    break

                }
                case 'v2CheckSimilarity':{
                    if(!trigger.lowLevelAccess){
                        break
                    }
                    let source = effect.sourceType === 'value' ? risuChatParser(effect.source,{chara:char, subject}) : getVar(risuChatParser(effect.source,{chara:char, subject}))
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    let processer = new HypaProcesser()
                    await processer.addText(value.split('§'))
                    let val = await processer.similaritySearch(source)
                    if(!refreshSubject()){
                        break triggerLoop
                    }
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), val.join('§'))
                    break
                }
                case 'v2RunLLM':{
                    if(!trigger.lowLevelAccess){
                        break
                    }
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    let promptbody = parseChatML(value)
                    if(!promptbody){
                        promptbody = [{role:'user', content:value}]
                    }
                    let result = await requestChatData({
                        formated: promptbody,
                        bias: {},
                        useStreaming: effect.streaming ?? false,
                        noMultiGen: true,
                        subject: subject ?? undefined,
                    }, effect.model)
                    if(!refreshSubject()){
                        break triggerLoop
                    }

                    if(result.type === 'fail' || result.type === 'multiline'){
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), 'null')
                    }
                    else if(result.type === 'streaming'){
                        const text = await collectStreamingText(result.result)
                        if(!refreshSubject()){
                            break triggerLoop
                        }
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), text)
                    }
                    else{
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), result.result)
                    }
                    break
                }
                case 'v2ShowAlert':{
                    if(arg.displayMode){
                        return
                    }
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    alertNormal(value)
                    break
                }
                case 'v2ExtractRegex':{
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    let regexValue = effect.regexType === 'value' ? risuChatParser(effect.regex,{chara:char, subject}) : getVar(risuChatParser(effect.regex,{chara:char, subject}))
                    let flagsValue = effect.flagsType === 'value' ? risuChatParser(effect.flags,{chara:char, subject}) : getVar(risuChatParser(effect.flags,{chara:char, subject}))
                    let regex = new RegExp(regexValue, flagsValue)
                    let regexResult = regex.exec(value)
                    let resultValue = effect.resultType === 'value' ? risuChatParser(effect.result,{chara:char, subject}) : getVar(risuChatParser(effect.result,{chara:char, subject}))
                    
                    let result = ''
                    if (regexResult !== null) {
                        result = resultValue.replace(/\$[0-9]+/g, (match) => {
                            let index = Number(match.slice(1))
                            return regexResult[index] || ''
                        }).replace(/\$&/g, regexResult[0] || '').replace(/\$\$/g, '$')
                    } else {
                        result = resultValue.replace(/\$[0-9]+/g, '').replace(/\$&/g, '').replace(/\$\$/g, '$')
                    }

                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), result)
                    break
                }
                case 'v2GetLastMessage':{
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), chat.message[chat.message.length - 1]?.data ?? 'null')
                    break
                }
                case 'v2GetMessageAtIndex':{
                    let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), chat.message[index]?.data ?? 'null')
                    break
                }
                case 'v2GetMessageCount':{
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), chat.message.length.toString())
                    break
                }
                case 'v2ModifyLorebook':{
                    if(memberRequiredButGone()){
                        break
                    }
                    char.globalLore = char.globalLore ?? []
                    const target = effect.targetType === 'value' ? risuChatParser(effect.target,{chara:char, subject}) : getVar(risuChatParser(effect.target,{chara:char, subject}))
                    const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))

                    const index = char.globalLore.findIndex((v) => v[0] === target)
                    if(index !== -1){
                        char.globalLore[index][1] = value
                        markWrite()
                    }
                    break
                }
                case 'v2GetLorebook':{
                    char.globalLore = char.globalLore ?? []
                    const target = effect.targetType === 'value' ? risuChatParser(effect.target,{chara:char, subject}) : getVar(risuChatParser(effect.target,{chara:char, subject}))
                    const index = char.globalLore.findIndex((v) => v[0] === target)
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), index === -1 ? 'null' : char.globalLore[index][1])
                    break
                }
                case 'v2GetLorebookCount':{
                    char.globalLore = char.globalLore ?? []
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), char.globalLore.length.toString())
                    break
                }
                case 'v2GetLorebookEntry':{
                    char.globalLore = char.globalLore ?? []
                    let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    if(Number.isNaN(index)){
                        index = 0
                    }
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), char.globalLore[index]?.[1] ?? 'null')
                    break
                }
                case 'v2SetLorebookActivation':{
                    if(memberRequiredButGone()){
                        break
                    }
                    char.globalLore = char.globalLore ?? []
                    let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    let value = effect.value
                    char.globalLore[index][2] = value
                    markWrite()
                    break
                }
                case 'v2GetLorebookIndexViaName':{
                    char.globalLore = char.globalLore ?? []
                    let name = effect.nameType === 'value' ? risuChatParser(effect.name,{chara:char, subject}) : getVar(risuChatParser(effect.name,{chara:char, subject}))
                    let index = char.globalLore.findIndex((v) => v[0] === name)
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), index.toString())
                    break
                }
                case 'v2Random':{
                    let min = effect.minType === 'value' ? Number(risuChatParser(effect.min,{chara:char, subject})) : Number(getVar(risuChatParser(effect.min,{chara:char, subject})))
                    let max = effect.maxType === 'value' ? Number(risuChatParser(effect.max,{chara:char, subject})) : Number(getVar(risuChatParser(effect.max,{chara:char, subject})))

                    let output = Math.floor(Math.random() * (max - min + 1) + min)
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), output.toString())
                    break
                }
                case 'v2GetCharAt':{
                    let source = effect.sourceType === 'value' ? risuChatParser(effect.source,{chara:char, subject}) : getVar(risuChatParser(effect.source,{chara:char, subject}))
                    let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), source[index] ?? 'null')
                    break
                }
                case 'v2GetCharCount':{
                    let source = effect.sourceType === 'value' ? risuChatParser(effect.source,{chara:char, subject}) : getVar(risuChatParser(effect.source,{chara:char, subject}))
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), source.length.toString())
                    break
                }
                case 'v2ToLowerCase':{
                    let source = effect.sourceType === 'value' ? risuChatParser(effect.source,{chara:char, subject}) : getVar(risuChatParser(effect.source,{chara:char, subject}))
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), source.toLowerCase())
                    break
                }
                case 'v2ToUpperCase':{
                    let source = effect.sourceType === 'value' ? risuChatParser(effect.source,{chara:char, subject}) : getVar(risuChatParser(effect.source,{chara:char, subject}))
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), source.toUpperCase())
                    break
                }
                case 'v2SetCharAt':{
                    let source = effect.sourceType === 'value' ? risuChatParser(effect.source,{chara:char, subject}) : getVar(risuChatParser(effect.source,{chara:char, subject}))
                    let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    const source2 = [...source]
                    source2[index] = value
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), source2.join(''))
                    break
                }
                case 'v2SplitString':{
                    let source = effect.sourceType === 'value' ? risuChatParser(effect.source,{chara:char, subject}) : getVar(risuChatParser(effect.source,{chara:char, subject}))
                    let delimiter: string
                    
                    if (effect.delimiterType === 'value') {
                        delimiter = risuChatParser(effect.delimiter,{chara:char, subject})
                    } else if (effect.delimiterType === 'var') {
                        delimiter = getVar(risuChatParser(effect.delimiter,{chara:char, subject}))
                    } else {
                        delimiter = risuChatParser(effect.delimiter,{chara:char, subject})
                    }
                    
                    let result: string[]
                    if (effect.delimiterType === 'regex') {
                        try {
                            const regexMatch = delimiter.match(/^\/(.+)\/([gimuy]*)$/)
                            if (regexMatch) {
                                const [, pattern, flags] = regexMatch
                                const regex = new RegExp(pattern, flags)
                                result = source.split(regex)
                            } else {
                                const regex = new RegExp(delimiter)
                                result = source.split(regex)
                            }
                        } catch (error) {
                            result = [source]
                        }
                    } else {
                        result = source.split(delimiter)
                    }
                    
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), JSON.stringify(result))
                    break
                }
                case 'v2JoinArrayVar':{
                    try {
                        let varValue = effect.varType === 'value' ? risuChatParser(effect.var,{chara:char, subject}) : getVar(risuChatParser(effect.var,{chara:char, subject}))
                        let arr = JSON.parse(varValue)
                        let delimiter = effect.delimiterType === 'value' ? risuChatParser(effect.delimiter,{chara:char, subject}) : getVar(risuChatParser(effect.delimiter,{chara:char, subject}))
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), arr.join(delimiter))
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '')
                    }
                    break
                }
                case 'v2GetCharacterDesc':{
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), char.desc)
                    break
                }
                case 'v2SetCharacterDesc':{
                    if(memberRequiredButGone()){
                        break
                    }
                    let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    char.desc = value
                    markWrite()
                    break
                }
                case 'v2GetPersonaDesc':{
                    const db = getDatabase()
                    const currentPersonaPrompt = db.personaPrompt ?? ''
                    const savedPersonaPrompt = db.personas[db.selectedPersona]?.personaPrompt ?? ''
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), currentPersonaPrompt || savedPersonaPrompt)
                    break
                }
                case 'v2SetPersonaDesc':{
                    const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    if(DBState.db.personas[DBState.db.selectedPersona]){
                        DBState.db.personas[DBState.db.selectedPersona].personaPrompt = value
                        DBState.db.personaPrompt = value
                    }
                    break
                }
                case 'v2GetReplaceGlobalNote':{
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), char.replaceGlobalNote ?? '')
                    break
                }
                case 'v2SetReplaceGlobalNote':{
                    if(memberRequiredButGone()){
                        break
                    }
                    const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    char.replaceGlobalNote = value
                    markWrite()
                    break
                }
                case 'v2MakeArrayVar':{
                    const varName = risuChatParser(effect.var, {chara:char, subject})
                    if(varName.startsWith('[') && varName.endsWith(']')){
                        return
                    }

                    setVar(varName, '[]')
                    break
                }
                case 'v2GetArrayVarLength':{
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), arr.length.toString())
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '0')
                    }
                    break
                }
                case 'v2GetArrayVar':{
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), arr[index] ?? 'null')
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), 'null')
                    }
                    break
                }
                case 'v2PushArrayVar':{
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                        arr.push(value)
                        setVar(varName, JSON.stringify(arr))
                    } catch (error) {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        setVar(varName, '[]')
                    }
                    break
                }
                case 'v2PopArrayVar':{
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), arr.pop() ?? 'null')
                        setVar(varName, JSON.stringify(arr))
                    } catch (error) {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        setVar(varName, '[]')
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), 'null')
                    }
                    break
                }
                case 'v2ShiftArrayVar':{
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), arr.shift() ?? 'null')
                        setVar(varName, JSON.stringify(arr))
                    } catch (error) {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        setVar(varName, '[]')
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), 'null')
                    }
                    break
                }
                case 'v2UnshiftArrayVar':{
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                        arr.unshift(value)
                        setVar(varName, JSON.stringify(arr))
                    } catch (error) {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        setVar(varName, '[]')
                    }
                    break
                }
                case 'v2SpliceArrayVar':{
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        let start = effect.startType === 'value' ? Number(risuChatParser(effect.start,{chara:char, subject})) : Number(getVar(risuChatParser(effect.start,{chara:char, subject})))
                        let value = effect.itemType === 'value' ? risuChatParser(effect.item,{chara:char, subject}) : getVar(risuChatParser(effect.item,{chara:char, subject}))
                        arr.splice(start, 0, value)
                        setVar(varName, JSON.stringify(arr))
                    } catch (error) {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        setVar(varName, '[]')
                    }
                    break
                }
                case 'v2SliceArrayVar':{
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        let start = effect.startType === 'value' ? Number(risuChatParser(effect.start,{chara:char, subject})) : Number(getVar(risuChatParser(effect.start,{chara:char, subject})))
                        let end = effect.endType === 'value' ? Number(risuChatParser(effect.end,{chara:char, subject})) : Number(getVar(risuChatParser(effect.end,{chara:char, subject})))
                        
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), JSON.stringify(arr.slice(start,end)))
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '[]')
                    }
                    break
                }
                case 'v2GetIndexOfValueInArrayVar':{
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        let value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), arr.indexOf(value).toString())
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '-1')
                    }
                    break
                }
                case 'v2RemoveIndexFromArrayVar':{
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                        arr.splice(index, 1)
                        setVar(varName, JSON.stringify(arr))
                    } catch (error) {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        setVar(varName, '[]')
                    }
                    break
                }
                case 'v2ConcatString':{
                    let source1 = effect.source1Type === 'value' ? risuChatParser(effect.source1,{chara:char, subject}) : getVar(risuChatParser(effect.source1,{chara:char, subject}))
                    let source2 = effect.source2Type === 'value' ? risuChatParser(effect.source2,{chara:char, subject}) : getVar(risuChatParser(effect.source2,{chara:char, subject}))
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), source1 + source2)
                    break
                }
                case 'v2GetLastUserMessage':{
                    let lastUserMessage = chat.message.slice().reverse().find((v) => v.role === 'user')
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), lastUserMessage?.data ?? 'null')
                    break
                }
                case 'v2GetLastCharMessage':{
                    let lastCharMessage = chat.message.slice().reverse().find((v) => v.role === 'char')
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), lastCharMessage?.data ?? 'null')
                    break
                }
                case 'v2GetFirstMessage':{
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), chat.fmIndex === -1 ? char.firstMessage : char.alternateGreetings[chat.fmIndex])
                    break
                }
                case 'v2GetAlertInput':{
                    if(arg.displayMode){
                        return
                    }
                    let value = await alertInput(
                        effect.displayType === 'value' ? risuChatParser(effect.display,{chara:char, subject}) : getVar(risuChatParser(effect.display,{chara:char, subject}))
                    )
                    if(!refreshSubject()){
                        break triggerLoop
                    }
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), value)
                    break
                }
                case 'v2GetAlertSelect':{
                    if(arg.displayMode){
                        return
                    }
                    const display = effect.displayType === 'value' ? risuChatParser(effect.display,{chara:char, subject}) : getVar(risuChatParser(effect.display,{chara:char, subject}))
                    const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    const options = value.split('|')
                    let result = await alertSelect(options, display)
                    if(!refreshSubject()){
                        break triggerLoop
                    }
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), result)
                    break
                }
                case 'v2SetArrayVar':{
                    const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    const index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    if(Number.isNaN(index)){
                        break
                    }
                    try {
                        const varName = risuChatParser(effect.var, {chara:char, subject})
                        let varValue = getVar(varName)
                        let arr = JSON.parse(varValue)
                        arr[index] = value
                        setVar(varName, JSON.stringify(arr))
                    } catch (error) {
                        
                    }
                    break
                }
                case 'v2GetDisplayState':{
                    if(!arg.displayMode){
                        return
                    }
                    
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), arg.displayData ?? 'null')
                    break
                }
                case 'v2SetDisplayState':{
                    if(!arg.displayMode){
                        return
                    }
                    arg.displayData = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    break
                }
                case 'v2UpdateGUI':{
                    ReloadGUIPointer.set(get(ReloadGUIPointer) + 1)
                    break
                }
                case 'v2UpdateChatAt':{
                    ReloadChatPointer.update((v) => {
                        v[effect.index] = (v[effect.index] ?? 0) + 1
                        return v
                    })
                    break
                }
                case 'v2Wait':{
                    let value = effect.valueType === 'value' ? Number(risuChatParser(effect.value,{chara:char, subject})) : Number(getVar(risuChatParser(effect.value,{chara:char, subject})))
                    await sleep(value * 1000)
                    break
                }
                case 'v2GetRequestState':{
                    if(!arg.displayMode){
                        return
                    }
                    const json = JSON.parse(arg.displayData) as OpenAIChat[]
                    const index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    const content = json?.[index]?.content ?? 'null'
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), content)
                    break
                }
                case 'v2SetRequestState':{
                    if(!arg.displayMode){
                        return
                    }
                    const json = JSON.parse(arg.displayData) as OpenAIChat[]
                    const index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    json[index].content = value
                    arg.displayData = JSON.stringify(json)
                    break
                }
                case 'v2GetRequestStateRole':{
                    if(!arg.displayMode){
                        return
                    }
                    const json = JSON.parse(arg.displayData) as OpenAIChat[]
                    const index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    const content = json?.[index]?.role ?? 'null'
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), content)
                    break
                }
                case 'v2SetRequestStateRole':{
                    if(!arg.displayMode){
                        return
                    }
                    const json = JSON.parse(arg.displayData) as OpenAIChat[]
                    const index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    if(value === 'user' || value === 'assistant' || value === 'system'){
                        json[index].role = value
                    }
                    arg.displayData = JSON.stringify(json)
                    break
                }

                case 'v2GetRequestStateLength':{
                    if(!arg.displayMode){
                        return
                    }
                    const json = JSON.parse(arg.displayData) as OpenAIChat[]
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), json.length.toString())
                    break
                }
                case 'v2QuickSearchChat':{
                    const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    const depth = effect.depthType === 'value' ? Number(risuChatParser(effect.depth,{chara:char, subject})) : Number(getVar(risuChatParser(effect.depth,{chara:char, subject})))
                    const condition = effect.condition

                    if(isNaN(depth)){
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '0')
                        break
                    }
                    let pass = false
                    let da =  chat.message.slice(0-depth).map((v)=>v.data).join(' ')
                    if(condition === 'strict'){
                        pass = da.split(' ').includes(value)
                    }
                    else if(condition === 'loose'){
                        pass = da.toLowerCase().includes(value.toLowerCase())
                    }
                    else if(condition === 'regex'){
                        pass = new RegExp(value).test(da)
                    }
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), pass ? '1' : '0')
                    break
                }
                case 'v2Tokenize':{
                    const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), (await tokenize(value)).toString())
                    break
                }
                case 'v2GetAllLorebooks':{
                    char.globalLore = char.globalLore ?? []
                    const allPrompts: string[] = []
                    for (const lore of char.globalLore) {
                        if (lore && lore.content !== undefined) {
                            allPrompts.push(lore.content)
                        }
                    }
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), JSON.stringify(allPrompts))
                    break
                }
                case 'v2GetLorebookByName':{
                    char.globalLore = char.globalLore ?? []
                    const name = effect.nameType === 'value' ? risuChatParser(effect.name,{chara:char, subject}) : getVar(risuChatParser(effect.name,{chara:char, subject}))
                    const regex = new RegExp(name, 'i')
                    const matchingIndices: number[] = []
                    for (let i = 0; i < char.globalLore.length; i++) {
                        const lore = char.globalLore[i]
                        if (lore && lore.comment !== undefined && regex.test(lore.comment)) {
                            matchingIndices.push(i)
                        }
                    }
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), JSON.stringify(matchingIndices))
                    break
                }
                case 'v2GetLorebookByIndex':{
                    char.globalLore = char.globalLore ?? []
                    let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))
                    if(Number.isNaN(index) || index < 0 || index >= char.globalLore.length){
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), 'null')
                    } else {
                        const loreEntry = char.globalLore[index]
                        if(loreEntry && loreEntry.content !== undefined){
                            setVar(risuChatParser(effect.outputVar, {chara:char, subject}), loreEntry.content)
                        } else {
                            setVar(risuChatParser(effect.outputVar, {chara:char, subject}), 'null')
                        }
                    }
                    break
                }
                case 'v2CreateLorebook':{
                    if(memberRequiredButGone()){
                        break
                    }
                    char.globalLore = char.globalLore ?? []
                    const name = effect.nameType === 'value' ? risuChatParser(effect.name,{chara:char, subject}) : getVar(risuChatParser(effect.name,{chara:char, subject}))
                    const key = effect.keyType === 'value' ? risuChatParser(effect.key,{chara:char, subject}) : getVar(risuChatParser(effect.key,{chara:char, subject}))
                    const content = effect.contentType === 'value' ? risuChatParser(effect.content,{chara:char, subject}) : getVar(risuChatParser(effect.content,{chara:char, subject}))
                    const insertOrder = effect.insertOrderType === 'value' ? Number(risuChatParser(effect.insertOrder,{chara:char, subject})) : Number(getVar(risuChatParser(effect.insertOrder,{chara:char, subject})))

                    char.globalLore.push({
                        key: key,
                        comment: name,
                        content: content,
                        mode: 'normal',
                        insertorder: Number.isNaN(insertOrder) ? 100 : insertOrder,
                        alwaysActive: false,
                        secondkey: "",
                        selective: false
                    })
                    markWrite()
                    break
                }
                case 'v2ModifyLorebookByIndex':{
                    if(memberRequiredButGone()){
                        break
                    }
                    char.globalLore = char.globalLore ?? []
                    let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))

                    if(Number.isNaN(index) || index < 0 || index >= char.globalLore.length || !char.globalLore[index]){
                        break
                    }

                    const currentLore = char.globalLore[index]
                    
                    let name = effect.nameType === 'value' ? risuChatParser(effect.name,{chara:char, subject}) : getVar(risuChatParser(effect.name,{chara:char, subject}))
                    name = name.replace(/{{slot}}/g, currentLore.comment || '')
                    char.globalLore[index].comment = name
                    
                    let key = effect.keyType === 'value' ? risuChatParser(effect.key,{chara:char, subject}) : getVar(risuChatParser(effect.key,{chara:char, subject}))
                    key = key.replace(/{{slot}}/g, currentLore.key || '')
                    char.globalLore[index].key = key
                    
                    let content = effect.contentType === 'value' ? risuChatParser(effect.content,{chara:char, subject}) : getVar(risuChatParser(effect.content,{chara:char, subject}))
                    content = content.replace(/{{slot}}/g, currentLore.content || '')
                    char.globalLore[index].content = content
                    
                    let insertOrder = effect.insertOrderType === 'value' ? risuChatParser(effect.insertOrder,{chara:char, subject}) : getVar(risuChatParser(effect.insertOrder,{chara:char, subject}))
                    insertOrder = insertOrder.replace(/{{slot}}/g, (currentLore.insertorder || 100).toString())
                    const insertOrderNum = Number(insertOrder)
                    if(!Number.isNaN(insertOrderNum)){
                        char.globalLore[index].insertorder = insertOrderNum
                    }

                    markWrite()
                    break
                }
                case 'v2DeleteLorebookByIndex':{
                    if(memberRequiredButGone()){
                        break
                    }
                    char.globalLore = char.globalLore ?? []
                    let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))

                    if(Number.isNaN(index) || index < 0 || index >= char.globalLore.length || !char.globalLore[index]){
                        break
                    }

                    char.globalLore.splice(index, 1)
                    markWrite()
                    break
                }
                case 'v2GetLorebookCountNew':{
                    char.globalLore = char.globalLore ?? []
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), char.globalLore.length.toString())
                    break
                }
                case 'v2SetLorebookAlwaysActive':{
                    if(memberRequiredButGone()){
                        break
                    }
                    char.globalLore = char.globalLore ?? []
                    let index = effect.indexType === 'value' ? Number(risuChatParser(effect.index,{chara:char, subject})) : Number(getVar(risuChatParser(effect.index,{chara:char, subject})))

                    if(Number.isNaN(index) || index < 0 || index >= char.globalLore.length || !char.globalLore[index]){
                        break
                    }

                    char.globalLore[index].alwaysActive = effect.value
                    markWrite()
                    break
                }
                case 'v2RegexTest':{
                    try {
                        const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                        const regexPattern = effect.regexType === 'value' ? risuChatParser(effect.regex,{chara:char, subject}) : getVar(risuChatParser(effect.regex,{chara:char, subject}))
                        const flags = effect.flagsType === 'value' ? risuChatParser(effect.flags,{chara:char, subject}) : getVar(risuChatParser(effect.flags,{chara:char, subject}))
                        const regex = new RegExp(regexPattern, flags)
                        const result = regex.test(value)
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), result ? '1' : '0')
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '0')
                    }
                    break
                }
                case 'v2GetAuthorNote':{
                    setVar(risuChatParser(effect.outputVar, {chara:char, subject}), chat.note ?? '')
                    break
                }
                case 'v2SetAuthorNote':{
                    const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                    chat.note = value
                    markWrite()
                    break
                }
                case 'v2MakeDictVar':{
                    if(effect.var.startsWith('{') && effect.var.endsWith('}')){
                        return
                    }

                    setVar(risuChatParser(effect.var, {chara:char, subject}), '{}')
                    break
                }
                case 'v2GetDictVar':{
                    try {
                        let varValue = effect.varType === 'value' ? risuChatParser(effect.var,{chara:char, subject}) : getVar(risuChatParser(effect.var,{chara:char, subject}))
                        let dict = JSON.parse(varValue)
                        let key = effect.keyType === 'value' ? risuChatParser(effect.key,{chara:char, subject}) : getVar(risuChatParser(effect.key,{chara:char, subject}))
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), dict[key] ?? 'null')
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), 'null')
                    }
                    break
                }
                case 'v2SetDictVar':{
                    try {
                        const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                        const key = effect.keyType === 'value' ? risuChatParser(effect.key,{chara:char, subject}) : getVar(risuChatParser(effect.key,{chara:char, subject}))
                        
                        if(effect.varType === 'value') {
                            break
                        }
                        
                        let varValue = getVar(risuChatParser(effect.var,{chara:char, subject}))
                        let dict = JSON.parse(varValue)
                        dict[key] = value
                        setVar(risuChatParser(effect.var, {chara:char, subject}), JSON.stringify(dict))
                    } catch (error) {
                        if(effect.varType === 'var') {
                            const value = effect.valueType === 'value' ? risuChatParser(effect.value,{chara:char, subject}) : getVar(risuChatParser(effect.value,{chara:char, subject}))
                            const key = effect.keyType === 'value' ? risuChatParser(effect.key,{chara:char, subject}) : getVar(risuChatParser(effect.key,{chara:char, subject}))
                            let dict = {}
                            dict[key] = value
                            setVar(risuChatParser(effect.var, {chara:char, subject}), JSON.stringify(dict))
                        }
                    }
                    break
                }
                case 'v2DeleteDictKey':{
                    try {
                        if(effect.varType === 'value') {
                            break
                        }
                        
                        let varValue = getVar(risuChatParser(effect.var,{chara:char, subject}))
                        let dict = JSON.parse(varValue)
                        let key = effect.keyType === 'value' ? risuChatParser(effect.key,{chara:char, subject}) : getVar(risuChatParser(effect.key,{chara:char, subject}))
                        delete dict[key]
                        setVar(risuChatParser(effect.var, {chara:char, subject}), JSON.stringify(dict))
                    } catch (error) {
                        if(effect.varType === 'var') {
                            setVar(risuChatParser(effect.var, {chara:char, subject}), '{}')
                        }
                    }
                    break
                }
                case 'v2HasDictKey':{
                    try {
                        let varValue = effect.varType === 'value' ? risuChatParser(effect.var,{chara:char, subject}) : getVar(risuChatParser(effect.var,{chara:char, subject}))
                        let dict = JSON.parse(varValue)
                        let key = effect.keyType === 'value' ? risuChatParser(effect.key,{chara:char, subject}) : getVar(risuChatParser(effect.key,{chara:char, subject}))
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), Object.hasOwn(dict, key) ? '1' : '0')
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '0')
                    }
                    break
                }
                case 'v2ClearDict':{
                    if(effect.var.startsWith('{') && effect.var.endsWith('}')){
                        return
                    }
                    setVar(risuChatParser(effect.var, {chara:char, subject}), '{}')
                    break
                }
                case 'v2GetDictSize':{
                    try {
                        let varValue = effect.varType === 'value' ? risuChatParser(effect.var,{chara:char, subject}) : getVar(risuChatParser(effect.var,{chara:char, subject}))
                        let dict = JSON.parse(varValue)
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), Object.keys(dict).length.toString())
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '0')
                    }
                    break
                }
                case 'v2GetDictKeys':{
                    try {
                        let varValue = effect.varType === 'value' ? risuChatParser(effect.var,{chara:char, subject}) : getVar(risuChatParser(effect.var,{chara:char, subject}))
                        let dict = JSON.parse(varValue)
                        let keys = Object.keys(dict)
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), JSON.stringify(keys))
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '[]')
                    }
                    break
                }
                case 'v2GetDictValues':{
                    try {
                        let varValue = effect.varType === 'value' ? risuChatParser(effect.var,{chara:char, subject}) : getVar(risuChatParser(effect.var,{chara:char, subject}))
                        let dict = JSON.parse(varValue)
                        let values = Object.values(dict)
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), JSON.stringify(values))
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '[]')
                    }
                    break
                }
                case 'v2Calculate':{
                    try {
                        let expression = effect.expressionType === 'value' ? risuChatParser(effect.expression,{chara:char, subject}) : getVar(risuChatParser(effect.expression,{chara:char, subject}))
                        expression = expression.replace(/\$([a-zA-Z0-9_]+)/g, (_, varName) => {
                            const varValue = getVar(varName)
                            const parsed = parseFloat(varValue)
                            return isNaN(parsed) ? '0' : parsed.toString()
                        })
                        
                        const result = calcString(expression, subject)
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), result.toString())
                    } catch (error) {
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), '0')
                    }
                    break
                }
                case 'v2ReplaceString':{
                    try {
                        const source = effect.sourceType === 'value' ? risuChatParser(effect.source,{chara:char, subject}) : getVar(risuChatParser(effect.source,{chara:char, subject}))
                        const regexPattern = effect.regexType === 'value' ? risuChatParser(effect.regex,{chara:char, subject}) : getVar(risuChatParser(effect.regex,{chara:char, subject}))
                        const resultFormat = effect.resultType === 'value' ? risuChatParser(effect.result,{chara:char, subject}) : getVar(risuChatParser(effect.result,{chara:char, subject}))
                        const replacement = effect.replacementType === 'value' ? risuChatParser(effect.replacement,{chara:char, subject}) : getVar(risuChatParser(effect.replacement,{chara:char, subject}))
                        const flags = effect.flagsType === 'value' ? risuChatParser(effect.flags,{chara:char, subject}) : getVar(risuChatParser(effect.flags,{chara:char, subject}))
                        
                        const regex = new RegExp(regexPattern, flags)
                        const result = source.replace(regex, (...args) => {
                            const match = args[0]
                            const groups = args.slice(1, -2)
                            
                            const targetGroupMatch = resultFormat.match(/^\$(\d+)$/)
                            if (targetGroupMatch) {
                                const targetIndex = Number(targetGroupMatch[1])
                                if (targetIndex === 0) {
                                    return replacement
                                } else {
                                    const targetGroup = groups[targetIndex - 1]
                                    if (targetGroup) {
                                        return match.replace(targetGroup, replacement)
                                    }
                                }
                            }
                            
                            return resultFormat.replace(/\$[0-9]+/g, (placeholder) => {
                                const index = Number(placeholder.slice(1))
                                return index === 0 ? match : (groups[index - 1] || '')
                            }).replace(/\$&/g, match).replace(/\$\$/g, '$')
                        })
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), result)
                    } catch (error) {
                        const source = effect.sourceType === 'value' ? risuChatParser(effect.source,{chara:char, subject}) : getVar(risuChatParser(effect.source,{chara:char, subject}))
                        setVar(risuChatParser(effect.outputVar, {chara:char, subject}), source)
                    }
                    break
                }
                case 'v2Comment':{
                    break
                }
            }
        }
    }
    
    let caculatedTokens = 0
    if(additonalSysPrompt.start){
        caculatedTokens += await tokenize(additonalSysPrompt.start)
    }
    if(additonalSysPrompt.historyend){
        caculatedTokens += await tokenize(additonalSysPrompt.historyend)
    }
    if(additonalSysPrompt.promptend){
        caculatedTokens += await tokenize(additonalSysPrompt.promptend)
    }
    if(varChanged){
        ReloadGUIPointer.set(get(ReloadGUIPointer) + 1)
    }

    if (shouldSetTriggerId && mode !== 'manual') {
        CurrentTriggerIdStore.set(previousTriggerId)
    }

    return {additonalSysPrompt, tokens:caculatedTokens, stopSending, sendAIprompt, displayData: arg.displayData, tempVars: arg.tempVars}

}
