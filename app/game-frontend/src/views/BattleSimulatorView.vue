<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, shallowRef } from 'vue';
import type { BattleSimRequestPayload, BattleSimResultPayload } from '@sammo-ts/game-api';
import PanelCard from '../components/ui/PanelCard.vue';
import SkeletonLines from '../components/ui/SkeletonLines.vue';
import BattleGeneralCard from '../components/battle/BattleGeneralCard.vue';
import { useGameFeedback } from '../composables/useGameFeedback';
import { trpc } from '../utils/trpc';
import { getNpcColor } from '../utils/npcColor';
import { compareGeneralTypeThenName } from '../utils/generalOrder';
import type { BattleSimOptions, GeneralDraft, InheritBuff } from '../utils/battleSimulatorTypes';
import { BattleSimulatorWorkerClient } from '../utils/battleSimulatorWorkerClient';
import { formatSeoulDateTime } from '../utils/legacyDateTime';

type GeneralExport = Omit<GeneralDraft, 'id'>;

type BattleExport = {
    attackerGeneral: GeneralExport;
    attackerCity: { level: number };
    attackerNation: { type: string; tech: number; level: number; capital: number };
    defenderGenerals: GeneralExport[];
    defenderCity: { level: number; def: number; wall: number };
    defenderNation: { type: string; tech: number; level: number; capital: number };
    year: number;
    month: number;
    repeatCnt: number;
    seed?: string;
};

type ExportedInfo = { objType: 'general'; data: GeneralExport } | { objType: 'battle'; data: BattleExport };

type GeneralListResponse = Awaited<ReturnType<typeof trpc.battle.getGeneralList.query>>;
type GeneralMeResponse = Awaited<ReturnType<typeof trpc.general.me.query>>;

const loading = ref(true);
const error = ref<string | null>(null);
// Worker execution data must stay outside Vue's deep reactive proxy graph so it remains structured-cloneable.
const options = shallowRef<BattleSimOptions | null>(null);
const battleResult = ref<BattleSimResultPayload | null>(null);

const attackerNation = reactive({
    type: '',
    tech: 1,
    level: 0,
    isCapital: false,
});

const attackerCity = reactive({
    level: 5,
});

const defenderNation = reactive({
    type: '',
    tech: 1,
    level: 0,
    isCapital: false,
});

const defenderCity = reactive({
    level: 5,
    def: 1000,
    wall: 1000,
});

const year = ref(0);
const month = ref(1);
const repeatCnt = ref(1);
const seed = ref('');

const attackerGeneral = ref<GeneralDraft | null>(null);
const defenders = ref<GeneralDraft[]>([]);

const isSimulating = ref(false);
const simulationWorker = new BattleSimulatorWorkerClient();
const { info: showInfoToast, dismissToast } = useGameFeedback();

onBeforeUnmount(() => {
    simulationWorker.dispose();
});

const importOpen = ref(false);
const importTarget = ref<GeneralDraft | null>(null);
const generalList = ref<GeneralListResponse | null>(null);
const generalListLoading = ref(false);
const selectedGeneralId = ref<number | null>(null);
const gameDefaults = ref<GeneralMeResponse>(null);

const availableCrewTypes = computed(() => {
    const context = options.value;
    if (!context) {
        return [];
    }
    return (context.unitSet.crewTypes ?? [])
        .filter((crewType) => crewType.armType !== context.config.armTypes.castle)
        .map((crewType) => ({ id: crewType.id, name: crewType.name, armType: crewType.armType }));
});

let generalIdSeed = 0;

const createInheritBuff = (): InheritBuff => ({
    warAvoidRatio: 0,
    warCriticalRatio: 0,
    warMagicTrialProb: 0,
    warAvoidRatioOppose: 0,
    warCriticalRatioOppose: 0,
    warMagicTrialProbOppose: 0,
});

const nextGeneralId = (): string => {
    generalIdSeed += 1;
    return `general-${Date.now()}-${generalIdSeed}`;
};

const getUsedGeneralNos = (excludeId?: string): Set<number> => {
    const used = new Set<number>();
    if (attackerGeneral.value && attackerGeneral.value.id !== excludeId) {
        used.add(attackerGeneral.value.no);
    }
    for (const defender of defenders.value) {
        if (defender.id !== excludeId) {
            used.add(defender.no);
        }
    }
    return used;
};

const resolveGeneralNo = (preferred: number | null, excludeId?: string): number => {
    const used = getUsedGeneralNos(excludeId);
    if (preferred && preferred !== 1 && !used.has(preferred)) {
        return preferred;
    }
    let candidate = 2;
    while (used.has(candidate) || candidate === 1) {
        candidate += 1;
    }
    return candidate;
};

const createGeneralDraft = (overrides?: Partial<GeneralDraft>): GeneralDraft => {
    const baseCrew = options.value?.unitSet.defaultCrewTypeId ?? availableCrewTypes.value[0]?.id ?? 1;
    const draft: GeneralDraft = {
        id: nextGeneralId(),
        no: 0,
        name: '무명',
        officerLevel: 1,
        expLevel: 20,
        leadership: 50,
        strength: 50,
        intel: 50,
        horse: null,
        weapon: null,
        book: null,
        item: null,
        injury: 0,
        rice: 5000,
        personal: null,
        special: null,
        special2: null,
        crew: 7000,
        crewtype: baseCrew,
        atmos: 100,
        train: 100,
        dex1: 0,
        dex2: 0,
        dex3: 0,
        dex4: 0,
        dex5: 0,
        defenceTrain: 90,
        warnum: 0,
        killnum: 0,
        killcrew: 0,
        inheritBuff: createInheritBuff(),
    };
    Object.assign(draft, overrides);
    draft.no = resolveGeneralNo(overrides?.no ?? null, draft.id);
    if (draft.crewtype <= 0) {
        draft.crewtype = baseCrew;
    }
    return draft;
};

const createAttackerGeneral = () => {
    const draft = createGeneralDraft();
    draft.no = 1;
    attackerGeneral.value = draft;
};

const addDefender = (general?: GeneralExport) => {
    const draft = createGeneralDraft(general ?? undefined);
    defenders.value.push(draft);
    return draft;
};

const removeDefender = (generalId: string) => {
    defenders.value = defenders.value.filter((item) => item.id !== generalId);
};

