// Preload for the Node server's revision-log tests (`node --require <this file>
// server.cjs`). It injects I/O failures into the two revision files, driven by
// marker files in the server's working directory so a test can switch a fault
// on and off without restarting the server:
//
//   inject-append-fail   one shot: the next append to __revisions.log writes
//                        the first half of its bytes, then fails; the marker
//                        is removed.
//   inject-rename-fail   while present: every rename onto __revisions.json
//                        fails, through both the synchronous module (startup
//                        compaction) and the promise module (runtime
//                        compaction). Each attempt adds a line to
//                        rename-attempts.txt.
//   inject-read-fail     while present: reading __revisions.log fails with
//                        EACCES.
const fs = require('fs')
const path = require('path')

const markerPath = (name) => path.join(process.cwd(), name)
const hasMarker = (name) => fs.existsSync(markerPath(name))
const isRevisionLog = (file) => path.basename(String(file)) === '__revisions.log'
const isRevisionSnapshot = (file) => path.basename(String(file)) === '__revisions.json'

function failSnapshotRename(target) {
    fs.appendFileSync(markerPath('rename-attempts.txt'), `${path.basename(String(target))}\n`)
    throw Object.assign(new Error('injected snapshot rename failure'), { code: 'EIO' })
}

const originalAppend = fs.promises.appendFile
fs.promises.appendFile = async function (file, data, ...rest) {
    if (isRevisionLog(file) && hasMarker('inject-append-fail')) {
        fs.unlinkSync(markerPath('inject-append-fail'))
        const text = String(data)
        await originalAppend.call(this, file, text.slice(0, Math.ceil(text.length / 2)), ...rest)
        throw Object.assign(new Error('injected append failure'), { code: 'EIO' })
    }
    return originalAppend.call(this, file, data, ...rest)
}

const originalRename = fs.promises.rename
fs.promises.rename = async function (from, to, ...rest) {
    if (isRevisionSnapshot(to) && hasMarker('inject-rename-fail')) {
        failSnapshotRename(to)
    }
    return originalRename.call(this, from, to, ...rest)
}

const originalRenameSync = fs.renameSync
fs.renameSync = function (from, to, ...rest) {
    if (isRevisionSnapshot(to) && hasMarker('inject-rename-fail')) {
        failSnapshotRename(to)
    }
    return originalRenameSync.call(this, from, to, ...rest)
}

const originalReadFileSync = fs.readFileSync
fs.readFileSync = function (file, ...rest) {
    if (typeof file === 'string' && isRevisionLog(file) && hasMarker('inject-read-fail')) {
        throw Object.assign(new Error('injected log read failure'), { code: 'EACCES' })
    }
    return originalReadFileSync.call(this, file, ...rest)
}
