/** A task assigned to someone is announced once, this long before it is due. */
export const DUE_SOON_WINDOW_MS = 24 * 60 * 60_000;

/** How often the worker looks for tasks that have come into the window. */
export const DEADLINE_SWEEP_INTERVAL_MS = 5 * 60_000;

/** Most reminders created by one sweep; the rest follow on the next one. */
export const DEADLINE_SWEEP_BATCH = 200;
