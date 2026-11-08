export type NotificationStatus = 'granted' | 'denied' | 'default' | 'unsupported'

function isKnownPermission(value: unknown): value is Exclude<NotificationStatus, 'unsupported'> {
    return value === 'granted' || value === 'denied' || value === 'default'
}

/** Current notification permission. Never throws: a missing or misbehaving API reads as unsupported. */
export function readNotificationStatus(): NotificationStatus {
    try {
        if (typeof Notification === 'undefined') {
            return 'unsupported'
        }
        const permission: unknown = Notification.permission
        return isKnownPermission(permission) ? permission : 'unsupported'
    } catch {
        return 'unsupported'
    }
}

/**
 * Asks for permission only while it is still undecided; a granted, blocked or unsupported state
 * is returned unchanged. Never throws: a failed request leaves the re-read status.
 */
export async function requestNotifications(): Promise<NotificationStatus> {
    const before = readNotificationStatus()
    if (before !== 'default') {
        return before
    }
    try {
        const answer: unknown = await Notification.requestPermission()
        if (isKnownPermission(answer)) {
            return answer
        }
    } catch {
        // A rejected or unavailable request falls through to the re-read below.
    }
    return readNotificationStatus()
}
