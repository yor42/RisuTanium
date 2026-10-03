import { Buffer } from 'buffer';
import crc32 from 'crc/crc32';
import { AppendableBuffer, VirtualWriter, blobToUint8Array } from './byteBuffer';
import type { LocalWriter } from './globalApi.svelte';

class StreamChunkWriter{
    constructor(private data:Uint8Array, private writer:LocalWriter|WritableStreamDefaultWriter<Uint8Array>|VirtualWriter){

    }
    async pushData(data:Uint8Array){
        await this.writer.write(data)
    }
    async init(){
        let pos = 8
        let newData:Uint8Array[] = []


        const data = this.data
        await this.pushData(data.slice(0,8))

        while(pos < data.length){
            const len = data[pos] * 0x1000000 + data[pos+1] * 0x10000 + data[pos+2] * 0x100 + data[pos+3]
            const type = data.slice(pos+4,pos+8)
            const typeString = new TextDecoder().decode(type)
            if(typeString === 'IEND'){
                break
            }
            if(typeString === 'tEXt'){
                const endPos = 12 + len + pos
                //get key
                let key=''
                while(data[pos+8] !== 0){
                    key += String.fromCharCode(data[pos+8])
                    pos++
                    if(pos === endPos || key.length > 6){
                        break
                    }
                }

                if(key !== 'ccv3' && key !== 'chara'){
                    await this.pushData(data.slice(pos,endPos))
                }
                pos = endPos
            }
            else{
                await this.pushData(data.slice(pos,pos+12+len))
                pos += 12 + len
            }
        }
    }
    async write(key:string, val:string|Uint8Array){

        const keyData = new TextEncoder().encode(key)
        const value = Buffer.from(val)
        const lenNum = value.byteLength + keyData.byteLength + 1
        //idk, but uint32array is not working
        const length = new Uint8Array([
            lenNum / 0x1000000 % 0x100,
            lenNum / 0x10000 % 0x100,
            lenNum / 0x100 % 0x100,
            lenNum % 0x100
        ])
        const type = new TextEncoder().encode('tEXt')
        await this.pushData(length)
        await this.pushData(type)
        await this.pushData(keyData)
        await this.pushData(new Uint8Array([0]))
        await this.pushData(value)
        const crc = crc32(Buffer.concat([type,keyData,new Uint8Array([0]),value]))
        await this.pushData(new Uint8Array([
            crc / 0x1000000 % 0x100,
            crc / 0x10000 % 0x100,
            crc / 0x100 % 0x100,
            crc % 0x100
        ]))
    }
    async end() {
        const length = new Uint8Array((new Uint32Array([0])).buffer)
        const type = new TextEncoder().encode('IEND')
        await this.pushData(length)
        await this.pushData(type)
        const crc = crc32(type as Buffer)
        await this.pushData(new Uint8Array([
            crc / 0x1000000 % 0x100,
            crc / 0x10000 % 0x100,
            crc / 0x100 % 0x100,
            crc % 0x100
        ]))
        this.writer.close()
    }
}

//Forward-only read window over a stream: keeps the stream reads that end after the last release() offset,
//and a slice() copies only the requested range. Offsets are absolute positions in the stream.
export class StreamWindow{
    private chunks:Uint8Array[] = []
    private base = 0 //absolute offset of chunks[0]
    private total = 0 //absolute offset just past the last buffered byte
    constructor(private reader:ReadableStreamDefaultReader<Uint8Array>){}
    get bufferedBytes():number{ return this.total - this.base } //bytes of stream reads currently held

    async slice(start:number,end:number):Promise<Uint8Array>{
        while(end > this.total){
            const rs = await this.reader.read()
            if(!rs.value && rs.done){
                return new Uint8Array(0)
            }
            if(!rs.value || rs.value.length === 0){
                continue
            }
            this.chunks.push(rs.value)
            this.total += rs.value.length
        }
        const out = new Uint8Array(end - start)
        let chunkStart = this.base
        let written = 0
        for(const chunk of this.chunks){
            const chunkEnd = chunkStart + chunk.length
            if(chunkEnd > start && chunkStart < end){
                const from = Math.max(start, chunkStart) - chunkStart
                const to = Math.min(end, chunkEnd) - chunkStart
                out.set(chunk.subarray(from, to), written)
                written += to - from
            }
            if(chunkEnd >= end){
                break
            }
            chunkStart = chunkEnd
        }
        return out
    }

