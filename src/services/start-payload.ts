import type { CommandContext, Context } from "grammy";

export function getStartPayload(ctx: CommandContext<Context>): string {
    const text = ctx.message?.text || "";
    const parts = text.split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(" ") : "";
}

export function objPayload(payload: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!payload) return result;

    
    if (payload.startsWith("share_")) {
        result.share = payload.slice("share_".length);
        return result;
    }

    for (const part of payload.split("&")) {
        const [k, v] = part.split("=");
        if (k) result[k] = v ?? "";
    }
    return result;
}

export function findUtm(payloadObj: Record<string, string>): string {
    return payloadObj.utm || payloadObj.ref || payloadObj.from || "organic";
}
