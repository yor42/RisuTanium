import { getDatabase } from "src/ts/storage/database.svelte";
import { MCPClient, type JsonRPC, type MCPTool, type RPCToolCallContent } from "./mcplib";
import { DBState } from "src/ts/stores.svelte";
import { getModuleMcps } from "../modules";
import { alertError, alertInput, alertNormal } from "src/ts/alert";
import { language } from "src/lang";
import { fillLang } from "src/lang/fill";
import { v4 } from "uuid";
import type { MCPClientLike } from "./internalmcp";
import localforage from "localforage";
import { isTauri } from "src/ts/platform"
import { sleep } from "src/ts/util";
import { registeredCustomPluginMCPs } from "./pluginmcp";
import type { RunSubject } from "../chatOrigin";

export type MCPToolWithURL = MCPTool & {
    mcpURL: string;
};

/**
 * What a tool call carries besides its name and arguments: the request's subject (the graph memory,
 * `risuaccess` and `aiaccess` clients read it) and, when the caller knows it, the URL of the client that
 * listed the tool.
 */
export type MCPCallContext = {
    subject?: RunSubject;
    mcpURL?: string;
};

type MCPClientInstance = MCPClient | MCPClientLike;

/** The live clients, keyed by URL. `registry` holds the usage of exactly these URLs. */
export const MCPs:Record<string,MCPClientInstance> = {};

type RegistryEntry = {
    lastUsed: number;
    inFlight: number;
};

const registry = new Map<string, RegistryEntry>();
const creations = new Map<string, Promise<MCPClientInstance | undefined>>();

/**
 * A client that no running activity lists is kept this long after it was last created, listed, scanned or
 * called, so that a switch away from a module set and back does not rebuild it (a rebuilt `internal:fs`
 * asks for its directory again).
 */
const MCP_IDLE_GUARD_MS = 5 * 60 * 1000;

/** Callable from every module set; listed only by the sets whose modules name it. */
const callOnlyMCPUrls = [
    'internal:risuai',
]

function stampMCP(url:string) {
    const entry = registry.get(url);
    if(entry) {
        entry.lastUsed = Date.now();
    }
}

function registerMCP(url:string, client:MCPClientInstance) {
    MCPs[url] = client;
    registry.set(url, { lastUsed: Date.now(), inFlight: 0 });
}

/**
 * Shuts down the clients that neither the selection nor the running activity lists, that have no call in
 * flight and that were not used within the guard period. Never throws: a client whose `destroy()` throws is
 * removed anyway.
 */
function sweepMCPs(selectionUrls:string[], activityUrls:string[]) {
    try {
        const keep = new Set([...selectionUrls, ...activityUrls]);
        const now = Date.now();
        for(const url of Object.keys(MCPs)) {
            const entry = registry.get(url);
            if(keep.has(url) || (entry && (entry.inFlight > 0 || now - entry.lastUsed < MCP_IDLE_GUARD_MS))) {
                continue;
            }
            const client = MCPs[url];
            delete MCPs[url];
            registry.delete(url);
            try {
                client.destroy();
            } catch (error) {
                console.error(`MCP: Failed to shut down the client of ${url}:`, error);
            }
        }
    } catch (error) {
        console.error('MCP: Failed to sweep idle clients:', error);
    }
}