    //drops the stream reads that end at or before pos; later slices must start at or after pos
    release(pos:number){
        let drop = 0
        while(drop < this.chunks.length && this.base + this.chunks[drop].length <= pos){
            this.base += this.chunks[drop].length
            drop++
        }
        if(drop > 0){
            this.chunks.splice(0, drop)
        }
    }
}

const TEXT_KEY_SCAN_LIMIT = 70
const IEND_HEADER = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44]
const DEFAULT_SCAN_WINDOW = 256 * 1024

const readUint32 = (b:Uint8Array, at:number) => b[at] * 0x1000000 + b[at+1] * 0x10000 + b[at+2] * 0x100 + b[at+3]

/**
 * Splits a tEXt body into its key and the offset where the value starts. The key ends at the first NUL found at an
 * index below min(body length, 70) and is decoded with the default TextDecoder (a leading BOM is dropped), so a key
 * that decodes differently from its raw bytes is read the same way by every caller. Returns null when no NUL is found.
 * Only the first min(length, 70) bytes of the body are looked at, so a caller may pass just that prefix.
 */
export function readTextChunkKey(body:Uint8Array):{key:string,valueStart:number}|null{
    const limit = Math.min(body.length, TEXT_KEY_SCAN_LIMIT)
    for(let i=0;i<limit;i++){
        if(body[i] === 0){
            return {key: new TextDecoder().decode(body.subarray(0, i)), valueStart: i + 1}
        }
    }
    return null
}

export type PngCardScan = {
    /** tEXt chunks whose key starts with `chara-ext-asset_` and whose whole body is present */
    assetCount: number
    /** a chunk before IEND is cut short, by the per-kind rule of scanCard */
    cut: boolean
    iendReached: boolean
    /** a tEXt chunk keyed `chara` or `ccv3` was seen */
    hasCardData: boolean
}

type ByteSource = {
    size: number
    read: (start:number, end:number) => Promise<Uint8Array>
}

/** `read` must stay inside [0, size]. The returned view is only valid until the next `read`. */
function byteSourceOf(data:File|Uint8Array, windowSize:number):ByteSource{
    if(data instanceof Uint8Array){
        return {size: data.length, read: async (start, end) => data.subarray(start, end)}
    }
    let windowStart = 0
    let windowBytes = new Uint8Array(0)
    return {
        size: data.size,
        read: async (start, end) => {
            if(start < windowStart || end > windowStart + windowBytes.length){
                const to = Math.min(data.size, start + Math.max(windowSize, end - start))
                windowBytes = new Uint8Array(await data.slice(start, to).arrayBuffer())
                windowStart = start
            }
            return windowBytes.subarray(start - windowStart, end - windowStart)
        }
    }
}

