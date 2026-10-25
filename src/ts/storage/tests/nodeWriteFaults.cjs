// Preload for the Node server's write-error tests (`node --require <this file>
// server.cjs`). While the marker file `inject-write-fail` exists in the server's
// working directory, every write of a temp file inside the save directory
// (`<hex>.tmp-<random>`, the first step of a key write) is rejected with the
// error code the marker holds (default ENOSPC). The marker is read on every
// write, so a test switches the fault on and off without restarting the server.
const fs = require('fs')
const path = require('path')

const markerPath = path.join(process.cwd(), 'inject-write-fail')
const isKeyTempFile = (file) => path.basename(path.dirname(String(file))) === 'save' && path.basename(String(file)).includes('.tmp-')

// The upload routes' faults follow the same marker rule (files in the server's
// working directory, read on every call):
//   inject-upload-delay      milliseconds to wait before a staging file is opened
//   inject-upload-write-fail the chunk write into a staging file writes half the
//                            bytes, then rejects with the code the marker holds
//   inject-rename-fail       renaming a staging file or a key's write temp into
//                            place rejects with the code the marker holds
// read-file.log records the name of every key file read whole with
// fs.promises.readFile, one per line, so a test can show a route did not read.
const isInSaveDirectory = (file) => path.basename(path.dirname(String(file))) === 'save'
const isStagingFile = (file) => isInSaveDirectory(file) && path.basename(String(file)).startsWith('__upload-')
const markerCode = (marker) => fs.readFileSync(marker, 'utf-8').trim() || 'ENOSPC'
const injectedError = (code, what) => Object.assign(new Error(`${code}: injected ${what} failure`), { code })

const delayMarkerPath = path.join(process.cwd(), 'inject-upload-delay')
const uploadWriteFailMarkerPath = path.join(process.cwd(), 'inject-upload-write-fail')
const renameFailMarkerPath = path.join(process.cwd(), 'inject-rename-fail')
const readLogPath = path.join(process.cwd(), 'read-file.log')

const originalOpen = fs.promises.open
fs.promises.open = async function (file, ...rest) {
    if (isStagingFile(file) && fs.existsSync(delayMarkerPath)) {
        await new Promise((resolve) => setTimeout(resolve, Number(fs.readFileSync(delayMarkerPath, 'utf-8')) || 0))
    }
    const handle = await originalOpen.call(this, file, ...rest)
    if (isStagingFile(file) && rest[0] === 'r+' && fs.existsSync(uploadWriteFailMarkerPath)) {
        const code = markerCode(uploadWriteFailMarkerPath)
        const originalWrite = handle.write.bind(handle)
        handle.write = async (buffer, offset, length, position) => {
            await originalWrite(buffer, offset, Math.floor(length / 2), position)
            throw injectedError(code, 'upload write')
        }
    }
    return handle
}

const originalRename = fs.promises.rename
fs.promises.rename = async function (from, to) {
    const name = path.basename(String(from))
    const movesIntoPlace = isInSaveDirectory(from) && (name.startsWith('__upload-') || (!name.startsWith('__') && name.includes('.tmp-')))
    if (movesIntoPlace && fs.existsSync(renameFailMarkerPath)) {
        throw injectedError(markerCode(renameFailMarkerPath), 'rename')
    }
    return originalRename.call(this, from, to)
}

const originalReadFile = fs.promises.readFile
fs.promises.readFile = async function (file, ...rest) {
    if (isInSaveDirectory(file) && /^(?:[0-9a-f]{2})+$/i.test(path.basename(String(file)))) {
        fs.appendFileSync(readLogPath, `${path.basename(String(file))}\n`)
    }
    return originalReadFile.call(this, file, ...rest)
}

const originalWriteFile = fs.promises.writeFile
fs.promises.writeFile = async function (file, ...rest) {
    if (isKeyTempFile(file) && fs.existsSync(markerPath)) {
        const code = fs.readFileSync(markerPath, 'utf-8').trim() || 'ENOSPC'
        throw Object.assign(new Error(`${code}: injected write failure, write '${String(file)}'`), { code })
    }
    return originalWriteFile.call(this, file, ...rest)
}
