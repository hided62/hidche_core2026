export const GENERAL_RECORD_TYPES = ['generalHistory', 'battleDetail', 'battleResult', 'generalAction'] as const;

export type GeneralRecordType = (typeof GENERAL_RECORD_TYPES)[number];

export type GeneralRecordEntry = {
    id: number | string;
    content: string;
};

export type GeneralRecordCollection = Partial<Record<GeneralRecordType, GeneralRecordEntry[]>>;
