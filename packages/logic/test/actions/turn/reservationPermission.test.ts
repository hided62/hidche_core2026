import { describe, expect, it } from 'vitest';

import { evaluateConstraints } from '../../../src/constraints/evaluate.js';
import type { Constraint, ConstraintContext, RequirementKey, StateView } from '../../../src/constraints/types.js';
import type { TurnCommandEnv } from '../../../src/actions/turn/commandEnv.js';
import { ActionDefinition as EmployAction } from '../../../src/actions/turn/general/che_등용.js';
import { ActionDefinition as AcceptScoutAction } from '../../../src/actions/turn/general/che_등용수락.js';
import { ActionDefinition as AppointmentAction } from '../../../src/actions/turn/general/che_임관.js';
import { ActionDefinition as FollowAppointmentAction } from '../../../src/actions/turn/general/che_장수대상임관.js';
import { ActionDefinition as NpcSelfAction } from '../../../src/actions/turn/general/che_NPC능동.js';
import { ActionDefinition as NonAggressionProposalAction } from '../../../src/actions/turn/nation/che_불가침제의.js';

const commandEnv: TurnCommandEnv = {
    develCost: 100,
    trainDelta: 35,
    atmosDelta: 35,
    maxTrainByCommand: 100,
    maxAtmosByCommand: 100,
    sabotageDefaultProb: 0.5,
    sabotageProbCoefByStat: 0.1,
    sabotageDefenceCoefByGeneralCount: 0.1,
    sabotageDamageMin: 10,
    sabotageDamageMax: 30,
    openingPartYear: 0,
    maxGeneral: 10,
    defaultNpcGold: 1000,
    defaultNpcRice: 1000,
    defaultCrewTypeId: 1100,
    defaultSpecialDomestic: null,
    defaultSpecialWar: null,
    initialNationGenLimit: 10,
    maxTechLevel: 10,
    baseGold: 1000,
    baseRice: 1000,
    maxResourceActionAmount: 1000,
};

class PermissionStateView implements StateView {
    constructor(
        private readonly actor: { npcState: number },
        private readonly env: Record<string, unknown>
    ) {}

    has(req: RequirementKey): boolean {
        if (req.kind === 'general') {
            return req.id === 1;
        }
        if (req.kind === 'env') {
            return Object.hasOwn(this.env, req.key);
        }
        return false;
    }

    get(req: RequirementKey): unknown | null {
        if (req.kind === 'general' && req.id === 1) {
            return this.actor;
        }
        if (req.kind === 'env') {
            return this.env[req.key] ?? null;
        }
        return null;
    }
}

const evaluatePermission = (
    constraints: Constraint[],
    args: Record<string, unknown>,
    options?: { joinMode?: string; npcState?: number }
) => {
    const env = {
        join_mode: options?.joinMode ?? 'full',
        year: 190,
        month: 1,
        startYear: 180,
    };
    const ctx: ConstraintContext = {
        actorId: 1,
        args,
        env,
        mode: 'full',
    };
    return evaluateConstraints(constraints, ctx, new PermissionStateView({ npcState: options?.npcState ?? 0 }, env));
};

const permissionContext: ConstraintContext = {
    actorId: 1,
    args: {},
    env: {},
    mode: 'full',
};

describe('legacy reservation permission constraints', () => {
    it('applies only join_mode to the three reservable join commands', () => {
        const cases = [
            {
                constraints: new EmployAction(commandEnv).buildPermissionConstraints(permissionContext, {
                    destGeneralId: 2,
                }),
                args: { destGeneralId: 2 },
            },
            {
                constraints: new AppointmentAction(commandEnv).buildPermissionConstraints(permissionContext, {
                    destNationId: 2,
                }),
                args: { destNationId: 2 },
            },
            {
                constraints: new FollowAppointmentAction().buildPermissionConstraints(permissionContext, {
                    destGeneralID: 2,
                }),
                args: { destGeneralID: 2 },
            },
        ];

        for (const { constraints, args } of cases) {
            const randomOnly = evaluatePermission(constraints, args, { joinMode: 'onlyRandom' });
            expect(randomOnly).toMatchObject({ kind: 'deny', reason: '랜덤 임관만 가능합니다' });

            const full = evaluatePermission(constraints, args);
            expect(full).toEqual({ kind: 'allow' });
        }
    });

    it('blocks scout acceptance reservations and restricts NPC self-action to NPC actors', () => {
        const accept = new AcceptScoutAction(commandEnv);
        const acceptArgs = { destNationId: 2, destGeneralId: 7 };
        expect(
            evaluatePermission(accept.buildPermissionConstraints(permissionContext, acceptArgs), acceptArgs)
        ).toMatchObject({
            kind: 'deny',
            reason: '예약 불가능 커맨드',
        });

        const npcAction = new NpcSelfAction();
        const npcArgs = { optionText: '순간이동' as const, destCityId: 2 };
        expect(
            evaluatePermission(npcAction.buildPermissionConstraints(permissionContext, npcArgs), npcArgs)
        ).toMatchObject({
            kind: 'deny',
            reason: 'NPC여야 합니다.',
        });
        expect(
            evaluatePermission(npcAction.buildPermissionConstraints(permissionContext, npcArgs), npcArgs, {
                npcState: 2,
            })
        ).toEqual({ kind: 'allow' });
    });

    it('checks only the six-month minimum when reserving a non-aggression proposal', () => {
        const definition = new NonAggressionProposalAction();
        const shortArgs = { destNationId: 2, year: 190, month: 6 };
        expect(
            evaluatePermission(definition.buildPermissionConstraints(permissionContext, shortArgs), shortArgs)
        ).toMatchObject({
            kind: 'deny',
            reason: '기한은 6개월 이상이어야 합니다.',
        });

        const validArgs = { destNationId: 2, year: 190, month: 7 };
        expect(
            evaluatePermission(definition.buildPermissionConstraints(permissionContext, validArgs), validArgs)
        ).toEqual({
            kind: 'allow',
        });
    });
});
