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

const originalWriteFile = fs.promises.writeFile
fs.promises.writeFile = async function (file, ...rest) {
    if (isKeyTempFile(file) && fs.existsSync(markerPath)) {
        const code = fs.readFileSync(markerPath, 'utf-8').trim() || 'ENOSPC'
        throw Object.assign(new Error(`${code}: injected write failure, write '${String(file)}'`), { code })
    }
    return originalWriteFile.call(this, file, ...rest)
}
