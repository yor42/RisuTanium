// Preload for the Node server's clock tests (`node --require <this file> server.cjs`).
// It shifts the server's `Date.now()` by the signed number of milliseconds in
// RISU_TEST_SERVER_CLOCK_SHIFT_MS, read once at start-up, so a test can age the
// server's clock by restarting it. `new Date()` is left alone: the server uses it
// for log stamps only. Only the test launcher passes this file to `--require`;
// `server.cjs` itself never reads the variable.
const raw = process.env.RISU_TEST_SERVER_CLOCK_SHIFT_MS
const shift = Number(raw)
if (raw === undefined || raw === '' || !Number.isSafeInteger(shift)) {
    throw new Error(`RISU_TEST_SERVER_CLOCK_SHIFT_MS must hold a safe integer, got ${JSON.stringify(raw)}`)
}
const realNow = Date.now.bind(Date)
Date.now = () => realNow() + shift