async function createMCPClient(mcp:string):Promise<MCPClientInstance | undefined> {
    let mcpUrl = mcp;

    if(mcp.startsWith('internal:')) {
        let client:MCPClientInstance;
        switch(mcp) {
            case 'internal:fs':{
                const { FileSystemClient } = await import('./filesystemclient');
                client = new FileSystemClient();
                break;
            }
            case 'internal:risuai':{
                const { RisuAccessClient } = await import('./risuaccess');
                client = new RisuAccessClient();
                break;
            }
            case 'internal:aiaccess':{
                const { AIAccessClient } = await import('./aiaccess');
                client = new AIAccessClient();
                break;
            }
            case 'internal:googlesearch': {
                const { GoogleSearchClient } = await import('./googlesearchclient');
                client = new GoogleSearchClient();
                break;
            }
            case 'internal:graphmem':{
                const { GraphMemClient } = await import('./graphmem');
                client = new GraphMemClient();
                break;
            }
            case 'internal:dice':{
                const { DiceClient } = await import('./dice');
                client = new DiceClient();
                break;
            }
            default:
                throw new Error(`Unknown internal MCP: ${mcp}`);
        }

        await client.checkHandshake();
        return client;
    }

    if(mcp.startsWith('plugin:')){
        const customMCP = registeredCustomPluginMCPs.get(mcp);
        if(customMCP){
            await customMCP.checkHandshake();
            return customMCP;
        }
    }
    if(mcp.startsWith('stdio:')){
        const MCPJSON = mcp.slice('stdio:'.length);
        try {
            const MCPData = JSON.parse(MCPJSON);
            if(MCPData.url) {
                mcpUrl = MCPData.url;
            }
            else if(MCPData.command && MCPData.args) {
                const command = MCPData.command as string;
                const args: string[] = Array.isArray(MCPData.args) ? MCPData.args : [MCPData.args];
                const env: Record<string, string> = MCPData.env || {};

                if(!isTauri){
                    throw new Error('stdio MCPs are only supported in Local Version');
                }

                const { Command } = await import('@tauri-apps/plugin-shell');
                const listeners = new Set<(message: JsonRPC) => void | Promise<void>>();
                const cmd = Command.create(command, args, {
                    env: env
                })
                let gotPong = false;
                let pingIds: string[] = [];
                cmd.stdout.on('data', ((line) => {
                    console.log('MCP JSON:', line);
                    try {
                        const data = JSON.parse(line);
                        if(pingIds.includes(data.id)){
                            gotPong = true
                            return
                        }
                        for(const listener of listeners) {
                            listener(data);
                        }
                    } catch (error) {
                        console.error('Failed to parse MCP JSON:', error);
                    }
                }))
                const child = await cmd.spawn();

                const client = new MCPClient(mcp);
                client.customTransport = {
                    send: async (data) => {
                        console.log('Sending data to MCP:', data);
                        await child.write(JSON.stringify(data))
                    },
                    addListener: (callback) => {
                        listeners.add(callback);
                    },
                    removeListener: (callback) => {
                        listeners.delete(callback);
                    },
                }

                client.onDestroy = () => {
                    child.kill();
                    for(const listener of listeners) {
                        client.customTransport?.removeListener(listener);
                    }
                }

                //ping-pong before handshake, ensure MCP is ready
                for(let i=0;i<10;i++){
                    const pingId = v4();
                    pingIds.push(pingId);
                    console.log('Sending ping to MCP:', pingId);
                    await child.write(JSON.stringify({
                        jsonrpc: "2.0",
                        id: pingId,
                        method: "ping"
                    }))
                    await sleep(1000)
                    if(gotPong){
                        break;
                    }
                }

                if(!gotPong){
                    throw new Error('MCP did not respond');
                }

                await client.checkHandshake();
                return client;
            }
            else {
                throw new Error('MCP JSON does not contain a valid URL');
            }
        }
        catch (error) {
            throw new Error(`Failed to parse MCP JSON: ${error}`);
        }
    }

    const registerRefresh:typeof MCPClient.prototype.registerRefreshToken = (arg) => {
        DBState.db.authRefreshes.push({
            url: mcp,
            ...arg
        })
    }

    const getRefresh:typeof MCPClient.prototype.getRefreshToken = async () => {
        return DBState.db.authRefreshes.find(refresh => refresh.url === mcp);
    }

    try {

        if(
            !mcpUrl.startsWith('https://') &&
            !mcpUrl.startsWith('http://')
        ){
            throw new Error('Invalid MCP URL');
        }

        const mcpClient = new MCPClient(mcpUrl);
        mcpClient.registerRefreshToken = registerRefresh;
        mcpClient.getRefreshToken = getRefresh;
        await mcpClient.checkHandshake()
        return mcpClient;
    } catch (error) {
        console.error(`MCP: Failed to initialize MCP at ${mcp}:`, error);
        return undefined;
    }
}

/**
 * The live client of `url`, created when there is none. Concurrent callers share one creation, and a
 * creation is forgotten once it settles, so a failed one can be retried. A network failure yields no
 * client; an unknown `internal:` URL or a `stdio:` URL outside the desktop app rejects.
 */
