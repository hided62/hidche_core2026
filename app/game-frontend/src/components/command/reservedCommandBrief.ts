import { JosaUtil } from '@sammo-ts/common';

import type { CommandOption, CommandTable } from './types';

type CommandScope = 'general' | 'nation';
type CommandArgs = Record<string, unknown>;

const CITY_TO_COMMANDS = new Set(['che_이동', 'che_강행', 'che_출병', 'che_천도']);
const CITY_AT_COMMANDS = new Set([
    'che_첩보',
    'che_화계',
    'che_선동',
    'che_탈취',
    'che_파괴',
    'che_백성동원',
    'che_허보',
]);
const CITY_OBJECT_COMMANDS = new Set(['che_수몰', 'che_초토화']);
const NATION_AT_COMMANDS = new Set(['che_선전포고', 'che_급습', 'che_이호경식']);
const NATION_PROPOSAL_COMMANDS = new Set(['che_불가침파기제의', 'che_종전제의']);

const ITEM_TYPE_NAMES: Record<string, string> = {
    horse: '명마',
    weapon: '무기',
    book: '서적',
    item: '도구',
};

const asArgs = (value: unknown): CommandArgs =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as CommandArgs) : {};

const firstValue = (args: CommandArgs, keys: readonly string[]): unknown => {
    for (const key of keys) {
        if (args[key] !== undefined) return args[key];
    }
    return undefined;
};

const optionLabel = (options: readonly CommandOption[], value: unknown): string | null => {
    const option = options.find((entry) => entry.value === value || String(entry.value) === String(value));
    if (!option) return null;
    // 도시·장수 option에는 선택 보조용 소속 정보가 괄호로 붙지만 Ref brief에는 이름만 들어간다.
    return option.label.replace(/\s+\([^)]*\)$/u, '');
};

const commandNameMap = (table: CommandTable | null, scope: CommandScope): Map<string, string> => {
    const result = new Map<string, string>([['휴식', '휴식']]);
    for (const group of table?.[scope] ?? []) {
        for (const command of group.values) result.set(command.key, command.name);
    }
    return result;
};

const defaultCommandName = (action: string): string => action.replace(/^(?:che_|cr_|event_)/u, '');

const numberText = (value: unknown, grouped = false): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return String(value ?? '');
    return grouped ? value.toLocaleString('en-US') : String(value);
};

const wrap = (value: string): string => `【${value}】`;
const withParticle = (value: string, particle: '을' | '으로'): string => `${value}${JosaUtil.pick(value, particle)}`;
const wrappedWithParticle = (value: string, particle: '을' | '으로'): string =>
    `${wrap(value)}${JosaUtil.pick(value, particle)}`;

