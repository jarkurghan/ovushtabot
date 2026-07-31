/** 500000 | 500.000 | 500,000 | 500 ming | 500минг */
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

/** YYYY-MM-DD yoki DD.MM.YYYY */
export function parseDate(input: string): string | null {
    const raw = input.trim();
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
        const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) return null;
        return `${iso[1]}-${iso[2]}-${iso[3]}`;
    }

    const dmy = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (dmy) {
        const day = dmy[1].padStart(2, "0");
        const month = dmy[2].padStart(2, "0");
        const year = dmy[3];
        const d = new Date(`${year}-${month}-${day}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) return null;
        return `${year}-${month}-${day}`;
    }

    return null;
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
