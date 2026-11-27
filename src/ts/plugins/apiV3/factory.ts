import { beginChokePoint } from "src/ts/process/memory/busyActions";
import { MEASURE } from "src/ts/process/memory/measureFlag";
import { startPluginRecord } from "../pluginCostMeter";
import { isPlainResult } from "./pluginCopy.svelte";
import type { CallGate } from "../pluginWriteTurns";
import { v4 } from "uuid";

type MsgType =
    | 'CALL_ROOT'
    | 'CALL_INSTANCE'
    | 'INVOKE_CALLBACK'
    | 'CALLBACK_RETURN'
    | 'RESPONSE'
    | 'RELEASE_INSTANCE'
    | 'ABORT_SIGNAL'
    | 'CHUNK_BEGIN'
    | 'CHUNK_PIECE'
    | 'CHUNK_END'
    | 'CHUNK_ABORT';

interface RpcMessage {
    type: MsgType;
    reqId?: string;
    id?: string;
    ids?: string[];
    method?: string;
    args?: any[];
    result?: any;
    error?: string;
    abortId?: string;
    // Chunked write: read only after narrowing, since the iframe is untrusted.
    pieces?: unknown;
    layout?: unknown;
    seq?: unknown;
    slot?: unknown;
    items?: unknown;
}

/** The plugin database writes the sandbox may send in pieces: the methods the write turn orders. */
const CHUNK_METHODS: ReadonlySet<string> = new Set(['setDatabase', 'setDatabaseLite']);
const CHUNK_MAX_PIECES = 4096;
const CHUNK_MAX_LAYOUT = 4096;
/** A transfer is dropped after two consecutive quiet intervals of this length. */
const CHUNK_IDLE_MS = 30000;

/** One top-level key of the argument: a value carried in the layout, or an array whose items arrive in pieces. */
interface ChunkLayoutEntry {
    key: string;
    /** Declared item count of a split array; null for a value carried in the layout. */
    split: number | null;
    value: unknown;
}

/** The single open transfer of one plugin iframe. */
interface ChunkTransfer {
    reqId: string;
    method: string;
    layout: ChunkLayoutEntry[];
    /** Items received so far, per layout index; null where the entry is not split. */
    slots: (unknown[] | null)[];
    pieces: number;
    nextSeq: number;
    timer: ReturnType<typeof setInterval>;
    /** Messages from the iframe since the last idle tick. */
    activity: number;
    quietFires: number;
    endChokePoint: () => void;
}

interface RemoteRef {
    __type: 'REMOTE_REF';
    id: string;
}

interface CallbackRef {
    __type: 'CALLBACK_REF';
    id: string;
}

interface AbortSignalRef {
    __type: 'ABORT_SIGNAL_REF';
    abortId: string;
    aborted: boolean;
}


