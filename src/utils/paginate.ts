export const PAGE_SIZE = 20;

export type PageResult<T> = {
    slice: T[];
    page: number;
    totalPages: number;
    total: number;
};

export function paginate<T>(items: T[], page: number, size = PAGE_SIZE): PageResult<T> {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / size) || 1);
    const safePage = Math.min(Math.max(0, page), totalPages - 1);
    const start = safePage * size;
    return {
        slice: items.slice(start, start + size),
        page: safePage,
        totalPages,
        total,
    };
}

/** Callback: `prefix` yoki `prefix_p{N}` */
export function pageCallback(prefix: string, page: number): string {
    return page <= 0 ? prefix : `${prefix}_p${page}`;
}

/** `list_open_p2` → { base: "list_open", page: 2 }; `pdebts_5_p1` → { base: "pdebts_5", page: 1 } */
export function parsePageCallback(data: string): { base: string; page: number } | null {
    const m = data.match(/^(.*)_p(\d+)$/);
    if (!m) return null;
    return { base: m[1]!, page: Number(m[2]) };
}
