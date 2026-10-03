import { language } from "src/lang"
import { alertError, alertInput, waitAlert } from "../alert"
import { base64url, getKeypairStore, saveKeypairStore } from "../util"

/**
 * Thrown by NodeStorage.setItem() when the self-hosted Node server rejects a
 * write because the revision it was based on has moved (HTTP 409) — i.e.
 * another writer has saved this key since this client last read it. Distinct
 * from the generic "setItem Error" thrown for any other failure so callers
 * (saveDb()) can react differently: a conflict is an expected, recoverable
 * state, not a transient I/O failure worth blindly retrying the same write.
 */
export class NodeStorageConflictError extends Error {
    constructor(public readonly currentRevision: number | undefined) {
        super('NodeStorage write rejected: local revision is out of date with the server.')
        this.name = 'NodeStorageConflictError'
    }
}

/**
 * Whether this page has been authenticated against the Node server, and the
 * check in flight. One state serves every entry point of a page (the storage
 * class, the store built over it, the proxy-auth path), so a page shows at most
 * one password prompt per outcome however many calls start before the first
 * check settles. A failed check is dropped when it settles: the next call asks
 * again.
 */
export interface NodeAuthState {
    checked: boolean
    pending: Promise<void> | null
}

export function createNodeAuthState(): NodeAuthState {
    return { checked: false, pending: null }
}

const pageAuthState = createNodeAuthState()

export class NodeStorage{

    constructor(private readonly auth: NodeAuthState = pageAuthState) {}

    // Last revision this instance observed for each key, from either a
    // getItem() read or a setItem() write's own response. Sent back as
    // if-match-revision on the NEXT setItem() for that key, so the server can
    // tell whether this client's view is still current. Deliberately never
    // updated from a 409 response's reported currentRevision — see setItem()
    // below for why blindly adopting it would defeat the whole check.
    private knownRevisions = new Map<string, number>()
    JSONStringlifyAndbase64Url(obj:any){
        return base64url(Buffer.from(JSON.stringify(obj), 'utf-8'))
    }

    async createAuth(){
        const keyPair = await this.getKeyPair()
        const date = Math.floor(Date.now() / 1000)
        
        const header = {
            alg: "ES256",
            typ: "JWT",   
        }
        const payload = {
            iat: date,
            exp: date + 5 * 60, //5 minutes expiration
            pub: await crypto.subtle.exportKey('jwk', keyPair.publicKey)
        }
        const sig = await crypto.subtle.sign(
            {
                name: "ECDSA",
                hash: "SHA-256"
            },
            keyPair.privateKey,
            Buffer.from(
                this.JSONStringlifyAndbase64Url(header) + "." + this.JSONStringlifyAndbase64Url(payload)
            )
        )
        const sigString = base64url(new Uint8Array(sig))
        return this.JSONStringlifyAndbase64Url(header) + "." + this.JSONStringlifyAndbase64Url(payload) + "." + sigString
    }