const GUEST_BRIDGE_SCRIPT = `
await (async function() {
    const pendingRequests = new Map();
    const callbackRegistry = new Map();
    const callbackIdByFunction = new WeakMap();
    const proxyRefRegistry = new WeakMap();
    const releaseBuffer = [];
    const flushReleases = () => {
        if (releaseBuffer.length === 0) return;
        const ids = releaseBuffer.splice(0);
        try {
            send({ type: 'RELEASE_INSTANCE', ids: ids });
        } catch (_) {
            // Frame is tearing down; host clears its registry anyway
        }
    };
    const releaseRegistry = new FinalizationRegistry((id) => {
        // Schedule one flush per burst: first push arms the microtask.
        if (releaseBuffer.length === 0) queueMicrotask(flushReleases);
        releaseBuffer.push(id);
    });
    const abortControllers = new Map();

    // Bound before any plugin code runs, so a plugin that replaces these globals cannot redirect the bridge.
    const clone = structuredClone;
    const MC = MessageChannel;
    const doc = document;

    const CHUNK_MIN_ESTIMATE = 2 * 1024 * 1024;
    const CHUNK_PIECE = 1024 * 1024;
    const CHUNK_MAX_PIECES = ${CHUNK_MAX_PIECES};
    const CHUNK_MAX_LAYOUT = ${CHUNK_MAX_LAYOUT};

    // Every window message goes through send(). While a chunked write is pumping, later messages are snapshotted into
    // the outbox and posted after it, so the host sees them in program order. The head entry stays in the outbox while
    // it is processed, which keeps calls made from a late-failure handler at the tail.
    const outbox = [];
    let draining = false;
    let preparing = false;
    let turnChannel = null;
    const turnWaiters = [];

    function serializeArg(arg) {
        if (typeof arg === 'function') {
            const existingId = callbackIdByFunction.get(arg);
            if (existingId) {
                return { __type: 'CALLBACK_REF', id: existingId };
            }
            const id = 'cb_' + Math.random().toString(36).substring(2);
            callbackRegistry.set(id, arg);
            callbackIdByFunction.set(arg, id);
            return { __type: 'CALLBACK_REF', id: id };
        }
        if (arg && typeof arg === 'object') {
            const refId = proxyRefRegistry.get(arg);
            if (refId) {
                return { __type: 'REMOTE_REF', id: refId };
            }
            if (arg.constructor === Object) {
                let out = null;
                for (const [key, val] of Object.entries(arg)) {
                    if (val instanceof AbortSignal) {
                        if (!out) out = { ...arg };
                        const abortId = 'abort_' + Math.random().toString(36).substring(2);

                        if (!val.aborted) {
                            val.addEventListener('abort', () => {
                                send({ type: 'ABORT_SIGNAL', abortId });
                            }, { once: true });
                        }

                        out[key] = { __type: 'ABORT_SIGNAL_REF', abortId, aborted: val.aborted };
                    }
                }
                if (out) return out;
            }
        }
        return arg;
    }

    function deserializeResult(val) {
        if (val && typeof val === 'object' && val.__type === 'REMOTE_REF') {
            const proxy = new Proxy({}, {
                get: (target, prop) => {
                    if (prop === 'then') return undefined;
                    if (prop === 'release') {
                        return () => send({ type: 'RELEASE_INSTANCE', id: val.id });
                    }
                    return (...args) => {
                        // Extracted methods must pin their owning proxy:
                        // without this reference the proxy could be
                        // collected (and auto-released) while this
                        // function is still callable.
                        void proxy;
                        return sendRequest('CALL_INSTANCE', {
                            id: val.id,
                            method: prop,
                            args: args
                        });
                    };
                }
            });
            // Store the mapping so we can serialize it back
            proxyRefRegistry.set(proxy, val.id);
            // Held value must be the id string, never the proxy itself:
            // the registry holds it strongly until cleanup fires.
            releaseRegistry.register(proxy, val.id);
            return proxy;
        }
        if (val && typeof val === 'object' && val.__type === 'CALLBACK_STREAMS') {
            //specialType, one of
            // - Response
            // - none
            const specialType = val.__specialType;
            if (specialType === 'Response') {
                return new Response(val.value, val.init);
            }
            return val.value;
        }
        return val;
    }

    function collectTransferables(obj, transferables = []) {
        if (!obj || typeof obj !== 'object') return transferables;

        if (obj instanceof ArrayBuffer ||
            obj instanceof MessagePort ||
            obj instanceof ImageBitmap ||
            (typeof OffscreenCanvas !== 'undefined' && obj instanceof OffscreenCanvas)) {
            transferables.push(obj);
        }
        else if (ArrayBuffer.isView(obj) && obj.buffer instanceof ArrayBuffer) {
            transferables.push(obj.buffer);
        }
        else if (Array.isArray(obj)) {
            obj.forEach(item => collectTransferables(item, transferables));
        }
        else if (obj.constructor === Object) {
            Object.values(obj).forEach(value => collectTransferables(value, transferables));
        }

        return transferables;
    }

    function replaceStreamsWithPorts(obj) {
        const ports = [];
        const cleanups = [];
        if (!obj || typeof obj !== 'object') return { result: obj, ports, cleanups };

        function replace(val) {
            if (!(val instanceof ReadableStream)) return val;

            const ch = new MessageChannel();
            ports.push(ch.port2);

            const reader = val.getReader();
            let credits = 0;
            let reading = false;
            let finished = false;

            function finish() {
                finished = true;
                ch.port1.onmessage = null;
                ch.port1.close();
            }

            cleanups.push(() => {
                reader.cancel().catch(() => {});
                finish();
            });

            async function pump() {
                if (reading || finished) return;
                reading = true;
                try {
                    while (credits > 0 && !finished) {
                        credits--;
                        const { done, value } = await reader.read();
                        if (finished) return;
                        if (done) { ch.port1.postMessage({ done: true }); finish(); return; }
                        ch.port1.postMessage({ done: false, value });
                    }
                } catch (e) {
                    try { ch.port1.postMessage({ done: true, error: e.message }); } catch(_) {}
                    finish();
                } finally {
                    reading = false;
                }
            }

            ch.port1.onmessage = (e) => {
                if (e.data?.cancel) {
                    reader.cancel();
                    finish();
                } else if (e.data?.pull) {
                    credits++;
                    pump();
                }
            };

            return { __type: 'STREAM_PORT', portIndex: ports.length - 1 };
        }

        if (obj instanceof ReadableStream) return { result: replace(obj), ports, cleanups };
        if (obj.constructor === Object) {
            const out = {};
            for (const k of Object.keys(obj)) out[k] = replace(obj[k]);
            return { result: out, ports, cleanups };
        }

        return { result: obj, ports, cleanups };
    }

    function reconstructStreamsFromPorts(obj, ports) {
        if (!obj || typeof obj !== 'object') return obj;

        function reconstruct(val) {
            if (!val || val.__type !== 'STREAM_PORT' || typeof val.portIndex !== 'number') return val;

            const port = ports[val.portIndex];
            if (!port) throw new Error('Stream port at index ' + val.portIndex + ' not received');

            return new ReadableStream({
                start(controller) {
                    port.onmessage = (e) => {
                        if (e.data.done) {
                            if (e.data.error) controller.error(new Error(e.data.error));
                            else controller.close();
                            port.onmessage = null;
                            port.close();
                        } else {
                            controller.enqueue(e.data.value);
                        }
                    };
                },
                pull() {
                    port.postMessage({ pull: true });
                },
                cancel() {
                    port.postMessage({ cancel: true });
                    port.onmessage = null;
                    port.close();
                }
            });
        }

        if (obj.__type === 'STREAM_PORT') return reconstruct(obj);
        if (obj.constructor === Object) {
            const out = {};
            for (const k of Object.keys(obj)) out[k] = reconstruct(obj[k]);
            return out;
        }

        return obj;
    }

    function send(payload, transferables = [], onLateFail) {
        if (outbox.length === 0 && !draining) {
            window.parent.postMessage(payload, '*', transferables);
            return;
        }
        // Cloning here throws the same errors a direct post would, at the same moment; the wrapper keeps the body and
        // the transfer list sharing identity, so transferred ports and buffers still travel in the transfer list.
        const e = clone({ b: payload, t: transferables }, { transfer: transferables });
        outbox.push({ e: e, onLateFail: onLateFail });
    }

    async function drain() {
        draining = true;
        try {
            while (outbox.length > 0) {
                const entry = outbox[0];
                try {
                    if (entry.x) {
                        await pumpTransfer(entry.x);
                    } else {
                        try {
                            window.parent.postMessage(entry.e.b, '*', entry.e.t);
                        } catch (err) {
                            if (entry.onLateFail) entry.onLateFail(err);
                        }
                    }
                } catch (_) {
                    // A failing entry never stops the pump.
                }
                outbox.shift();
            }
        } finally {
            draining = false;
        }
    }

    function turn() {
        return new Promise((resolve) => {
            if (!turnChannel) {
                turnChannel = new MC();
                turnChannel.port1.onmessage = () => {
                    const next = turnWaiters.shift();
                    if (next) next();
                };
            }
            turnWaiters.push(resolve);
            turnChannel.port2.postMessage(0);
        });
    }

    function abandonTransfer(x, err, begun) {
        x.held = null;
        if (begun) {
            try {
                window.parent.postMessage({ type: 'CHUNK_ABORT', reqId: x.reqId }, '*');
            } catch (_) {}
        }
        const req = pendingRequests.get(x.reqId);
        if (req) {
            pendingRequests.delete(x.reqId);
            req.reject(err);
        }
    }

    async function pumpTransfer(x) {
        const reqId = x.reqId;
        const held = x.held;
        try {
            window.parent.postMessage(x.begin, '*');
        } catch (err) {
            abandonTransfer(x, err, false);
            return;
        }
        for (let i = 0; i < held.length; i++) {
            // One piece per task turn keeps the page responsive; a hidden page gets no such turns reliably.
            if (doc.visibilityState !== 'hidden') await turn();
            // The host already refused the transfer (error RESPONSE): stop posting.
            if (!pendingRequests.has(reqId)) {
                x.held = null;
                return;
            }
            try {
                window.parent.postMessage({ type: 'CHUNK_PIECE', reqId: reqId, seq: i, slot: x.slots[i], items: held[i] }, '*');
            } catch (err) {
                abandonTransfer(x, err, true);
                return;
            }
            held[i] = null;
        }
        if (!pendingRequests.has(reqId)) {
            x.held = null;
            return;
        }
        try {
            window.parent.postMessage({ type: 'CHUNK_END', reqId: reqId }, '*');
        } catch (err) {
            abandonTransfer(x, err, true);
        }
        x.held = null;
    }

    // Size estimate of a value, in the units of a length sum; -1 when the value cannot be carried in pieces
    // (functions, symbols, anything that is not a plain object, plain array, Date or RegExp) or is shared with
    // another owner. Each object may belong to one owner only, so identity inside one unit is kept and identity across
    // units never has to be.
    // An object revisited while it is still on the current recursion path is a cycle: the write is left to the
    // single-message path, which treats it as it did before.
    function estimateValue(val, owner, registered) {
        if (!val || typeof val !== 'object') return estimateWalk(val, owner, registered);
        if (walkPath.has(val)) return -1;
        walkPath.add(val);
        const size = estimateWalk(val, owner, registered);
        walkPath.delete(val);
        return size;
    }

    function estimateWalk(val, owner, registered) {
        switch (typeof val) {
            case 'string': return val.length;
            case 'number': return 8;
            case 'bigint': return 8;
            case 'boolean': return 4;
            case 'undefined': return 4;
            case 'object': break;
            default: return -1;
        }
        if (val === null) return 4;
        if (!registered) {
            if (owners.has(val)) return owners.get(val) === owner ? 0 : -1;
            owners.set(val, owner);
        }
        if (val instanceof Date) return 8;
        if (val instanceof RegExp) return 16 + val.source.length;
        let size = 16;
        if (Array.isArray(val)) {
            if (Object.getPrototypeOf(val) !== Array.prototype) return -1;
            for (let i = 0; i < val.length; i++) {
                const s = estimateValue(val[i], owner, false);
                if (s < 0) return -1;
                size += s;
            }
            return size;
        }
        const proto = Object.getPrototypeOf(val);
        if (proto !== Object.prototype && proto !== null) return -1;
        const keys = Object.keys(val);
        for (let i = 0; i < keys.length; i++) {
            const s = estimateValue(val[keys[i]], owner, false);
            if (s < 0) return -1;
            size += keys[i].length + s;
        }
        return size;
    }

    // Ownership of every object reached by the current planWrite walk.
    let owners = new WeakMap();
    let walkPath = new WeakSet();

    // Decides whether a database write travels in pieces. Returns null for everything that must take the
    // single-message path unchanged.
    function planWrite(arg) {
        if (!arg || typeof arg !== 'object') return null;
        const rootProto = Object.getPrototypeOf(arg);
        if (rootProto !== Object.prototype && rootProto !== null) return null;
        const keys = Object.keys(arg);
        if (keys.length > CHUNK_MAX_LAYOUT) return null;
        owners = new WeakMap();
        walkPath = new WeakSet();
        owners.set(arg, 0);
        let nextOwner = 1;
        const entries = [];
        let hasSplit = false;
        for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            const val = arg[key];
            if (Array.isArray(val)) {
                if (Object.getPrototypeOf(val) !== Array.prototype) return null;
                if (owners.has(val)) return null;
                owners.set(val, nextOwner++);
                const n = val.length;
                if (Object.keys(val).length !== n) return null;
                const elems = [];
                for (let i = 0; i < n; i++) {
                    if (!(i in val)) return null;
                    elems.push(val[i]);
                }
                entries.push({ key: key, elems: elems, value: undefined, owner: -1, ids: [], sizes: [] });
                hasSplit = true;
            } else {
                let owner = -1;
                if (val && typeof val === 'object') {
                    if (owners.has(val)) return null;
                    owner = nextOwner++;
                    owners.set(val, owner);
                }
                entries.push({ key: key, elems: null, value: val, owner: owner, ids: null, sizes: null });
            }
        }
        if (!hasSplit) return null;

        let total = 0;
        for (let k = 0; k < entries.length; k++) {
            const en = entries[k];
            if (en.elems) continue;
            const s = estimateValue(en.value, en.owner, true);
            if (s < 0) return null;
            total += en.key.length + s;
            if (total > CHUNK_PIECE) return null;
        }
        for (let k = 0; k < entries.length; k++) {
            const en = entries[k];
            if (!en.elems) continue;
            for (let i = 0; i < en.elems.length; i++) {
                const el = en.elems[i];
                if (el && typeof el === 'object') {
                    if (owners.has(el)) return null;
                    const id = nextOwner++;
                    owners.set(el, id);
                    en.ids.push(id);
                } else {
                    en.ids.push(-1);
                }
            }
        }
        for (let k = 0; k < entries.length; k++) {
            const en = entries[k];
            if (!en.elems) continue;
            total += en.key.length;
            for (let i = 0; i < en.elems.length; i++) {
                const s = estimateValue(en.elems[i], en.ids[i], true);
                if (s < 0) return null;
                en.sizes.push(s);
                total += s;
            }
        }
        if (total < CHUNK_MIN_ESTIMATE) return null;

        const groups = [];
        for (let k = 0; k < entries.length; k++) {
            const en = entries[k];
            if (!en.elems || en.elems.length === 0) continue;
            let from = 0;
            let acc = 0;
            for (let i = 0; i < en.elems.length; i++) {
                const s = en.sizes[i];
                if (i > from && acc + s > CHUNK_PIECE) {
                    groups.push({ slot: k, from: from, to: i });
                    from = i;
                    acc = 0;
                }
                acc += s;
            }
            groups.push({ slot: k, from: from, to: en.elems.length });
        }
        if (groups.length === 0 || groups.length > CHUNK_MAX_PIECES) return null;
        return { entries: entries, groups: groups };
    }

    // Takes the call-time snapshot of an eligible write: every piece is cloned now, so later edits by the plugin never
    // reach the host. Returns the outbox entry, or null when the write takes the single-message path.
    function prepareWrite(reqId, method, arg) {
        let plan;
        try {
            plan = planWrite(arg);
        } catch (e) {
            if (e instanceof RangeError) return null;
            throw e;
        }
        if (!plan) return null;
        const layout = [];
        for (let k = 0; k < plan.entries.length; k++) {
            const en = plan.entries[k];
            layout.push(en.elems ? { key: en.key, split: en.elems.length } : { key: en.key, value: clone(en.value) });
        }
        const held = [];
        const slots = [];
        for (let g = 0; g < plan.groups.length; g++) {
            const group = plan.groups[g];
            held.push(clone(plan.entries[group.slot].elems.slice(group.from, group.to)));
            slots.push(group.slot);
        }
        return {
            x: {
                reqId: reqId,
                begin: { type: 'CHUNK_BEGIN', reqId: reqId, method: method, pieces: held.length, layout: layout },
                held: held,
                slots: slots
            }
        };
    }

    function sendRequest(type, payload) {
        return new Promise((resolve, reject) => {
            const reqId = Math.random().toString(36).substring(7);
            pendingRequests.set(reqId, { resolve, reject });


            const rawArgs = payload.args;
            if (payload.args) {
                payload.args = payload.args.map(serializeArg);
            }

            // Only a write whose single argument went through serializeArg unchanged can travel in pieces, and never
            // while another write is being prepared: calls made by getters during the walk follow send().
            if (!preparing && type === 'CALL_ROOT' && (payload.method === 'setDatabase' || payload.method === 'setDatabaseLite')
                && rawArgs && rawArgs.length === 1 && payload.args[0] === rawArgs[0]) {
                let entry;
                preparing = true;
                try {
                    entry = prepareWrite(reqId, payload.method, payload.args[0]);
                } catch (e) {
                    pendingRequests.delete(reqId);
                    throw e;
                } finally {
                    preparing = false;
                }
                if (entry) {
                    outbox.push(entry);
                    if (!draining) void drain();
                    return;
                }
            }

            const message = { type: type, reqId: reqId, ...payload };
            const transferables = collectTransferables(message);
            send(message, transferables, (err) => {
                pendingRequests.delete(reqId);
                reject(err);
            });
        });
    }

    
    
    
    window.addEventListener('message', async (event) => {
        if (event.source !== window.parent) return;

        const data = event.data;
        if (!data) return;


        if (data.type === 'RESPONSE' && data.reqId) {
            const req = pendingRequests.get(data.reqId);
            if (req) {
                if (data.error) req.reject(new Error(data.error));
                else {
                    try {
                        req.resolve(deserializeResult(reconstructStreamsFromPorts(data.result, event.ports)));
                    } catch (e) {
                        req.reject(e);
                    }
                }
                pendingRequests.delete(data.reqId);
            }
        }

        else if (data.type === 'EXECUTE_CODE' && data.reqId) {
            const response = { type: 'EXEC_RESULT', reqId: data.reqId };
            try {
                const result = await eval('(async () => {' + data.code + '})()');
                response.result = result;
            } catch (e) {
                response.error = e.message || String(e);
            }
            send(response);
        }

        else if (data.type === 'ABORT_SIGNAL' && data.abortId) {
            const controller = abortControllers.get(data.abortId);
            if (controller) {
                controller.abort();
                abortControllers.delete(data.abortId);
            }
        }

        else if (data.type === 'INVOKE_CALLBACK' && data.id) {
            const fn = callbackRegistry.get(data.id);
            const response = { type: 'CALLBACK_RETURN', reqId: data.reqId };
            const usedAbortIds = [];
            let transferables = [];
            let streamCleanups = [];

            const rollbackStreams = () => {
                for (const cleanup of streamCleanups) {
                    try { cleanup(); } catch(_) {}
                }
                streamCleanups = [];
            };

            try {
                if (!fn) throw new Error("Callback not found or released");
                const deserializedArgs = (data.args || []).map(function(a) {
                    if (a && typeof a === 'object' && a.__type === 'ABORT_SIGNAL_REF') {
                        const controller = new AbortController();
                        abortControllers.set(a.abortId, controller);
                        usedAbortIds.push(a.abortId);
                        if (a.aborted) { controller.abort(); }
                        return controller.signal;
                    }
                    return deserializeResult(a);
                });
                const result = await fn(...deserializedArgs);
                response.result = result;
                const { result: streamResult, ports: streamPorts, cleanups } = replaceStreamsWithPorts(response.result);
                response.result = streamResult;
                streamCleanups = cleanups;
                transferables = collectTransferables(response, streamPorts);
            } catch (e) {
                rollbackStreams();
                delete response.result;
                response.error = (e && e.message) || String(e || "Guest callback error");
            }
            // Clean up abort controllers after callback completes
            for (const id of usedAbortIds) {
                abortControllers.delete(id);
            }
            // A post that fails after queueing reports through the same handler, at the tail of the outbox.
            const failReturn = (e) => {
                rollbackStreams();
                try {
                    send({
                        type: 'CALLBACK_RETURN',
                        reqId: data.reqId,
                        error: 'Failed to post message to parent: ' + ((e && e.message) || String(e || "Unknown error"))
                    });
                } catch(_) {}
            };
            try {
                send(response, transferables, failReturn);
            } catch (e) {
                failReturn(e);
            }
        }
    });





    const propertyCache = new Map();

    window.risuai = new Proxy({}, {
        get: (target, prop) => {
            if (propertyCache.has(prop)) {
                return propertyCache.get(prop);
            }
            return (...args) => sendRequest('CALL_ROOT', { method: prop, args: args });
        }
    });
    window.Risuai = window.risuai;

    try {
        // Initialize cached properties
        const propsToInit = await window.risuai._getPropertiesForInitialization();
        console.log('Initializing risuai properties:', JSON.stringify(propsToInit.list));
        for (let i = 0; i < propsToInit.list.length; i++) {
            const key = propsToInit.list[i];
            const value = propsToInit[key];
            propertyCache.set(key, value);
        }

        // Initialize aliases
        const aliases = await window.risuai._getAliases();
        const aliasKeys = Object.keys(aliases);
        for (let i = 0; i < aliasKeys.length; i++) {
            const aliasKey = aliasKeys[i];
            const childrens = Object.keys(aliases[aliasKey]);
            const aliasObj = {};
            for (let j = 0; j < childrens.length; j++) {
                const childKey = childrens[j];
                aliasObj[childKey] = risuai[aliases[aliasKey][childKey]];
            }
            propertyCache.set(aliasKey, aliasObj);
        }

        // Initialize helper functions defined in the guest

        propertyCache.set('unwarpSafeArray', async (safeArray) => {
            const length = await safeArray.length();
            const result = [];
            for (let i = 0; i < length; i++) {
                const item = await safeArray.at(i);
                result.push(item);
            }
            return result;
        });
    } catch (e) {
        console.error('Failed to initialize risuai properties:', e);
    }

    window.initOldApiGlobal = () => {
        const keys = risuai._getOldKeys()
        for(const key of keys){
            window[key] = risuai[key];
        }
    }

    Object.freeze(window.postMessage);
})();
`;

