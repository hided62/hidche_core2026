export const GATEWAY_PROFILE_ORDER = ['che', 'kwe', 'pwe', 'twe', 'nya', 'pya', 'hwe'] as const;

const gatewayProfileOrder = new Map<string, number>(GATEWAY_PROFILE_ORDER.map((profile, index) => [profile, index]));

export const compareGatewayProfiles = (
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
