import { asBuffer } from "../util";

export class OpfsStorage{

    opfs:FileSystemDirectoryHandle

    async setItem(key:string, value:Uint8Array) {
        await this.Init()
        const handle = await this.opfs.getFileHandle(Buffer.from(key, 'utf-8').toString('hex'), {
            create: true
        })
        const stream = await handle.createWritable()
        try {
            await stream.write(asBuffer(value))
        } catch (error) {
            // Under the File System spec's entry lock, a still-open writable
            // can block removeEntry() on this same file -- best-effort abort()
            // it before rethrowing, which may let a caller cleaning up this key
            // remove it. A write that already errored the stream is not
            // helped. Any error from abort() itself is not the original
            // failure and is dropped.
            try {
                await stream.abort()
            } catch {
                // ignored: the original write error is what matters
            }
            throw error
        }
        await stream.close()
    }
    async getItem(key:string):Promise<Buffer> {
        try {
            await this.Init()
            const handle = await this.opfs.getFileHandle(Buffer.from(key, 'utf-8').toString('hex'), {
                create: false
            })
            const stream = await handle.getFile();
    
            return Buffer.from(await stream.arrayBuffer())   
        } catch (error) {
            if(error instanceof DOMException){
                if(error.name === "NotFoundError"){
                    return null
                }
            }
            throw error
        }
    }
    async keys():Promise<string[]>{
        await this.Init()
        let entries:string[] = []
        for await (const entry of this.opfs.values()) {
            // Legacy cold-storage units sit as `coldstorage_<key>.json` files
            // in this same OPFS root (`getDirectory()` returns the origin
            // root to every caller), never hex-encoded, and are only read and
            // deleted. A name only this class
            // itself ever wrote round-trips back to the same hex string on
            // re-encode, so a foreign name is excluded here rather than
            // surfacing as a garbage "key".
            const decoded = Buffer.from(entry.name, 'hex').toString('utf-8')
            if(Buffer.from(decoded, 'utf-8').toString('hex') === entry.name){
                entries.push(decoded)
            }
        }
        return entries
    }
    async removeItem(key:string){
        try {
            await this.Init()
            await this.opfs.removeEntry(Buffer.from(key, 'utf-8').toString('hex'))
        } catch (error) {
            if(error instanceof DOMException){
                if(error.name === "NotFoundError"){
                    return null
                }
            }
            throw error
        }
    }

    private async Init(){
        if(!this.opfs){
            this.opfs = await window.navigator.storage.getDirectory()
        }
    }

    listItem = this.keys
}