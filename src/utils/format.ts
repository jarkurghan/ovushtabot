
export function parseAmount(input: string): number | null {
    let raw = input.trim().toLowerCase();
    if (!raw) return null;

    raw = raw
        .replace(/so['ʼ'`’]?m/gi, "")
        .replace(/сўм/gi, "")
        .replace(/\s+/g, " ")
        .trim();

    const mingMatch = raw.match(/^([\d\s.,]+)\s*(ming|минг)$/i);
    if (mingMatch) {
        const base = Number(mingMatch[1].replace(/[\s.,]/g, ""));
        if (!Number.isFinite(base) || base <= 0) return null;
        return Math.round(base * 1000);
    }

    const mlnMatch = raw.match(/^([\d\s.,]+)\s*(mln|млн|million|миллион)$/i);
    if (mlnMatch) {
        const base = Number(mlnMatch[1].replace(/[\s.,]/g, ""));
        if (!Number.isFinite(base) || base <= 0) return null;
        return Math.round(base * 1_000_000);
    }

    const digits = raw.replace(/[\s.,]/g, "");
    if (!/^\d+$/.test(digits)) return null;
    const value = Number(digits);
    if (!Number.isFinite(value) || value <= 0) return null;
    return value;
}

export function formatAmount(amount: number, lang: "uz" | "cyrl" = "uz"): string {
    const formatted = new Intl.NumberFormat("uz-UZ").format(Math.abs(amount));
    return lang === "cyrl" ? `${formatted} сўм` : `${formatted} so'm`;
}

export function parseDate(input: string): string | null {
    const raw = input.trim();
    const dmy = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (!dmy) return null;

    const day = dmy[1].padStart(2, "0");
    const month = dmy[2].padStart(2, "0");
    const year = dmy[3];
    const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (Number.isNaN(d.getTime())) return null;
    if (d.getUTCFullYear() !== Number(year) || d.getUTCMonth() + 1 !== Number(month) || d.getUTCDate() !== Number(day)) {
        return null;
    }
    return `${year}-${month}-${day}`;
}

export function formatDate(iso: string | null | undefined, lang: "uz" | "cyrl" = "uz"): string {
    if (!iso) return lang === "cyrl" ? "Белгиланмаган" : "Belgilanmagan";
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
}

export function todayInTashkent(): string {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tashkent",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).format(new Date());
}

function partsInTashkent(date: Date): { y: number; m: number; d: number } {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Tashkent",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date);
    const y = Number(parts.find((p) => p.type === "year")?.value);
    const m = Number(parts.find((p) => p.type === "month")?.value);
    const d = Number(parts.find((p) => p.type === "day")?.value);
    return { y, m, d };
}

function isoFromParts(y: number, m: number, d: number): string {
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function dateIsoInTashkent(date: Date): string {
    const { y, m, d } = partsInTashkent(date);
    return isoFromParts(y, m, d);
}

export function addDaysInTashkent(days: number): string {
    const { y, m, d } = partsInTashkent(new Date());
    const base = new Date(Date.UTC(y, m - 1, d));
    base.setUTCDate(base.getUTCDate() + days);
    return isoFromParts(base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate());
}

export function addMonthsInTashkent(months: number): string {
    const { y, m, d } = partsInTashkent(new Date());
    const target = new Date(Date.UTC(y, m - 1 + months, 1));
    const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
    const day = Math.min(d, lastDay);
    return isoFromParts(target.getUTCFullYear(), target.getUTCMonth() + 1, day);
}

export function firstOfNextMonthInTashkent(): string {
    const { y, m } = partsInTashkent(new Date());
    const next = new Date(Date.UTC(y, m, 1));
    return isoFromParts(next.getUTCFullYear(), next.getUTCMonth() + 1, 1);
}

export function nowTimeInTashkent(): string {
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Tashkent",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date());
}

export function escapeHtml(text: string): string {
    return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function normalizeContactName(input: string): string {
    return input.trim().replace(/\s+/g, " ").toLocaleLowerCase("uz");
}

export function contactNameHasForbiddenChars(input: string): boolean {
    return /[<>&]/.test(input);
}

export function formatContactName(name: string): string {
    const normalized = name.trim().replace(/\s+/g, " ");
    if (!normalized) return normalized;
    return normalized
        .split(" ")
        .map((word) => {
            if (!word) return word;
            return word.charAt(0).toLocaleUpperCase("uz") + word.slice(1).toLocaleLowerCase("uz");
        })
        .join(" ");
}