export class SandboxHost {
    private iframe: HTMLIFrameElement;
    private apiFactory: any;
    private nonce = v4();
    private csp = `connect-src 'none'; script-src 'nonce-${this.nonce}' 'wasm-unsafe-eval'; frame-src 'none'; object-src 'none'; style-src * 'unsafe-inline'; default-src 'none'; img-src * data: blob:; font-src * data: blob:; media-src * data: blob:; base-uri 'none';`;

    private instanceRegistry = new Map<string, any>();
    private refIdCounter = 0;
    private abortControllers = new Map<string, AbortController>();
    private messageHandlerRef: ((event: MessageEvent) => void) | null = null;
    private callbackWrapperCache = new Map<string, Function>();

    private pendingCallbacks = new Map<string, { resolve: Function, reject: Function }>();

    // Teardown hooks for streams bridged over MessagePort. MessagePort has no
    // 'close' event in stable browsers, so without these the other side of an
    // active stream would wait forever once the iframe is gone.
    private activeStreamCleanups = new Set<() => void>();

    private callGate: CallGate | undefined;

    private chunkTransfer: ChunkTransfer | null = null;

    constructor(apiFactory: any, callGate?: CallGate) {
        this.apiFactory = apiFactory;
        this.callGate = callGate;
    }

    public executeInIframe(code: string): Promise<any> {
        return new Promise((resolve, reject) => {
            const reqId = 'exec_' + Math.random().toString(36).substring(2);

            const handler = (event: MessageEvent) => {
                if (event.source !== this.iframe.contentWindow) return;
                const data = event.data;

                if (data.type === 'EXEC_RESULT' && data.reqId === reqId) {
                    window.removeEventListener('message', handler);
                    if (data.error) {
                        reject(new Error(data.error));
                    } else {
                        resolve(data.result);
                    }
                }
            };

            window.addEventListener('message', handler);

            this.iframe.contentWindow?.postMessage({
                type: 'EXECUTE_CODE',
                reqId,
                code
            }, '*');
        });
    }