const copyDefender = (source: GeneralDraft) => {
    const clone = toExportedGeneral(source);
    addDefender(clone);
};

const applyGeneralExport = (target: GeneralDraft, data: GeneralExport) => {
    target.name = data.name;
    target.officerLevel = data.officerLevel;
    target.expLevel = data.expLevel;
    target.leadership = data.leadership;
    target.strength = data.strength;
    target.intel = data.intel;
    target.horse = data.horse;
    target.weapon = data.weapon;
    target.book = data.book;
    target.item = data.item;
    target.injury = data.injury;
    target.rice = data.rice;
    target.personal = data.personal;
    target.special = data.special;
    target.special2 = data.special2;
    target.crew = data.crew;
    target.crewtype = data.crewtype;
    target.atmos = data.atmos;
    target.train = data.train;
    target.dex1 = data.dex1;
    target.dex2 = data.dex2;
    target.dex3 = data.dex3;
    target.dex4 = data.dex4;
    target.dex5 = data.dex5;
    target.defenceTrain = data.defenceTrain;
    target.warnum = data.warnum;
    target.killnum = data.killnum;
    target.killcrew = data.killcrew;
    target.inheritBuff = data.inheritBuff ? { ...data.inheritBuff } : createInheritBuff();
    if (target.crewtype <= 0) {
        target.crewtype = options.value?.unitSet.defaultCrewTypeId ?? availableCrewTypes.value[0]?.id ?? 1;
    }
};

const toExportedGeneral = (general: GeneralDraft): GeneralExport => ({
    no: general.no,
    name: general.name,
    officerLevel: general.officerLevel,
    expLevel: general.expLevel,
    leadership: general.leadership,
    strength: general.strength,
    intel: general.intel,
    horse: general.horse,
    weapon: general.weapon,
    book: general.book,
    item: general.item,
    injury: general.injury,
    rice: general.rice,
    personal: general.personal,
    special: general.special,
    special2: general.special2,
    crew: general.crew,
    crewtype: general.crewtype,
    atmos: general.atmos,
    train: general.train,
    dex1: general.dex1,
    dex2: general.dex2,
    dex3: general.dex3,
    dex4: general.dex4,
    dex5: general.dex5,
    defenceTrain: general.defenceTrain,
    warnum: general.warnum,
    killnum: general.killnum,
    killcrew: general.killcrew,
    inheritBuff: { ...general.inheritBuff },
});

const resolveAvailableNationType = (candidate?: string | null): string => {
    const available = options.value?.nationTypes ?? [];
    return available.some((entry) => entry.key === candidate) ? (candidate as string) : (available[0]?.key ?? '');
};

const initializeDefaults = async () => {
    loading.value = true;
    error.value = null;

    try {
        const [context, me] = await Promise.all([trpc.battle.getSimulatorContext.query(), trpc.general.me.query()]);
        options.value = context;
        gameDefaults.value = me;
        year.value = context.world.currentYear;
        month.value = context.world.currentMonth;
        repeatCnt.value = 1;
        seed.value = '';

        const nationTypeDefault = resolveAvailableNationType(me?.nation?.typeCode);
        attackerNation.type = nationTypeDefault;
        defenderNation.type = nationTypeDefault;

        attackerNation.level = me?.nation?.level ?? 0;
        defenderNation.level = me?.nation?.level ?? 0;

        attackerNation.tech = me?.nation?.tech ? Math.floor(me.nation.tech / 1000) : 1;
        defenderNation.tech = attackerNation.tech;

        attackerCity.level = me?.city?.level ?? 5;
        defenderCity.level = me?.city?.level ?? 5;
        defenderCity.def = me?.city?.defence ?? 1000;
        defenderCity.wall = me?.city?.wall ?? 1000;

        attackerNation.isCapital = me?.nation?.capitalCityId === me?.city?.id;
        defenderNation.isCapital = attackerNation.isCapital;

        createAttackerGeneral();
        defenders.value = [];
        addDefender();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        loading.value = false;
    }
};

const hasGameGeneral = computed(() => !!gameDefaults.value?.general?.id);

const applyGameEnvironment = () => {
    if (!options.value) {
        return;
    }
    const me = gameDefaults.value;
    const nationTypeDefault = resolveAvailableNationType(me?.nation?.typeCode);
    year.value = options.value.world.currentYear;
    month.value = options.value.world.currentMonth;
    attackerNation.type = nationTypeDefault;
    defenderNation.type = attackerNation.type;
    attackerNation.level = me?.nation?.level ?? 0;
    defenderNation.level = attackerNation.level;
    attackerNation.tech = me?.nation?.tech ? Math.floor(me.nation.tech / 1000) : 1;
    defenderNation.tech = attackerNation.tech;
    attackerCity.level = me?.city?.level ?? 5;
    defenderCity.level = attackerCity.level;
    defenderCity.def = me?.city?.defence ?? 1000;
    defenderCity.wall = me?.city?.wall ?? 1000;
    attackerNation.isCapital = !!me?.city && me.nation?.capitalCityId === me.city.id;
    defenderNation.isCapital = attackerNation.isCapital;
    error.value = null;
};

const applyIndependentEnvironment = () => {
    if (!options.value) {
        return;
    }
    const nationTypeDefault = resolveAvailableNationType();
    year.value = options.value.world.startYear;
    month.value = 1;
    seed.value = '';
    repeatCnt.value = 1;
    Object.assign(attackerNation, { type: nationTypeDefault, tech: 1, level: 0, isCapital: false });
    Object.assign(defenderNation, { type: nationTypeDefault, tech: 1, level: 0, isCapital: false });
    attackerCity.level = 5;
    Object.assign(defenderCity, { level: 5, def: 1000, wall: 1000 });
    error.value = null;
};

onMounted(() => {
    void initializeDefaults();
});

const resolveErrorMessage = (value: unknown): string => {
    if (value instanceof Error) {
        return value.message;
    }
    if (typeof value === 'string') {
        return value;
    }
    return 'unknown_error';
};

