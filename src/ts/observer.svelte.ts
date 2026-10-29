import { globalFetch } from "./globalApi.svelte";
import { isWellFormedBgm, parseBgmControl, type BgmControl } from "./bgmControl";
import { connectedMessageRoots, messageRootOf, onMessageRootsChanged } from "./messageRootRegistry";

// The extensions the markdown parser can emit in `x-hl-lang`. Authored markup may
// carry any other value, which must not become a download file extension.
const CODE_EXTENSIONS = new Set(['sh', 'c', 'cpp', 'cs', 'css', 'dart', 'html', 'svg', 'xml', 'java', 'js', 'json', 'lua', 'md', 'py', 'rs', 'ts', 'txt', 'vtt', 'yml']);
const FALLBACK_CODE_EXTENSION = 'txt';

// A held track survives a re-render of its message for at most this long.
const BGM_HOLD_MS = 2000;

function onCodeContextMenu(e:MouseEvent){
    const target = e.target;
    if(!(target instanceof Element)){
        return;
    }
    const node = target.closest('[x-hl-lang]');
    const hlLang = node?.getAttribute('x-hl-lang');
    if(!node || !hlLang){
        return;
    }

    e.preventDefault()

    const prevContextMenu = document.getElementById('code-contextmenu')
    if(prevContextMenu){
        prevContextMenu.remove()
    }

    const menu = document.createElement('div')
    menu.id = 'code-contextmenu'
    menu.setAttribute('class', 'fixed z-50 min-w-[160px] py-2 bg-gray-800 rounded-lg border border-gray-700')

    const copyOption = document.createElement('div')
    copyOption.textContent = 'Copy'
    copyOption.setAttribute('class', 'px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 cursor-pointer')
    copyOption.addEventListener('click', ()=>{
        navigator.clipboard.writeText(node.textContent)
        menu.remove()
    })

    const downloadOption = document.createElement('div');
    downloadOption.textContent = 'Download';
    downloadOption.setAttribute('class', 'px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 cursor-pointer')
    downloadOption.addEventListener('click', ()=>{
        const a = document.createElement('a')
        a.href = URL.createObjectURL(new Blob([node.textContent], {type: 'text/plain'}))
        a.download = 'code.' + (CODE_EXTENSIONS.has(hlLang) ? hlLang : FALLBACK_CODE_EXTENSION)
        a.click()
        menu.remove()
    })

    menu.appendChild(copyOption)
    menu.appendChild(downloadOption)

    menu.style.left = e.clientX + 'px'
    menu.style.top = e.clientY + 'px'

    document.body.appendChild(menu)

    document.addEventListener('click', ()=>{
        menu?.remove()
    }, {once: true})
}

interface BgmPlayer {
    src:string|null
    audio:HTMLAudioElement|null
    // chatId of the message that owns the playing track; '' means no hold is possible.
    chatId:string
}

interface BgmCandidate {
    el:Element
    bgm:BgmControl
    // null for a control outside any message (background, plugin panel).
    rank:number|null
    chatId:string
}

const trackedControls = new Set<Element>();
const player:BgmPlayer = { src: null, audio: null, chatId: '' };
let activeDisposer:(()=>void)|null = null;
let reconcileTimer:ReturnType<typeof setTimeout>|null = null;
let holdTimer:ReturnType<typeof setTimeout>|null = null;
let holdExpired = false;

function rankOf(candidate:BgmCandidate){
    return candidate.rank ?? -Infinity;
}

