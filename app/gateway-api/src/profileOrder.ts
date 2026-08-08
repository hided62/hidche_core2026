export const GATEWAY_PROFILE_ORDER = ['che', 'kwe', 'pwe', 'twe', 'nya', 'pya', 'hwe'] as const;

const gatewayProfileOrder = new Map<string, number>(GATEWAY_PROFILE_ORDER.map((profile, index) => [profile, index]));

export const compareGatewayProfiles = (
    left: { profile: string; scenario: string },
    right: { profile: string; scenario: string }
): number => {
    const unknownRank = GATEWAY_PROFILE_ORDER.length;
    const profileOrder =
        (gatewayProfileOrder.get(left.profile) ?? unknownRank) -
        (gatewayProfileOrder.get(right.profile) ?? unknownRank);
    if (profileOrder !== 0) return profileOrder;

    const profileNameOrder = left.profile.localeCompare(right.profile);
    if (profileNameOrder !== 0) return profileNameOrder;
    return left.scenario.localeCompare(right.scenario);
};

export const orderGatewayProfiles = <T extends { profile: string; scenario: string }>(profiles: readonly T[]): T[] =>
    [...profiles].sort(compareGatewayProfiles);