    async getProxyAuth() {
        await this.checkAuth()
        const auth = await this.createAuth()
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem('risuauth', auth)
        }
        return auth
    }

    /** The `risu-auth` header value for one request, after the page's auth check has settled. Writes no `localStorage` key. */
    async authHeader() {
        await this.checkAuth()
        return await this.createAuth()
    }

    async getKeyPair():Promise<CryptoKeyPair>{
        
        const storedKey = await getKeypairStore('node')

        if(storedKey){
            return storedKey
        }

        const keyPair = await crypto.subtle.generateKey(
            {
                name: "ECDSA",
                namedCurve: "P-256"
            },
            false,
            ["sign", "verify"],
        );

        await saveKeypairStore('node', keyPair)

        return keyPair

    }

    async setItem(key:string, value:Uint8Array) {
        await this.checkAuth()
        const headers: Record<string, string> = {
            'content-type': 'application/octet-stream',
            'file-path': Buffer.from(key, 'utf-8').toString('hex'),
            'risu-auth': await this.createAuth()
        }
        const knownRevision = this.knownRevisions.get(key)
        if(knownRevision !== undefined){
            headers['if-match-revision'] = String(knownRevision)
        }
        const da = await fetch('/api/write', {
            method: "POST",
            body: value as any,
            headers
        })
        if(da.status === 409){
            const data = await da.json().catch(() => ({}))
            // Deliberately NOT updating knownRevisions to data.currentRevision
            // here: doing so would make the NEXT setItem() attempt for this
            // key send a now-matching if-match-revision header with this
            // SAME (still-stale) content, and the server would accept it —
            // silently overwriting whatever the other writer just saved,
            // exactly the last-write-wins outcome this check exists to
            // prevent. Leaving it stale means every retry keeps correctly
            // failing until a fresh getItem() (e.g. after the user reloads)
            // establishes a real up-to-date revision.
            throw new NodeStorageConflictError(data?.currentRevision)
        }
        if(da.status < 200 || da.status >= 300){
            throw "setItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
        if(typeof data.revision === 'number'){
            this.knownRevisions.set(key, data.revision)
        }
    }
    async getItem(key:string):Promise<Buffer> {
        const { data, revision } = await this.readItem(key)
        if(revision !== undefined){
            this.knownRevisions.set(key, revision)
        }
        return data
    }
    /**
     * Reads `key` without adopting the revision the server reports for it.
     * A reader that is not the writer of `key` uses this so the revision the
     * next `setItem()` sends still reflects what this client last wrote or
     * loaded; `getItem()` would replace it, and a write that another client
     * made in between would then go through instead of conflicting.
     */
    async peekItem(key:string):Promise<Buffer> {
        return (await this.readItem(key)).data
    }
    private async readItem(key:string):Promise<{ data: Buffer, revision: number | undefined }> {
        await this.checkAuth()
        const da = await fetch('/api/read', {
            method: "GET",
            headers: {
                'file-path': Buffer.from(key, 'utf-8').toString('hex'),
                'risu-auth': await this.createAuth()
            }
        })
        if(da.status < 200 || da.status >= 300){
            throw "getItem Error"
        }

        let revision: number | undefined
        const revisionHeader = da.headers.get('x-risu-revision')
        if(revisionHeader !== null){
            const parsed = parseInt(revisionHeader, 10)
            if(Number.isFinite(parsed)){
                revision = parsed
            }
        }

        const data = Buffer.from(await da.arrayBuffer())
        if (data.length == 0){
            return { data: null, revision }
        }
        return { data, revision }
    }
    async keys():Promise<string[]>{
        await this.checkAuth()
        const da = await fetch('/api/list', {
            method: "GET",
            headers:{
                'risu-auth': await this.createAuth()
            }
        })
        if(da.status < 200 || da.status >= 300){
            throw "listItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
        return data.content
    }
    async removeItem(key:string|string[]){
        await this.checkAuth()
        // Each key must be hex-encoded individually, then joined with the plain-text
        // '$$' separator — not the other way around. Hex-encoding the whole joined
        // string produces a single hex blob with no literal '$' characters in it, so
        // the server's header.split('$$') (which runs before any hex-decoding) would
        // never actually find a separator and would treat the entire multi-key
        // request as one nonexistent composite path.
        const keys = Array.isArray(key) ? key : [key]
        const filePath = keys.map(k => Buffer.from(k, 'utf-8').toString('hex')).join('$$')
        // Positionally aligned with filePath's '$$' segments — an empty entry
        // means "no known revision for this key," which the server treats as
        // an unconditional delete for that one key (same back-compat
        // reasoning as setItem() omitting if-match-revision entirely). Server
        // rejects the whole batch with 409 if any key's revision has moved
        // since this client last observed it, rather than silently deleting
        // content it never actually read (e.g. someone else's newer write).
        const revisionHeader = keys
            .map((k) => this.knownRevisions.get(k))
            .map((rev) => rev === undefined ? '' : String(rev))
            .join('$$')
        const da = await fetch('/api/remove', {
            method: "GET",
            headers: {
                'file-path': filePath,
                'if-match-revision': revisionHeader,
                'risu-auth': await this.createAuth()
            }
        })
        // The server keeps advancing each key's revision counter even after
        // deletion (a "tombstone" revision) — NOT forgetting it matters: if
        // this client (or any other) later recreates the same key via
        // setItem(), it needs to present that tombstone as its
        // if-match-revision, or that write would fall back to unconditional
        // and could silently overwrite a DIFFERENT client's own recreation of
        // the key in the meantime. Applied both on success AND on a partial
        // I/O failure after commit (see below) — the server attaches whatever
        // revisions it already committed to that error response too, since
        // leaving the client with no way to learn they moved would strand it
        // presenting stale values indefinitely.
        const applyKnownRevisions = (revisionsByHexKey: Record<string, number> | undefined) => {
            if(!revisionsByHexKey){
                return
            }
            for(const k of keys){
                const hexKey = Buffer.from(k, 'utf-8').toString('hex')
                const revision = revisionsByHexKey[hexKey]
                if(typeof revision === 'number'){
                    this.knownRevisions.set(k, revision)
                }
            }
        }
        if(da.status === 409){
            const data = await da.json().catch(() => ({}))
            throw new NodeStorageConflictError(data?.currentRevision)
        }
        if(da.status < 200 || da.status >= 300){
            const data = await da.json().catch(() => ({}))
            applyKnownRevisions(data?.revisions)
            throw data?.error ?? "removeItem Error"
        }
        const data = await da.json()
        if(data.error){
            throw data.error
        }
        applyKnownRevisions(data.revisions)
    }

    private checkAuth(): Promise<void> {
        const auth = this.auth
        if(auth.checked){
            return Promise.resolve()
        }
        auth.pending ??= this.runAuthCheck().then(
            () => {
                auth.checked = true
                auth.pending = null
            },
            (error) => {
                auth.pending = null
                throw error
            }
        )
        return auth.pending
    }

    /** Registers this browser's key pair with the server under the password digest; a refusal is shown to the user and thrown. */
    private async login(digest: string){
        const keypair = await this.getKeyPair()
        const publicKey = await crypto.subtle.exportKey('jwk', keypair.publicKey)
        const s = await fetch('/api/login',{
            method: "POST",
            body: JSON.stringify({
                password: digest,
                publicKey: publicKey
            }),
            headers: {
                'content-type': 'application/json'
            }
        })
        if(s.status < 200 || s.status >= 300){
            let message = `Login failed (${s.status})`
            try {
                const body = await s.json()
                if(body?.error){
                    message = body.error
                }
            } catch {}
            alertError(message)
            await waitAlert()
            throw message
        }
    }

    private async runAuthCheck(){
        const data = await (await fetch('/api/test_auth',{
            headers: {
                'risu-auth': await this.createAuth()
            }
        })).json()

        if(data.status === 'unset'){
            const digest = await digestPassword(await alertInput(language.setNodePassword))
            const set = await fetch('/api/set_password',{
                method: "POST",
                body:JSON.stringify({
                    password: digest
                }),
                headers: {
                    'content-type': 'application/json'
                }
            })
            if(set.status < 200 || set.status >= 300){
                throw `Setting the password failed (${set.status})`
            }
            // The server knows a key pair only after a login, so the password
            // just set is used once more to register this browser's pair.
            await this.login(digest)
        }
        else if(data.status === 'incorrect'){
            await this.login(await digestPassword(await alertInput(language.inputNodePassword)))
        }
    }

    listItem = this.keys
}

const sharedNodeStorage = new NodeStorage()

export async function getNodeServerProxyAuth() {
    return await sharedNodeStorage.getProxyAuth()
}

async function digestPassword(message:string) {
    const response = await fetch('/api/crypto', {
        body: JSON.stringify({
            data: message
        }),
        headers: {
            'content-type': 'application/json'
        },
        method: "POST"
    })

    if(response.status < 200 || response.status >= 300){
        let message = `Password crypto failed (${response.status})`
        try {
            const body = await response.json()
            if(body?.error){
                message = body.error
            }
        } catch {}
        throw message
    }
    const crypt = await response.text()
    
    return crypt;
}
