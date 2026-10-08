import { get } from 'svelte/store';
import { doingChat, sendChat } from '../index.svelte';
import { isComposerWindowOpen } from '../generationOwnership.svelte';
import { createSendSubject, registerWork, type OriginHint, type RunSubject } from '../chatOrigin';
import type { ComposerDraftKey } from '../composerDrafts.svelte';
import { downloadFile } from 'src/ts/globalApi.svelte';
import { isTauri } from "src/ts/platform"
import { HypaProcesser } from '../memory/hypamemory';
import { BufferToText as BufferToText, selectMultipleFile } from 'src/ts/util';
import { isInlayRefusal, postInlayAsset } from './inlays';
import { alertError } from '../../alert';
import { language } from 'src/lang';

type sendFileArg = {
    file:string
    query:string
}

/**
 * Sends each entry of a `.po` file into the chat `subject` addresses, and
 * hands over the file it builds. The chat is found again by id at every entry,
 * never through the selection and never through an object held across an
 * `await`; a chat that is gone stops the job.
 *
 * The job is registered against its chat for its whole duration, including the
 * waits between entries, and ends that registration in a `finally`. The
 * registration's stop aborts the job's signal: no further entry is posted and no
 * further request starts, and a send running for the job is aborted with it.
 */
async function sendPofile(arg:sendFileArg, subject:RunSubject, hint:OriginHint|undefined){
    const controller = new AbortController()
    const workHandle = registerWork(subject.origin, () => controller.abort())
    try {
        await sendPofileEntries(arg, subject, hint, controller.signal)
    }
    finally {
        workHandle.end()
    }
}

/**
 * The job's entries. A stopped job takes the same exits as a job whose chat is
 * gone or whose send returned false: it posts nothing more, and hands over the
 * file it has built so far if it had already sent an entry.
 */
async function sendPofileEntries(arg:sendFileArg, subject:RunSubject, hint:OriginHint|undefined, signal:AbortSignal){

    let result = ''
    let msgId = ''
    let note = ''
    let speaker = ''
    let parseMode = 0
    let sentEntries = 0
    if(!subject.resolve()){
        return
    }
    const lines = arg.file.split('\n')
    for(let i=0;i<lines.length;i++){
        console.log(i)
        const line = lines[i]
        if(line === ''){
            if(msgId === ''){
                result += '\n'
                continue
            }
            if(signal.aborted || get(doingChat) || isComposerWindowOpen()){
                // The job was stopped, or another send is in flight: post
                // nothing more. A job that has already sent an entry still
                // ends by handing over what it has built.
                if(sentEntries === 0){
                    return
                }
                break
            }
            const target = subject.resolve()
            if(!target){
                // The chat is gone: post nothing more. A job that has already
                // sent an entry still ends by handing over what it has built.
                if(sentEntries === 0){
                    return
                }
                break
            }
            let text = msgId
            if(speaker !== ''){
                text = `Speaker: ${speaker}\n${text}`
            }
            if(note !== ''){
                text = `Note: ${note}\n${text}`
            }
            target.chat.message.push({
                role: 'user',
                data: text
            })
            subject.mark()
            sentEntries++
            if(!(await sendChat(-1, { origin: subject.origin, originHint: hint, signal }))){
                break
            }
            const res = subject.resolve()?.chat.message.at(-1)
            const msgStr = (res?.data ?? '').split('\n').filter((a) => {
                return a !== ''
            }).map((str) => {
                return `"${str.replaceAll('"', '\\"')}"`
            }).join('\n')
            result += `msgstr ""\n${msgStr}\n\n`
            note = ''
            speaker = ''
            msgId = ''
            if(isTauri){
                await downloadFile('translated.po', result)
            }
            continue
        }
        if(line.startsWith('#. Note =')){
            note = line.replace('#. Note =', '').trim()
            continue
        }
        if(line.startsWith('#. Speaker =')){
            speaker = line.replace('#. Speaker =', '').trim()
            continue
        }
        if(line.startsWith('msgid')){
            parseMode = 0
            msgId = line.replace('msgid ', '').trim().replaceAll('\\"', '♠#').replaceAll('"', '').replaceAll('♠#', '\\"')
            if(msgId === ''){
                parseMode = 1
            }
            result += line + '\n'
            continue
        }
        if(parseMode === 1 && line.startsWith('"') && line.endsWith('"')){
            msgId += line.substring(1, line.length-1).replaceAll('\\"', '"')
            result += line + '\n'
            continue
        }
        if(line.startsWith('msgstr')){
            if(msgId === ''){
                result += line + '\n'
                parseMode = 0
            }
            else{
                parseMode = 2
            }
            continue
        }
        if(parseMode === 2 && line.startsWith('"') && line.endsWith('"')){
            continue
        }
        result += line + '\n'

    }
    await downloadFile('translated.po', result)
}