async function ensureMCP(url:string):Promise<MCPClientInstance | undefined> {
    const live = MCPs[url];
    if(live) {
        stampMCP(url);
        return live;
    }
    let creation = creations.get(url);
    if(!creation) {
        creation = (async () => {
            try {
                const client = await createMCPClient(url);
                if(client) {
                    registerMCP(url, client);
                }
                return client;
            } finally {
                creations.delete(url);
            }
        })();
        creations.set(url, creation);
    }
    return await creation;
}

/**
 * The URLs one activity works on: its module set (the subject's, or the selection's without a subject), then
 * `extraUrls`, without repeats. `selectionUrls` is what the selection lists, which no sweep takes.
 */
function activityUrlsOf(extraUrls:string[], subject?:RunSubject) {
    const own = getModuleMcps(subject);
    const urls = Array.from(new Set(own));
    for(const url of extraUrls) {
        if(!urls.includes(url)) {
            urls.push(url);
        }
    }
    const selectionUrls = subject ? getModuleMcps() : own;
    return { urls, selectionUrls };
}

/**
 * Starts an activity: stamps the clients it lists, sweeps, then ensures `ensureUrls` (its whole list unless
 * given). Returns the client each ensure returned, in list order, skipping a URL that yielded none.
 */
async function beginMCPActivity(urls:string[], selectionUrls:string[], ensureUrls:string[] = urls) {
    for(const url of urls) {
        stampMCP(url);
    }
    sweepMCPs(selectionUrls, urls);
    const ensured:[string, MCPClientInstance][] = [];
    for(const url of ensureUrls) {
        const client = await ensureMCP(url);
        if(client) {
            ensured.push([url, client]);
        }
    }
    return ensured;
}

export async function initializeMCPs(additionalMCPs?:string[], subject?:RunSubject) {
    const { urls, selectionUrls } = activityUrlsOf(additionalMCPs ?? [], subject);
    await beginMCPActivity(urls, selectionUrls);
}

export async function getMCPTools(additionalMCPs?:string[], subject?:RunSubject) {
    const { urls, selectionUrls } = activityUrlsOf(additionalMCPs ?? [], subject);
    const ensured = await beginMCPActivity(urls, selectionUrls);
    const tools:MCPToolWithURL[] = [];
    for(const [url, client] of ensured) {
        stampMCP(url);
        const t = (await client.getToolList()).map(tool => {
            return {
                ...tool,
                mcpURL: url
            }
        })

        tools.push(...t);
    }
    return tools;
}

export async function getMCPMeta(additionalMCPs?:string[], subject?:RunSubject) {
    const { urls, selectionUrls } = activityUrlsOf(additionalMCPs ?? [], subject);
    const ensured = await beginMCPActivity(urls, selectionUrls);
    const meta:Record<string, typeof MCPClient.prototype.serverInfo> = {};
    for(const [url, client] of ensured) {
        stampMCP(url);
        meta[url] = client.serverInfo
    }
    return meta;
}

/** A client's `callTool`, which takes the subject as an optional third argument that most clients ignore. */
type SubjectAwareClient = {
    callTool(toolName:string, args:any, ctx?:{ subject?: RunSubject }):Promise<RPCToolCallContent[]>;
};

async function callOnClient(url:string, client:MCPClientInstance, methodName:string, args:any, subject?:RunSubject) {
    const entry = registry.get(url);
    if(entry) {
        entry.inFlight++;
        entry.lastUsed = Date.now();
    }
    try {
        const target:SubjectAwareClient = client;
        return await target.callTool(methodName, args, { subject });
    } finally {
        if(entry) {
            entry.inFlight--;
            entry.lastUsed = Date.now();
        }
    }
}

export async function callMCPTool(methodName:string, args:any, ctx?:MCPCallContext):Promise<RPCToolCallContent[]> {
    const subject = ctx?.subject;
    const mcpURL = ctx?.mcpURL;
    const { urls, selectionUrls } = activityUrlsOf(mcpURL ? [mcpURL, ...callOnlyMCPUrls] : callOnlyMCPUrls, subject);
    const ensured = await beginMCPActivity(urls, selectionUrls, mcpURL ? [mcpURL] : urls);
    if(mcpURL) {
        const routed = ensured.find(([url]) => url === mcpURL);
        if(routed) {
            return await callOnClient(mcpURL, routed[1], methodName, args, subject);
        }
    }
    else {
        for(const [url, client] of ensured) {
            stampMCP(url);
            const tools = await client.getToolList();
            const tool = tools.find(t => t.name === methodName);
            if(tool) {
                return await callOnClient(url, client, methodName, args, subject);
            }
        }
    }
    return  [{
        type: 'text',
        text: `Tool ${methodName} not found on any MCP`
    }]
}

