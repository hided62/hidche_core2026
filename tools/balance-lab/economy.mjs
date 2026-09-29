// Calculation-only use of the production recruitment resolver. No world mutation or DB access.
export function domainContext(payload, nation, time) {
    return {
        time,
        maxTechLevel: 12,
        nation: {
            id: nation.nation,
            typeCode: nation.type,
            gold: nation.gold,
            rice: nation.rice,
            meta: { tech: nation.tech },
        },
        general: {
            id: payload.no,
            name: payload.name,
            nationId: payload.nation,
            cityId: payload.city,
            troopId: 0,
            stats: { leadership: payload.leadership, strength: payload.strength, intelligence: payload.intel },
            role: {
                specialWar: payload.special2,
                specialDomestic: payload.special,
                personality: payload.personal,
                items: { horse: payload.horse, weapon: payload.weapon, book: payload.book, item: payload.item },
            },
            crew: 0,
            crewTypeId: payload.crewtype,
            injury: payload.injury,
            gold: payload.gold,
            rice: payload.rice,
            train: payload.train,
            atmos: payload.atmos,
            experience: payload.experience,
            dedication: payload.dedication,
            officerLevel: payload.officer_level,
            age: 20,
            npcState: 0,
            triggerState: { flags: {}, counters: {}, modifiers: {}, meta: {} },
            meta: {},
        },
    };
}

export function economicTools(logic, CommandResolver, items, war, nations) {
    const itemMap = new Map(items.map((item) => [item.key, item]));
    const warMap = new Map(war.map((trait) => [trait.key, trait]));
    const nationMap = new Map(nations.map((trait) => [trait.key, trait]));
    const modules = (payload, nation) =>
        [
            nationMap.get(nation.type),
            warMap.get(payload.special2),
            ...['horse', 'weapon', 'book', 'item'].map((slot) => itemMap.get(payload[slot])),
        ].filter(Boolean);
    function quote(payload, nation, time, unit, { gold = 5000, rice = 5000, population = 20000 } = {}) {
        const context = domainContext(payload, nation, time);
        const resolver = new CommandResolver(modules(payload, nation), {});
        const capacity = resolver.resolveFullLeadership(context) * 100;
        // Search the actual rounded resolver costs; population constraint uses the trait-adjusted draw.
        let low = 99,
            high = Math.floor(resolver.resolveLeadership(context) * 100);
        const feasible = (amount) => {
            const cost = resolver.getCost(context, unit.id, amount, unit);
            return (
                cost.gold <= gold &&
                cost.rice <= rice &&
                resolver.getRecruitPopulation(context, cost.applied) <= population
            );
        };
        while (low < high) {
            const middle = Math.ceil((low + high) / 2);
            if (feasible(middle)) low = middle;
            else high = middle - 1;
        }
        if (low < 100) return { capacity, crew: 0, gold: 0, rice: 0, population: 0, train: 0, atmos: 0 };
        const cost = resolver.getCost(context, unit.id, low, unit);
        return {
            capacity,
            crew: cost.applied,
            gold: cost.gold,
            rice: cost.rice,
            population: resolver.getRecruitPopulation(context, cost.applied),
            train: resolver.getTrain(context, unit),
            atmos: resolver.getAtmos(context, unit),
        };
    }
    function recruit(payload, cell) {
        const reports = new Map();
        for (const [general, nation] of [
            [payload.attackerGeneral, payload.attackerNation],
            ...payload.defenderGenerals.map((general) => [general, payload.defenderNation]),
        ]) {
            const unit = payload.unitSet.crewTypes.find((entry) => entry.id === general.crewtype);
            const result = quote(general, nation, payload.time, unit, {
                gold: cell.wallet,
                rice: 5000,
                population: 20000,
            });
            if (!result.crew) throw new Error('Recruitment budget cannot field the minimum 100 troops');
            general.crew = result.crew;
            general.gold = cell.wallet - result.gold;
            general.rice = 5000 - result.rice;
            general.train = cell.quality === 'fresh' ? result.train : 100;
            general.atmos = cell.quality === 'fresh' ? result.atmos : 100;
            reports.set(general.no, result);
        }
        const subject = cell.role === 'attack' ? payload.attackerGeneral : payload.defenderGenerals[0];
        const report = reports.get(subject.no);
        if (cell.crewFraction !== undefined) {
            if (!(cell.crewFraction > 0 && cell.crewFraction <= 1)) throw new Error('Invalid remaining troop fraction');
            // Prior attrition is a controlled snapshot, not a simulated earlier battle. Recruitment was paid in full.
            subject.crew = Math.floor(subject.crew * cell.crewFraction);
            report.remainingBeforeBattle = subject.crew;
        }
        return report;
    }
    function profile(payload, nation, time, module) {
        const context = domainContext(payload, nation, time);
        const pipeline = new logic.GeneralActionPipeline([module]);
        const output = {
            key: module.key,
            stats: {},
            statBaselines: {},
            opposeStats: {},
            domestic: {},
            strategies: {},
            events: Object.keys(module.eventHandlers ?? {}),
        };
        for (const stat of [
            'leadership',
            'strength',
            'intelligence',
            'experience',
            'dedication',
            'addDex',
            'injuryProb',
            'sabotageAttack',
            'sabotageDefence',
        ]) {
            const baseline = stat === 'injuryProb' ? 0.2 : 100;
            output.statBaselines[stat] = baseline;
            output.stats[stat] = pipeline.onCalcStat(context, stat, baseline);
            output.opposeStats[stat] = pipeline.onCalcOpposeStat(context, stat, baseline);
        }
        for (const action of [
            '농업',
            '상업',
            '기술',
            '수비',
            '성벽',
            '치안',
            '민심',
            '인구',
            '조달',
            '계략',
            '징병',
            '모병',
            '징집인구',
        ]) {
            output.domestic[action] = Object.fromEntries(
                ['score', 'cost', 'rice', 'success', 'fail', 'train', 'atmos'].map((kind) => {
                    const baseline = ['success', 'fail'].includes(kind) ? 0.2 : 100;
                    return [
                        kind,
                        { baseline, value: pipeline.onCalcDomestic(context, action, kind, baseline, { armType: 1 }) },
                    ];
                })
            );
        }
        for (const action of ['의병모집', '급습', '수몰'])
            output.strategies[action] = Object.fromEntries(
                ['delay', 'globalDelay'].map((kind) => [kind, pipeline.onCalcStrategic(context, action, kind, 100)])
            );
        return output;
    }
    return { quote, recruit, profile };
}

