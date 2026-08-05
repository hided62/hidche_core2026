import type { CrewTypeDefinition } from '@sammo-ts/logic/world/types.js';

const isWideCodePoint = (codePoint: number): boolean =>
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
        codePoint === 0x2329 ||
        codePoint === 0x232a ||
        (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
        (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
        (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
        (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
        (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
        (codePoint >= 0xff00 && codePoint <= 0xff60) ||
        (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
        (codePoint >= 0x1b000 && codePoint <= 0x1b001) ||
        (codePoint >= 0x1f200 && codePoint <= 0x1f251) ||
        (codePoint >= 0x20000 && codePoint <= 0x3fffd));

const substringForDisplayWidth = (value: string, width: number): string => {
    let currentWidth = 0;
    let result = '';
    for (const character of value) {
        const characterWidth = isWideCodePoint(character.codePointAt(0) ?? 0) ? 2 : 1;
        if (currentWidth + characterWidth > width) {
            break;
        }
        result += character;
        currentWidth += characterWidth;
    }
    return result;
};

// 전투 계산에 필요한 병종 정보 래퍼.
export class WarCrewType {
    constructor(private readonly definition: CrewTypeDefinition) {}

    get id(): number {
        return this.definition.id;
    }

    get armType(): number {
        return this.definition.armType;
    }

    get name(): string {
        return this.definition.name;
    }

    get speed(): number {
        return this.definition.speed;
    }

    get avoid(): number {
        return this.definition.avoid;
    }

    get attack(): number {
        return this.definition.attack;
    }

    get defence(): number {
        return this.definition.defence;
    }

    get rice(): number {
        return this.definition.rice;
    }

    get magicCoef(): number {
        return this.definition.magicCoef;
    }

    get cost(): number {
        return this.definition.cost;
    }

    public reqCities(): boolean {
        return this.definition.requirements.some((req) => req.type === 'ReqCities');
    }

    public reqRegions(): boolean {
        return this.definition.requirements.some((req) => req.type === 'ReqRegions');
    }

    get initSkillTrigger(): string[] {
        return this.definition.initSkillTrigger ?? [];
    }

    get phaseSkillTrigger(): string[] {
        return this.definition.phaseSkillTrigger ?? [];
    }

    getShortName(): string {
        // Ref uses mb_strwidth(..., 'UTF-8') and truncates at display width 4.
        // Korean/CJK characters consume two columns, unlike JS string length.
        return substringForDisplayWidth(this.definition.name, 4);
    }

    getAttackCoef(oppose: WarCrewType): number {
        const byId = this.definition.attackCoef[String(oppose.id)];
        if (typeof byId === 'number') {
            return byId;
        }
        const byType = this.definition.attackCoef[String(oppose.armType)];
        if (typeof byType === 'number') {
            return byType;
        }
        return 1;
    }

    getDefenceCoef(oppose: WarCrewType): number {
        const byId = this.definition.defenceCoef[String(oppose.id)];
        if (typeof byId === 'number') {
            return byId;
        }
        const byType = this.definition.defenceCoef[String(oppose.armType)];
        if (typeof byType === 'number') {
            return byType;
        }
        return 1;
    }
}