//Currently just a wrapper for getMCPTools, but can be extended later for more than MCPs
export async function getTools(subject?:RunSubject){
    return await getMCPTools(undefined, subject);
}

//Currently just a wrapper for callMCPTool, but can be extended later for more than MCPs
export async function callTool(methodName:string, args:any, ctx?:MCPCallContext) {
    return await callMCPTool(methodName, args, ctx);
}

export async function importMCPModule(){
    const x = await alertInput(language.alerts.mcpEnterModuleUrl, [
        ['internal:aiaccess', 'LLM Call Client (internal:aiaccess)'],
        ['internal:risuai', 'Risu Access Client (internal:risuai)'],
        ['internal:fs', 'File System Client (internal:fs)'],
        ['internal:googlesearch', 'Google Search Client (internal:googlesearch)'],
        ['internal:dice', 'Dice Tool Client (internal:dice)'],
        ['internal:graphmem', 'Graph Memory Client (internal:graphmem)'],
        ['https://mcp.paypal.com/sse', 'PayPal MCP (https://mcp.paypal.com/sse)'],
        ['https://mcp.linear.app/sse', 'Linear MCP (https://mcp.linear.app/sse)'],
        ['https://rag-mcp-2.whatsmcp.workers.dev/sse', 'OneContext MCP (https://rag-mcp-2.whatsmcp.workers.dev/sse)'],
        ['https://browser.mcp.cloudflare.com/sse', 'Cloudflare Browser MCP (https://browser.mcp.cloudflare.com/sse)'],
        ['https://mcp.deepwiki.com/mcp', 'DeepWiki MCP (https://mcp.deepwiki.com/mcp)'],
    ])

    if(
        !x.startsWith('http://localhost') &&
        !x.startsWith('http://127') &&
        !x.startsWith('https:') &&
        !x.startsWith('internal:') &&
        !x.startsWith('stdio:') &&
        !x.startsWith('plugin:')
    ){
        alertError(language.errors.invalidUrl);
        return;
    }
    try {
        const metas = (await getMCPMeta([x]))
        console.log(metas)
        const meta = metas[x];
        if(!meta) {
            alertError(language.errors.mcpModuleNotFound);
            return;
        }
        const db = getDatabase();
        db.modules.push({
            name: meta.serverInfo.name,
            description: "MCP from " + x,
            mcp: {
                url: x
            },
            id: v4(),
            lorebook: [{
                comment: "MCP Info",
                content: `@@mcp\n\n<MCP Info>Name:${meta.serverInfo.name}\nVersion:${meta.serverInfo.version}\nInst:${meta.instructions ?? 'None'}</MCP Info>`,
                key: '',
                alwaysActive: true,
                secondkey: "",
                insertorder: 0,
                mode: "normal",
                selective: false
            }]
        })
        alertNormal(fillLang(language.alerts.mcpModuleImported, { name: meta.serverInfo.name }));

    } catch (error) {
        alertError(error)
    }
}

export type toolCallData = {
    call: {
        id: string,
        name: string,
        arg: any
    },
    response: RPCToolCallContent[],
}

const inst = localforage.createInstance({
    name: 'mcp-tool-calls',
    storeName: 'mcp-tool-calls'
});

export async function encodeToolCall(call:toolCallData){
    call.call.id = call.call.id || v4();
    await inst.setItem(call.call.id, call)
    return `<tool_call>${call.call.id}\uf100${call.call.name}</tool_call>\n\n`;
}

export async function decodeToolCall(text:string):Promise<toolCallData|undefined> {
    text = text.trim();
    if(text.startsWith('<tool_call>')){
        text = text.slice('<tool_call>'.length, 0).trim();
    }
    if(text.endsWith('</tool_call>')){
        text = text.slice(0, -'</tool_call>'.length).trim();
    }
    const [callId, callName] = text.split('\uf100');
    if(!callId) {
        return undefined;
    }
    const call = await inst.getItem<toolCallData>(callId);
    if(!call) {
        return undefined;
    }
    return call;
}