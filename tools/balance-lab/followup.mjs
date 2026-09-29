import { BASE_UNITS, nativeBuild } from './design.mjs';

export const FOLLOWUP_SUITES = ['conditional', 'premium', 'sensitivity', 'recruit', 'attrition', 'counter'];
export function buildFollowupPlan(catalog, suite) {
    const cells = [];
    const add = (cell) => cells.push({ id: String(cells.length).padStart(5, '0'), ...cell });
    const subjects = [1100, 1200, 1300, 1400, 1501];
    if (suite === 'conditional') {
        // Same effect registry, but opponents meet region/city conditions absent from basic-family screens.
        const candidates = [
            ...catalog.war.map((trait) => ({ key: trait.key, generalPatch: { special2: trait.key } })),
            ...catalog.items.map((item) => ({ key: item.key, generalPatch: { [item.slot]: item.key } })),
        ];
        for (const candidate of candidates)
            for (const unit of subjects)
                for (const opponent of [1104, 1407]) {
                    for (const role of ['attack', 'defend'])
                        add({
                            ...candidate,
                            category: suite,
                            unit,
                            opponent,
                            build: nativeBuild(unit),
                            opponentBuild: nativeBuild(opponent),
                            role,
                            mode: 'field',
                            paired: true,
                        });
                }
        for (const opponent of [1100, 1101, 1104, 1407])
            for (const role of ['attack', 'defend']) {
                add({
                    category: suite,
                    key: 'che_척사+che_척사_오악진형도',
                    unit: 1100,
                    build: 'martial',
                    opponent,
                    opponentBuild: nativeBuild(opponent),
                    role,
                    mode: 'field',
                    paired: true,
                    generalPatch: { special2: 'che_척사', item: 'che_척사_오악진형도' },
                    factorialPatches: [{ special2: 'che_척사' }, { item: 'che_척사_오악진형도' }],
                });
            }
    } else if (suite === 'premium') {
        const keys = [
            'che_명마_12_옥란백용구',
            'che_명마_07_백상',
            'che_불굴_상편',
            'che_위압_조목삭',
            'che_회피_태평요술',
        ];
        for (const key of keys) {
            const item = catalog.items.find((entry) => entry.key === key);
            if (!item) throw new Error(`Unknown premium candidate ${key}`);
            // Horse: persistent buyable +6 horse. Tool: empty slot and recurring consumable are separate controls.
            const controls = item.slot === 'horse' ? ['che_명마_06_흑색마'] : [null, 'che_훈련_청주'];
            for (const control of controls)
                for (const unit of subjects)
                    for (const opponent of [1100, 1200, 1300, 1400, 1104, 1407]) {
                        for (const role of ['attack', 'defend'])
                            add({
                                category: suite,
                                key,
                                unit,
                                opponent,
                                build: nativeBuild(unit),
                                opponentBuild: nativeBuild(opponent),
                                role,
                                mode: 'field',
                                paired: true,
                                baseline: control ?? 'empty',
                                generalPatch: { [item.slot]: key },
                                controlPatch: { [item.slot]: control },
                            });
                    }
        }
    } else if (suite === 'counter') {
        for (const special2 of [null, 'che_반계', 'che_격노'])
            for (const unit of subjects)
                for (const opponent of [1100, 1300, 1400, 1407])
                    for (const role of ['attack', 'defend'])
                        add({
                            category: suite,
                            key: 'che_진압_박혁론',
                            unit,
                            opponent,
                            build: nativeBuild(unit),
                            opponentBuild: nativeBuild(opponent),
                            role,
                            mode: 'field',
                            paired: true,
                            condition: special2 ?? 'no-opponent-trait',
                            opponentPatch: { special2 },
                            generalPatch: { item: 'che_진압_박혁론' },
                        });
    } else if (suite === 'attrition') {
        for (const key of ['che_명마_12_옥란백용구', 'che_불굴_상편']) {
            const item = catalog.items.find((entry) => entry.key === key);
            if (!item) throw new Error(`Unknown attrition candidate ${key}`);
            const control = item.slot === 'horse' ? 'che_명마_06_흑색마' : null;
            for (const unit of subjects)
                for (const crewFraction of [1, 0.5, 0.25])
                    for (const opponent of [1100, 1200, 1300, 1407])
                        for (const role of ['attack', 'defend'])
                            add({
                                category: suite,
                                key,
                                unit,
                                opponent,
                                build: nativeBuild(unit),
                                opponentBuild: nativeBuild(opponent),
                                role,
                                mode: 'field',
                                paired: true,
                                budget: 'recruited',
                                wallet: 100000,
                                quality: 'trained',
                                crewFraction,
                                condition: `remaining-${crewFraction}`,
                                baseline: control ?? 'empty',
                                generalPatch: { [item.slot]: key },
                                controlPatch: { [item.slot]: control },
                            });
        }
    } else if (suite === 'sensitivity') {
        for (const [condition, patch] of Object.entries({
            early: { year: 183, tech: 1000, dex: 0, readiness: 80, statScale: 0.8 },
            trained: { year: 200, tech: 3000, dex: 10000, readiness: 100 },
            late: { year: 220, tech: 6000, dex: 50000, readiness: 110, statScale: 1.4 },
        }))
            for (const unit of BASE_UNITS)
                for (const opponent of BASE_UNITS) {
                    for (const role of ['attack', 'defend'])
                        add({
                            category: suite,
                            key: String(unit),
                            unit,
                            opponent,
                            build: nativeBuild(unit),
                            opponentBuild: nativeBuild(opponent),
                            role,
                            mode: 'field',
                            condition,
                            ...patch,
                        });
                }
    } else if (suite === 'recruit') {
        const variants = [
            { key: 'che_징병', generalPatch: { special2: 'che_징병' } },
            { key: 'che_징병_낙주', generalPatch: { item: 'che_징병_낙주' } },
            {
                key: 'che_명마_12_옥란백용구',
                generalPatch: { horse: 'che_명마_12_옥란백용구' },
                controlPatch: { horse: 'che_명마_06_흑색마' },
            },
            ...['보병', '궁병', '기병'].map((name) => ({
                key: `che_${name}`,
                generalPatch: { special2: `che_${name}` },
            })),
        ];
        for (const candidate of variants)
            for (const unit of subjects)
                for (const wallet of [1500, 5000]) {
                    for (const quality of ['fresh', 'trained'])
                        for (const opponent of [1100, 1300, 1400]) {
                            add({
                                ...candidate,
                                category: suite,
                                unit,
                                opponent,
                                build: nativeBuild(unit),
                                opponentBuild: nativeBuild(opponent),
                                role: 'attack',
                                mode: 'field',
                                paired: true,
                                budget: 'recruited',
                                wallet,
                                quality,
                            });
                        }
                }
    } else throw new Error(`Unknown follow-up suite ${suite}`);
    return cells;
}
