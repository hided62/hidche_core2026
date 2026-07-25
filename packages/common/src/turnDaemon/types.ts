export type TurnDaemonState = 'idle' | 'running' | 'flushing' | 'paused' | 'stopping';

export type RunReason = 'schedule' | 'manual' | 'poke';

export interface TurnRunBudget {
    budgetMs: number;
    maxGenerals: number;
    catchUpCap: number;
}

export interface TurnCheckpoint {
    turnTime: string;
    generalId?: number;
    year: number;
    month: number;
}

export interface TurnRunResult {
    lastTurnTime: string;
    processedGenerals: number;
    processedTurns: number;
    durationMs: number;
    partial: boolean;
    checkpoint?: TurnCheckpoint;
    deletedGenerals?: number[];
    deletedTroops?: number[];
}

export interface TurnDaemonStatus {
    state: TurnDaemonState;
    running: boolean;
    paused: boolean;
    lastError?: string;
    lastRunAt?: string;
    lastDurationMs?: number;
    lastTurnTime?: string;
    nextTurnTime?: string;
    pendingReason?: RunReason;
    queueDepth: number;
    checkpoint?: TurnCheckpoint;
}

export type TurnDaemonCommand =
    | {
          type: 'run';
          requestId?: string;
          reason: RunReason;
          targetTime?: string;
          budget?: TurnRunBudget;
      }
    | { type: 'pause'; requestId?: string; reason?: string }
    | { type: 'resume'; requestId?: string; reason?: string }
    | { type: 'shutdown'; requestId?: string; reason?: string }
    | { type: 'getStatus'; requestId?: string }
    | { type: 'troopCreate'; requestId?: string; generalId: number; troopName: string }
    | { type: 'troopJoin'; requestId?: string; generalId: number; troopId: number }
    | { type: 'troopExit'; requestId?: string; generalId: number }
    | {
          type: 'troopKick';
          requestId?: string;
          generalId: number;
          troopId: number;
          targetGeneralId: number;
      }
    | { type: 'troopRename'; requestId?: string; generalId: number; troopId: number; troopName: string }
    | { type: 'dieOnPrestart'; requestId?: string; generalId: number }
    | { type: 'buildNationCandidate'; requestId?: string; generalId: number }
    | { type: 'instantRetreat'; requestId?: string; generalId: number }
    | { type: 'vacation'; requestId?: string; generalId: number }
    | {
          type: 'setMySetting';
          requestId?: string;
          generalId: number;
          settings: {
              tnmt?: number;
              defence_train?: number;
              use_treatment?: number;
              use_auto_nation_turn?: number;
          };
      }
    | { type: 'dropItem'; requestId?: string; generalId: number; itemType: string }
    | { type: 'auctionFinalize'; requestId?: string; auctionId: number }
    | {
          type: 'changePermission';
          requestId?: string;
          generalId: number;
          isAmbassador: boolean;
          targetGeneralIds: number[];
      }
    | { type: 'kick'; requestId?: string; generalId: number; destGeneralId: number }
    | {
          type: 'appoint';
          requestId?: string;
          generalId: number;
          destGeneralId: number;
          destCityId: number;
          officerLevel: number;
      }
    | {
          type: 'tournamentRefund';
          requestId?: string;
          bettingId?: number;
          reason?: string;
          refunds: Array<{
              generalId: number;
              amount: number;
          }>;
      }
    | {
          type: 'tournamentBettingPayout';
          requestId?: string;
          bettingId?: number;
          reason?: string;
          payouts: Array<{
              generalId: number;
              amount: number;
          }>;
      }
    | {
          type: 'tournamentReward';
          requestId?: string;
          tournamentType: number;
          winnerId: number;
          runnerUpId: number;
          top16: number[];
          top8: number[];
          top4: number[];
      }
    | {
          type: 'voteReward';
          requestId?: string;
          voteId: number;
          generalId: number;
          goldReward: number;
          unique?: {
              expected: boolean;
              itemKey?: string | null;
          };
      }
    | {
          type: 'setNationMeta';
          requestId?: string;
          nationId: number;
          updates: Record<string, unknown>;
          expectedUpdatedAt?: string;
      }
        | {
                    type: 'adjustGeneralResources';
                    requestId?: string;
                    reason?: string;
                    adjustments: Array<{
                            generalId: number;
                            goldDelta?: number;
                            riceDelta?: number;
                    }>;
          }
        | {
              type: 'adjustGeneralMeta';
              requestId?: string;
              reason?: string;
              adjustments: Array<{
                  generalId: number;
                  metaDelta: Record<string, number>;
              }>;
          }
        | {
              type: 'tournamentMatchResult';
              requestId?: string;
              tournamentType: number;
              attackerId: number;
              defenderId: number;
              result: 'attacker' | 'defender' | 'draw';
          }
        | {
              type: 'patchGeneral';
              requestId?: string;
              generalId: number;
              patch: {
                  meta?: Record<string, unknown>;
                  turnTime?: string;
                  stats?: {
                      leadership?: number;
                      strength?: number;
                      intelligence?: number;
                  };
                  specialWar?: string;
              };
          }
        | {
              type: 'auctionBid';
              requestId?: string;
              auctionId: number;
              generalId: number;
              amount: number;
              tryExtendCloseDate?: boolean;
          };

