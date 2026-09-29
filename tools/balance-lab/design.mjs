// Internal experiment design. No router, database, server seed or gameplay mutation.
export const DESIGN_VERSION = 'balance-lab-v3.2';
export const BUILDS = {
    martial: { leadership: 90, strength: 90, intel: 30 },
    scholar: { leadership: 90, strength: 30, intel: 90 },
    command: { leadership: 150, strength: 30, intel: 30 },
    hybrid: { leadership: 30, strength: 90, intel: 90 },
};
export const BASE_UNITS = [1100, 1200, 1300, 1400, 1500];
export const nativeBuild = (unit) =>
    Math.floor(unit / 100) === 14 ? 'scholar' : Math.floor(unit / 100) === 15 ? 'command' : 'martial';

export function general(id, unit, build, crew = 7000) {
    return {
        no: id,
        name: `fixture-${id}`,
        nation: id,
        city: id,
        turntime: '2000-01-01 00:00:00',
        personal: null,
        special: 'None',
        special2: null,
        crew,
        crewtype: unit,
        atmos: 100,
        train: 100,
        ...BUILDS[build],
        intel_exp: 0,
        book: null,
        strength_exp: 0,
        weapon: null,
        injury: 0,
        leadership_exp: 0,
        horse: null,
        item: null,
        explevel: 0,
        experience: 1000,
        dedication: 1000,
        officer_level: 1,
        officer_city: 0,
        gold: 100000,
        rice: 100000,
        dex1: 1000,
        dex2: 1000,
        dex3: 1000,
        dex4: 1000,
        dex5: 1000,
        defence_train: 0,
        recent_war: null,
        warnum: 0,
        killnum: 0,
        killcrew: 0,
    };
}

function city(id, wall) {
    return {
        city: id,
        nation: id,
        supply: 1,
        name: `fixture-city-${id}`,
        pop: 50000,
        agri: 1000,
        comm: 1000,
        secu: 1000,
        def: wall,
        wall,
        trust: 100,
        level: 5,
        pop_max: 100000,
        agri_max: 2000,
        comm_max: 2000,
        secu_max: 2000,
        def_max: Math.max(2000, wall),
        wall_max: Math.max(2000, wall),
        dead: 0,
        state: 0,
        conflict: '{}',
    };
}

function nation(id, type = 'che_중립') {
    return {
        type,
        tech: 3000,
        level: 1,
        capital: id,
        nation: id,
        name: `fixture-nation-${id}`,
        gold: 100000,
        rice: 100000,
        gennum: 10,
    };
}

export function makePayload(unitSet, cell, seed, treatment = true) {
    const { build, opponentBuild = build, unit, opponent, mode, role, budget = 'equal-crew' } = cell;
    if (!BUILDS[build] || !BUILDS[opponentBuild]) throw new Error('Unknown build');
    const lookup = (id) => {
        const found = unitSet.crewTypes.find((entry) => entry.id === id);
        if (!found) throw new Error(`Unknown unit ${id}`);
        return found;
    };
    const count = (id, buildKey) =>
        budget === 'capacity'
            ? BUILDS[buildKey].leadership * 100
            : budget === 'equal-gold'
              ? Math.min(BUILDS[buildKey].leadership * 100, Math.floor((7000 * 9) / lookup(id).cost))
              : Math.min(7000, BUILDS[buildKey].leadership * 100);
    const subject = general(role === 'attack' ? 1 : 2, unit, build, count(unit, build));
    const other = general(role === 'attack' ? 2 : 1, opponent, opponentBuild, count(opponent, opponentBuild));
    Object.assign(subject, cell.commonPatch ?? {}, treatment ? (cell.generalPatch ?? {}) : (cell.controlPatch ?? {}));
    Object.assign(other, cell.opponentPatch ?? {});
    for (const participant of [subject, other]) {
        if (cell.readiness !== undefined) participant.train = participant.atmos = cell.readiness;
        if (cell.dex !== undefined) for (let family = 1; family <= 5; family++) participant[`dex${family}`] = cell.dex;
        if (cell.statScale !== undefined)
            for (const stat of ['leadership', 'strength', 'intel']) participant[stat] *= cell.statScale;
    }
    if (cell.condition === 'depleted') {
        subject.crew = Math.floor(subject.crew * 0.5);
        subject.train = 70;
        subject.atmos = 70;
    }
    const attack = role === 'attack' ? subject : other;
    const defend = role === 'attack' ? other : subject;
    const payload = {
        action: 'battle',
        repeatCnt: 1,
        seed,
        year: 200,
        month: 1,
        attackerGeneral: attack,
        attackerCity: city(1, 1000),
        attackerNation: nation(1),
        defenderGenerals:
            mode === 'siege'
                ? []
                : mode === 'line'
                  ? [defend, { ...defend, no: 3, name: 'fixture-3' }, { ...defend, no: 4, name: 'fixture-4' }]
                  : [defend],
        defenderCity: city(2, mode === 'field' ? 0 : (cell.wall ?? 1000)),
        defenderNation: nation(2),
        unitSet,
        scenarioEffect: null,
        config: {
            armPerPhase: 500,
            maxTrainByCommand: 100,
            maxAtmosByCommand: 100,
            maxTrainByWar: 110,
            maxAtmosByWar: 150,
            maxGeneralStat: 255,
            statUpgradeLimit: 30,
            maxTechLevel: 12,
            castleCrewTypeId: 1000,
            armTypes: { footman: 1, archer: 2, cavalry: 3, wizard: 4, siege: 5, misc: 6, castle: 0 },
        },
        time: { year: 200, month: 1, startYear: 180 },
    };
    if (treatment && cell.nationTrait) {
        payload[role === 'attack' ? 'attackerNation' : 'defenderNation'].type = cell.nationTrait;
    }
    payload.year = payload.time.year = cell.year ?? 200;
    payload.attackerNation.tech = payload.defenderNation.tech = cell.tech ?? 3000;
    if (mode === 'siege' && role !== 'attack') throw new Error('Siege subject must attack');
    return payload;
}

