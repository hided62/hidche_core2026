import { JosaUtil } from '@sammo-ts/common';
import { LogCategory, LogFormat, LogScope, type TurnCommandEnv } from '@sammo-ts/logic';

import type { InMemoryTurnWorld, TurnCalendarHandler } from './inMemoryWorld.js';

const readNumber = (value: unknown, fallback = 0): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
            return parsed;
        }
    }
    return fallback;
};

const formatHourMinute = (date: Date): string =>
    `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;

export const createMonthlyWanderHandler = (options: {
    getWorld: () => InMemoryTurnWorld | null;
    startYear: number;
    commandEnv: TurnCommandEnv;
}): TurnCalendarHandler => ({
    onMonthChanged: (context) => {
        const world = options.getWorld();
        if (!world || context.currentYear < options.startYear + 2) {
            return;
        }
        const baseGold = options.commandEnv.baseGold > 0 ? options.commandEnv.baseGold : 1_000;
        const baseRice = options.commandEnv.baseRice > 0 ? options.commandEnv.baseRice : 1_000;
        const wanderers = world
            .listGenerals()
            .filter((general) => {
                const nation = world.getNationById(general.nationId);
                return nation?.level === 0 && general.officerLevel === 12;
            })
            .sort((left, right) => left.id - right.id);

        for (const wanderer of wanderers) {
            const nation = world.getNationById(wanderer.nationId);
            if (!nation || nation.level !== 0 || wanderer.officerLevel !== 12) {
                continue;
            }
            const nationGenerals = world
                .listGenerals()
                .filter((general) => general.nationId === nation.id)
                .sort((left, right) => left.id - right.id);
            const nationCities = world.listCities().filter((city) => city.nationId === nation.id);
            const nationGeneralIds = nationGenerals.map((general) => general.id);
            const nationNameJosaYi = JosaUtil.pick(nation.name, '이');
            const nationNameJosaUl = JosaUtil.pick(nation.name, '을');
            const nationNameJosaUn = JosaUtil.pick(nation.name, '은');
            const wandererNameJosaYi = JosaUtil.pick(wanderer.name, '이');

            // Preserve the legacy two-UPDATE bug: gold is capped first, then the
            // rice UPDATE tests the already-capped gold column.
            for (const general of nationGenerals) {
                const gold = Math.min(general.gold, baseGold);
                const rice = gold > baseRice ? Math.min(general.rice, baseRice) : general.rice;
                const belong = readNumber(general.meta.belong);
                const maxBelong = readNumber(general.meta.max_belong);
                world.updateGeneral(general.id, {
                    gold,
                    rice,
                    meta: {
                        ...general.meta,
                        belong: 0,
                        officer_city: 0,
                        officerCity: 0,
                        permission: 'normal',
                        ...(general.npcState < 2 ? { max_belong: Math.max(belong, maxBelong) } : {}),
                    },
                });
            }
            const updatedWanderer = world.getGeneralById(wanderer.id);
            if (!updatedWanderer) {
                continue;
            }
            world.updateGeneral(wanderer.id, {
                gold: Math.min(updatedWanderer.gold, baseGold),
                rice: Math.min(updatedWanderer.rice, baseRice),
                lastTurn: { command: '해산', arg: {} },
                meta: {
                    ...updatedWanderer.meta,
                    makelimit: 12,
                },
            });
            for (const city of nationCities) {
                world.updateCity(city.id, { nationId: 0, frontState: 0 });
            }

            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.HISTORY,
                text: `<R><b>【멸망】</b></><D><b>${nation.name}</b></>${nationNameJosaUn} <R>멸망</>했습니다.`,
                format: LogFormat.YEAR_MONTH,
            });
            for (const general of nationGenerals.filter((general) => general.id !== wanderer.id)) {
                world.pushLog({
                    scope: LogScope.GENERAL,
                    category: LogCategory.HISTORY,
                    generalId: general.id,
                    text: `<D><b>${nation.name}</b></>${nationNameJosaYi} <R>멸망</>`,
                    format: LogFormat.YEAR_MONTH,
                });
                world.pushLog({
                    scope: LogScope.GENERAL,
                    category: LogCategory.ACTION,
                    generalId: general.id,
                    text: `<D><b>${nation.name}</b></>${nationNameJosaYi} <R>멸망</>했습니다.`,
                    format: LogFormat.PLAIN,
                });
            }
            world.pushLog({
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                generalId: wanderer.id,
                text: `<D><b>${nation.name}</b></>${nationNameJosaUl} 해산`,
                format: LogFormat.YEAR_MONTH,
            });
            world.pushLog({
                scope: LogScope.GENERAL,
                category: LogCategory.HISTORY,
                generalId: wanderer.id,
                text: `<D><b>${nation.name}</b></>${nationNameJosaYi} <R>멸망</>`,
                format: LogFormat.YEAR_MONTH,
            });
            world.pushLog({
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: wanderer.id,
                text: '초반 제한후 방랑군은 자동 해산됩니다.',
                format: LogFormat.PLAIN,
            });
            world.pushLog({
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: wanderer.id,
                text: `세력을 해산했습니다. <1>${formatHourMinute(wanderer.turnTime)}</>`,
                format: LogFormat.MONTH,
            });
            world.pushLog({
                scope: LogScope.GENERAL,
                category: LogCategory.ACTION,
                generalId: wanderer.id,
                text: `<D><b>${nation.name}</b></>${nationNameJosaYi} <R>멸망</>했습니다.`,
                format: LogFormat.PLAIN,
            });
            world.pushLog({
                scope: LogScope.SYSTEM,
                category: LogCategory.SUMMARY,
                text: `<Y>${wanderer.name}</>${wandererNameJosaYi} 세력을 해산했습니다.`,
                format: LogFormat.MONTH,
            });

            if (!world.collapseNation(nation.id)) {
                throw new Error(`Monthly wander disband could not remove nation ${nation.id}.`);
            }
            if (nationGeneralIds.some((generalId) => world.getGeneralById(generalId)?.nationId !== 0)) {
                throw new Error(`Monthly wander disband did not detach every general of nation ${nation.id}.`);
            }
        }
    },
});
