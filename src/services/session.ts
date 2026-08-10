import type { SessionData, SessionStep } from "../utils/types";

const sessions = new Map<number, SessionData>();
const TTL_MS = 30 * 60 * 1000;

function fresh(step: SessionStep = "idle"): SessionData {
    return { step, updatedAt: Date.now() };
}

export function getSession(tgId: number): SessionData {
    const existing = sessions.get(tgId);
    if (!existing) return fresh();
    if (Date.now() - existing.updatedAt > TTL_MS) {
        sessions.delete(tgId);
        return fresh();
    }
    return existing;
}

export function setSession(tgId: number, data: Partial<SessionData> & { step: SessionStep }): SessionData {
    const next: SessionData = { ...getSession(tgId), ...data, updatedAt: Date.now() };
    sessions.set(tgId, next);
    return next;
}

export function clearSession(tgId: number): void {
    sessions.delete(tgId);
}