export function summarize(values) {
    if (!values.length || values.some((value) => !Number.isFinite(value))) throw new Error('Invalid samples');
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const variance = n > 1 ? values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : null;
    // Normal-approximation interval, descriptive screening only; never a multiple-testing gate.
    const half = variance === null ? null : 1.96 * Math.sqrt(variance / n);
    const sorted = values.toSorted((a, b) => a - b);
    return {
        n,
        mean,
        sd: variance === null ? null : Math.sqrt(variance),
        ci95: half === null ? null : [mean - half, mean + half],
        p10: sorted[Math.floor((n - 1) * 0.1)],
        p50: sorted[Math.floor((n - 1) * 0.5)],
        p90: sorted[Math.floor((n - 1) * 0.9)],
        min: sorted[0],
        max: sorted[n - 1],
    };
}

export function observe(outcome, payload, role) {
    const subjectId = role === 'attack' ? 1 : 2;
    const report = outcome.reports.find((entry) => entry.type === 'general' && entry.id === subjectId);
    if (!report) throw new Error('Subject report missing');
    const ownStart = role === 'attack' ? payload.attackerGeneral : payload.defenderGenerals[0];
    const ownEnd = role === 'attack' ? outcome.attacker : outcome.defenders[0];
    const enemyReports = outcome.reports.filter((entry) => entry.type === 'general' && entry.id !== subjectId);
    const fieldKills = enemyReports.reduce((sum, entry) => sum + entry.dead, 0);
    const wall = outcome.reports.find((entry) => entry.type === 'city');
    const enemyStart =
        role === 'attack'
            ? payload.defenderGenerals.reduce((sum, entry) => sum + entry.crew, 0)
            : payload.attackerGeneral.crew;
    const enemyEnd =
        role === 'attack' ? outcome.defenders.reduce((sum, entry) => sum + entry.crew, 0) : outcome.attacker.crew;
    return {
        // Fractional loss difference is bounded and comparable across troop budgets, unlike kill/death ratios.
        exchange: enemyStart ? fieldKills / enemyStart - report.dead / ownStart.crew : null,
        fieldKills,
        dead: report.dead,
        remaining: ownEnd.crew,
        rice: ownStart.rice - ownEnd.rice,
        goldGain: ownEnd.gold - ownStart.gold,
        experienceGain: ownEnd.experience - ownStart.experience,
        dedicationGain: ownEnd.dedication - ownStart.dedication,
        injury: ownEnd.injury - ownStart.injury,
        phase: report.phase ?? 0,
        wallDamage: role === 'attack' ? (wall?.dead ?? 0) : 0,
        breakthrough: Number(outcome.conquered),
        annihilated: Number(ownEnd.crew === 0),
        enemyAnnihilated: enemyStart ? Number(enemyEnd === 0) : null,
    };
}

