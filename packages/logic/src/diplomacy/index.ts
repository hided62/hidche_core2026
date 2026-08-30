import { clamp } from 'es-toolkit';

import { DIPLOMACY_STATE } from './constants.js';

export { DIPLOMACY_STATE } from './constants.js';

export const DEFAULT_WAR_TERM = 6;

const MAX_WAR_TERM = 13;

export interface DiplomacyEntry {
    fromNationId: number;
    toNationId: number;
    state: number;
    term: number;
    dead: number;
    meta: Record<string, unknown>;
}

export interface DiplomacyPatch {
    state?: number;
    term?: number;
    dead?: number;
    deadDelta?: number;
    meta?: Record<string, unknown>;
}

export const buildDiplomacyKey = (srcNationId: number, destNationId: number): string =>
    `${srcNationId}:${destNationId}`;

export const buildDefaultDiplomacy = (srcNationId: number, destNationId: number): DiplomacyEntry => ({
    fromNationId: srcNationId,
    toNationId: destNationId,
    state: DIPLOMACY_STATE.TRADE,
    term: 0,
    dead: 0,
    meta: {},
});

export const applyDiplomacyPatch = (entry: DiplomacyEntry, patch: DiplomacyPatch): DiplomacyEntry => {
    const nextDead =
        typeof patch.dead === 'number'
            ? patch.dead
            : typeof patch.deadDelta === 'number'
              ? entry.dead + patch.deadDelta
              : entry.dead;
    return {
        ...entry,
        state: patch.state ?? entry.state,
        term: patch.term ?? entry.term,
        dead: clamp(nextDead, 0, Number.MAX_SAFE_INTEGER),
        meta: patch.meta ? { ...entry.meta, ...patch.meta } : entry.meta,
    };
};

export const readDiplomacyMeta = (meta: Record<string, unknown>): { meta: Record<string, unknown>; dead: number } => {
    const rawDead = meta.dead;
    const dead = typeof rawDead === 'number' ? rawDead : 0;
    const cleaned = { ...meta };
    delete cleaned.dead;
    return { meta: cleaned, dead };
};

export const buildDiplomacyMeta = (entry: DiplomacyEntry): Record<string, unknown> => ({
    ...entry.meta,
    dead: entry.dead,
});

export const processDiplomacyMonth = (
    diplomacy: DiplomacyEntry[],
    generalCounts: Map<number, number>
): DiplomacyEntry[] => {
    const next = diplomacy.map((entry) => ({
        ...entry,
        meta: { ...entry.meta },
    }));
    const byKey = new Map<string, DiplomacyEntry>(
        next.map((entry) => [buildDiplomacyKey(entry.fromNationId, entry.toNationId), entry])
    );

    // 전쟁 기간 갱신: 사상자에 따라 term 증가, 잔여 사상자 유지.
    for (const entry of next) {
        if (entry.state !== DIPLOMACY_STATE.WAR || entry.dead <= 0) {
            continue;
        }
        const genCount = Math.max(1, generalCounts.get(entry.fromNationId) ?? 1);
        const termIncrease = Math.floor(entry.dead / 100 / genCount);
        if (termIncrease <= 0) {
            continue;
        }
        entry.dead -= termIncrease * 100 * genCount;
        entry.term = clamp(entry.term + termIncrease, 0, MAX_WAR_TERM);
    }

    // 전쟁은 양방향 diplomacy row로 저장되지만 기간은 하나의 관계가 소유한다.
    // Ref처럼 방향별 사상자 연장을 먼저 계산하되, 더 긴 기간을 양쪽에 적용하여
    // 한쪽만 0개월 전쟁으로 남는 비대칭 상태를 다음 월까지 노출하지 않는다.
    const processedPairs = new Set<string>();
    for (const entry of next) {
        if (entry.state !== DIPLOMACY_STATE.WAR) {
            continue;
        }
        const pairKey = buildDiplomacyKey(
            Math.min(entry.fromNationId, entry.toNationId),
            Math.max(entry.fromNationId, entry.toNationId)
        );
        if (processedPairs.has(pairKey)) {
            continue;
        }
        const opposite = byKey.get(buildDiplomacyKey(entry.toNationId, entry.fromNationId));
        if (!opposite || opposite.state !== DIPLOMACY_STATE.WAR) {
            continue;
        }

        const sharedTerm = Math.max(entry.term, opposite.term);
        entry.term = sharedTerm;
        opposite.term = sharedTerm;
        processedPairs.add(pairKey);

        if (sharedTerm <= 1) {
            entry.state = DIPLOMACY_STATE.TRADE;
            entry.term = 0;
            opposite.state = DIPLOMACY_STATE.TRADE;
            opposite.term = 0;
        }
    }

    // 사상자 초기화 및 term 감소.
    for (const entry of next) {
        if (entry.state !== DIPLOMACY_STATE.WAR) {
            entry.dead = 0;
        }
        entry.term = Math.max(0, entry.term - 1);
    }

    // 불가침/선전포고 만료 처리.
    for (const entry of next) {
        if (entry.state === DIPLOMACY_STATE.NON_AGGRESSION && entry.term === 0) {
            entry.state = DIPLOMACY_STATE.TRADE;
        } else if (entry.state === DIPLOMACY_STATE.DECLARATION && entry.term === 0) {
            entry.state = DIPLOMACY_STATE.WAR;
            entry.term = DEFAULT_WAR_TERM;
        }
    }

    return next;
};

export * from './frontState.js';
export * from './instantResponse.js';
export * from './messageValidity.js';
export * from './treatyTerm.js';
