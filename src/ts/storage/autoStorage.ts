import localforage from "localforage"
import { tabPresenceLockAcquired, recordStorageEpoch } from "../globalApi.svelte"
import { isNodeServer } from "src/ts/platform"
import { NodeStorage } from "./nodeStorage"
import type { StorageTabLocks } from "./storageTabLocks"

/**
 * The storage object `globalApi.svelte.ts` exports as `forageStorage`. It picks
 * the Node server client on a self-hosted build and the plain LocalForage
 * instance on every other web build. It never picks OPFS: a web profile whose
 * main store is still OPFS is brought back to IndexedDB, or kept on OPFS with a
 * notice, by the page's byte store (`store/appStore.ts`, `opfsCopyBack.ts`).
 */
export class AutoStorage{
    /** Set once, in `Init()`, from a stale RisuAccount-sync profile's leftover `localStorage` flag. Boot (`loadData()` in `bootstrap.ts`) reads this to decide whether to show the stale-profile notice; `Init()` itself never acts on it. */
    staleAccountProfile:boolean = false

    realStorage:LocalForage|NodeStorage

    /**
     * The lock instance this AutoStorage was built against, or `undefined`
     * to default to production's single global instance (see
     * `storageTabLocks.ts`'s single-instance rule) -- read lazily, inside
     * `Init()`, never captured at construction time, since `forageStorage`
     * is constructed at module-evaluation time in `globalApi.svelte.ts`,
     * before that module's own `tabPresenceLockAcquired`/
     * `recordStorageEpoch` bindings exist yet.
     */
    private readonly injectedLocks?: StorageTabLocks

    /**
     * The single in-flight Init() run, so a second caller in this tab never
     * runs the decision twice. A rejection is kept for the life of the page
     * and nothing here retries the boot.
     */
    private initPromise: Promise<void> | null = null

    constructor(locks?: StorageTabLocks) {
        this.injectedLocks = locks
    }

    async setItem(key:string, value:Uint8Array):Promise<void> {
        await this.Init()
        await this.realStorage.setItem(key, value)
    }
    async getItem(key:string):Promise<Buffer> {
        await this.Init()
        return await this.realStorage.getItem(key)

    }
    async keys():Promise<string[]>{
        await this.Init()
        return await this.realStorage.keys()

    }
    async removeItem(key:string){
        await this.Init()
        return await this.realStorage.removeItem(key)
    }

    async Init(): Promise<void> {
        if(this.realStorage){
            return
        }
        if(!this.initPromise){
            this.initPromise = this.runInit()
        }
        return this.initPromise
    }

    /**
     * Runs the backend decision, then takes a fresh storage-epoch reading.
     * A page whose `Init()` rejected therefore keeps no reading of its own.
     */
    private async runInit(): Promise<void> {
        await this.decideBackend()
        ;(this.injectedLocks?.recordStorageEpoch ?? recordStorageEpoch)?.()
    }

    private async decideBackend(): Promise<void> {
        // Waits for this tab's own shared cross-tab presence lock to actually
        // be granted first, so a tab that opens while another tab holds the
        // exclusive storage-migration lock (the copy back from OPFS in
        // `opfsCopyBack.ts`) waits here until that tab releases and then
        // reads the settled outcome. Read lazily off the injected instance or
        // the production default -- never captured at construction time,
        // since `forageStorage` is constructed at module-evaluation time in
        // `globalApi.svelte.ts`, before that module's own export of this is
        // initialized yet.
        await (this.injectedLocks?.tabPresenceLockAcquired ?? tabPresenceLockAcquired)
        // A returning RisuAccount-sync profile leaves this flag set. Detection
        // only records it for boot to act on later; it never changes which
        // backend this platform lands on, and never touches the flag itself.
        this.staleAccountProfile = localStorage.getItem('accountst') === 'able'
        if(isNodeServer){
            console.log("using node storage")
            this.realStorage = new NodeStorage()
            return
        }
        console.log("using forage storage")
        this.realStorage = localforage.createInstance({
            name: "risuai"
        })
    }

    listItem = this.keys
}
