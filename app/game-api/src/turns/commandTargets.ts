import type { TurnCommandOption } from './commandInput.js';

export interface GeneralTargetSource {
    id: number;
    name: string;
    nationId: number;
    cityId: number;
    npcState: number;
    officerLevel: number;
}

export interface RefGeneralTargetOptions {
    generals: TurnCommandOption[];
    generalTargets: Record<string, TurnCommandOption[]>;
}

const SAME_NATION_GENERAL_COMMANDS = ['che_증여'] as const;
const SAME_NATION_NATION_COMMANDS = ['che_발령', 'che_포상', 'che_몰수', 'che_부대탈퇴지시'] as const;

/** Ref 각 처리 화면의 SELECT 조건을 공통 command table의 명령별 option으로 투영한다. */
export const buildRefGeneralTargetOptions = (options: {
    actorId: number;
    actorNationId: number;
    generals: readonly GeneralTargetSource[];
    nationNames: ReadonlyMap<number, string>;
    cityNames: ReadonlyMap<number, string>;
}): RefGeneralTargetOptions => {
    const toOption = (entry: GeneralTargetSource): TurnCommandOption => ({
        value: entry.id,
        label: `${entry.name} (${options.nationNames.get(entry.nationId) ?? '무소속'} · ${
            options.cityNames.get(entry.cityId) ?? '재야'
        })`,
    });
    const project = (predicate: (entry: GeneralTargetSource) => boolean): TurnCommandOption[] =>
        options.generals.filter(predicate).map(toOption);

    const sameNation = project((entry) => entry.nationId === options.actorNationId);
    const generalTargets: Record<string, TurnCommandOption[]> = {};
    for (const action of SAME_NATION_GENERAL_COMMANDS) generalTargets[action] = sameNation;
    for (const action of SAME_NATION_NATION_COMMANDS) generalTargets[action] = sameNation;

    generalTargets.che_선양 = project(
        (entry) => entry.nationId !== 0 && entry.nationId === options.actorNationId && entry.id !== options.actorId
    );
    generalTargets.che_등용 = project(
        (entry) => entry.npcState < 2 && entry.officerLevel !== 12 && entry.id !== options.actorId
    );
    generalTargets.che_장수대상임관 = project((entry) => entry.id !== options.actorId);

    return {
        // 기존 profile의 공통 fallback은 유저장 목록을 유지한다.
        generals: project((entry) => entry.npcState < 2),
        generalTargets,
    };
};
