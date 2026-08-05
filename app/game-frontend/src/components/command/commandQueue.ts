import type { CommandPatternEntry, ReservedCommandRow } from './types';

const jsonClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const cloneArgs = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return jsonClone(value as Record<string, unknown>);
};

export const normalizedSelection = (
    selected: ReadonlySet<number>,
    previous: ReadonlySet<number>,
    maxTurns: number
): number[] => {
    const source = selected.size ? selected : previous.size ? previous : new Set([0]);
    return [...source].filter((index) => index >= 0 && index < maxTurns).sort((left, right) => left - right);
};

export const selectStep = (maxTurns: number, begin: number, step: number): Set<number> => {
    const result = new Set<number>();
    for (let index = 0; index < maxTurns; index += 1) {
        if ((index - begin) % step === 0) result.add(index);
    }
    return result;
};

export const extractPattern = (rows: ReservedCommandRow[], selection: number[]): CommandPatternEntry[] => {
    if (!selection.length) return [];
    const first = selection[0] ?? 0;
    const grouped = new Map<string, CommandPatternEntry>();
    for (const index of selection) {
        const row = rows[index];
        if (!row) continue;
        const args = cloneArgs(row.args);
        const key = JSON.stringify([row.action, args]);
        const relative = index - first;
        const existing = grouped.get(key);
        if (existing) {
            existing.turnList.push(relative);
        } else {
            grouped.set(key, { turnList: [relative], action: row.action, args, label: row.label });
        }
    }
    return [...grouped.values()];
};

export const amplifyPattern = (
    pattern: CommandPatternEntry[],
    targets: number[],
    maxTurns: number
): CommandPatternEntry[] => {
    if (!pattern.length || !targets.length) return [];
    const offsets = pattern.flatMap((entry) => entry.turnList);
    if (!offsets.length) return [];
    const minOffset = Math.min(...offsets);
    const width = Math.max(...offsets) - minOffset + 1;
    const anchors: number[] = [];
    for (const target of [...targets].sort((a, b) => a - b)) {
        const last = anchors.at(-1);
        if (last === undefined || target >= last + width) anchors.push(target);
    }
    return pattern
        .map((entry) => ({
            ...entry,
            args: cloneArgs(entry.args),
            turnList: entry.turnList
                .flatMap((offset) => anchors.map((anchor) => anchor + offset - minOffset))
                .filter((index) => index >= 0 && index < maxTurns),
        }))
        .filter((entry) => entry.turnList.length > 0);
};

export const moveQueueRange = (
    rows: ReservedCommandRow[],
    selection: number[],
    direction: 'pull' | 'push',
    restAction = '휴식'
): CommandPatternEntry[] => {
    if (!selection.length) return [];
    const first = selection[0] ?? 0;
    const last = selection.at(-1) ?? first;
    const width = last - first + 1;
    const next = rows.map((row) => ({ action: row.action, args: cloneArgs(row.args), label: row.label }));
    if (direction === 'pull') {
        for (let index = first; index < rows.length - width; index += 1) next[index] = next[index + width]!;
        for (let index = Math.max(first, rows.length - width); index < rows.length; index += 1) {
            next[index] = { action: restAction, args: {}, label: '휴식' };
        }
    } else {
        for (let index = rows.length - 1; index >= first + width; index -= 1) next[index] = next[index - width]!;
        for (let index = first; index < Math.min(rows.length, first + width); index += 1) {
            next[index] = { action: restAction, args: {}, label: '휴식' };
        }
    }
    return next.map((entry, index) => ({ turnList: [index], ...entry }));
};

export class CommandStorage {
    readonly recent = new Map<string, CommandPatternEntry>();
    readonly templates = new Map<string, CommandPatternEntry[]>();
    clipboard: CommandPatternEntry[] | undefined;
    editMode = false;
    activeCategory = '';
    private readonly key: string;
    private readonly maxRecent: number;

    constructor(key: string, maxRecent = 10) {
        this.key = key;
        this.maxRecent = maxRecent;
        this.load();
    }

    private read<T>(suffix: string, fallback: T): T {
        try {
            return JSON.parse(localStorage.getItem(`${this.key}:${suffix}`) ?? '') as T;
        } catch {
            return fallback;
        }
    }

    private load(): void {
        for (const entry of this.read<CommandPatternEntry[]>('recent', [])) {
            this.recent.set(JSON.stringify([entry.action, entry.args]), entry);
        }
        for (const [name, entries] of this.read<Array<[string, CommandPatternEntry[]]>>('templates', [])) {
            this.templates.set(name, entries);
        }
        this.clipboard = this.read<CommandPatternEntry[] | undefined>('clipboard', undefined);
        this.editMode = localStorage.getItem(`${this.key}:editMode`) === '1';
        this.activeCategory = this.read('category', '');
    }

    saveState(): void {
        localStorage.setItem(`${this.key}:editMode`, this.editMode ? '1' : '0');
        localStorage.setItem(`${this.key}:category`, JSON.stringify(this.activeCategory));
    }

    saveClipboard(pattern: CommandPatternEntry[]): void {
        this.clipboard = jsonClone(pattern);
        localStorage.setItem(`${this.key}:clipboard`, JSON.stringify(this.clipboard));
    }

    pushRecent(entry: CommandPatternEntry): void {
        const key = JSON.stringify([entry.action, entry.args]);
        this.recent.delete(key);
        this.recent.set(key, jsonClone(entry));
        while (this.recent.size > this.maxRecent) this.recent.delete(this.recent.keys().next().value as string);
        localStorage.setItem(`${this.key}:recent`, JSON.stringify([...this.recent.values()]));
    }

    setTemplate(name: string, entries: CommandPatternEntry[]): void {
        this.templates.set(name, jsonClone(entries));
        this.saveTemplates();
    }

    deleteTemplate(name: string): void {
        this.templates.delete(name);
        this.saveTemplates();
    }

    private saveTemplates(): void {
        localStorage.setItem(`${this.key}:templates`, JSON.stringify([...this.templates.entries()]));
    }
}