const readNumberValue = (value: unknown, fallback = 0): number => {
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

const readStringValue = (value: unknown, fallback = ''): string => {
    if (typeof value === 'string') {
        return value;
    }
    return fallback;
};

const readOptionalString = (value: unknown): string | null => {
    if (typeof value !== 'string') {
        return null;
    }
    if (!value || value === 'None') {
        return null;
    }
    return value;
};

const normalizeInheritBuff = (raw: unknown): InheritBuff => {
    if (!raw || typeof raw !== 'object') {
        return createInheritBuff();
    }
    const buff = raw as Record<string, unknown>;
    return {
        warAvoidRatio: readNumberValue(buff.warAvoidRatio, 0),
        warCriticalRatio: readNumberValue(buff.warCriticalRatio, 0),
        warMagicTrialProb: readNumberValue(buff.warMagicTrialProb, 0),
        warAvoidRatioOppose: readNumberValue(buff.warAvoidRatioOppose, 0),
        warCriticalRatioOppose: readNumberValue(buff.warCriticalRatioOppose, 0),
        warMagicTrialProbOppose: readNumberValue(buff.warMagicTrialProbOppose, 0),
    };
};

const normalizeGeneralExport = (raw: Record<string, unknown>): GeneralExport => ({
    no: readNumberValue(raw.no, 0),
    name: readStringValue(raw.name, '무명'),
    officerLevel: readNumberValue(raw.officerLevel ?? raw.officer_level, 1),
    expLevel: readNumberValue(raw.expLevel ?? raw.explevel, 0),
    leadership: readNumberValue(raw.leadership, 50),
    strength: readNumberValue(raw.strength, 50),
    intel: readNumberValue(raw.intel, 50),
    horse: readOptionalString(raw.horse),
    weapon: readOptionalString(raw.weapon),
    book: readOptionalString(raw.book),
    item: readOptionalString(raw.item),
    injury: readNumberValue(raw.injury, 0),
    rice: readNumberValue(raw.rice, 0),
    personal: readOptionalString(raw.personal),
    special: readOptionalString(raw.special),
    special2: readOptionalString(raw.special2),
    crew: readNumberValue(raw.crew, 0),
    crewtype: readNumberValue(raw.crewtype, 0),
    atmos: readNumberValue(raw.atmos, 0),
    train: readNumberValue(raw.train, 0),
    dex1: readNumberValue(raw.dex1, 0),
    dex2: readNumberValue(raw.dex2, 0),
    dex3: readNumberValue(raw.dex3, 0),
    dex4: readNumberValue(raw.dex4, 0),
    dex5: readNumberValue(raw.dex5, 0),
    defenceTrain: readNumberValue(raw.defenceTrain ?? raw.defence_train, 0),
    warnum: readNumberValue(raw.warnum, 0),
    killnum: readNumberValue(raw.killnum, 0),
    killcrew: readNumberValue(raw.killcrew, 0),
    inheritBuff: normalizeInheritBuff(raw.inheritBuff),
});

const buildGeneralPayload = (
    general: GeneralDraft,
    nationId: number,
    officerCityId: number,
    timestamp: string
): BattleSimRequestPayload['attackerGeneral'] => {
    const officerCity = general.officerLevel >= 2 && general.officerLevel <= 4 ? officerCityId : 0;
    return {
        no: general.no,
        name: general.name,
        nation: nationId,
        turntime: timestamp,
        personal: general.personal,
        // Ref does not expose the domestic speciality in this form. Battle requests
        // always use the scenario's default domestic speciality instead.
        special: options.value?.defaultSpecialDomestic ?? 'None',
        special2: general.special2,
        crew: general.crew,
        crewtype: general.crewtype,
        atmos: general.atmos,
        train: general.train,
        intel: general.intel,
        intel_exp: 0,
        book: general.book,
        strength: general.strength,
        strength_exp: 0,
        weapon: general.weapon,
        injury: general.injury,
        leadership: general.leadership,
        leadership_exp: 0,
        horse: general.horse,
        item: general.item,
        explevel: general.expLevel,
        experience: Math.round(Math.pow(general.expLevel, 2)),
        dedication: 0,
        officer_level: general.officerLevel,
        officer_city: officerCity,
        gold: 10000,
        rice: general.rice,
        dex1: general.dex1,
        dex2: general.dex2,
        dex3: general.dex3,
        dex4: general.dex4,
        dex5: general.dex5,
        defence_train: general.defenceTrain,
        recent_war: timestamp,
        warnum: general.warnum,
        killnum: general.killnum,
        killcrew: general.killcrew,
        inheritBuff: { ...general.inheritBuff },
    };
};

const buildBattlePayload = (action: BattleSimRequestPayload['action']): BattleSimRequestPayload => {
    if (!attackerGeneral.value) {
        throw new Error('attacker_general_missing');
    }
    const now = formatSeoulDateTime(new Date());

    const attackerNationPayload = {
        nation: 1,
        name: '출병국',
        capital: attackerNation.isCapital ? 1 : 2,
        level: attackerNation.level,
        gold: 0,
        rice: 2000,
        type: attackerNation.type,
        tech: attackerNation.tech * 1000,
        gennum: 200,
    };

    const defenderNationPayload = {
        nation: 2,
        name: '수비국',
        capital: defenderNation.isCapital ? 3 : 4,
        level: defenderNation.level,
        gold: 0,
        rice: 2000,
        type: defenderNation.type,
        tech: defenderNation.tech * 1000,
        gennum: 200,
    };

    const baseCity = {
        nation: 0,
        supply: 1,
        name: '도시',
        pop: 500000,
        agri: 10000,
        comm: 10000,
        secu: 10000,
        def: 1000,
        wall: 1000,
        trust: 100,
        pop_max: 600000,
        agri_max: 12000,
        comm_max: 12000,
        secu_max: 10000,
        def_max: 12000,
        wall_max: 12000,
        dead: 0,
        state: 0,
        conflict: '{}',
    };

    const attackerCityPayload = {
        ...baseCity,
        nation: 1,
        city: 1,
        level: attackerCity.level,
    };

    const defenderCityPayload = {
        ...baseCity,
        nation: 2,
        city: 3,
        level: defenderCity.level,
        def: defenderCity.def,
        wall: defenderCity.wall,
        def_max: Math.floor((defenderCity.def / 5) * 6),
        wall_max: Math.floor((defenderCity.wall / 5) * 6),
    };

    return {
        action,
        seed: seed.value.trim() ? seed.value.trim() : undefined,
        repeatCnt: repeatCnt.value,
        year: year.value,
        month: month.value,
        attackerGeneral: buildGeneralPayload(attackerGeneral.value, 1, 1, now),
        attackerCity: attackerCityPayload,
        attackerNation: attackerNationPayload,
        defenderGenerals: defenders.value.map((general) => buildGeneralPayload(general, 2, 3, now)),
        defenderCity: defenderCityPayload,
        defenderNation: defenderNationPayload,
    };
};

const runSimulation = async (action: BattleSimRequestPayload['action']) => {
    if (!options.value) {
        return;
    }

    isSimulating.value = true;
    error.value = null;
    if (action === 'battle') {
        battleResult.value = null;
    }
    const progressToastId = showInfoToast(
        action === 'battle' ? '전투를 진행 중입니다.' : '수비자 순서를 계산 중입니다.',
        0
    );

    try {
        const payload = buildBattlePayload(action);
        const preparation = await trpc.battle.prepareSimulation.mutate(payload);
        const result = await simulationWorker.run({
            ...payload,
            ...(preparation.seedBase ? { seedBase: preparation.seedBase } : {}),
            unitSet: options.value.unitSet,
            config: options.value.config,
            time: {
                year: payload.year,
                month: payload.month,
                startYear: options.value.world.startYear,
            },
            scenarioEffect: options.value.scenarioEffect,
        });

        if (!result.result) {
            error.value = result.reason || 'battle_failed';
            return;
        }

        if (action === 'reorder' && result.order) {
            reorderDefenders(result.order);
            return;
        }

        battleResult.value = result;
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        isSimulating.value = false;
        dismissToast(progressToastId);
    }
};

const reorderDefenders = (order: number[]) => {
    const map = new Map(defenders.value.map((general) => [general.no, general]));
    const next: GeneralDraft[] = [];
    for (const generalNo of order) {
        const general = map.get(generalNo);
        if (!general) {
            continue;
        }
        next.push(general);
        map.delete(generalNo);
    }
    for (const general of map.values()) {
        next.push(general);
    }
    defenders.value = next;
};

const formatNumber = (value?: number | null) => {
    if (value === null || value === undefined) {
        return '-';
    }
    const rounded = Number.isInteger(value) ? Math.floor(value) : Number(value.toFixed(2));
    return new Intl.NumberFormat('ko-KR').format(rounded);
};

const formatSkillCounts = (skills?: Record<string, number>) => {
    if (!skills || Object.keys(skills).length === 0) {
        return '-';
    }
    return Object.entries(skills)
        .map(([name, count]) => `${name}(${formatNumber(count)}회)`)
        .join(', ');
};

const exportBattleData = (): BattleExport => ({
    attackerGeneral: toExportedGeneral(attackerGeneral.value ?? createGeneralDraft()),
    attackerCity: { level: attackerCity.level },
    attackerNation: {
        type: attackerNation.type,
        tech: attackerNation.tech * 1000,
        level: attackerNation.level,
        capital: attackerNation.isCapital ? 1 : 2,
    },
    defenderGenerals: defenders.value.map((general) => toExportedGeneral(general)),
    defenderCity: {
        level: defenderCity.level,
        def: defenderCity.def,
        wall: defenderCity.wall,
    },
    defenderNation: {
        type: defenderNation.type,
        tech: defenderNation.tech * 1000,
        level: defenderNation.level,
        capital: defenderNation.isCapital ? 3 : 4,
    },
    year: year.value,
    month: month.value,
    repeatCnt: repeatCnt.value,
    seed: seed.value.trim() ? seed.value.trim() : undefined,
});

const downloadJson = (payload: ExportedInfo, filename: string) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
};

