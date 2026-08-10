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

    // namoz-style: utm-xxx--broadcast_date-yyyy_mm_dd / mcode_...
    if (payload.includes("--") || /^(utm|mcode|ref|from)[-_]/i.test(payload)) {
        const arr = payload.toLowerCase().split("--");
        for (let i = 0; i < arr.length; i++) {
            const item = arr[i].split("-");
            if (item.length > 1) result[item[0]] = item[1];
            else {
                const underscored = arr[i].split("_");
                if (underscored.length > 0) result[underscored[0]] = underscored[1];
            }
        }
        return result;
    }

    for (const part of payload.split("&")) {
        const [k, v] = part.split("=");
        if (k) result[k] = v ?? "";
    }
    return result;
}

export function findUtm(obj: Record<string, string>): string {
    const utm = obj.utm;
    if (!utm) return obj.ref || obj.from || "Xudo biladi 🤷‍♂️";
    else if (utm === "karyera") return "@meni_botlarim";
    else if (utm.includes("aniuzbot")) return "@aniuz_bot";
    else if (utm === "uz_multfilm_bot") {
        if (obj.broadcast_date) return `@uz_multfilm_bot\n🚪 Broadcast: <code>${obj.broadcast_date.replaceAll("_", ".")}</code>`;
        else return "@uz_multfilm_bot";
    } else if (utm === "uz_multfilm_bot_2") {
        if (obj.broadcast_date) return `@uz_multfilm_bot 2\n🚪 Broadcast: <code>${obj.broadcast_date.replaceAll("_", ".")}</code>`;
        else return "@uz_multfilm_bot";
    } else if (utm === "uzkinomov1ebot") {
        if (obj.broadcast_date) return `@uzkinomov1ebot (@bekk_media)\n🚪 Broadcast: <code>${obj.broadcast_date.replaceAll("_", ".")}</code>`;
        else return "@uzkinomov1ebot";
    } else if (utm === "uzkinomov1ebot_2") {
        if (obj.broadcast_date) return `@uzkinomov1ebot 2\n🚪 Broadcast: <code>${obj.broadcast_date.replaceAll("_", ".")}</code>`;
        else return "@uzkinomov1ebot";
    } else if (utm.includes("uz_multfilm_bot")) return "@uz_multfilm_bot";
    else return utm;
}

export function resolveUtmFromStartPayload(startPayload: string): string {
    const p = startPayload.trim();
    if (!p) return "";

    if (p.includes("utm-")) {
        const utm = p.slice(p.indexOf("utm-") + 4);
        if (utm.includes("karyera")) return "@meni_botlarim";
        else if (utm.includes("aniuzbot")) return "@aniuz_bot";
        else return utm;
    }

    return p;
}
