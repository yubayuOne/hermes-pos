/**
 * Reopening the app without internet goes on with the open shift only while it was opened less than 24 hours ago
 * (owner's choice, 18 Oct 2026): a phone never runs for days without the server. An unreadable time counts as too old.
 */
export const RESUME_OFFLINE_MS = 24 * 60 * 60 * 1000;

export const canResumeOffline = (openedAt: string, now = Date.now()) => now - Date.parse(openedAt) < RESUME_OFFLINE_MS;