export const formatReservedCommandBrief = (
    scope: CommandScope,
    action: string,
    rawArgs: unknown,
    table: CommandTable | null
): string => {
    const args = asArgs(rawArgs);
    const input = table?.inputOptions;
    const commandNames = commandNameMap(table, scope);
    const commandName = commandNames.get(action) ?? defaultCommandName(action);
    const cityName = optionLabel(input?.cities ?? [], firstValue(args, ['destCityId', 'destCityID']));
    const nationName = optionLabel(input?.nations ?? [], firstValue(args, ['destNationId', 'destNationID']));
    const generalName = optionLabel(input?.generals ?? [], firstValue(args, ['destGeneralId', 'destGeneralID']));

    if (CITY_TO_COMMANDS.has(action) && cityName) {
        return `${wrappedWithParticle(cityName, '으로')} ${commandName}`;
    }
    if (action === 'cr_인구이동' && cityName) {
        return `${wrappedWithParticle(cityName, '으로')} ${numberText(args.amount, true)}명 ${commandName}`;
    }
    if (CITY_AT_COMMANDS.has(action) && cityName) {
        const suffix =
            scope === 'nation' ? commandName : action === 'che_첩보' ? `${commandName} 실행` : `${commandName}실행`;
        return `${wrap(cityName)}에 ${suffix}`;
    }
    if (CITY_OBJECT_COMMANDS.has(action) && cityName) {
        return `${wrappedWithParticle(cityName, '을')} ${commandName}`;
    }
    if (action === 'che_임관' && nationName) {
        return `${wrappedWithParticle(nationName, '으로')} ${commandName}`;
    }
    if (NATION_AT_COMMANDS.has(action) && nationName) {
        return `${wrap(nationName)}에 ${commandName}`;
    }
    if (NATION_PROPOSAL_COMMANDS.has(action) && nationName) {
        return `${wrap(nationName)}에게 ${commandName}`;
    }
    if (action === 'che_불가침제의' && nationName) {
        return `${wrap(nationName)}에게 ${numberText(args.year)}년 ${numberText(args.month)}월까지 ${commandName}`;
    }
    if (action === 'che_등용' && generalName) {
        return `${wrappedWithParticle(generalName, '을')} ${commandName}`;
    }
    if (action === 'che_장수대상임관' && generalName) {
        return `${wrappedWithParticle(generalName, '을')} 따라 임관`;
    }
    if (action === 'che_선양' && generalName) {
        return `${wrap(generalName)}에게 ${commandName}`;
    }
    if (action === 'che_랜덤임관') {
        return '무작위 국가로 임관';
    }
    if ((action === 'che_건국' || action === 'cr_건국') && typeof args.nationName === 'string') {
        return `${wrappedWithParticle(args.nationName, '을')} 건국`;
    }
    if (action === 'che_무작위건국' && typeof args.nationName === 'string') {
        return `${wrappedWithParticle(args.nationName, '을')} 무작위 도시에 건국`;
    }
    if (action === 'che_군량매매') {
        return `군량 ${numberText(args.amount)}을 ${args.buyRice ? '구입' : '판매'}`;
    }
    if (action === 'che_헌납') {
        return `${args.isGold ? '금' : '쌀'} ${numberText(args.amount)}을 ${commandName}`;
    }
    if (action === 'che_증여' && generalName) {
        return `${wrap(generalName)}에게 ${args.isGold ? '금' : '쌀'} ${numberText(args.amount)}을 ${commandName}`;
    }
    if (action === 'che_징병' || action === 'che_모병') {
        const crewType = optionLabel(input?.crewTypes ?? [], args.crewType);
        if (crewType) return `${wrap(crewType)} ${numberText(args.amount)}명 ${commandName}`;
    }
    if (action === 'che_숙련전환') {
        const srcArmType = optionLabel(input?.armTypes ?? [], args.srcArmType);
        const destArmType = optionLabel(input?.armTypes ?? [], args.destArmType);
        if (srcArmType && destArmType) return `${wrap(srcArmType)}숙련을 ${wrap(destArmType)}숙련으로 전환`;
    }
    if (action === 'che_장비매매') {
        const itemType = typeof args.itemType === 'string' ? args.itemType : '';
        if (args.itemCode === 'None') {
            const itemTypeName = ITEM_TYPE_NAMES[itemType];
            if (itemTypeName) return `${withParticle(itemTypeName, '을')} 판매`;
        }
        const itemName = optionLabel(input?.items[itemType] ?? [], args.itemCode);
        if (itemName) {
            const itemRawName = itemName.replace(/\([^)]*\)$/u, '');
            return `${wrap(itemName)}${JosaUtil.pick(itemRawName, '을')} 구입`;
        }
    }
    if (action === 'che_발령' && generalName && cityName) {
        return `${wrap(generalName)}${wrappedWithParticle(cityName, '으로')} ${commandName}`;
    }
    if (action === 'che_부대탈퇴지시' && generalName) {
        return `${wrap(generalName)}${commandName}`;
    }
    if ((action === 'che_포상' || action === 'che_몰수') && generalName) {
        return `${wrap(generalName)} ${args.isGold ? '금' : '쌀'} ${numberText(args.amount, true)} ${commandName}`;
    }
    if (action === 'che_물자원조' && nationName && Array.isArray(args.amountList)) {
        return `${wrap(nationName)}에게 국고 ${numberText(args.amountList[0], true)} 병량 ${numberText(
            args.amountList[1],
            true
        )} ${commandName}`;
    }
    if (action === 'che_증축' || action === 'che_감축') {
        return `수도를 ${commandName}`;
    }
    if (action === 'che_국기변경') {
        return '【국기】를 변경';
    }
    if (action === 'che_국호변경' && typeof args.nationName === 'string') {
        return `국호를 ${wrappedWithParticle(args.nationName, '으로')} 변경`;
    }
    if (action === 'che_피장파장' && nationName) {
        const targetAction = typeof args.commandType === 'string' ? args.commandType : '';
        const targetName = commandNames.get(targetAction) ?? defaultCommandName(targetAction);
        return `${wrap(nationName)}에 ${wrap(targetName)} ${commandName}`;
    }

    return commandName;
};
