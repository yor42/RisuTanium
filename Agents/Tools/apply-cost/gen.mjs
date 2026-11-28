import fs from 'node:fs'; import zlib from 'node:zlib'; import crypto from 'node:crypto'; import path from 'node:path'
const out = process.argv[2]; fs.mkdirSync(out, { recursive: true })
function zip(entries) { // entries: [name, Buffer]; stored, no compression
  const locals=[], cds=[]; let off=0
  for (const [name,data] of entries) {
    const nb=Buffer.from(name), crc=zlib.crc32(data)>>>0
    const lh=Buffer.alloc(30); lh.writeUInt32LE(0x04034b50,0); lh.writeUInt16LE(20,4); lh.writeUInt16LE(0,6); lh.writeUInt16LE(0,8); lh.writeUInt16LE(0,10); lh.writeUInt16LE(0x21,12)
    lh.writeUInt32LE(crc,14); lh.writeUInt32LE(data.length,18); lh.writeUInt32LE(data.length,22); lh.writeUInt16LE(nb.length,26); lh.writeUInt16LE(0,28)
    const ch=Buffer.alloc(46); ch.writeUInt32LE(0x02014b50,0); ch.writeUInt16LE(20,4); ch.writeUInt16LE(20,6); ch.writeUInt16LE(0,8); ch.writeUInt16LE(0,10); ch.writeUInt16LE(0,12); ch.writeUInt16LE(0x21,14)
    ch.writeUInt32LE(crc,16); ch.writeUInt32LE(data.length,20); ch.writeUInt32LE(data.length,24); ch.writeUInt16LE(nb.length,28); ch.writeUInt32LE(off,42)
    locals.push(lh,nb,data); cds.push(ch,nb); off+=30+nb.length+data.length
  }
  const cd=Buffer.concat(cds), end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50,0); end.writeUInt16LE(entries.length,8); end.writeUInt16LE(entries.length,10); end.writeUInt32LE(cd.length,12); end.writeUInt32LE(off,16)
  return Buffer.concat([...locals,cd,end])
}
const MiB=1024*1024
function font(size){ const b=crypto.randomBytes(size); b.write('wOF2',0,'latin1'); return b }
function manifest(extra){ return JSON.stringify({ kind:'risutheme', format:1, name:'Synthetic Cap', version:'1.0.0', license:'MIT', attribution:'synthetic', modes:['dark'], ...extra }) }
function pack(label, fontCount, fontSize, images, imgSize, extraRefs) {
  const files=[]; const fonts=[]; let css=''
  for (let i=0;i<fontCount;i++){ const n=`fonts/f${i}.woff2`; files.push([n,font(fontSize)]); fonts.push({file:n,license:'OFL-1.1'}); css+=`@font-face{font-family:"pack-f${i}";src:url("${n}") format("woff2");font-display:swap}\n` }
  for (let i=0;i<images;i++){ const n=`images/i${i}.png`; const b=crypto.randomBytes(imgSize); Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]).copy(b); files.push([n,b]) }
  css+=':root{--chat-message-font:"pack-f0",sans-serif}\n[data-part="chat-message-avatar"]{opacity:1}\n'
  const entries=[['manifest.json',Buffer.from(manifest({fonts}))],['chat.css',Buffer.from(css)],...files]
  const bytes=zip(entries); const h=crypto.createHash('sha256').update(bytes).digest('hex')
  const name=`${label}.tp-${h}.risutheme`; fs.writeFileSync(path.join(out,name),bytes)
  return { label, name, key:`assets/tp-${h}.risutheme`, bytes:bytes.length, entries:entries.length, fonts:fontCount, images }
}
const idx=[]
idx.push(pack('small', 1, 1*MiB, 0, 0))
idx.push(pack('mid', 4, 16*MiB, 0, 0))                 // ~64 MiB
idx.push(pack('bytecap', 16, Math.floor(15.6*MiB), 0, 0)) // ~250 MiB, 16 fonts all named by @font-face
idx.push(pack('entrycap', 8, 20*MiB, 502, Math.floor(0.03*MiB))) // 512 entries; fonts named, images unreferenced
fs.writeFileSync(path.join(out,'index.json'),JSON.stringify(idx,null,1)); console.log(JSON.stringify(idx,null,1))