    private collectTransferables(obj: any, transferables: Transferable[] = []): Transferable[] {
        if (!obj || typeof obj !== 'object') return transferables;

        if (obj instanceof ArrayBuffer ||
            obj instanceof MessagePort ||
            obj instanceof ImageBitmap ||
            obj instanceof WritableStream ||
            obj instanceof TransformStream ||
            (typeof OffscreenCanvas !== 'undefined' && obj instanceof OffscreenCanvas)) {
            transferables.push(obj);
        }
        else if (ArrayBuffer.isView(obj) && obj.buffer instanceof ArrayBuffer) {
            transferables.push(obj.buffer);
        }
        else if (Array.isArray(obj)) {
            obj.forEach(item => this.collectTransferables(item, transferables));
        }
        else if (obj.constructor === Object) {
            Object.values(obj).forEach(value => this.collectTransferables(value, transferables));
        }

        return transferables;
    }


    private serialize(val: any): any {
        if (
            val &&
            (typeof val === 'object' || typeof val === 'function') &&
            val.__classType === 'REMOTE_REQUIRED'
        ) {
            if (val === null) return null;
            if (Array.isArray(val)) return val;


            const id = 'ref_' + (++this.refIdCounter);
            this.instanceRegistry.set(id, val);
            return { __type: 'REMOTE_REF', id } as RemoteRef;
        }

        if(val instanceof Response) {
            return {
                __type: 'CALLBACK_STREAMS',
                __specialType: 'Response',
                value: val.body,
                init: {
                    status: val.status,
                    statusText: val.statusText,
                    headers: Array.from(val.headers.entries())
                }
            };
        }

        if(
            val instanceof WritableStream
            || val instanceof TransformStream
        ) {
            return {
                __type: 'CALLBACK_STREAMS',
                __specialType: 'none',
                value: val
            };
        }
        return val;
    }


