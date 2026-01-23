import { createTournamentRng } from '@sammo-ts/common';

import {
    TournamentType,
    type TournamentBattleInput,
    type TournamentBattleResult,
    type TournamentBattleLogEntry,
} from './types.js';

const clampPositive = (value: number, fallback = 0): number => {
    if (!Number.isFinite(value)) {
        return fallback;
    }
    return value;
};

const round = (value: number): number => Math.round(value);

const getLogRatio = (lvl1: number, lvl2: number): number => {
    if (lvl1 >= lvl2) {
        return 1 + Math.log10(1 + lvl1 - lvl2) / 10;
    }
    return 1 - Math.log10(1 + lvl2 - lvl1) / 10;
};

const resolveTournamentStat = (type: TournamentType, stats: { leadership: number; strength: number; intel: number }): number => {
    switch (type) {
        case TournamentType.LEADERSHIP:
            return stats.leadership;
        case TournamentType.STRENGTH:
            return stats.strength;
        case TournamentType.INTEL:
            return stats.intel;
        case TournamentType.TOTAL:
        default:
            return (stats.leadership + stats.strength + stats.intel) * (7 / 15);
    }
};

export const resolveTournamentBattle = (input: TournamentBattleInput): TournamentBattleResult => {
    const { attacker, defender, battleType, context } = input;
    const attackerStat = resolveTournamentStat(input.type, attacker.stats);
    const defenderStat = resolveTournamentStat(input.type, defender.stats);

    const rng = createTournamentRng(input.baseSeed, {
        openYear: context.openYear,
        openMonth: context.openMonth,
        stage: context.stage,
        phase: context.phase,
        matchIndex: context.matchIndex,
        participantIndex: 0,
        extraSeed: `${attacker.id}:${defender.id}`,
    });

    const energyBaseAttacker = round(attackerStat * getLogRatio(attacker.level, defender.level) * 10);
    const energyBaseDefender = round(defenderStat * getLogRatio(attacker.level, defender.level) * 10);
    let energyAttacker = energyBaseAttacker;
    let energyDefender = energyBaseDefender;

    const maxTurns = battleType === 0 ? 10 : 100;
    const log: string[] = [];
    const logEntries: TournamentBattleLogEntry[] = [];

    log.push(`<S>●</> <Y>${attacker.name}</> <C>(${energyBaseAttacker})</> vs <C>(${energyBaseDefender})</> <Y>${defender.name}</>`);

    let totalDamageAttacker = 0;
    let totalDamageDefender = 0;
    let selected = 2;

    for (let phase = 1; phase <= maxTurns; phase += 1) {
        const baseDamageAttacker = round(defenderStat * (rng.nextInt(21) + 90) / 130);
        const baseDamageDefender = round(attackerStat * (rng.nextInt(21) + 90) / 130);
        let damageAttacker = baseDamageAttacker;
        let damageDefender = baseDamageDefender;

        if (attackerStat >= rng.nextInt(100)) {
            damageDefender += round(attackerStat * (rng.nextInt(41) + 10) / 130);
        }
        if (defenderStat >= rng.nextInt(100)) {
            damageAttacker += round(defenderStat * (rng.nextInt(41) + 10) / 130);
        }

        let criticalAttacker = false;
        let criticalDefender = false;
        let factorAttacker = 1;
        let factorDefender = 1;

        if (energyBaseAttacker / 5 > energyAttacker && damageAttacker > damageDefender && attackerStat >= rng.nextInt(300)) {
            factorDefender = round((rng.nextInt(301) + 200) / 100);
            criticalAttacker = true;
            log.push(`<S>●</> <Y>${attacker.name}</>의 분노의 일격!`);
        }
        if (energyBaseDefender / 5 > energyDefender && damageDefender > damageAttacker && defenderStat >= rng.nextInt(300)) {
            factorAttacker = round((rng.nextInt(301) + 200) / 100);
            criticalDefender = true;
            log.push(`<S>●</> <Y>${defender.name}</>의 분노의 일격!`);
        }

        damageAttacker = round(damageAttacker * factorAttacker);
        damageDefender = round(damageDefender * factorDefender);

        if (phase === 1) {
            if (attackerStat * 0.9 > defenderStat && attackerStat >= rng.nextInt(400)) {
                damageDefender += round(attackerStat * (rng.nextInt(31) + 70) / 100);
            }
            if (defenderStat * 0.9 > attackerStat && defenderStat >= rng.nextInt(400)) {
                damageAttacker += round(defenderStat * (rng.nextInt(31) + 70) / 100);
            }
        } else {
            if (!criticalAttacker && attackerStat >= rng.nextInt(1000)) {
                damageDefender += round(attackerStat * (rng.nextInt(31) + 20) / 100);
            }
            if (!criticalDefender && defenderStat >= rng.nextInt(1000)) {
                damageAttacker += round(defenderStat * (rng.nextInt(31) + 20) / 100);
            }
        }

        damageAttacker = clampPositive(round(damageAttacker), 0);
        damageDefender = clampPositive(round(damageDefender), 0);

        energyAttacker -= damageAttacker;
        energyDefender -= damageDefender;

        totalDamageAttacker += damageAttacker;
        totalDamageDefender += damageDefender;

        const entryText =
            `<S>●</> ${String(phase).padStart(2, '0')}合 : ` +
            `<C>${String(round(energyAttacker)).padStart(3, '0')}</>` +
            `<span class="ev_highlight">(-${String(round(damageAttacker)).padStart(3, '0')})</span>` +
            ' vs ' +
            `<span class="ev_highlight">(-${String(round(damageDefender)).padStart(3, '0')})</span>` +
            `<C>${String(round(energyDefender)).padStart(3, '0')}</>`;

        log.push(entryText);
        logEntries.push({
            phase,
            attackerEnergy: round(energyAttacker),
            defenderEnergy: round(energyDefender),
            attackerDamage: damageAttacker,
            defenderDamage: damageDefender,
            text: entryText,
        });

        if (energyAttacker <= 0 && energyDefender <= 0) {
            if (battleType === 0) {
                selected = 2;
                break;
            }
            selected = energyAttacker > energyDefender ? 0 : 1;
            break;
        }
        if (energyAttacker <= 0) {
            selected = 1;
            break;
        }
        if (energyDefender <= 0) {
            selected = 0;
            break;
        }
    }

    if (selected === 0) {
        log.push(`<S>●</> <Y>${attacker.name}</> <S>승리</>!`);
    } else if (selected === 1) {
        log.push(`<S>●</> <Y>${defender.name}</> <S>승리</>!`);
    } else {
        log.push(`<S>●</> <Y>${attacker.name}</> <S>무승부</>!`);
    }

    const winnerId = selected === 0 ? attacker.id : selected === 1 ? defender.id : null;
    const loserId = selected === 0 ? defender.id : selected === 1 ? attacker.id : null;

    return {
        winnerId,
        loserId,
        draw: selected === 2,
        rounds: logEntries.length,
        totalDamage: {
            attacker: totalDamageAttacker,
            defender: totalDamageDefender,
        },
        log,
        logEntries,
    };
};
