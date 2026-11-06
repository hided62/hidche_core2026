/** 표시만 묶는다. 명시적인 서버 권한을 모든 서버 권한으로 승격하지 않는다. */
export const formatRoleGroups = (roles: readonly string[]): string[] => {
    const groups = new Map<string, { permission: string; instance: string; profiles: string[] }>();
    const entries: Array<string | { permission: string; instance: string; profiles: string[] }> = [];
    for (const role of roles) {
        const match = /^(admin\.[^:]+):([^:]+):([^:]+)$/u.exec(role);
        if (!match) {
            entries.push(role.endsWith(':*') ? `${role} (모든 서버)` : role);
            continue;
        }
        const [, permission, profile, instance] = match;
        const key = `${permission}:${instance}`;
        let group = groups.get(key);
        if (!group) {
            group = { permission, instance, profiles: [] };
            groups.set(key, group);
            entries.push(group);
        }
        if (!group.profiles.includes(profile)) group.profiles.push(profile);
    }
    return entries.map((entry) => {
        if (typeof entry === 'string') return entry;
        const profiles = entry.profiles.length > 1 ? `{${entry.profiles.join(', ')}}` : entry.profiles[0];
        return `${entry.permission}:${profiles}:${entry.instance}`;
    });
};
