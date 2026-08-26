interface LockEntry {
    controller: AbortController;
}

const globalForInFlight = globalThis as unknown as {
    inFlightLocks: Map<string, LockEntry>;
}

export const inFlightLocks = (globalForInFlight.inFlightLocks ??= new Map<string, LockEntry>());

if (process.env.NODE_ENV !== "production") {
    globalForInFlight.inFlightLocks = inFlightLocks;
}

export function acquireLock(key: string): AbortController | null {
    if (inFlightLocks.has(key)) return null;

    const controller = new AbortController();
    inFlightLocks.set(key, { controller });
    return controller;
}

export function releaseLock(key: string, controller: AbortController): void {
    const entry = inFlightLocks.get(key);
    if (entry?.controller === controller) {
        inFlightLocks.delete(key);
    }
}

export function abortLock(key: string): boolean {
    const entry = inFlightLocks.get(key);
    if (!entry) return false;
    entry.controller.abort();
    inFlightLocks.delete(key);
    return true;
}