    private deserializeArgs(args: any[], usedAbortIds?: string[]) {
        return args.map(arg => {
            if (arg && arg.__type === 'CALLBACK_REF') {
                const cbRef = arg as CallbackRef;

                const cached = this.callbackWrapperCache.get(cbRef.id);
                if (cached) return cached;

                const wrapper = async (...innerArgs: any[]) => {
                    return new Promise((resolve, reject) => {
                        const reqId = 'cb_req_' + Math.random().toString(36).substring(2);
                        this.pendingCallbacks.set(reqId, { resolve, reject });

                        // AbortSignal cannot be structured-cloned for postMessage.
                        // Convert to a serializable ref and forward abort events
                        // via a separate ABORT_SIGNAL message.
                        const sanitizedArgs = innerArgs.map(arg => {
                            if (arg instanceof AbortSignal) {
                                const abortId = 'abort_' + Math.random().toString(36).substring(2);
                                const ref: AbortSignalRef = {
                                    __type: 'ABORT_SIGNAL_REF',
                                    abortId,
                                    aborted: arg.aborted
                                };
                                if (!arg.aborted) {
                                    arg.addEventListener('abort', () => {
                                        try {
                                            this.iframe.contentWindow?.postMessage({
                                                type: 'ABORT_SIGNAL',
                                                abortId
                                            } as RpcMessage, '*');
                                        } catch (_) { /* iframe already removed */ }
                                    }, { once: true });
                                }
                                return ref;
                            }
                            return this.serialize(arg);
                        });

                        const message = {
                            type: 'INVOKE_CALLBACK',
                            id: cbRef.id,
                            reqId,
                            args: sanitizedArgs
                        };
                        const transferables = this.collectTransferables(message);
                        this.iframe.contentWindow?.postMessage(message, '*', transferables);
                    });
                };
                this.callbackWrapperCache.set(cbRef.id, wrapper);
                return wrapper;
            }
            if (arg && arg.__type === 'REMOTE_REF') {
                const remoteRef = arg as RemoteRef;
                const instance = this.instanceRegistry.get(remoteRef.id);
                if (instance) {
                    return instance;
                }
                throw new Error("Instance not found or released");
            }
            if (arg && typeof arg === 'object' && arg.constructor === Object) {
                let out: any = null;
                for (const [key, val] of Object.entries<any>(arg)) {
                    if (val && val.__type === 'ABORT_SIGNAL_REF') {
                        if (!out) out = { ...arg };
                        const abortRef = val as AbortSignalRef, controller = new AbortController();

                        if (abortRef.aborted) controller.abort();
                        else this.abortControllers.set(abortRef.abortId, controller);

                        usedAbortIds?.push(abortRef.abortId);
                        out[key] = controller.signal;
                    }
                }
                if (out) return out;
            }
            return arg;
        });
    }

