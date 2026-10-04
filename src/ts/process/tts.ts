import { alertError } from "../alert";
import { getCurrentCharacter, getDatabase, type character } from "../storage/database.svelte";
import { runTranslator, translateVox } from "../translator/translator";
import { globalFetch, loadAsset } from "../globalApi.svelte";
import { language } from "src/lang";
import { fillLang } from "src/lang/fill";
import { runVITS } from "./transformers";
import { cancelTTSPlayback, currentTTSSignal, playEncodedAudio } from "./ttsPlayback";
import {
    getTTSPreprocessors,
    getTTSPostprocessors,
    runHookPipeline,
    type BeforeTTSContext,
    type BeforeTTSResult,
    type AfterTTSContext,
    type AfterTTSResult,
} from "./ttsHooks";
import { createFishSpeechDefaults, createNovelAIVoiceDefaults, createVoicevoxDefaults } from "./ttsDefaults";
import { SecretRefError, isSecretRef, resolveSecret, secretRefName } from "../secretRef";

/**
 * True only for an `https:` URL whose hostname is exactly `api.openai.com` (any port, path or
 * userinfo): the one host a referenced `db.openAIKey` may be sent to from the per-character OpenAI
 * TTS settings. An unparsable URL is not the default.
 */
function isDefaultOpenAIHost(baseURL: string): boolean {
    try {
        const parsed = new URL(baseURL)
        return parsed.protocol === 'https:' && parsed.hostname === 'api.openai.com'
    } catch {
        return false
    }
}

const HF_MAX_REQUESTS = 5
const HF_WAIT_BUDGET_MS = 30_000

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve) => {
        if (signal.aborted) {
            resolve()
            return
        }
        const onAbort = () => {
            clearTimeout(timer)
            resolve()
        }
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort)
            resolve()
        }, ms)
        signal.addEventListener('abort', onAbort, { once: true })
    })
}

/**
 * The text a provider is given: asterisks removed and, when the character
 * reads only quoted speech, just the quoted spans joined together. Not
 * idempotent: quote extraction of quote-free text yields an empty string.
 */
export function filterTTSText(text: string, readOnlyQuoted: boolean): string {
    text = text.replace(/\*/g,'')

    if(readOnlyQuoted){
        const matches = text.match(/["「](.*?)["」]/g)
        if(matches && matches.length > 0){
            text = matches.map(match => match.slice(1, -1)).join("");
        }
        else{
            text = ''
        }
    }
    return text
}

/**
 * Run every registered TTS postprocessor hook against the audio bytes, honoring
 * replacement audio / mimeType / skip semantics. Before each hook invocation a
 * fresh slice of the current base audio is handed to the hook as its disposable
 * copy — the plugin sandbox postMessage layer transfers that buffer into the
 * iframe and neuters it on the host side, so reusing a single slice across
 * multiple hooks would leave all hooks after the first with a detached buffer.
 *
 * Returns the final audio bytes (possibly replaced by a hook), the final
 * mimeType, and whether a hook requested a skip.
 */
async function runPostprocessorPipeline(
    audio: ArrayBuffer,
    mimeType: string,
    ctx: { ttsMode: string; characterId: string },
    signal: AbortSignal,
): Promise<{ audio: ArrayBuffer; mimeType: string; skip: boolean }> {
    const hooks = getTTSPostprocessors();
    if (hooks.length === 0) return { audio, mimeType, skip: false };

    let currentAudio = audio;
    let currentMime = mimeType;

    for (const hook of hooks) {
        if (signal.aborted) return { audio: currentAudio, mimeType: currentMime, skip: true };
        const disposable = currentAudio.slice(0); // fresh clone per hook
        let result: AfterTTSResult | void;
        try {
            result = await Promise.resolve().then(() =>
                hook({
                    audio: disposable,
                    mimeType: currentMime,
                    ttsMode: ctx.ttsMode,
                    characterId: ctx.characterId,
                })
            );
        } catch (err) {
            console.error('[TTS postprocessor] threw, continuing with next hook:', err);
            continue;
        }

        if (!result) continue;
        if (result.skip) return { audio: currentAudio, mimeType: currentMime, skip: true };
        if (result.audio && result.audio.byteLength > 0) currentAudio = result.audio;
        if (typeof result.mimeType === 'string' && result.mimeType) currentMime = result.mimeType;
    }

    if (signal.aborted) return { audio: currentAudio, mimeType: currentMime, skip: true };
    return { audio: currentAudio, mimeType: currentMime, skip: false };
}

