import type { City, Nation } from '@sammo-ts/logic';
import type { StateView } from '@sammo-ts/logic';

import type { TurnGeneral } from '../../types.js';
import type { AiWorldView } from '../types.js';
import type { ConstraintEnv } from './constraint.js';

export class WorldStateView implements StateView {
    constructor(
        private readonly world: AiWorldView | null,
        private readonly env: ConstraintEnv,
        private readonly args: Record<string, unknown>,
        private readonly overrides?: {
            general?: TurnGeneral;
            city?: City;
            nation?: Nation | null;
        }
    ) {}

    has(req: Parameters<StateView['has']>[0]): boolean {
        return this.get(req) !== null;
    }

    get(req: Parameters<StateView['get']>[0]): unknown | null {
        if (!this.world) {
            return null;
        }
        switch (req.kind) {
            case 'general':
                if (this.overrides?.general && this.overrides.general.id === req.id) {
                    return this.overrides.general;
                }
                return this.world.getGeneralById(req.id);
            case 'generalList':
                return this.world.listGenerals();
            case 'destGeneral':
                return this.world.getGeneralById(req.id);
            case 'city':
                if (this.overrides?.city && this.overrides.city.id === req.id) {
                    return this.overrides.city;
                }
                return this.world.getCityById(req.id);
            case 'destCity':
                return this.world.getCityById(req.id);
            case 'nation':
                if (this.overrides?.nation && this.overrides.nation.id === req.id) {
                    return this.overrides.nation;
                }
                return this.world.getNationById(req.id);
            case 'nationList':
                return this.world.listNations();
            case 'destNation':
                return this.world.getNationById(req.id);
            case 'diplomacy':
                return this.world.getDiplomacyEntry(req.srcNationId, req.destNationId);
            case 'diplomacyList':
                return this.world.listDiplomacy();
            case 'arg':
                return this.args[req.key] ?? null;
            case 'env':
                return this.env[req.key] ?? null;
            default:
                return null;
        }
    }
}