    private replaceStreamsWithPorts(obj: any): { result: any, ports: MessagePort[], cleanups: (() => void)[] } {
        const ports: MessagePort[] = [];
        const cleanups: (() => void)[] = [];
        if (!obj || typeof obj !== 'object') return { result: obj, ports, cleanups };

        const replace = (val: any): any => {
            if (!(val instanceof ReadableStream)) return val;

            const ch = new MessageChannel();
            ports.push(ch.port2);

            const reader = val.getReader();
            let credits = 0;
            let reading = false;
            let finished = false;

            const finish = () => {
                finished = true;
                ch.port1.onmessage = null;
                ch.port1.close();
                this.activeStreamCleanups.delete(cleanup);
            };

            const cleanup = () => {
                reader.cancel().catch(() => {});
                finish();
            };
            this.activeStreamCleanups.add(cleanup);
            cleanups.push(cleanup);

            const pump = async () => {
                if (reading || finished) return;
                reading = true;
                try {
                    while (credits > 0 && !finished) {
                        credits--;
                        const { done, value } = await reader.read();
                        if (finished) return;
                        if (done) { ch.port1.postMessage({ done: true }); finish(); return; }
                        ch.port1.postMessage({ done: false, value });
                    }
                } catch (e: any) {
                    try { ch.port1.postMessage({ done: true, error: e.message }); } catch(_) {}
                    finish();
                } finally {
                    reading = false;
                }
            };

            ch.port1.onmessage = (e: MessageEvent) => {
                if (e.data?.cancel) {
                    reader.cancel();
                    finish();
                } else if (e.data?.pull) {
                    credits++;
                    pump();
                }
            };

            return { __type: 'STREAM_PORT', portIndex: ports.length - 1 };
        };

        if (obj instanceof ReadableStream) return { result: replace(obj), ports, cleanups };
        if (obj.constructor === Object) {
            const out: any = {};
            for (const k of Object.keys(obj)) out[k] = replace(obj[k]);
            return { result: out, ports, cleanups };
        }

        return { result: obj, ports, cleanups };
    }

    private reconstructStreamsFromPorts(obj: any, ports: readonly MessagePort[]): any {
        if (!obj || typeof obj !== 'object') return obj;

        const reconstruct = (val: any): any => {
            if (val?.__type !== 'STREAM_PORT' || typeof val.portIndex !== 'number') return val;

            const port = ports[val.portIndex];
            if (!port) throw new Error(`Stream port at index ${val.portIndex} not received`);

            const cleanups = this.activeStreamCleanups;
            let cleanup: (() => void) | null = null;
            const unregister = () => {
                if (cleanup) {
                    cleanups.delete(cleanup);
                    cleanup = null;
                }
            };

            return new ReadableStream({
                start(controller) {
                    port.onmessage = (e: MessageEvent) => {
                        if (e.data.done) {
                            if (e.data.error) controller.error(new Error(e.data.error));
                            else controller.close();
                            port.onmessage = null;
                            port.close();
                            unregister();
                        } else {
                            controller.enqueue(e.data.value);
                        }
                    };
                    cleanup = () => {
                        controller.error(new Error('Sandbox terminated'));
                        port.onmessage = null;
                        port.close();
                    };
                    cleanups.add(cleanup);
                },
                pull() {
                    port.postMessage({ pull: true });
                },
                cancel() {
                    port.postMessage({ cancel: true });
                    port.onmessage = null;
                    port.close();
                    unregister();
                }
            });
        };

        if (obj.__type === 'STREAM_PORT') return reconstruct(obj);
        if (obj.constructor === Object) {
            const out: any = {};
            for (const k of Object.keys(obj)) out[k] = reconstruct(obj[k]);
            return out;
        }

        return obj;
    }

    private closeActiveStreams() {
        for (const cleanup of [...this.activeStreamCleanups]) {
            try { cleanup(); } catch(_) {}
        }
        this.activeStreamCleanups.clear();
    }