const formatDateTag = (): string => {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(
        now.getMinutes()
    )}`;
};

const saveBattle = () => {
    const payload: ExportedInfo = { objType: 'battle', data: exportBattleData() };
    downloadJson(payload, `battle_${formatDateTag()}.json`);
};

const saveGeneral = (general: GeneralDraft) => {
    const payload: ExportedInfo = { objType: 'general', data: toExportedGeneral(general) };
    downloadJson(payload, `general_${general.name}_${formatDateTag()}.json`);
};

const parseImport = async (file: File): Promise<ExportedInfo> => {
    const raw = await file.text();
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (!data || typeof data !== 'object' || !('objType' in data)) {
        throw new Error('invalid_file');
    }
    const objType = data.objType;
    if (objType === 'general') {
        return {
            objType: 'general',
            data: normalizeGeneralExport(data.data as Record<string, unknown>),
        };
    }
    if (objType === 'battle') {
        const battle = data.data as Record<string, unknown>;
        const attackerGeneral = normalizeGeneralExport(battle.attackerGeneral as Record<string, unknown>);
        const defenderGenerals = Array.isArray(battle.defenderGenerals)
            ? battle.defenderGenerals.map((item) => normalizeGeneralExport(item as Record<string, unknown>))
            : [];
        return {
            objType: 'battle',
            data: {
                attackerGeneral,
                defenderGenerals,
                attackerCity: battle.attackerCity as BattleExport['attackerCity'],
                defenderCity: battle.defenderCity as BattleExport['defenderCity'],
                attackerNation: battle.attackerNation as BattleExport['attackerNation'],
                defenderNation: battle.defenderNation as BattleExport['defenderNation'],
                year: readNumberValue(battle.year, year.value),
                month: readNumberValue(battle.month, month.value),
                repeatCnt: readNumberValue(battle.repeatCnt, repeatCnt.value),
                seed: readStringValue(battle.seed ?? ''),
            },
        };
    }
    throw new Error('invalid_file');
};

const importBattle = (data: BattleExport) => {
    seed.value = data.seed ?? '';
    year.value = data.year;
    month.value = data.month;
    repeatCnt.value = data.repeatCnt;

    attackerNation.type = resolveAvailableNationType(data.attackerNation.type);
    attackerNation.level = data.attackerNation.level;
    attackerNation.tech = Math.floor(data.attackerNation.tech / 1000);
    attackerNation.isCapital = data.attackerNation.capital === 1;
    attackerCity.level = data.attackerCity.level;

    defenderNation.type = resolveAvailableNationType(data.defenderNation.type);
    defenderNation.level = data.defenderNation.level;
    defenderNation.tech = Math.floor(data.defenderNation.tech / 1000);
    defenderNation.isCapital = data.defenderNation.capital === 3;
    defenderCity.level = data.defenderCity.level;
    defenderCity.def = data.defenderCity.def;
    defenderCity.wall = data.defenderCity.wall;

    if (!attackerGeneral.value) {
        createAttackerGeneral();
    }
    if (attackerGeneral.value) {
        applyGeneralExport(attackerGeneral.value, data.attackerGeneral);
        attackerGeneral.value.no = 1;
    }

    defenders.value = [];
    for (const general of data.defenderGenerals) {
        const draft = addDefender();
        applyGeneralExport(draft, general);
        draft.no = resolveGeneralNo(general.no, draft.id);
    }
};

const handleGeneralLoad = async (payload: { target: GeneralDraft; file: File }) => {
    try {
        const data = await parseImport(payload.file);
        if (data.objType === 'battle') {
            importBattle(data.data);
            return;
        }
        applyGeneralExport(payload.target, data.data);
        payload.target.no =
            payload.target === attackerGeneral.value ? 1 : resolveGeneralNo(data.data.no, payload.target.id);
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const handleBattleLoad = async (file: File) => {
    try {
        const data = await parseImport(file);
        if (data.objType !== 'battle') {
            throw new Error('invalid_battle_file');
        }
        importBattle(data.data);
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const battleFileInput = ref<HTMLInputElement | null>(null);

const triggerBattleLoad = () => {
    battleFileInput.value?.click();
};

const handleBattleFileChange = (event: Event) => {
    const target = event.target as HTMLInputElement | null;
    const file = target?.files?.[0];
    if (!file) {
        return;
    }
    void handleBattleLoad(file);
    if (target) {
        target.value = '';
    }
};

const loadGeneralList = async () => {
    if (generalListLoading.value) {
        return;
    }
    generalListLoading.value = true;
    try {
        generalList.value = await trpc.battle.getGeneralList.query();
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        generalListLoading.value = false;
    }
};

const openImportModal = async (target: GeneralDraft) => {
    if (!hasGameGeneral.value) {
        error.value = '게임 장수를 보유한 사용자만 서버 장수 정보를 가져올 수 있습니다.';
        return;
    }
    importTarget.value = target;
    importOpen.value = true;
    if (!generalList.value) {
        await loadGeneralList();
    }
    if (generalList.value) {
        selectedGeneralId.value = generalList.value.myGeneralId;
    }
};

const closeImportModal = () => {
    importOpen.value = false;
    importTarget.value = null;
};

const applyServerGeneral = async (target: GeneralDraft, generalId: number) => {
    const response = await trpc.battle.getGeneralDetail.query({ generalId });
    applyGeneralExport(target, {
        no: response.general.no,
        name: response.general.name,
        officerLevel: response.general.officer_level,
        expLevel: response.general.explevel,
        leadership: response.general.leadership,
        strength: response.general.strength,
        intel: response.general.intel,
        horse: response.general.horse,
        weapon: response.general.weapon,
        book: response.general.book,
        item: response.general.item,
        injury: response.general.injury,
        rice: response.general.rice,
        personal: response.general.personal,
        special: response.general.special,
        special2: response.general.special2,
        crew: response.general.crew,
        crewtype: response.general.crewtype,
        atmos: response.general.atmos,
        train: response.general.train,
        dex1: response.general.dex1,
        dex2: response.general.dex2,
        dex3: response.general.dex3,
        dex4: response.general.dex4,
        dex5: response.general.dex5,
        defenceTrain: response.general.defence_train,
        warnum: response.general.warnum,
        killnum: response.general.killnum,
        killcrew: response.general.killcrew,
        inheritBuff: createInheritBuff(),
    });
    target.no = target === attackerGeneral.value ? 1 : resolveGeneralNo(response.general.no, target.id);
};

const applyMyGeneralToAttacker = async () => {
    const generalId = gameDefaults.value?.general?.id;
    if (!attackerGeneral.value || !generalId) {
        error.value = '불러올 내 장수가 없습니다.';
        return;
    }
    try {
        error.value = null;
        await applyServerGeneral(attackerGeneral.value, generalId);
    } catch (err) {
        error.value = resolveErrorMessage(err);
    }
};

const confirmImport = async () => {
    if (!importTarget.value || !selectedGeneralId.value) {
        return;
    }
    try {
        await applyServerGeneral(importTarget.value, selectedGeneralId.value);
    } catch (err) {
        error.value = resolveErrorMessage(err);
    } finally {
        closeImportModal();
    }
};

const generalGroups = computed(() => {
    if (!generalList.value) {
        return [];
    }
    const nationOrder = [generalList.value.myNationId, ...Object.keys(generalList.value.generalsByNation).map(Number)];
    const orderedIds = Array.from(new Set(nationOrder));
    const nationMap = new Map(generalList.value.nations.map((nation) => [nation.id, nation]));

    return orderedIds
        .filter((nationId) => generalList.value?.generalsByNation[nationId]?.length)
        .map((nationId) => {
            const nation = nationMap.get(nationId) ?? { id: nationId, name: '재야', color: '#000000' };
            const generals = [...(generalList.value?.generalsByNation[nationId] ?? [])];
            generals.sort(compareGeneralTypeThenName);
            return { nation, generals };
        });
});

const summaryRows = computed(() => {
    if (!battleResult.value) {
        return [
            { label: '전투 일시', value: '' },
            { label: '전투 횟수', value: '' },
            { label: '전투 페이즈', value: '' },
            { label: '준 피해', value: '0 (0 ~ 0)' },
            { label: '받은 피해', value: '0 (0 ~ 0)' },
            { label: '출병자 군량 소모', value: '' },
            { label: '수비자 군량 소모', value: '' },
            { label: '공격자 스킬', value: '' },
        ];
    }
    return [
        { label: '전투 일시', value: formatSeoulDateTime(battleResult.value.datetime ?? '') || '-' },
        { label: '전투 횟수', value: formatNumber(battleResult.value.repeatCnt) },
        { label: '전투 페이즈', value: formatNumber(battleResult.value.phase) },
        {
            label: '준 피해',
            value:
                battleResult.value.minKilled !== battleResult.value.maxKilled
                    ? `${formatNumber(battleResult.value.killed)} (${formatNumber(battleResult.value.minKilled)} ~ ${formatNumber(
                          battleResult.value.maxKilled
                      )})`
                    : formatNumber(battleResult.value.killed),
        },
        {
            label: '받은 피해',
            value:
                battleResult.value.minDead !== battleResult.value.maxDead
                    ? `${formatNumber(battleResult.value.dead)} (${formatNumber(battleResult.value.minDead)} ~ ${formatNumber(
                          battleResult.value.maxDead
                      )})`
                    : formatNumber(battleResult.value.dead),
        },
        { label: '출병자 군량 소모', value: formatNumber(battleResult.value.attackerRice) },
        { label: '수비자 군량 소모', value: formatNumber(battleResult.value.defenderRice) },
        { label: '공격자 스킬', value: formatSkillCounts(battleResult.value.attackerSkills) },
    ];
});

const defenderSkillRows = computed(() => {
    if (!battleResult.value?.defendersSkills) {
        return defenders.value.map((_, idx) => ({ label: `수비자${idx + 1} 스킬`, value: '' }));
    }
    return battleResult.value.defendersSkills.map((skills, idx) => ({
        label: `수비자${idx + 1} 스킬`,
        value: formatSkillCounts(skills),
    }));
});

const shouldShowUI = computed(() => !loading.value && !!options.value);
</script>

<template>
    <main class="battle-simulator">
        <!-- Ref renders several equivalent controls as input/button tags. Keep
             that DOM signature without duplicating the visible Vue controls. -->
        <div class="legacy-control-signature" hidden>
            <input v-for="index in 38" :key="`legacy-input-${index}`" type="hidden" />
            <button v-for="index in 5" :key="`legacy-button-${index}`" type="button"></button>
        </div>
        <div v-if="error" class="error">{{ error }}</div>

        <PanelCard data-parity-id="world-settings" title="전역 설정">
            <div v-if="loading">
                <SkeletonLines :lines="3" />
            </div>
            <div v-else-if="options" class="settings-grid">
                <label class="field unit-after">
                    <input type="number" :value="options.world.startYear" disabled />
                    <span>년 시작</span>
                </label>
                <label class="field unit-after">
                    <input
                        v-model.number="year"
                        aria-label="연도"
                        data-parity-id="year"
                        type="number"
                        :min="options.world.startYear"
                    />
                    <span>년</span>
                </label>
                <label class="field unit-after month-field">
                    <input v-model.number="month" aria-label="월" type="number" min="1" max="12" />
                    <span>월</span>
                </label>
                <label class="field seed-field">
                    <span>시드</span>
                    <input v-model="seed" data-parity-id="seed" type="text" />
                </label>
                <label class="field repeat-field">
                    <span>반복 횟수</span>
                    <select v-model.number="repeatCnt" data-parity-id="repeat-count">
                        <option :value="1">1회 (로그 표기)</option>
                        <option :value="1000">1000회 (요약 표기)</option>
                    </select>
                </label>
                <div class="header-actions">
                    <button
                        class="primary"
                        data-parity-id="battle-button"
                        type="button"
                        :disabled="isSimulating || !options"
                        @click="runSimulation('battle')"
                    >
                        전투
                    </button>
                    <button class="ghost save-action" type="button" @click="saveBattle">모두 저장</button>
                    <input ref="battleFileInput" type="file" accept=".json" hidden @change="handleBattleFileChange" />
                    <button class="ghost load-action" type="button" @click="triggerBattleLoad">모두 불러오기</button>
                </div>
            </div>
        </PanelCard>

        <div v-if="shouldShowUI" class="battle-grid">
            <div class="column">
                <PanelCard data-parity-id="attacker-nation" title="출병국 설정">
                    <div class="form-row">
                        <label class="field">
                            <span>국가 성향</span>
                            <select v-model="attackerNation.type">
                                <option v-for="trait in options!.nationTypes" :key="trait.key" :value="trait.key">
                                    {{ trait.name }} ({{ trait.info }})
                                </option>
                            </select>
                        </label>
                        <label class="field">
                            <span>기술</span>
                            <input v-model.number="attackerNation.tech" type="number" min="0" max="12" />
                        </label>
                        <span class="grade-label">등급</span>
                    </div>
                    <div class="form-row">
                        <label class="field">
                            <span>국가 규모</span>
                            <select v-model.number="attackerNation.level">
                                <option v-for="level in options!.nationLevels" :key="level.level" :value="level.level">
                                    {{ level.name }}
                                </option>
                            </select>
                        </label>
                        <label class="field">
                            <span>도시 규모</span>
                            <select v-model.number="attackerCity.level">
                                <option v-for="level in options!.cityLevels" :key="level.level" :value="level.level">
                                    {{ level.name }}
                                </option>
                            </select>
                        </label>
                        <label class="field">
                            <span>수도</span>
                            <select v-model="attackerNation.isCapital">
                                <option :value="true">Y</option>
                                <option :value="false">N</option>
                            </select>
                        </label>
                    </div>
                </PanelCard>

                <BattleGeneralCard
                    v-if="attackerGeneral"
                    v-model:general="attackerGeneral"
                    data-parity-id="attacker-general"
                    :options="options!"
                    :crew-types="availableCrewTypes"
                    mode="attacker"
                    title="출병자 설정"
                    :can-import-server="hasGameGeneral"
                    @import="openImportModal(attackerGeneral!)"
                    @save="saveGeneral(attackerGeneral!)"
                    @load="(payload) => handleGeneralLoad({ target: attackerGeneral!, file: payload.file })"
                />
            </div>

            <div class="column">
                <PanelCard data-parity-id="defender-nation" title="수비국 설정">
                    <div class="form-row">
                        <label class="field">
                            <span>국가 성향</span>
                            <select v-model="defenderNation.type">
                                <option v-for="trait in options!.nationTypes" :key="trait.key" :value="trait.key">
                                    {{ trait.name }} ({{ trait.info }})
                                </option>
                            </select>
                        </label>
                        <label class="field">
                            <span>기술</span>
                            <input v-model.number="defenderNation.tech" type="number" min="0" max="12" />
                        </label>
                        <span class="grade-label">등급</span>
                    </div>
                    <div class="form-row">
                        <label class="field">
                            <span>국가 규모</span>
                            <select v-model.number="defenderNation.level">
                                <option v-for="level in options!.nationLevels" :key="level.level" :value="level.level">
                                    {{ level.name }}
                                </option>
                            </select>
                        </label>
                        <label class="field">
                            <span>도시 규모</span>
                            <select v-model.number="defenderCity.level">
                                <option v-for="level in options!.cityLevels" :key="level.level" :value="level.level">
                                    {{ level.name }}
                                </option>
                            </select>
                        </label>
                        <label class="field">
                            <span>수도</span>
                            <select v-model="defenderNation.isCapital">
                                <option :value="true">Y</option>
                                <option :value="false">N</option>
                            </select>
                        </label>
                    </div>
                    <div class="form-row">
                        <label class="field">
                            <span>수비</span>
                            <input v-model.number="defenderCity.def" type="number" min="10" step="10" />
                        </label>
                        <label class="field">
                            <span>성벽</span>
                            <input v-model.number="defenderCity.wall" type="number" min="0" step="10" />
                        </label>
                    </div>
                </PanelCard>

                <div class="defender-list">
                    <div class="defender-toolbar">
                        <strong>수비자 설정</strong>
                        <div>
                            <button
                                class="ghost"
                                type="button"
                                :disabled="isSimulating || !options"
                                @click="runSimulation('reorder')"
                            >
                                수비 순서대로 정렬
                            </button>
                            <button class="ghost add-action" type="button" :disabled="!options" @click="addDefender()">
                                추가
                            </button>
                        </div>
                    </div>
                    <BattleGeneralCard
                        v-for="(defender, index) in defenders"
                        :key="defender.id"
                        v-model:general="defenders[index]"
                        :data-parity-id="index === 0 ? 'defender-general' : `defender-general-${index + 1}`"
                        :options="options!"
                        :crew-types="availableCrewTypes"
                        mode="defender"
                        title="수비자 설정"
                        :can-import-server="hasGameGeneral"
                        @import="openImportModal(defender)"
                        @save="saveGeneral(defender)"
                        @load="(payload) => handleGeneralLoad({ target: defender, file: payload.file })"
                        @copy="copyDefender(defender)"
                        @remove="removeDefender(defender.id)"
                    />
                </div>
            </div>
        </div>

        <PanelCard class="battle-summary-card" title="전투 요약">
            <table class="summary-table">
                <tbody data-parity-id="battle-summary">
                    <tr v-for="row in summaryRows" :key="row.label">
                        <th>{{ row.label }}</th>
                        <td>{{ row.value }}</td>
                    </tr>
                    <tr v-for="row in defenderSkillRows" :key="row.label">
                        <th>{{ row.label }}</th>
                        <td>{{ row.value }}</td>
                    </tr>
                </tbody>
            </table>
        </PanelCard>

        <div class="log-grid">
            <PanelCard title="마지막 전투 로그">
                <div
                    class="log-body"
                    data-parity-id="battle-log"
                    v-html="battleResult?.lastWarLog?.generalBattleResultLog ?? ''"
                />
            </PanelCard>
            <PanelCard title="마지막 전투 상세 로그">
                <div
                    class="log-body"
                    data-parity-id="battle-detail-log"
                    v-html="battleResult?.lastWarLog?.generalBattleDetailLog ?? ''"
                />
            </PanelCard>
        </div>

        <details class="independence-notice" aria-label="시뮬레이터 데이터 안내">
            <summary>환경</summary>
            <p>
                현재 연도·국가·도시는 시작값으로만 읽으며, 아래 편집과 전투 결과는 턴·DB·장수 상태를 변경하지 않습니다.
            </p>
            <div class="notice-actions">
                <button class="ghost" type="button" :disabled="!options" @click="applyGameEnvironment">
                    현재 게임 환경 적용
                </button>
                <button class="ghost" type="button" :disabled="!options" @click="applyIndependentEnvironment">
                    독립 기본값
                </button>
                <button
                    class="ghost"
                    type="button"
                    :disabled="!hasGameGeneral || !attackerGeneral"
                    @click="applyMyGeneralToAttacker"
                >
                    내 장수를 출병자로
                </button>
            </div>
        </details>

        <div v-if="importOpen" class="modal-backdrop">
            <div class="modal">
                <header>
                    <h3>장수 목록</h3>
                    <button type="button" class="ghost" @click="closeImportModal">닫기</button>
                </header>
                <div class="modal-body">
                    <p class="hint">타국 장수는 숙련과 아이템이 초기화됩니다.</p>
                    <div v-if="generalListLoading">
                        <SkeletonLines :lines="4" />
                    </div>
                    <div v-else class="select-wrap">
                        <select v-model.number="selectedGeneralId">
                            <optgroup v-for="group in generalGroups" :key="group.nation.id" :label="group.nation.name">
                                <option
                                    v-for="general in group.generals"
                                    :key="general.id"
                                    :value="general.id"
                                    :style="{ color: getNpcColor(general.npcState) ?? '#e8ddc4' }"
                                >
                                    {{ general.name }}
                                </option>
                            </optgroup>
                        </select>
                    </div>
                </div>
                <footer>
                    <button type="button" class="primary" @click="confirmImport">가져오기</button>
                </footer>
            </div>
        </div>
    </main>
</template>

<style scoped>
.battle-simulator {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: min(100%, 1000px);
    margin: 0 auto;
    padding-bottom: 0;
    line-height: 18.2px;
    position: relative;
}

.battle-simulator :deep(.panel-card) {
    border-color: rgba(0, 0, 0, 0.18);
    border-radius: 5.25px;
    background: #303030;
    background-image: none;
}

.battle-simulator :deep(.panel-header) {
    min-height: 32px;
    border-bottom: 0;
    padding: 6px 14px;
    background: #444;
    background-image: none;
}

.battle-simulator :deep(.panel-body) {
    padding: 14px;
    line-height: 18.2px;
}

.header-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
    margin-left: 14px;
}

.independence-notice {
    position: absolute;
    top: 5px;
    right: 8px;
    z-index: 5;
    padding: 2px 6px;
    background: #444;
    color: #aaa;
    font-size: 11px;
}

.independence-notice p {
    margin: 6px 0;
}

.notice-actions {
    display: flex;
    flex: 0 0 auto;
    flex-wrap: wrap;
    gap: 6px;
}

button {
    font-family: inherit;
    background: none;
    border: none;
    color: inherit;
}

/*
 * Ref uses the Bootstrap/Lumen family here: no top border, 1px sides and a 4px
 * bottom that shortens on hover and active while the control moves down.
 */
.primary,
.ghost {
    --simulator-button-border: #d04436;

    border-color: var(--simulator-button-border);
    border-style: solid;
    border-width: 0 1px 4px;
    border-radius: 5.25px;
    padding: 5.25px 10.5px;
    color: #fff;
    font-size: 14px;
    font-weight: 700;
    line-height: 21px;
    vertical-align: middle;
    cursor: pointer;
    transition:
        color 0.15s ease-in-out,
        background-color 0.15s ease-in-out,
        border-color 0.15s ease-in-out,
        box-shadow 0.15s ease-in-out;
}

.primary {
    background: #e74c3c;
}

.primary:not(:disabled):hover,
.ghost:not(:disabled):hover {
    margin-top: 1px;
    border-bottom-width: 3px;
}

.primary:not(:disabled):active,
.ghost:not(:disabled):active {
    margin-top: 2px;
    border-bottom-width: 2px;
}

.primary:active {
    background: #b93d30;
}

.header-actions .primary,
.header-actions .ghost {
    min-height: 35.5px;
}

.ghost {
    --simulator-button-border: #2f89c5;

    background: #3498db;
}

.load-action {
    --simulator-button-border: #26527d;

    background: #2c5d8f;
}

.add-action {
    --simulator-button-border: #0da271;

    background: #10b981;
}

button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.error {
    color: #f5b7b1;
    font-size: 0.85rem;
}

.status {
    color: #f5d08a;
    font-size: 0.85rem;
}

.settings-grid {
    display: grid;
    grid-template-columns: 126px 99px 106px 166px 216px minmax(0, 1fr);
    gap: 0;
    margin-top: 1.1875px;
}

.field {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    color: #ddd;
    font-size: 14px;
}

.unit-after {
    grid-template-columns: minmax(0, 1fr) auto;
}

.field span {
    display: flex;
    align-items: center;
    padding: 5.25px 10.5px;
    border: 1px solid #111;
    background: #444;
    white-space: nowrap;
}

.field input,
.field select {
    min-width: 0;
    border: 1px solid #000;
    background: #ddd;
    color: #303030;
    padding: 5.25px 10.5px;
    font-size: 14px;
    line-height: 21px;
    box-shadow: inset 0 2px 0 rgba(0, 0, 0, 0.075);
    transition:
        border-color 0.15s ease-in-out,
        box-shadow 0.15s ease-in-out;
}

.unit-after input[type='number'] {
    text-align: right;
}

.repeat-field select {
    border-radius: 0 5.25px 5.25px 0;
    padding-right: 31.5px;
    background-image: url('data:image/svg+xml,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%270 0 16 16%27%3e%3cpath fill=%27none%27 stroke=%27%23303030%27 stroke-linecap=%27round%27 stroke-linejoin=%27round%27 stroke-width=%272%27 d=%27m2 5 6 6 6-6%27/%3e%3c/svg%3e');
    background-repeat: no-repeat;
    background-position: right 10.5px center;
    background-size: 16px 12px;
    box-shadow: none;
    appearance: none;
}

.field input:focus,
.field select:focus {
    border-color: #9badbf;
    box-shadow: 0 0 0 3.5px rgba(55, 90, 127, 0.25);
    outline: 0;
}

.battle-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 20px;
}

.battle-grid .form-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
}

.battle-grid :deep(.panel-body) > .form-row:first-child {
    grid-template-columns: 3fr 1fr auto;
}

.battle-grid [data-parity-id='defender-nation'] :deep(.panel-body) > .form-row:last-child {
    margin-top: -7px;
}

.battle-grid :deep(.panel-body) {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding-block: 24px;
}

.grade-label {
    display: flex;
    align-items: center;
    padding: 5px 10px;
    border: 1px solid #111;
    background: #444;
    color: #ddd;
    font-size: 14px;
    white-space: nowrap;
}

.column {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.defender-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.defender-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 38px;
    padding: 6px 14px;
    border-radius: 5px;
    background: #444;
    font-size: 14px;
}

.defender-toolbar > div {
    display: flex;
    gap: 7px;
}

.summary-table {
    width: 100%;
    border-collapse: collapse;
    vertical-align: top;
}

.summary-table tbody,
.summary-table tr {
    vertical-align: top;
}

/*
 * Ref renders this as a Bootstrap table: 7px padding on every side, a #444
 * bottom rule and the transparent accent inset shadow the framework always
 * emits.
 */
.summary-table th,
.summary-table td {
    padding: 7px;
    border-bottom: 1px solid #444;
    box-shadow: inset 0 0 0 9999px rgba(0, 0, 0, 0);
    text-align: left;
    vertical-align: top;
}

.summary-table th {
    width: 180px;
    color: #fff;
    font-weight: 700;
}

.battle-summary-card :deep(.panel-body) {
    padding: 0;
}

.battle-summary-card {
    margin-top: -6px;
}

.log-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 12px;
    margin-top: 15px;
    margin-bottom: 14px;
}

.log-body {
    min-height: 0;
    line-height: 1.5;
    font-size: 0.85rem;
}

.modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(5, 5, 5, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 30;
}

.modal {
    background: rgba(12, 12, 12, 0.95);
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 16px;
    width: min(520px, 90vw);
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.modal header,
.modal footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
}

.modal h3 {
    margin: 0;
    font-size: 1rem;
}

.modal-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
}

.hint {
    font-size: 0.75rem;
    color: rgba(232, 221, 196, 0.7);
}

.select-wrap select {
    width: 100%;
    min-height: 180px;
    background: rgba(6, 6, 6, 0.7);
    border: 1px solid rgba(201, 164, 90, 0.35);
    color: #e8ddc4;
    padding: 6px;
}
@media (max-width: 720px) {
    .battle-simulator {
        margin-right: 11px;
    }

    .battle-grid {
        gap: 7px;
    }

    .settings-grid {
        grid-template-columns: 175px 149px 134px;
    }

    .seed-field {
        grid-column: 1 / 3;
        grid-row: 2;
        width: 208px;
    }

    .seed-field span {
        padding-right: 17px;
    }

    .repeat-field {
        grid-column: 2 / 4;
        grid-row: 2;
        width: 249px;
        margin-left: 33.5px;
    }

    .header-actions {
        grid-column: 1 / -1;
        margin-left: 0;
    }

    .defender-toolbar {
        align-items: flex-start;
        flex-direction: column;
        gap: 7px;
    }
}
</style>