export function buildPlan(catalog, suite) {
    const cells = [];
    const add = (cell) => cells.push({ id: String(cells.length).padStart(5, '0'), ...cell });
    if (suite === 'families' || suite === 'tiers') {
        const candidates =
            suite === 'families'
                ? catalog.units.filter((unit) => BASE_UNITS.includes(unit.id))
                : catalog.units.filter((unit) =>
                      unit.requirements.some((req) => req.type === 'ReqTech' && req.tech === 3000)
                  );
        for (const unit of candidates)
            for (const enemy of candidates) {
                for (const budget of ['equal-crew', 'equal-gold', 'capacity'])
                    for (const role of ['attack', 'defend']) {
                        add({
                            category: suite,
                            key: String(unit.id),
                            unit: unit.id,
                            opponent: enemy.id,
                            build: nativeBuild(unit.id),
                            opponentBuild: nativeBuild(enemy.id),
                            budget,
                            role,
                            mode: 'field',
                        });
                    }
            }
    } else if (suite === 'interactions') {
        const pairs = [
            ['che_공성', 'che_공성_묵자', 1501],
            ['che_공성', 'che_행동_서촉지형도', 1501],
            ['che_반계', 'che_서적_07_사마법', 1400],
            ['che_반계', 'che_서적_12_산해경', 1400],
            ['che_격노', 'che_격노_구정신단경', 1100],
            ['che_집중', 'che_환술_논어집해', 1400],
            ['che_환술', 'che_집중_전국책', 1400],
            ['che_척사', 'che_척사_오악진형도', 1100],
            ['che_위압', 'che_위압_조목삭', 1100],
            ['che_징병', 'che_징병_낙주', 1501],
        ];
        for (const [trait, key, unit] of pairs) {
            const item = catalog.items.find((entry) => entry.key === key);
            if (!item) throw new Error(`Missing interaction item ${key}`);
            for (const mode of ['field', 'siege', 'line'])
                for (const condition of ['ready', 'depleted']) {
                    for (const wall of mode === 'siege' ? [1000, 5000] : [1000])
                        add({
                            category: 'interaction',
                            key: `${trait}+${key}`,
                            unit,
                            build: nativeBuild(unit),
                            opponent: 1400,
                            opponentBuild: 'scholar',
                            role: 'attack',
                            mode,
                            condition,
                            paired: true,
                            wall,
                            generalPatch: { special2: trait, [item.slot]: key },
                            factorialPatches: [{ special2: trait }, { [item.slot]: key }],
                        });
                }
        }
    } else if (suite === 'units') {
        for (const unit of catalog.units)
            for (const build of Object.keys(BUILDS)) {
                for (const budget of ['equal-crew', 'equal-gold']) {
                    for (const opponent of BASE_UNITS)
                        for (const role of ['attack', 'defend']) {
                            add({
                                category: 'unit',
                                key: String(unit.id),
                                unit: unit.id,
                                build,
                                budget,
                                opponent,
                                role,
                                mode: 'field',
                            });
                        }
                    for (const wall of [1000, 5000])
                        add({
                            category: 'unit',
                            key: String(unit.id),
                            unit: unit.id,
                            build,
                            budget,
                            opponent: 1100,
                            role: 'attack',
                            mode: 'siege',
                            wall,
                        });
                }
            }
    } else {
        const treatments =
            suite === 'items'
                ? catalog.items.map((item) => ({
                      category: 'item',
                      key: item.key,
                      generalPatch: { [item.slot]: item.key },
                  }))
                : suite === 'traits'
                  ? catalog.war.map((trait) => ({
                        category: 'war',
                        key: trait.key,
                        generalPatch: { special2: trait.key },
                    }))
                  : suite === 'nations'
                    ? catalog.nations.map((trait) => ({
                          category: 'nation',
                          key: trait.key,
                          nationTrait: trait.key,
                      }))
                    : null;
        if (!treatments) throw new Error(`Unknown suite ${suite}`);
        for (const treatment of treatments)
            for (const [build, unit] of [
                ['martial', 1100],
                ['martial', 1200],
                ['martial', 1300],
                ['scholar', 1400],
                ['command', 1501],
            ]) {
                for (const opponent of [1100, 1200, 1300, 1400, 1500])
                    for (const role of ['attack', 'defend']) {
                        add({
                            ...treatment,
                            unit,
                            build,
                            opponent,
                            opponentBuild: nativeBuild(opponent),
                            role,
                            mode: 'field',
                            paired: true,
                        });
                    }
                for (const wall of [1000, 5000])
                    add({
                        ...treatment,
                        unit,
                        build,
                        opponent: 1100,
                        role: 'attack',
                        mode: 'siege',
                        wall,
                        paired: true,
                    });
            }
    }
    return cells;
}
