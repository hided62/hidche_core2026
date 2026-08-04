import { LogCategory, LogFormat, LogScope } from '@sammo-ts/logic';

import type { InMemoryTurnWorld } from './inMemoryWorld.js';
import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';
import type { NationBettingCandidate } from './types.js';

const joinYearMonth = (year: number, month: number): number => year * 12 + month - 1;

const readIntegerArg = (value: unknown, fallback: number, label: string): number => {
    if (value === undefined) {
        return fallback;
    }
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Error(`${label} must be an integer.`);
    }
    return value;
};

export const createOpenNationBettingHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return (args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const nationCount = readIntegerArg(args[0], 1, 'OpenNationBetting nation count');
        const bonusPoint = readIntegerArg(args[1], 0, 'OpenNationBetting bonus point');
        if (nationCount < 1) {
            throw new Error('OpenNationBetting nation count must be at least 1.');
        }
        if (bonusPoint < 0) {
            throw new Error('OpenNationBetting bonus point must not be negative.');
        }

        const generals = world.listGenerals();
        const cities = world.listCities();
        const candidates: NationBettingCandidate[] = world
            .listNations()
            .filter((nation) => nation.id > 0)
            .sort((left, right) => right.power - left.power)
            .map((nation) => {
                const generalCount = generals.filter((general) => general.nationId === nation.id).length;
                const cityCount = cities.filter((city) => city.nationId === nation.id).length;
                return {
                    title: nation.name,
                    info: `국력: ${nation.power}<br>장수 수: ${generalCount}<br>도시 수: ${cityCount}`,
                    isHtml: true,
                    aux: {
                        nation: nation.id,
                        name: nation.name,
                        color: nation.color,
                        type: nation.typeCode,
                        level: nation.level,
                        capital: nation.capitalCityId,
                        gennum: generalCount,
                        power: nation.power,
                        city_cnt: cityCount,
                    },
                };
            });

        const currentLastId = world.getState().meta.lastBettingId;
        const bettingId =
            (typeof currentLastId === 'number' && Number.isFinite(currentLastId) ? Math.trunc(currentLastId) : 0) + 1;
        world.updateWorldMeta({ lastBettingId: bettingId });

        const shortName = nationCount === 1 ? '천통국' : `최후 ${nationCount}국`;
        const openYearMonth = joinYearMonth(environment.year, environment.month);
        world.queueNationBettingOpen({
            id: bettingId,
            name: `${shortName} 예상`,
            selectCount: nationCount,
            isExclusive: null,
            requiresInheritancePoint: true,
            openYearMonth,
            closeYearMonth: openYearMonth + 24,
            candidates,
            bonusPoint,
        });

        const eventId = world.getNextEventId();
        if (
            !world.addEvent({
                id: eventId,
                targetCode: 'DESTROY_NATION',
                priority: 1_000,
                condition: ['RemainNation', '<=', nationCount],
                action: [['FinishNationBetting', bettingId], ['DeleteEvent']],
                meta: {},
            })
        ) {
            throw new Error(`Failed to add FinishNationBetting event: ${eventId}`);
        }

        world.pushLog({
            scope: LogScope.SYSTEM,
            category: LogCategory.HISTORY,
            format: LogFormat.YEAR_MONTH,
            text:
                nationCount > 1
                    ? '<B><b>【내기】</b></>중원의 강자를 점치는 <C>내기</>가 진행중입니다! 호사가의 참여를 기다립니다!'
                    : '<B><b>【내기】</b></>천하통일 후보를 점치는 <C>내기</>가 진행중입니다! 호사가의 참여를 기다립니다!',
        });

        const text = `새로운 ${shortName} 내기가 열렸습니다. 천통국 베팅란을 확인해주세요.`;
        const now = new Date(environment.turnTime.getTime());
        for (const general of generals.filter((entry) => entry.npcState <= 1)) {
            const nation = world.getNationById(general.nationId);
            world.queueMessage({
                msgType: 'private',
                src: {
                    generalId: 0,
                    generalName: '',
                    nationId: 0,
                    nationName: 'System',
                    color: '#000000',
                    icon: '',
                },
                dest: {
                    generalId: general.id,
                    generalName: general.name,
                    nationId: general.nationId,
                    nationName: nation?.name ?? '재야',
                    color: nation?.color ?? '#000000',
                    icon: general.picture ?? '',
                },
                text,
                time: now,
                validUntil: new Date('9999-12-31T00:00:00.000Z'),
                option: {},
            });
        }
    };
};

export const createFinishNationBettingHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
}): MonthlyEventActionHandler => {
    return (args, environment) => {
        const world = options.getWorld();
        if (!world) {
            return;
        }
        const bettingId = readIntegerArg(args[0], 0, 'FinishNationBetting betting ID');
        if (bettingId <= 0) {
            throw new Error('FinishNationBetting betting ID must be positive.');
        }
        world.queueNationBettingFinish({
            id: bettingId,
            winnerNationIds: world
                .listNations()
                .filter((nation) => nation.level > 0)
                .map((nation) => nation.id),
            year: environment.year,
            month: environment.month,
            turnTime: environment.turnTime,
        });
    };
};