function precedes(a:Element, b:Element){
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function clearHold(){
    if(holdTimer !== null){
        clearTimeout(holdTimer);
        holdTimer = null;
    }
    holdExpired = false;
}

function stopBgm(){
    player.audio?.pause();
    player.audio = null;
    player.src = null;
    player.chatId = '';
    clearHold();
}

// The only place a parsed BGM source becomes a fetch.
function startBgm(candidate:BgmCandidate){
    const { src, volume } = candidate.bgm;
    const audio = new Audio(src);
    audio.loop = true;
    audio.volume = volume;
    player.audio = audio;
    player.src = src;
    player.chatId = candidate.chatId;
    // A denied play() is silent and never retried; the rejection is always consumed.
    audio.play().catch(()=>{});
}

function governingControl():BgmCandidate|null{
    let best:BgmCandidate|null = null;
    for(const el of trackedControls){
        const bgm = parseBgmControl(el.getAttribute('risu-ctrl') ?? '');
        if(!bgm){
            continue;
        }
        const owner = messageRootOf(el);
        const candidate:BgmCandidate = {
            el,
            bgm,
            rank: owner ? owner.info.index : null,
            chatId: owner ? owner.info.chatId : '',
        };
        if(!best){
            best = candidate;
            continue;
        }
        const diff = rankOf(candidate) - rankOf(best);
        // -Infinity - -Infinity is NaN, which falls through to document order.
        if(diff > 0 || (!(diff < 0) && precedes(candidate.el, best.el))){
            best = candidate;
        }
    }
    return best;
}

function holdApplies(next:BgmCandidate|null){
    if(holdExpired || player.src === null || player.chatId === ''){
        return false;
    }
    let minIndex = Infinity;
    for(const { info } of connectedMessageRoots()){
        if(info.chatId === player.chatId && info.index < minIndex){
            minIndex = info.index;
        }
    }
    if(minIndex === Infinity){
        return false;
    }
    return next === null || rankOf(next) < minIndex;
}

function reconcileBgm(){
    for(const el of trackedControls){
        if(!el.isConnected){
            trackedControls.delete(el);
        }
    }
    const next = governingControl();
    const playable = next !== null && isWellFormedBgm(next.bgm);

    if(next && playable && next.bgm.src === player.src){
        // Same track keeps playing; only a volume change applies.
        if(player.audio && player.audio.volume !== next.bgm.volume){
            player.audio.volume = next.bgm.volume;
        }
        player.chatId = next.chatId;
        clearHold();
        return;
    }

    if(holdApplies(next)){
        if(holdTimer === null){
            holdTimer = setTimeout(()=>{
                holdTimer = null;
                holdExpired = true;
                scheduleReconcile();
            }, BGM_HOLD_MS);
        }
        return;
    }

    stopBgm();
    if(next && playable){
        startBgm(next);
    }
}

function runReconcile(){
    reconcileTimer = null;
    try{
        reconcileBgm();
    }
    catch(error){
        console.error('BGM reconcile failed', error);
        stopBgm();
    }
}

// Deferred to a task so that every microtask queued by the triggering change,
// including Svelte action effects and MutationObserver delivery, has settled.
function scheduleReconcile(){
    if(reconcileTimer === null){
        reconcileTimer = setTimeout(runReconcile, 0);
    }
}

function trackControls(node:Element){
    if(node.matches('[risu-ctrl]')){
        trackedControls.add(node);
    }
    if(node.firstElementChild){
        node.querySelectorAll('[risu-ctrl]').forEach((el)=>{
            trackedControls.add(el);
        });
    }
}

function onDomMutations(mutations:MutationRecord[]){
    let changed = false;
    for(const mutation of mutations){
        if(mutation.type === 'attributes'){
            const target = mutation.target;
            if(target instanceof Element){
                if(target.hasAttribute('risu-ctrl')){
                    trackedControls.add(target);
                }
                else{
                    trackedControls.delete(target);
                }
                changed = true;
            }
            continue;
        }
        mutation.addedNodes.forEach((node)=>{
            if(node instanceof Element){
                trackControls(node);
            }
        });
        if(mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0){
            changed = true;
        }
    }
    if(changed){
        scheduleReconcile();
    }
}

/**
 * Starts code-block context menus and background music. Idle cost is zero: no
 * timer runs and no document query happens after the initial scan. Calling it
 * again returns the same disposer.
 */
export function startObserveDom():()=>void{
    if(activeDisposer){
        return activeDisposer;
    }

    document.addEventListener('contextmenu', onCodeContextMenu);
    document.querySelectorAll('[risu-ctrl]').forEach((el)=>{
        trackedControls.add(el);
    });
    const observer = new MutationObserver(onDomMutations);
    observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['risu-ctrl'],
    });
    const unsubscribeRoots = onMessageRootsChanged(scheduleReconcile);
    scheduleReconcile();

    activeDisposer = ()=>{
        document.removeEventListener('contextmenu', onCodeContextMenu);
        observer.disconnect();
        unsubscribeRoots();
        if(reconcileTimer !== null){
            clearTimeout(reconcileTimer);
            reconcileTimer = null;
        }
        stopBgm();
        trackedControls.clear();
        activeDisposer = null;
    };
    return activeDisposer;
}


let claudeObserverRunning = false;
let lastClaudeObserverLoad = 0;
let lastClaudeRequestTimes = 0;
let lastClaudeObserverPayload:any = null;
let lastClaudeObserverHeaders:any = null;
let lastClaudeObserverURL:any = null;

export function registerClaudeObserver(arg:{
    url:string,
    body:any,
    headers:any,
}) {
    lastClaudeRequestTimes = 0;
    lastClaudeObserverLoad = Date.now();
    lastClaudeObserverPayload = safeStructuredClone(arg.body)
    lastClaudeObserverHeaders = arg.headers;
    lastClaudeObserverURL = arg.url;
    lastClaudeObserverPayload.max_tokens = 10;
    claudeObserver()
}

function claudeObserver(){
    if(claudeObserverRunning){
        return
    }
    claudeObserverRunning = true;

    const fetchIt = async (tries = 0)=>{
        const res = await globalFetch(lastClaudeObserverURL, {
            body: lastClaudeObserverPayload,
            headers: lastClaudeObserverHeaders,
            method: "POST"
        })
        if(res.status >= 400){
            if(tries < 3){
                fetchIt(tries + 1)
            }
        }
    }

    const func = ()=>{       
        //request every 4 minutes and 30 seconds
        if(lastClaudeObserverLoad > Date.now() - 1000 * 60 * 4.5){
            return
        }
        
        if(lastClaudeRequestTimes > 4){
            return
        }
        fetchIt()
        lastClaudeObserverLoad = Date.now();
        lastClaudeRequestTimes += 1;
    }
    
    setInterval(func, 20000)
}