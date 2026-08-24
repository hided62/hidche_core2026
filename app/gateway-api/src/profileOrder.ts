export const GATEWAY_PROFILE_ORDER = ['che', 'kwe', 'pwe', 'twe', 'nya', 'pya', 'hwe'] as const;

export const GATEWAY_PROFILE_KOREAN_NAMES = {
    che: '체',
    kwe: '퀘',
    pwe: '풰',
    twe: '퉤',
    nya: '냐',
    pya: '퍄',
    hwe: '훼',
} as const satisfies Record<(typeof GATEWAY_PROFILE_ORDER)[number], string>;

const gatewayProfileOrder = new Map<string, number>(GATEWAY_PROFILE_ORDER.map((profile, index) => [profile, index]));
const gatewayProfileKoreanNames = new Map<string, string>(Object.entries(GATEWAY_PROFILE_KOREAN_NAMES));

export const resolveGatewayProfileKoreanName = (profile: string, configuredName?: unknown): string => {
    if (typeof configuredName === 'string' && configuredName.trim()) {
        return configuredName.trim();
    }
    return gatewayProfileKoreanNames.get(profile) ?? profile;
};

/**
 * User-facing profile label. The immutable profileName (`che:default`) remains
 * an internal routing/storage key and must not leak into ordinary UI copy.
 */
export const resolveGatewayProfileDisplayName = (
    profile: string,
    instanceKey: string,
    configuredName?: unknown
): string => {
    const koreanName = resolveGatewayProfileKoreanName(profile, configuredName);
    return instanceKey === 'default' ? koreanName : `${koreanName} [${instanceKey}]`;
};

const compareGatewayProfiles = (
    left: { profile: string; instanceKey: string },
    right: { profile: string; instanceKey: string }
): number => {
    const unknownRank = GATEWAY_PROFILE_ORDER.length;
    const profileOrder =
        (gatewayProfileOrder.get(left.profile) ?? unknownRank) -
        (gatewayProfileOrder.get(right.profile) ?? unknownRank);
    if (profileOrder !== 0) return profileOrder;

    const profileNameOrder = left.profile.localeCompare(right.profile);
    if (profileNameOrder !== 0) return profileNameOrder;
    return left.instanceKey.localeCompare(right.instanceKey);
};

export const orderGatewayProfiles = <T extends { profile: string; instanceKey: string }>(profiles: readonly T[]): T[] =>
    [...profiles].sort(compareGatewayProfiles);