    private async handleCall(data: RpcMessage & { type: 'CALL_ROOT' | 'CALL_INSTANCE' }): Promise<void> {
        const response: RpcMessage = { type: 'RESPONSE', reqId: data.reqId };
        const usedAbortIds: string[] = [];
        let transferables: Transferable[] = [];
        let streamCleanups: (() => void)[] = [];

        const rollbackStreams = () => {
            for (const cleanup of streamCleanups) {
                try { cleanup(); } catch(_) {}
            }
            streamCleanups = [];
        };

        const rec = MEASURE ? startPluginRecord('bridge') : null;
        rec?.set('method', String(data.method));
        const endInFlight = beginChokePoint('pluginBridge');
        try {

            // The gate, the arguments and the target are all resolved in the arrival task; only the wait follows,
            // so a RELEASE_INSTANCE or ABORT_SIGNAL that arrives meanwhile cannot overtake this call.
            const gate = this.callGate?.(data.type, String(data.method)) ?? null;
            const args = this.deserializeArgs(data.args || [], usedAbortIds);
            rec?.lap('deserializeMs');
            let result: any;


            if (data.type === 'CALL_ROOT') {
                const fn = this.apiFactory[data.method!];
                if (typeof fn !== 'function') throw new Error(`API method ${data.method} not found`);
                if (gate) await gate;
                result = await fn(...args);
            } else {
                const instance = this.instanceRegistry.get(data.id!);
                if (!instance) throw new Error("Instance not found or released");
                if (typeof instance[data.method!] !== 'function') throw new Error(`Method ${data.method} missing on instance`);
                if (gate) await gate;
                result = await instance[data.method!](...args);
            }
            rec?.lap('fnMs');


            // Tested on the raw result: replaceStreamsWithPorts returns a new object for a plain result.
            const plainResult = isPlainResult(result);
            response.result = this.serialize(result);
            const { result: streamResult, ports: streamPorts, cleanups } = this.replaceStreamsWithPorts(response.result);
            response.result = streamResult;
            streamCleanups = cleanups;
            rec?.lap('serializeMs');
            if (plainResult) {
                // Structured-clone data holds nothing to transfer but the stream ports.
                transferables = streamPorts;
            } else {
                transferables = this.collectTransferables(response, streamPorts);
                rec?.lap('collectTransferablesMs');
                rec?.add('collectTransferablesCalls');
            }

        } catch (err: any) {
            rollbackStreams();
            delete response.result;
            response.error = err?.message || String(err || "Host execution error");
            rec?.set('failed', true);
        } finally {
            endInFlight();
            for (const id of usedAbortIds) this.abortControllers.delete(id);
        }

        rec?.restart();
        try {
            // The structured-clone serialisation of the response runs inside this synchronous call.
            this.iframe.contentWindow?.postMessage(response, '*', transferables);
            rec?.lap('postMessageMs');
            rec?.finish();
        } catch (error) {
            rec?.lap('postMessageMs');
            rec?.set('postFailed', true);
            rec?.finish();
            rollbackStreams();
            try {
                this.iframe.contentWindow?.postMessage({
                    type: 'RESPONSE',
                    reqId: data.reqId,
                    error: 'Failed to post message to iframe: ' + ((error as any)?.message || String(error || "Unknown error"))
                }, '*');
            } catch(_) {}
            console.error('Failed to post message to iframe:', error);
        }
    }

    private postChunkError(reqId: string, error: string) {
        try {
            this.iframe.contentWindow?.postMessage({ type: 'RESPONSE', reqId, error } as RpcMessage, '*');
        } catch (_) { /* iframe already removed */ }
    }

    /** Ends the open transfer without a RESPONSE: its timer and its choke point are released. */
    private dropChunkTransfer() {
        const transfer = this.chunkTransfer;
        if (!transfer) return;
        this.chunkTransfer = null;
        clearInterval(transfer.timer);
        transfer.endChokePoint();
    }

    private failChunkTransfer(transfer: ChunkTransfer, error: string) {
        this.dropChunkTransfer();
        this.postChunkError(transfer.reqId, error);
    }

    /** Validates the layout of a chunked write; null when it is malformed. */
    private parseChunkLayout(raw: unknown): ChunkLayoutEntry[] | null {
        if (!Array.isArray(raw) || raw.length > CHUNK_MAX_LAYOUT) return null;
        const keys = new Set<string>();
        const layout: ChunkLayoutEntry[] = [];
        for (let i = 0; i < raw.length; i++) {
            const entry: unknown = raw[i];
            if (!entry || typeof entry !== 'object') return null;
            const key = (entry as { key?: unknown }).key;
            if (typeof key !== 'string' || keys.has(key)) return null;
            keys.add(key);
            if (Object.prototype.hasOwnProperty.call(entry, 'split')) {
                const split = (entry as { split?: unknown }).split;
                if (typeof split !== 'number' || !Number.isSafeInteger(split) || split < 0) return null;
                layout.push({ key, split, value: undefined });
            } else {
                layout.push({ key, split: null, value: (entry as { value?: unknown }).value });
            }
        }
        return layout;
    }

    private chunkBegin(data: RpcMessage) {
        const reqId = data.reqId;
        if (typeof reqId !== 'string') return;
        if (this.chunkTransfer) {
            this.postChunkError(reqId, 'Another chunked write is already open');
            return;
        }
        const pieces = data.pieces;
        const layout = this.parseChunkLayout(data.layout);
        if (typeof data.method !== 'string' || !CHUNK_METHODS.has(data.method)
            || typeof pieces !== 'number' || !Number.isInteger(pieces) || pieces < 1 || pieces > CHUNK_MAX_PIECES
            || !layout) {
            this.postChunkError(reqId, 'Malformed chunked write');
            return;
        }
        const transfer: ChunkTransfer = {
            reqId,
            method: data.method,
            layout,
            // Never sized from a declared length: items are appended as they arrive.
            slots: layout.map((entry) => (entry.split === null ? null : [])),
            pieces,
            nextSeq: 0,
            timer: setInterval(() => {
                if (transfer.activity > 0) {
                    transfer.activity = 0;
                    transfer.quietFires = 0;
                    return;
                }
                transfer.quietFires += 1;
                if (transfer.quietFires >= 2 && this.chunkTransfer === transfer) {
                    this.failChunkTransfer(transfer, 'Chunked write timed out');
                }
            }, CHUNK_IDLE_MS),
            activity: 0,
            quietFires: 0,
            endChokePoint: beginChokePoint('pluginBridge'),
        };
        this.chunkTransfer = transfer;
    }