export function lifecycleProfiles(logic, common, payload, modules, seed, samples = 512) {
    const rows = [];
    for (const module of modules) {
        const events = Object.keys(module.eventHandlers ?? {});
        if (events.some((event) => event !== 'item.sold')) throw new Error(`Uncovered lifecycle event: ${module.key}`);
        if (events.includes('item.sold'))
            for (const year of [180, 200, 220]) {
                let personal = 0,
                    national = 0,
                    gold = 0;
                for (let index = 0; index < samples; index++) {
                    const context = domainContext(payload.attackerGeneral, payload.attackerNation, {
                        year,
                        month: 1,
                        startYear: 180,
                    });
                    const beforePersonal = context.general.gold + context.general.rice;
                    const beforeNational = context.nation.gold + context.nation.rice;
                    context.rng = new common.RandUtil(common.LiteHashDRBG.build(`${seed}/sale/${index}`));
                    logic.dispatchGeneralActionEventHandlers(
                        module.eventHandlers,
                        context,
                        logic.createGeneralActionEvent('item.sold', { itemKey: module.key, slot: module.slot })
                    );
                    personal += context.general.gold + context.general.rice - beforePersonal;
                    national += context.nation.gold + context.nation.rice - beforeNational;
                    gold += Number(context.general.gold > payload.attackerGeneral.gold);
                }
                rows.push({
                    key: module.key,
                    kind: 'sale-bonus',
                    year,
                    samples,
                    personalGain: personal / samples,
                    nationGain: national / samples,
                    goldFraction: gold / samples,
                });
            }
        if (module.getPreTurnExecuteTriggerList) {
            const totals = [0, 0, 0];
            for (let index = 0; index < samples; index++) {
                const context = domainContext(payload.attackerGeneral, payload.attackerNation, payload.time);
                const patients = [
                    context.general,
                    { ...structuredClone(context.general), id: 2 },
                    { ...structuredClone(context.general), id: 3, nationId: 2 },
                ];
                for (const general of patients) general.injury = 30;
                context.worldView = { listGenerals: () => patients };
                context.rng = new common.RandUtil(common.LiteHashDRBG.build(`${seed}/heal/${index}`));
                const triggerContext = logic.createGeneralTriggerContext(context);
                module.getPreTurnExecuteTriggerList(context)?.fire(triggerContext, {});
                patients.forEach((patient, index) => {
                    totals[index] += Number(patient.injury === 0);
                });
            }
            rows.push({
                key: module.key,
                kind: 'pre-turn-heal',
                samples,
                self: totals[0] / samples,
                ally: totals[1] / samples,
                enemy: totals[2] / samples,
            });
        }
    }
    return rows;
}

export function strategyPlans(VolunteerResolver, payload, nations, items) {
    const item = items.find((entry) => entry.key === 'che_전략_평만지장도');
    if (!item) throw new Error('Missing strategy item');
    return nations.flatMap((nation) =>
        [false, true].flatMap((equipped) =>
            [10, 30, 60].map((generals) => {
                const context = domainContext(
                    payload.attackerGeneral,
                    { ...payload.attackerNation, type: nation.key },
                    payload.time
                );
                const resolver = new VolunteerResolver([nation, ...(equipped ? [item] : [])], {
                    initialNationGenLimit: 10,
                });
                const delay = resolver.getPostDelay(context, generals);
                const globalDelay = resolver.getGlobalDelay(context);
                const horizon = 240;
                return {
                    key: nation.key,
                    equipped,
                    generals,
                    delay,
                    globalDelay,
                    horizon,
                    // Only one repeated strategy, resources/volunteer limit unconstrained. Not all-strategy throughput.
                    usesWithResources: 1 + Math.floor((horizon - 1) / Math.max(delay, globalDelay)),
                };
            })
        )
    );
}

// Controlled planning model, not the monthly national simulation: fixed starting budget and
// turn cap expose resource vs labour bottlenecks while retaining real nation-hook coefficients.
export function nationPlans(profiles) {
    const mixes = {
        development: ['농업', '상업', '기술'],
        defence: ['수비', '성벽', '치안'],
        recovery: ['민심', '인구', '치안'],
    };
    return profiles.flatMap((profile) =>
        Object.entries(mixes).flatMap(([role, actions]) =>
            [600, 1200, 2400].map((budget) => {
                let remaining = budget,
                    score = 0,
                    turns = 0;
                while (turns < 12) {
                    const action = actions[turns % actions.length];
                    const metric = profile.domestic[action];
                    if (remaining + 1e-8 < metric.cost) break;
                    remaining -= metric.cost;
                    score += metric.score;
                    turns++;
                }
                return {
                    key: profile.key,
                    role,
                    budget,
                    turns,
                    score,
                    spent: budget - remaining,
                    goldIncomePer1000: profile.income.gold * 10,
                    riceIncomePer1000: profile.income.rice * 10,
                    populationGainPer1000: profile.income.pop * 10,
                };
            })
        )
    );
}