export type TurnDaemonCommandResult =
    | {
          type: 'commandRejected';
          ok: false;
          commandType: TurnDaemonCommand['type'];
          reason: string;
      }
    | {
          type: 'auctionFinalize';
          ok: true;
          auctionId: number;
      }
    | {
          type: 'auctionFinalize';
          ok: false;
          auctionId: number;
          reason: string;
      }
    | {
          type: 'troopCreate';
          ok: true;
          generalId: number;
          troopId: number;
          troopName: string;
      }
    | {
          type: 'troopCreate';
          ok: false;
          generalId: number;
          reason: string;
      }
    | {
          type: 'troopJoin';
          ok: true;
          generalId: number;
          troopId: number;
      }
    | {
          type: 'troopJoin';
          ok: false;
          generalId: number;
          troopId: number;
          reason: string;
      }
    | {
          type: 'troopExit';
          ok: true;
          generalId: number;
          wasLeader: boolean;
      }
    | {
          type: 'troopExit';
          ok: false;
          generalId: number;
          reason: string;
      }
    | {
          type: 'troopKick';
          ok: true;
          generalId: number;
          troopId: number;
          targetGeneralId: number;
      }
    | {
          type: 'troopKick';
          ok: false;
          generalId: number;
          troopId: number;
          targetGeneralId: number;
          reason: string;
      }
    | {
          type: 'troopRename';
          ok: true;
          generalId: number;
          troopId: number;
          troopName: string;
      }
    | {
          type: 'troopRename';
          ok: false;
          generalId: number;
          troopId: number;
          reason: string;
      }
    | { type: 'dieOnPrestart'; ok: boolean; generalId: number; reason?: string }
    | { type: 'buildNationCandidate'; ok: boolean; generalId: number; reason?: string }
    | { type: 'instantRetreat'; ok: boolean; generalId: number; reason?: string }
    | { type: 'vacation'; ok: boolean; generalId: number; reason?: string }
    | { type: 'setMySetting'; ok: boolean; generalId: number; reason?: string }
    | { type: 'dropItem'; ok: boolean; generalId: number; reason?: string }
    | { type: 'changePermission'; ok: boolean; generalId: number; reason?: string }
    | { type: 'kick'; ok: boolean; generalId: number; reason?: string }
    | { type: 'appoint'; ok: boolean; generalId: number; reason?: string }
    | {
          type: 'tournamentRefund';
          ok: true;
          bettingId?: number;
          processed: number;
          missing: number;
          totalRefund: number;
      }
    | {
          type: 'tournamentRefund';
          ok: false;
          bettingId?: number;
          reason: string;
      }
    | {
          type: 'tournamentBettingPayout';
          ok: true;
          bettingId?: number;
          processed: number;
          missing: number;
          totalPayout: number;
      }
    | {
          type: 'tournamentBettingPayout';
          ok: false;
          bettingId?: number;
          reason: string;
      }
    | {
          type: 'tournamentReward';
          ok: true;
          winnerId: number;
          runnerUpId: number;
          rewarded: number;
          missing: number;
          totalGold: number;
          totalExp: number;
      }
    | {
          type: 'tournamentReward';
          ok: false;
          winnerId: number;
          runnerUpId: number;
          reason: string;
      }
    | {
          type: 'voteReward';
          ok: true;
          voteId: number;
          generalId: number;
          awardedUnique: boolean;
          itemKey?: string | null;
          alreadyApplied?: boolean;
      }
    | {
          type: 'voteReward';
          ok: false;
          voteId: number;
          generalId: number;
          reason: string;
      }
    | {
          type: 'setNationMeta';
          ok: true;
          nationId: number;
          updatedAt: string;
      }
    | {
          type: 'setNationMeta';
          ok: false;
          nationId: number;
          reason: string;
          currentUpdatedAt?: string;
      }
            | {
                type: 'adjustGeneralResources';
                ok: true;
                processed: number;
                missing: number;
                totalGoldDelta: number;
                totalRiceDelta: number;
            }
            | {
                type: 'adjustGeneralResources';
                ok: false;
                reason: string;
                }
            | {
                type: 'adjustGeneralMeta';
                ok: true;
                processed: number;
                missing: number;
            }
            | {
                type: 'adjustGeneralMeta';
                ok: false;
                reason: string;
            }
            | {
                type: 'tournamentMatchResult';
                ok: true;
                tournamentType: number;
                attackerId: number;
                defenderId: number;
                result: 'attacker' | 'defender' | 'draw';
            }
            | {
                type: 'tournamentMatchResult';
                ok: false;
                tournamentType: number;
                attackerId: number;
                defenderId: number;
                result: 'attacker' | 'defender' | 'draw';
                reason: string;
            }
                | {
                    type: 'patchGeneral';
                    ok: true;
                    generalId: number;
                }
                | {
                    type: 'patchGeneral';
                    ok: false;
                    generalId: number;
                    reason: string;
                    }
                    | {
                        type: 'auctionBid';
                        ok: true;
                        auctionId: number;
                        closeAt: string;
                    }
                    | {
                        type: 'auctionBid';
                        ok: false;
                        auctionId: number;
                        reason: string;
                    };

export type TurnDaemonEvent =
    | { type: 'status'; requestId?: string; status: TurnDaemonStatus }
    | { type: 'runStarted'; at: string; reason: RunReason }
    | { type: 'runCompleted'; at: string; result: TurnRunResult }
    | { type: 'runFailed'; at: string; error: string }
    | { type: 'commandResult'; result: TurnDaemonCommandResult };

export type TurnDaemonCommandType = TurnDaemonCommand['type'];

export type TurnDaemonCommandByType<T extends TurnDaemonCommandType> = Extract<TurnDaemonCommand, { type: T }>;

export type TurnDaemonCommandResultByType<T extends TurnDaemonCommandType> = Extract<
    TurnDaemonCommandResult,
    { type: T }
>;
