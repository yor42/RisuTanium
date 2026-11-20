import { language } from '../../../lang'
import type { TaskToastPresenter } from '../../../ts/alertTask.svelte'
import type { TaskToastAnnouncement, TaskToastContent, TaskToastPhase, ToastHost } from '../../../ts/toast/toastHost.svelte'
import { taskAnnouncement, taskToastContent, taskToastPhase, type TaskLabels, type TaskView } from './taskProgress'

function buildLabels(): TaskLabels {
    return {
        stepOf: language.patternTaskStepOf,
        fileOf: language.patternTaskFileOf,
        count: language.patternTaskCount,
        countFound: language.patternTaskCountFound,
        bytes: language.patternTaskBytes,
        cancelling: language.patternTaskCancelling,
        cancelledHeadline: language.patternTaskCancelled,
        skippedTitle: language.patternTaskSkippedTitle,
        dataLine: (failure) => {
            const base = failure.dataState === 'same'
                ? language.patternTaskDataSame
                : failure.dataState === 'partial'
                    ? language.patternTaskDataPartial(failure.kept ?? 0, failure.failed ?? 0)
                    : language.patternTaskDataUnknown
            return failure.detail ? `${base} ${failure.detail}` : base
        },
    }
}

function toastContent(view: TaskView, labels: TaskLabels): TaskToastContent {
    const phase = taskToastPhase(view)
    return {
        ...taskToastContent(view, labels),
        phase,
        openLabel: phase === 'running' ? language.patternTaskToastOpen : language.patternTaskToastResult,
    }
}

/**
 * What is spoken when a task ends: the headline, then the first line of its result (the skipped count or a notice), so a
 * clean finish with a note is not silent. A failure speaks its headline alone, assertively. Later result lines are not read.
 */
function endAnnouncement(view: TaskView, content: TaskToastContent, labels: TaskLabels): TaskToastAnnouncement {
    if (view.state === 'failed') return { text: taskAnnouncement(view, labels), assertive: true }
    return { text: content.line ? `${content.title}. ${content.line}` : content.title }
}

/**
 * Maps a backgrounded task's view to its toast and decides what is spoken: once when the task goes to the background and
 * once when it leaves `running`. Step and progress changes are never announced.
 */
export function createTaskToastPresenter(host: ToastHost): TaskToastPresenter {
    const phases = new Map<number, TaskToastPhase>()
    return {
        post(view, on) {
            const labels = buildLabels()
            const content = toastContent(view, labels)
            const id = host.postTask({
                ...content,
                announce: { text: language.patternTaskBackgrounded(view.title) },
                onOpen: on.open,
                onEnd: () => {
                    phases.delete(id)
                    on.end()
                },
            })
            phases.set(id, content.phase)
            return id
        },
        update(id, view) {
            const labels = buildLabels()
            const content = toastContent(view, labels)
            const before = phases.get(id)
            phases.set(id, content.phase)
            const leftRunning = before === 'running' && content.phase !== 'running'
            host.updateTask(id, content, leftRunning ? endAnnouncement(view, content, labels) : undefined)
        },
        end(id, opts) {
            phases.delete(id)
            host.endTask(id, opts)
        },
    }
}
