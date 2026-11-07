/**
 * Vitest reporter that writes a compact, classifier-oriented summary of a run to the
 * file named by RISU_FULLRUN_SUMMARY. It carries the `message` of every module, suite
 * and test error plus vitest's unhandled errors and the run state, because the JSON
 * reporter cannot identify a timeout (its stack text hides the message) and drops
 * suite-level and unhandled errors. It runs in the main vitest process only.
 *
 * With RISU_FULLRUN_SUMMARY unset nothing is written. A reporter failure surfaces as a
 * missing summary, which the classifier treats as FAIL-ERROR.
 */
import fs from 'node:fs'

export const SUMMARY_SCHEMA = 1
export const MAX_MESSAGE_CHARS = 4000

function messageOf(error) {
    const text = String((error && error.message) ?? '')
    return text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) : text
}

function messagesOf(errors) {
    return (errors ?? []).map(messageOf)
}

function unhandledEntry(error) {
    return { type: String((error && (error.type ?? error.name)) ?? 'Error'), message: messageOf(error) }
}

export function summarize(testModules, unhandledErrors, reason, vitestVersion) {
    return {
        schema: SUMMARY_SCHEMA,
        vitestVersion: String(vitestVersion ?? ''),
        reason: String(reason ?? ''),
        unhandled: (unhandledErrors ?? []).map(unhandledEntry),
        modules: [...testModules].map((module) => ({
            file: String(module.moduleId),
            state: module.state(),
            moduleErrors: messagesOf(module.errors()),
            suites: [...module.children.allSuites()].map((suite) => ({
                name: suite.fullName,
                state: suite.state(),
                errors: messagesOf(suite.errors()),
            })),
            tests: [...module.children.allTests()].map((test) => {
                const result = test.result()
                return { name: test.fullName, state: result.state, errors: messagesOf(result.errors) }
            }),
        })),
    }
}

export default class FullRunReporter {
    onInit(vitest) {
        this.vitestVersion = vitest && vitest.version
    }

    onTestRunEnd(testModules, unhandledErrors, reason) {
        const target = process.env.RISU_FULLRUN_SUMMARY
        if (!target) return
        const summary = summarize(testModules, unhandledErrors, reason, this.vitestVersion)
        const temporary = `${target}.${process.pid}.tmp`
        fs.writeFileSync(temporary, JSON.stringify(summary, null, 1))
        fs.renameSync(temporary, target)
    }
}
