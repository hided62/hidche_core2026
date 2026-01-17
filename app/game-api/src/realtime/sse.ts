export interface SseFrame {
    event?: string;
    data?: string;
    id?: string;
    retry?: number;
}

const splitLines = (value: string): string[] => value.split(/\r?\n/);

export const formatSseFrame = (frame: SseFrame): string => {
    const lines: string[] = [];

    if (frame.event) {
        lines.push(`event: ${frame.event}`);
    }
    if (frame.id) {
        lines.push(`id: ${frame.id}`);
    }
    if (frame.retry !== undefined) {
        lines.push(`retry: ${frame.retry}`);
    }

    const dataLines = splitLines(frame.data ?? '');
    for (const line of dataLines) {
        lines.push(`data: ${line}`);
    }

    lines.push('');
    return lines.join('\n');
};
