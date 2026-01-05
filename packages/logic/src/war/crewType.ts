import type { CrewTypeDefinition } from '@sammo-ts/logic/world/types.js';

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
        if (this.definition.name.length <= 4) {
            return this.definition.name;
        }
        return this.definition.name.slice(0, 4);
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
