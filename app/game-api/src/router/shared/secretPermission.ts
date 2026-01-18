import { asRecord } from '@sammo-ts/common';

export type PermissionKind = 'normal' | 'ambassador' | 'auditor';

export interface SecretPermissionInput {
    nationId: number;
    officerLevel: number;
    meta: unknown;
    penalty: unknown;
}

const readNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const resolvePermissionKind = (meta: Record<string, unknown>): PermissionKind => {
    const value = meta.permission;
    if (value === 'ambassador' || value === 'auditor') {
        return value;
    }
    return 'normal';
};

const resolveBelong = (meta: Record<string, unknown>): number => readNumber(meta.belong, 0);

const resolveSecretLimit = (meta: Record<string, unknown>): number =>
    readNumber(meta.secretlimit ?? meta.secretLimit, 3);

const checkSecretMaxPermission = (penalty: Record<string, unknown>): number => {
    if (penalty.noTopSecret) {
        return 1;
    }
    if (penalty.noChief) {
        return 1;
    }
    if (penalty.noAmbassador) {
        return 2;
    }
    return 4;
};

export const resolveSecretPermission = (
    input: SecretPermissionInput,
    nationMeta: unknown,
    checkSecretLimit = true
): number => {
    if (!input.nationId) {
        return -1;
    }
    if (input.officerLevel === 0) {
        return -1;
    }

    const penalty = asRecord(input.penalty);
    if (penalty.noChief) {
        return 0;
    }

    const meta = asRecord(input.meta);
    const permission = resolvePermissionKind(meta);
    const belong = resolveBelong(meta);
    const secretMax = checkSecretMaxPermission(penalty);

    let secretMin = 0;
    if (input.officerLevel === 12) {
        secretMin = 4;
    } else if (permission === 'ambassador') {
        secretMin = 4;
    } else if (permission === 'auditor') {
        secretMin = 3;
    } else if (input.officerLevel >= 5) {
        secretMin = 2;
    } else if (input.officerLevel > 1) {
        secretMin = 1;
    } else if (checkSecretLimit) {
        const limit = resolveSecretLimit(asRecord(nationMeta));
        if (belong >= limit) {
            secretMin = 1;
        }
    }

    return Math.min(secretMin, secretMax);
};
