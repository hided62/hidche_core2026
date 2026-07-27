import { legacyUserId } from './identity.js';

export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | {
          [key: string]: JsonValue;
      };

export const parseJson = (value: unknown, context: string): JsonValue => {
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
        return value;
    }
    if (typeof value === 'object') {
        return value as JsonValue;
    }
    if (typeof value !== 'string') {
        throw new Error(`${context}: expected JSON text`);
    }
    try {
        return JSON.parse(value) as JsonValue;
    } catch (error) {
        throw new Error(`${context}: invalid JSON`, { cause: error });
    }
};

const asObject = (value: JsonValue): Record<string, JsonValue> =>
    value !== null && !Array.isArray(value) && typeof value === 'object' ? value : {};

const asStringArray = (value: JsonValue | undefined): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const legacyAclRoleMap: Record<string, string> = {
    openClose: 'admin.profiles.manage',
    reset: 'admin.reset.schedule',
    update: 'admin.profiles.manage',
    fullUpdate: 'admin.profiles.manage',
    vote: 'admin.survey.open',
    globalNotice: 'admin.notice.manage',
    notice: 'admin.notice.manage',
    blockGeneral: 'admin.users.manage',
};

export const mapLegacyRoles = (grade: number, rawAcl: JsonValue): string[] => {
    const roles = new Set<string>(['user']);
    if (grade >= 7) {
        roles.add('superuser');
    } else if (grade === 6) {
        roles.add('admin.profiles.manage');
        roles.add('admin.notice.manage');
        roles.add('admin.reset.schedule');
        roles.add('admin.resume.when-stopped');
    } else if (grade === 5) {
        roles.add('admin.users.manage');
        roles.add('admin.users.create');
    }

    for (const [profile, permissions] of Object.entries(asObject(rawAcl))) {
        for (const permission of asStringArray(permissions)) {
            const mapped = legacyAclRoleMap[permission];
            if (mapped) {
                roles.add(`${mapped}:${profile}:default`);
            } else {
                roles.add(`legacy.acl.${permission}:${profile}`);
            }
        }
    }
    return [...roles].sort();
};

export const mapLegacySanctions = (grade: number, penalty: JsonValue): JsonValue => {
    const flags = grade === 0 ? ['legacy-blocked'] : [];
    return {
        ...(flags.length ? { flags, suspendedUntil: '9999-12-31T23:59:59.999Z' } : {}),
        legacyPenalty: penalty,
    };
};

export const classifyGameStorage = (
    namespace: string,
    key: string
): 'persistent-projected' | 'persistent-archive' | 'season-state' => {
    if (/^inheritance_\d+$/.test(namespace)) {
        return 'persistent-projected';
    }
    if (/^user_\d+$/.test(namespace)) {
        return key === 'last_stat_reset' ? 'persistent-projected' : 'persistent-archive';
    }
    return 'season-state';
};

export const parseStorageUserId = (namespace: string, prefix: 'inheritance' | 'user'): string | null => {
    const match = new RegExp(`^${prefix}_(\\d+)$`).exec(namespace);
    if (!match?.[1]) {
        return null;
    }
    return legacyUserId(Number.parseInt(match[1], 10));
};

export const parseInheritanceValue = (value: JsonValue, context: string): number => {
    const scalar = Array.isArray(value) ? value[0] : value;
    if (typeof scalar === 'number' && Number.isFinite(scalar)) {
        return scalar;
    }
    if (typeof scalar === 'string') {
        const parsed = Number(scalar);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    throw new Error(`${context}: inheritance value must be numeric`);
};