export const PngChunk = {
    /**
     * Walks the chunk headers of a PNG of known size without reading chunk bodies, except the first min(length, 70)
     * bytes of each tEXt chunk, and reports how many asset chunks the card has and whether it is complete.
     * A tEXt chunk is complete when its whole body is present (its CRC may be cut); any other chunk before IEND needs
     * its CRC too. With 1 to 7 bytes left at a chunk boundary the file is complete only if they begin an IEND header.
     * IEND ends the walk and bytes after it are ignored. The asset count is the number of asset chunks that
     * readGenerator yields for the same input, whether or not the file is cut.
     * A File is read through windows of `windowSize` bytes; a read that leaves the window loads a new one.
     */
    scanCard: async (data:File|Uint8Array, arg:{windowSize?:number} = {}):Promise<PngCardScan> => {
        const source = byteSourceOf(data, Math.max(1, arg.windowSize ?? DEFAULT_SCAN_WINDOW))
        const size = source.size
        const result:PngCardScan = {assetCount: 0, cut: false, iendReached: false, hasCardData: false}
        let pos = 8
        while(size - pos > 0){
            const left = size - pos
            if(left < 8){
                const rest = await source.read(pos, size)
                for(let i=0;i<rest.length;i++){
                    if(rest[i] !== IEND_HEADER[i]){
                        result.cut = true
                        break
                    }
                }
                break
            }
            const header = await source.read(pos, pos + 8)
            const len = readUint32(header, 0)
            if(new TextDecoder().decode(header.subarray(4, 8)) === 'IEND'){
                result.iendReached = true
                break
            }
            if(header[4] === 0x74 && header[5] === 0x45 && header[6] === 0x58 && header[7] === 0x74){ //tEXt
                if(len > left - 8){
                    result.cut = true
                    break
                }
                const found = readTextChunkKey(await source.read(pos + 8, pos + 8 + Math.min(len, TEXT_KEY_SCAN_LIMIT)))
                if(found){
                    if(found.key === 'chara' || found.key === 'ccv3'){
                        result.hasCardData = true
                    }
                    else if(found.key.startsWith('chara-ext-asset_')){
                        result.assetCount++
                    }
                }
            }
            else if(len > left - 12){
                result.cut = true
                break
            }
            pos += 12 + len
        }
        return result
    },

    read: (data:Uint8Array, chunkName:string[], arg:{checkCrc?:boolean} = {}) => {
        let pos = 8
        let chunks:{[key:string]:string} = {}
        while(pos < data.length){
            const len = data[pos] * 0x1000000 + data[pos+1] * 0x10000 + data[pos+2] * 0x100 + data[pos+3]
            const type = data.slice(pos+4,pos+8)
            const typeString = new TextDecoder().decode(type)
            if(arg.checkCrc){
                const crc = data[pos+8+len] * 0x1000000 + data[pos+9+len] * 0x10000 + data[pos+10+len] * 0x100 + data[pos+11+len]
                const crcCheck = crc32(data.slice(pos+4,pos+8+len) as Buffer)
                if(crc !== crcCheck){
                    throw new Error('crc check failed')
                }
            }
            if(typeString === 'IEND'){
                break
            }
            if(typeString === 'tEXt'){
                const chunkData = data.slice(pos+8,pos+8+len)
                let key=''
                let value=''
                for(let i=0;i<70;i++){
                    if(chunkData[i] === 0){
                        key = new TextDecoder().decode(chunkData.slice(0,i))
                        value = new TextDecoder().decode(chunkData.slice(i + 1))
                        break
                    }
                }
                if(chunkName.includes(key)){
                    chunks[key] = value
                }
            }
            pos += 12 + len
        }
        return chunks
    },

    readGenerator: async function*(data:File|Uint8Array|ReadableStream<Uint8Array>, arg:{checkCrc?:boolean,returnTrimed?:boolean} = {}):AsyncGenerator<
        {key:string,value:string}|AppendableBuffer,null
    >{
        if (data instanceof File) {
            if (typeof data.stream === 'function') {
                data = data.stream();
            } else {
                data = await blobToUint8Array(data);
            }
        }
        const reader = data instanceof ReadableStream ? new StreamWindow(data.getReader()) : null
        const trimedData = new AppendableBuffer()

        function appendTrimed(data:Uint8Array){
            if(arg.returnTrimed){
                trimedData.append(data)
            }
        }

        async function slice(start:number,end:number):Promise<Uint8Array> {
            if(data instanceof Uint8Array){
                return data.slice(start,end)
            }
            else{
                return await reader.slice(start, end)
            }
        }

        

        await appendTrimed(await slice(0,8))
        let pos = 8
        const size = data instanceof Uint8Array ? data.length : Infinity
        while(pos < size){
            reader?.release(pos)
            const dataPart = await slice(pos,pos+4)
            const len = dataPart[0] * 0x1000000 + dataPart[1] * 0x10000 + dataPart[2] * 0x100 + dataPart[3]
            const type = await slice(pos+4,pos+8)
            const typeString = new TextDecoder().decode(type)
            if(arg.checkCrc && !(data instanceof ReadableStream)){ //crc check is not supported for stream
                const dataPart = await slice(pos+8+len,pos+12+len)
                const crc = dataPart[0] * 0x1000000 + dataPart[1] * 0x10000 + dataPart[2] * 0x100 + dataPart[3]
                const crcCheck = crc32(await slice(pos+4,pos+8+len) as Buffer)
                if(crc !== crcCheck){
                    throw new Error('crc check failed')
                }
            }
            if(typeString === 'IEND'){
                await appendTrimed(await slice(pos,pos+12+len))
                break
            }
            else if(typeString === 'tEXt'){
                const chunkData = await slice(pos+8,pos+8+len)
                let key=''
                let value=''
                //a body that runs past the end of the input never yields a partial value
                const found = chunkData.length < len ? null : readTextChunkKey(chunkData)
                if(found){
                    key = found.key
                    value = new TextDecoder().decode(chunkData.subarray(found.valueStart))
                }
                yield {key,value}
            }
            else{
                await appendTrimed(await slice(pos,pos+12+len))
            }
            pos += 12 + len
        }
        if(arg.returnTrimed){
            yield trimedData
        }
        return null
    },

    trim: (data:Uint8Array) => {
        let pos = 8
        let newData:Uint8Array[] = []
        while(pos < data.length){
            const len = data[pos] * 0x1000000 + data[pos+1] * 0x10000 + data[pos+2] * 0x100 + data[pos+3]
            const type = data.slice(pos+4,pos+8)
            const typeString = new TextDecoder().decode(type)
            if(typeString === 'IEND'){
                newData.push(data.slice(pos,pos+12+len))
                break
            }
            if(typeString === 'tEXt'){
                pos += 12 + len
            }
            else{
                newData.push(data.slice(pos,pos+12+len))
                pos += 12 + len
            }
        }
        newData.push(data.slice(pos))
        return Buffer.concat(newData)
    },


    write: async (data:Uint8Array, chunks:{[key:string]:string}, options:{writer?:LocalWriter} = {}):Promise<void | Buffer> => {
        let pos = 8
        let newData:Uint8Array[] = []

        async function pushData(data:Uint8Array){
            if(options.writer){
                await options.writer.write(data)
            }
            else{
                newData.push(data)
            }
        }

        await pushData(data.slice(0,8))

        while(pos < data.length){
            const len = data[pos] * 0x1000000 + data[pos+1] * 0x10000 + data[pos+2] * 0x100 + data[pos+3]
            const type = data.slice(pos+4,pos+8)
            const typeString = new TextDecoder().decode(type)
            if(typeString === 'IEND'){
                break
            }
            if(typeString === 'tEXt'){
                pos += 12 + len
            }
            else{
                await pushData(data.slice(pos,pos+12+len))
                pos += 12 + len
            }
        }
        for(const key in chunks){
            const keyData = new TextEncoder().encode(key)
            const value = Buffer.from(chunks[key])
            const lenNum = value.byteLength + keyData.byteLength + 1
            //idk, but uint32array is not working
            const length = new Uint8Array([
                lenNum / 0x1000000 % 0x100,
                lenNum / 0x10000 % 0x100,
                lenNum / 0x100 % 0x100,
                lenNum % 0x100
            ])
            const type = new TextEncoder().encode('tEXt')
            await pushData(length)
            await pushData(type)
            await pushData(keyData)
            await pushData(new Uint8Array([0]))
            await pushData(value)
            const crc = crc32(Buffer.concat([type,keyData,new Uint8Array([0]),value]))
            await pushData(new Uint8Array([
                crc / 0x1000000 % 0x100,
                crc / 0x10000 % 0x100,
                crc / 0x100 % 0x100,
                crc % 0x100
            ]))
        }
        //create IEND chunk
        {
            const length = new Uint8Array((new Uint32Array([0])).buffer)
            const type = new TextEncoder().encode('IEND')
            await pushData(length)
            await pushData(type)
            const crc = crc32(type as Buffer)
            await pushData(new Uint8Array([
                crc / 0x1000000 % 0x100,
                crc / 0x10000 % 0x100,
                crc / 0x100 % 0x100,
                crc % 0x100
            ]))
        }

        if(options.writer){
            await options.writer.close()
        }
        else{
            return Buffer.concat(newData)
        }
    },
    streamWriter: StreamChunkWriter
}