async function playAudio(
    audio: ArrayBuffer,
    mimeType: string,
    ctx: { ttsMode: string; characterId: string },
    signal: AbortSignal,
    gain?: number,
): Promise<void> {
    const processed = await runPostprocessorPipeline(audio, mimeType, ctx, signal);
    if (processed.skip || signal.aborted) return;

    await playEncodedAudio(processed.audio, signal, gain);
}

export async function sayTTS(character:character,text:string, options?: { skipTextFilter?: boolean }) {
    const signal = currentTTSSignal()
    try {
        if(!character){
            const v = getCurrentCharacter()
            if(v.type === 'group'){
                return
            }
            character = v
        }

        if(!text){
            return
        }
    
        let db = getDatabase()
        if(!options?.skipTextFilter){
            text = filterTTSText(text, !!character.ttsReadOnlyQuoted)
        }

        const beforeResult = await runHookPipeline<BeforeTTSContext, BeforeTTSResult>(
            getTTSPreprocessors(),
            { text, ttsMode: character.ttsMode ?? '', characterId: character.chaId },
        );
        if (signal.aborted || beforeResult.skip) {
            return;
        }
        text = beforeResult.ctx.text;
        // A provider is never asked to speak nothing: the filter and the hooks
        // may leave empty, blank or non-string text.
        if(typeof text !== 'string' || !text.trim()){
            return
        }
        const hookCtx = { ttsMode: character.ttsMode ?? '', characterId: character.chaId }

        switch(character.ttsMode){
            case "webspeech":{
                if(typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'){
                    const utterThis = new SpeechSynthesisUtterance(text);
                    const voices = speechSynthesis.getVoices();
                    let voiceIndex = 0
                    for(let i=0;i<voices.length;i++){
                        if(voices[i].name === character.ttsSpeech){
                            voiceIndex = i
                        }
                    }
                    utterThis.voice = voices[voiceIndex]
                    const speak = speechSynthesis.speak(utterThis)
                }
                break
            }
            case "elevenlab": {
                const elevenKey = await resolveSecret(db.elevenLabKey)
                const da = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${character.ttsSpeech}`, {
                    body: JSON.stringify({
                        text: text,
                        model_id: "eleven_multilingual_v2"
                    }),
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        'xi-api-key': elevenKey || undefined
                    },
                    signal,
                })
                if(signal.aborted){
                    return
                }
                if(da.status >= 200 && da.status < 300){
                    const buffer = await da.arrayBuffer()
                    if(signal.aborted){
                        return
                    }
                    const mimeType = da.headers.get('content-type') || 'audio/mpeg'
                    await playAudio(buffer, mimeType, hookCtx, signal)
                }
                else{
                    const errorText = await da.text()
                    if(signal.aborted){
                        return
                    }
                    alertError(errorText)
                }
                break
            }
            case "VOICEVOX": {
                const voicevoxConfig = character.voicevoxConfig ?? createVoicevoxDefaults()
                const jpText = await translateVox(text)
                if(signal.aborted){
                    return
                }
                const query = await fetch(`${db.voicevoxUrl}/audio_query?text=${jpText}&speaker=${character.ttsSpeech}`, {
                    method: 'POST',
                    headers: { "Content-Type": "application/json"},
                    signal,
                })
                if(signal.aborted){
                    return
                }
                if (query.status == 200){
                    const queryJson = await query.json();
                    if(signal.aborted){
                        return
                    }
                    const bodyData = {
                        accent_phrases: queryJson.accent_phrases,
                        speedScale: voicevoxConfig.SPEED_SCALE,
                        pitchScale: voicevoxConfig.PITCH_SCALE,
                        volumeScale: voicevoxConfig.VOLUME_SCALE,
                        intonationScale: voicevoxConfig.INTONATION_SCALE,
                        prePhonemeLength: queryJson.prePhonemeLength,
                        postPhonemeLength: queryJson.postPhonemeLength,
                        outputSamplingRate: queryJson.outputSamplingRate,
                        outputStereo: queryJson.outputStereo,
                        kana: queryJson.kana,
                    }
                    const getVoice = await fetch(`${db.voicevoxUrl}/synthesis?speaker=${character.ttsSpeech}`, {
                        method: 'POST',
                        headers: { "Content-Type": "application/json"},
                        body: JSON.stringify(bodyData),
                        signal,
                    })
                    if(signal.aborted){
                        return
                    }
                    if (getVoice.status == 200 && getVoice.headers.get('content-type') === 'audio/wav'){
                        const wav = await getVoice.arrayBuffer()
                        if(signal.aborted){
                            return
                        }
                        await playAudio(wav, 'audio/wav', hookCtx, signal)
                    }
                }
                break
            }
            case 'openai':{
                const cfg = character.oaiTTSConfig?.enabled ? character.oaiTTSConfig : null
                const baseURL = (cfg?.baseURL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '')
                let apiKey  = (cfg?.apiKey || db.openAIKey || '').trim()
                // Only the app-wide key may be a reference, and only for the default OpenAI host: a
                // card chooses the base URL, so it must not be able to aim a referenced key elsewhere.
                // The card's own key never resolves; globalFetch refuses a request that carries it.
                if(!cfg?.apiKey && isSecretRef(apiKey)){
                    if(!isDefaultOpenAIHost(baseURL)){
                        throw new SecretRefError(secretRefName(apiKey), 'foreign')
                    }
                    apiKey = await resolveSecret(apiKey)
                }
                const model  = cfg?.model || 'tts-1'
                const voice   = cfg?.voice || character.oaiVoice || 'alloy'
                const format  = cfg?.format || 'mp3'

                const res = await globalFetch(`${baseURL}/audio/speech`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...(apiKey ? { 'Authorization': 'Bearer ' + apiKey } : {}),
                    },
                    body: {
                        model,
                        input: text,
                        voice,
                        response_format: format,
                    },
                    rawResponse: true,
                    abortSignal: signal,
                })
                if(signal.aborted){
                    return
                }
                const dat = res.data

                if(res.ok){
                    try {
                        const audio = Buffer.from(dat).buffer
                        await playAudio(audio, 'audio/mpeg', hookCtx, signal)
                    } catch (error) {
                        if(signal.aborted){
                            return
                        }
                        alertError(language.errors.httpError + `${error}`)
                    }
                }
                else{
                    if(dat.error && dat.error.message){
                        alertError((language.errors.httpError + `${dat.error.message}`))
                    }
                    else{
                        alertError((language.errors.httpError + `${Buffer.from(res.data).toString()}`))
                    }
                }
                break;

            }
            case 'novelai': {
                if(text === ''){
                    break;
                }
                const naittsConfig = character.naittsConfig ?? createNovelAIVoiceDefaults()
                const encodedText = encodeURIComponent(text);
                const encodedSeed = encodeURIComponent(naittsConfig.voice);

                const url = `https://api.novelai.net/ai/generate-voice?text=${encodedText}&voice=-1&seed=${encodedSeed}&opus=false&version=${naittsConfig.version}`;

                const response = await globalFetch(url, {
                    method: 'GET',
                    headers: {
                        "Authorization": "Bearer " + await resolveSecret(db.NAIApiKey),
                    },
                    rawResponse: true,
                    abortSignal: signal,
                });
                if(signal.aborted){
                    return
                }

                if (response.ok) {
                    await playAudio(response.data.buffer, 'audio/wav', hookCtx, signal)
                } else {
                    alertError(language.errors.audioFetchFailed);
                }
                break;
            }
            case 'huggingface': {
                if(!text.trim()){
                    return
                }
                if(!character.hfTTS?.model?.trim()){
                    throw new Error(language.errors.ttsNotSetUp)
                }
                const targetLanguage = (character.hfTTS.language ?? '').trim().toLowerCase()
                if(targetLanguage && targetLanguage !== 'en'){
                    text = await runTranslator(text, true, 'en', targetLanguage)
                    if(signal.aborted){
                        return
                    }
                }
                const url = `https://router.huggingface.co/hf-inference/models/${character.hfTTS.model}`
                const hfKey = await resolveSecret(db.huggingfaceKey)
                if(signal.aborted){
                    return
                }
                let waitedMs = 0
                for(let requests = 1; ; requests++){
                    const response = await fetch(url, {
                        method: 'POST',
                        headers: {
                            "Authorization": "Bearer " + hfKey,
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            inputs: text,
                        }),
                        signal,
                    });
                    if(signal.aborted){
                        return
                    }

                    if(response.status === 503 && (response.headers.get('content-type') ?? '').includes('application/json')){
                        const body = await response.text()
                        if(signal.aborted){
                            return
                        }
                        let estimatedTime: unknown
                        try {
                            estimatedTime = JSON.parse(body)?.estimated_time
                        } catch {
                            estimatedTime = undefined
                        }
                        if(typeof estimatedTime === 'number' && Number.isFinite(estimatedTime) && estimatedTime > 0){
                            const waitMs = estimatedTime * 1000
                            if(requests < HF_MAX_REQUESTS && waitMs <= HF_WAIT_BUDGET_MS - waitedMs){
                                waitedMs += waitMs
                                await abortableSleep(waitMs, signal)
                                if(signal.aborted){
                                    return
                                }
                                continue
                            }
                        }
                        alertError(language.errors.httpError + body)
                        return
                    }
                    if(response.status >= 400){
                        const errorText = await response.text()
                        if(signal.aborted){
                            return
                        }
                        alertError(language.errors.httpError + errorText)
                    }
                    else if (response.status === 200) {
                        const buffer = await response.arrayBuffer();
                        if(signal.aborted){
                            return
                        }
                        const mimeType = response.headers.get('content-type') || 'audio/wav'
                        await playAudio(buffer, mimeType, hookCtx, signal)
                    } else {
                        alertError(language.errors.audioFetchFailed);
                    }
                    return
                }
            }
            case 'vits':{
                await runVITS(text, character.vits, signal)
                break;
            }
            case 'gptsovits':{
                if(!character.gptSoVitsConfig?.url?.trim() || !character.gptSoVitsConfig.ref_audio_data?.assetId){
                    throw new Error(language.errors.ttsNotSetUp)
                }
                const audio: Uint8Array = await loadAsset(character.gptSoVitsConfig.ref_audio_data.assetId);
                if(signal.aborted){
                    return
                }
                const base64Audio = btoa(new Uint8Array(audio).reduce((data, byte) => data + String.fromCharCode(byte), ''));

                const body = {
                    text: text,
                    text_lang: character.gptSoVitsConfig.text_lang,
                    ref_audio_path: undefined,
                    ref_audio_name: character.gptSoVitsConfig.ref_audio_data.fileName,
                    ref_audio_data: base64Audio,
                    prompt_text: undefined,
                    prompt_lang: character.gptSoVitsConfig.prompt_lang,
                    top_p: character.gptSoVitsConfig.top_p,
                    temperature: character.gptSoVitsConfig.temperature,
                    speed_factor: character.gptSoVitsConfig.speed,
                    top_k: character.gptSoVitsConfig.top_k,
                    text_split_method: character.gptSoVitsConfig.text_split_method,
                    parallel_infer: true,
                    // media_type: character.gptSoVitsConfig.ref_audio_data.fileName.split('.')[1],
                    ref_free: character.gptSoVitsConfig.use_long_audio || !character.gptSoVitsConfig.use_prompt,
                }

                if (character.gptSoVitsConfig.use_prompt){
                    body.prompt_text = character.gptSoVitsConfig.prompt
                }

                if (character.gptSoVitsConfig.use_auto_path){
                    console.log('auto')
                    const path = await globalFetch(`${character.gptSoVitsConfig.url}/get_path`, {
                        method: 'GET',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        rawResponse: false,
                        plainFetchDeforce: true,
                        abortSignal: signal,
                    })
                    if(signal.aborted){
                        return
                    }
                    console.log(path)
                    if(path.ok){
                        body.ref_audio_path = path.data.message + '/public/audio/' + character.gptSoVitsConfig.ref_audio_data.fileName
                    }
                    else{
                        throw new Error(language.errors.ttsAutoPathFailed)
                    }
                } else {
                    body.ref_audio_path = character.gptSoVitsConfig.ref_audio_path + '/public/audio/' + character.gptSoVitsConfig.ref_audio_data.fileName
                }
                console.log(body)

                const response = await globalFetch(`${character.gptSoVitsConfig.url}/tts`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: body,
                    rawResponse: true,
                    abortSignal: signal,
                })
                if(signal.aborted){
                    return
                }
                console.log(response)

                if (response.ok) {
                    const volume = character.gptSoVitsConfig.volume
                    await playAudio(
                        response.data.buffer,
                        'audio/wav',
                        hookCtx,
                        signal,
                        volume !== undefined && volume !== 1.0 ? volume : undefined,
                    )
                } else {
                    const textBuffer: Uint8Array = response.data.buffer
                    const text = Buffer.from(textBuffer).toString('utf-8')
                    throw new Error(text);
                }
                break;
            }
            case 'fishspeech':{
                const fishSpeechConfig = character.fishSpeechConfig ?? createFishSpeechDefaults()
                if (!fishSpeechConfig.model?._id){
                    throw new Error(language.errors.fishSpeechModelNotSelected)
                }

                const body = {
                    text: text,
                    reference_id: fishSpeechConfig.model._id,
                    chunk_length: fishSpeechConfig.chunk_length,
                    normalize: fishSpeechConfig.normalize,
                    format: 'mp3',
                    mp3_bitrate: 192,
                }


                console.log(body)

                const response = await globalFetch(`https://api.fish.audio/v1/tts`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${await resolveSecret(db.fishSpeechKey)}`
                    },
                    body: body,
                    rawResponse: true,
                    abortSignal: signal,
                })
                if(signal.aborted){
                    return
                }
                console.log(response)

                if (response.ok) {
                    await playAudio(response.data.buffer, 'audio/mpeg', hookCtx, signal)
                } else {
                    const textBuffer: Uint8Array = response.data.buffer
                    const text = Buffer.from(textBuffer).toString('utf-8')
                    throw new Error(text);
                }
                break;
            }
        }
    } catch (error) {
        if(signal.aborted){
            return
        }
        alertError(fillLang(language.errors.ttsError, { error: `${error}` }))
    }
}



export const oaiVoices = [
    'alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'
]

export function stopTTS(){
    cancelTTSPlayback()
    if(typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'){
        speechSynthesis.cancel()
    }
}


export function getWebSpeechTTSVoices() {
    return speechSynthesis.getVoices().map(v => {
        return v.name
    })
}

export async function getElevenTTSVoices() {
    let db = getDatabase()

    const elevenKey = await resolveSecret(db.elevenLabKey)
    const data = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: {
            'xi-api-key': elevenKey || undefined
        }
    })
    const res = await data.json()

    console.log(res)
    return res.voices
}

/**
 * The Fish Audio voice models of the account behind `fishSpeechKey`. A `${NAME}` reference is
 * resolved here, so the literal is never sent; a failed resolution throws `SecretRefError` before
 * any request is made. Anything that is not an array of items yields an empty list.
 */
export async function fetchFishSpeechModels(fishSpeechKey: string): Promise<{ _id: string, title: string, description: string }[]> {
    const res = await fetch(`https://api.fish.audio/model?self=true`, {
        headers: {
            'Authorization': `Bearer ${await resolveSecret(fishSpeechKey)}`
        }
    });
    const data = await res.json();
    if (Array.isArray(data.items)) {
        return data.items.map((item: { _id?: string, title?: string, description?: string }) => ({
            _id: item._id || '',
            title: item.title || '',
            description: item.description || ''
        }));
    }
    console.error('Expected an array of items, but received:', data.items);
    return [];
}

export async function getVOICEVOXVoices() {
    const db = getDatabase();
    const speakerData = await fetch(`${db.voicevoxUrl}/speakers`)
    const speakerList = await speakerData.json()
    const speakersInfo = speakerList.map((speaker) => {
      const styles = speaker.styles.map((style) => {
        return {name: style.name, id: `${style.id}`}
      })
      return {name: speaker.name, list: JSON.stringify(styles)}
    })
    speakersInfo.unshift({ name: "None", list: null})
    return speakersInfo;
}

export function getNovelAIVoices(){
    return [
        {
            gender: "UNISEX",
            voices: ['Anananan']
        },
        {
            gender: "FEMALE",
            voices: ['Aini', 'Orea', 'Claea', 'Lim', 'Aurae', 'Naia']
        },
        {
            gender: "MALE",
            voices: ['Aulon', 'Elei', 'Ogma', 'Raid', 'Pega', 'Lam']
        }
    ];
}
