/** Gateway capability resolver와 같은 명시적 전권·범위 규칙. 인게임 직책은 사용하지 않는다. */
export const canReadPlayAudit = (roles: readonly string[], profileName: string): boolean =>
    roles.some(
        (role) =>
            role === 'superuser' ||
            role === 'admin.superuser' ||
            role === 'admin.playAudit.read' ||
            role === 'admin.playAudit.read:*' ||
            role === `admin.playAudit.read:${profileName}`
    );

export const canReadPlayAuditAccounts = (roles: readonly string[], profileName: string): boolean =>
    canReadPlayAudit(roles, profileName) &&
    roles.some((role) => role === 'superuser' || role === 'admin.superuser' || role === 'admin.playAudit.accounts');
