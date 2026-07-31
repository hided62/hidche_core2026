import { resolveAccountIconProjection, type AccountIconProjection } from '@sammo-ts/common';

import type { UserRecord } from './userRepository.js';

export const resolveEffectiveAccountIcon = (
    user: Pick<
        UserRecord,
        'createdAt' | 'picture' | 'imageServer' | 'iconUpdatedAt' | 'iconRevision' | 'profileIconResetAt'
    >
): AccountIconProjection =>
    resolveAccountIconProjection({
        createdAt: user.createdAt,
        picture: user.picture,
        imageServer: user.imageServer,
        ...(user.iconUpdatedAt ? { iconUpdatedAt: user.iconUpdatedAt } : {}),
        ...(user.iconRevision ? { iconRevision: user.iconRevision } : {}),
        ...(user.profileIconResetAt ? { profileIconResetAt: user.profileIconResetAt } : {}),
    });