    private chunkPiece(data: RpcMessage) {
        const transfer = this.chunkTransfer;
        if (!transfer || transfer.reqId !== data.reqId) return;
        const seq = data.seq;
        const slot = data.slot;
        const items = data.items;
        if (typeof seq !== 'number' || seq !== transfer.nextSeq || seq >= transfer.pieces) {
            this.failChunkTransfer(transfer, 'Chunked write piece out of order');
            return;
        }
        if (typeof slot !== 'number' || !Number.isInteger(slot) || slot < 0 || slot >= transfer.layout.length) {
            this.failChunkTransfer(transfer, 'Chunked write piece has no such slot');
            return;
        }
        const target = transfer.slots[slot];
        const declared = transfer.layout[slot].split;
        if (!target || declared === null || !Array.isArray(items)) {
            this.failChunkTransfer(transfer, 'Chunked write piece is malformed');
            return;
        }
        if (target.length + items.length > declared) {
            this.failChunkTransfer(transfer, 'Chunked write piece overflows its array');
            return;
        }
        for (let i = 0; i < items.length; i++) target.push(items[i]);
        transfer.nextSeq += 1;
    }

    private async chunkEnd(data: RpcMessage) {
        const transfer = this.chunkTransfer;
        if (!transfer || transfer.reqId !== data.reqId) return;
        if (transfer.nextSeq !== transfer.pieces) {
            this.failChunkTransfer(transfer, 'Chunked write ended before all pieces arrived');
            return;
        }
        const out: Record<string, unknown> = {};
        for (let i = 0; i < transfer.layout.length; i++) {
            const entry = transfer.layout[i];
            const slotItems = transfer.slots[i];
            if (entry.split !== null && (!slotItems || slotItems.length !== entry.split)) {
                this.failChunkTransfer(transfer, 'Chunked write array is incomplete');
                return;
            }
            // defineProperty keeps an own "__proto__", undefined values and key order that plain assignment would alter.
            Object.defineProperty(out, entry.key, {
                value: entry.split === null ? entry.value : slotItems,
                writable: true,
                enumerable: true,
                configurable: true,
            });
        }
        const { reqId, method } = transfer;
        // handleCall starts its own choke point in this task, so the transfer's can end after it.
        const call = this.handleCall({ type: 'CALL_ROOT', reqId, method, args: [out] });
        this.dropChunkTransfer();
        await call;
    }

    public run(container: HTMLElement|HTMLIFrameElement, userCode: string) {
        if(container instanceof HTMLIFrameElement) {
            this.iframe = container;
        } else {
            this.iframe = document.createElement('iframe');
            container.appendChild(this.iframe);
        }

        this.iframe.style.width = "100%";
        this.iframe.style.height = "100%";
        this.iframe.style.border = "none";

        this.iframe.style.backgroundColor = "transparent";
        this.iframe.setAttribute('allowTransparency', 'true');

        this.iframe.sandbox.add('allow-scripts');
        this.iframe.sandbox.add('allow-modals')
        this.iframe.sandbox.add('allow-downloads')

        this.iframe.setAttribute('csp', this.csp);

        const messageHandler = async (event: MessageEvent) => {
            if (event.source !== this.iframe.contentWindow) return;
            const data = event.data as RpcMessage;
            if (this.chunkTransfer) this.chunkTransfer.activity += 1;

            if (data.type === 'CHUNK_BEGIN') {
                this.chunkBegin(data);
                return;
            }
            if (data.type === 'CHUNK_PIECE') {
                this.chunkPiece(data);
                return;
            }
            if (data.type === 'CHUNK_END') {
                await this.chunkEnd(data);
                return;
            }
            if (data.type === 'CHUNK_ABORT') {
                if (this.chunkTransfer && this.chunkTransfer.reqId === data.reqId) this.dropChunkTransfer();
                return;
            }


            if (data.type === 'CALLBACK_RETURN') {
                const req = this.pendingCallbacks.get(data.reqId!);
                if (req) {
                    if (data.error) req.reject(new Error(data.error));
                    else {
                        try {
                            req.resolve(this.reconstructStreamsFromPorts(data.result, event.ports));
                        } catch (e) {
                            req.reject(e);
                        }
                    }
                    this.pendingCallbacks.delete(data.reqId!);
                }
                return;
            }

            if (data.type === 'ABORT_SIGNAL') {
                const controller = this.abortControllers.get(data.abortId!);
                if (controller) {
                    controller.abort();
                    this.abortControllers.delete(data.abortId!);
                }
                return;
            }


            if (data.type === 'RELEASE_INSTANCE') {
                if (data.id) this.instanceRegistry.delete(data.id!);
                if (Array.isArray(data.ids)) for (const id of data.ids) this.instanceRegistry.delete(id);
                return;
            }


            if (data.type === 'CALL_ROOT' || data.type === 'CALL_INSTANCE') {
                await this.handleCall(data as RpcMessage & { type: 'CALL_ROOT' | 'CALL_INSTANCE' });
            }
        };

        this.messageHandlerRef = messageHandler;
        window.addEventListener('message', this.messageHandlerRef);


        const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="${this.csp}" id="csp-meta">
      </head>
      <body>
        <style>
            body {
                background-color: transparent;
            }
        </style>
        <script nonce="${this.nonce}">
            document.querySelector('meta#csp-meta')?.remove();
            (async () => {
                ${GUEST_BRIDGE_SCRIPT}
                    
                (async () => {
                    ${userCode}
                })()
            })();
        </script>
      </body>
      </html>
    `;

        this.iframe.srcdoc = html;

        return () => {
            this.terminate();
        };
    }

    public terminate() {
        this.dropChunkTransfer();
        if (this.messageHandlerRef) {
            window.removeEventListener('message', this.messageHandlerRef);
            this.messageHandlerRef = null;
        }
        if (this.iframe) {
            this.iframe.remove();
        }
        this.closeActiveStreams();
        this.instanceRegistry.clear();
        this.pendingCallbacks.clear();
        this.abortControllers.clear();
        this.callbackWrapperCache.clear();
    }
}