async function sendPDFFile(arg:sendFileArg) {
    const pdfjsLib = (await import('pdfjs-dist'));
    const pdfjsWorker = await import('pdfjs-dist/build/pdf.worker?worker&url');
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker.default;
    const pdf = await pdfjsLib.getDocument({data: arg.file}).promise;
    const texts:string[] = []
    for(let i = 1; i<=pdf.numPages; i++){
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const items = content.items as {str:string}[];
        for(const item of items){
            texts.push(item.str)
        }
    }
    console.log(texts)
    const hypa = new HypaProcesser()
    hypa.addText(texts)
    const result = await hypa.similaritySearch(arg.query)
    let message = ''
    for(let i = 0; i<result.length; i++){
        message += "\n" + result[i]
        if(i>5){
            break
        }
    }
    console.log(message)
    return Buffer.from(`<File>\n${message}\n</File>\n`).toString('base64')
}

async function sendTxtFile(arg:sendFileArg) {
    const lines = arg.file.split('\n').filter((a) => {
        return a !== ''
    })
    const hypa = new HypaProcesser()
    hypa.addText(lines)
    const result = await hypa.similaritySearch(arg.query)
    let message = ''
    for(let i = 0; i<result.length; i++){
        message += "\n" + result[i]
        if(i>5){
            break
        }
    }
    console.log(message)
    return Buffer.from(`<File>\n${message}\n</File>\n`).toString('base64')
}

async function sendXMLFile(arg:sendFileArg) {
    const hypa = new HypaProcesser()
    let nodeTexts:string[] = []
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(arg.file, "text/xml");
    const nodes = xmlDoc.getElementsByTagName('*')
    for(const node of nodes){
        nodeTexts.push(node.textContent)
    }
    hypa.addText(nodeTexts)
    const result = await hypa.similaritySearch(arg.query)
    let message = ''
    for(let i = 0; i<result.length; i++){
        message += "\n" + result[i]
        if(i>5){
            break
        }
    }
    console.log(message)
    return Buffer.from(`<File>\n${message}\n</File>\n`).toString('base64')    
}

type postFileResult = postFileResultAsset | postFileResultVoid | postFileResultText

type postFileResultAsset = {
    data: string,
    type: 'asset',
}

type postFileResultVoid = {
    type: 'void',
}

type postFileResultText = {
    data: string,
    type: 'text',
    name: string
}
/**
 * `key` is the composer record of the chat the caller was clicked in, and
 * `hint` the objects the caller read that chat through: a `.po` job sends into
 * that chat, whichever chat is on screen by the time each entry runs, and does
 * nothing without a key. The other file types do not touch a chat.
 */
export async function postChatFile(query:string|{
    name:string,
    data:Uint8Array
}, key?:ComposerDraftKey|null, hint?:OriginHint|null):Promise<postFileResult[]>{
    const files = typeof(query) === 'string' ? (await selectMultipleFile([
        //image format
        'jpg',
        'jpeg',
        'png',
        'webp',
        'gif',
        'avif',

        //audio format
        'wav',
        'mp3',
        'ogg',
        'flac',

        //video format
        'mp4',
        'webm',
        'mpeg',
        'avi',

        //other format
        'po',
        // 'pdf',
        'txt'
    ])) : [query]

    if(!files){
        return null
    }

    const xquery = typeof(query) === 'string' ? query : ''
    const results: postFileResult[] = []

    for(const file of files){
        const extention = file.name.split('.').at(-1)
        console.log(extention)

        switch(extention){
            case 'po':{
                if(key){
                    await sendPofile({
                        file: BufferToText(file.data),
                        query: xquery
                    }, createSendSubject({ chaId: key.chaId, chatId: key.chatId }, hint ?? undefined), hint ?? undefined)
                }
                results.push({
                    type: 'void'
                })
                break
            }
            case 'pdf':{
                results.push({
                    type: 'text',
                    data: await sendPDFFile({
                        file: BufferToText(file.data),
                        query: xquery
                    }),
                    name: file.name
                })
                break
            }
            case 'xml':{
                results.push({
                    type: 'text',
                    data: await sendXMLFile({
                        file: BufferToText(file.data),
                        query: xquery
                    }),
                    name: file.name
                })
                break
            }

            //image format
            case 'jpg':
            case 'jpeg':
            case 'png':
            case 'webp':
            case 'gif':
            case 'avif':

            //audio format
            case 'wav':
            case 'mp3':
            case 'ogg':
            case 'flac':

            //video format
            case 'mp4':
            case 'webm':
            case 'mpeg':
            case 'avi':{
                const postData = await postInlayAsset(file)
                if(isInlayRefusal(postData)){
                    alertError(language.inlayFileTooLarge
                        .replace('{name}', postData.name)
                        .replace('{size}', Math.floor(postData.limit / (1024 * 1024)).toString()))
                    continue
                }
                if(!postData){
                    continue
                }
                results.push({
                    data: postData,
                    type: 'asset'
                })
                break
            }
            case 'txt':{
                results.push({
                    type: 'text',
                    data: await sendTxtFile({
                        file: BufferToText(file.data),
                        query: xquery
                    }),
                    name: file.name
                })
                break
            }
        }
    }

    return results
}