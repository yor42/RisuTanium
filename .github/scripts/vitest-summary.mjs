// Appends the failed tests of one vitest JSON report to the GitHub job summary.
//
//   node vitest-summary.mjs <report.json> <label>
//
// Informational only: it always exits 0, so the vitest step stays the single source of pass or fail.
// The built-in github-actions reporter already annotates failures and writes the counts; it lists no
// failure in the summary, and GitHub shows at most 10 error annotations per step. At most MAX_FAILURES
// entries of a few hundred bytes each are written, far under the 1 MiB a step may add to the job summary.
import { appendFileSync, readFileSync } from 'node:fs'

const MAX_FAILURES = 40
const MAX_LINES = 6
const MAX_LINE_CHARS = 300

const [reportPath, label = 'unit tests'] = process.argv.slice(2)
const slashed = (text) => String(text ?? '').split('\\').join('/')
const root = slashed(process.env.GITHUB_WORKSPACE ?? process.cwd()).replace(/\/+$/, '')

const cut = (line) => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}...` : line)
// Report text reaches a Markdown code block and an inline-code title; neither may be closed from inside.
function inline(text) {
  return cut(String(text).replace(/`/g, "'").replace(/[\r\n]+/g, ' '))
}
function block(text) {
  return String(text).replace(/`{3,}/g, "'''")
}
function fileOf(path) {
  const text = slashed(path)
  return text.startsWith(`${root}/`) ? text.slice(root.length + 1) : text
}
// The message part of a stack: everything before the first "    at " line.
function messageOf(raw) {
  const lines = String(raw ?? '').split(/\r?\n/)
  const stackAt = lines.findIndex((line) => /^\s+at\s/.test(line))
  const head = (stackAt === -1 ? lines : lines.slice(0, stackAt)).filter((line) => line.trim() !== '')
  const shown = head.slice(0, MAX_LINES).map(cut)
  if (head.length > MAX_LINES) shown.push(`... ${head.length - MAX_LINES} more line(s)`)
  return shown.join('\n')
}

function render(report) {
  const failures = []
  for (const file of report.testResults ?? []) {
    const failedTests = (file.assertionResults ?? []).filter((test) => test.status === 'failed')
    for (const test of failedTests) {
      failures.push({ file: fileOf(file.name), title: test.fullName, message: messageOf(test.failureMessages?.[0]) })
    }
    // A file that failed to load or collect has no failed test of its own.
    if (file.status === 'failed' && failedTests.length === 0) {
      failures.push({ file: fileOf(file.name), title: '(the file failed before or outside its tests)', message: messageOf(file.message) })
    }
  }
  let out = `### Failed tests: ${inline(label)}\n\n`
  if (failures.length === 0) {
    out += report.success === false
      ? 'The run failed without a failed test in the report (for example an unhandled error); see the step log.\n'
      : 'No failed tests in the report.\n'
    return out
  }
  out += `${failures.length} failure(s). Unhandled errors outside a test appear only in the step log.\n`
  for (const failure of failures.slice(0, MAX_FAILURES)) {
    out += `\n- \`${inline(failure.file)}\` > \`${inline(failure.title)}\`\n\n  \`\`\`text\n${block(failure.message).replace(/^/gm, '  ')}\n  \`\`\`\n`
  }
  if (failures.length > MAX_FAILURES) out += `\n(${failures.length - MAX_FAILURES} more failure(s) not listed)\n`
  return out
}

let text
try {
  text = render(JSON.parse(readFileSync(reportPath, 'utf8')))
} catch (error) {
  text = `### Failed tests: ${inline(label)}\n\nNo readable vitest report (${inline(error?.code ?? error?.message ?? error)}); the step ended before it was written. See the step log.\n`
}
try {
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text)
  else process.stdout.write(text)
} catch {
  // A summary that cannot be written must not change the job result.
}
process.exit(0)
