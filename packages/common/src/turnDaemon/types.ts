export type TurnDaemonState = 'idle' | 'running' | 'flushing' | 'paused' | 'stopping';

export type RunReason = 'schedule' | 'manual' | 'poke';

export interface TurnRunBudget {
    budgetMs: number;
    maxGenerals: number;
    catchUpCap: number;
}

export interface TurnCheckpoint {
    turnTime: string;
    turnTick?: number;
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

export type RuntimeAutorunUserOption = 'develop' | 'warp' | 'recruit' | 'recruit_high' | 'train' | 'battle' | 'chief';

export interface RuntimeAutorunUserSettings {
    limitMinutes: number;
    options: RuntimeAutorunUserOption[];
}

export interface RuntimeGameSettingsPatch {
    turnTermMinutes?: number;
    blockGeneralCreate?: 0 | 1 | 2;
    autorunUser?: RuntimeAutorunUserSettings | null;
}

export interface TurnDaemonSelectPoolCandidate {
    uniqueName: string;
    generalName: string;
    leadership: number;
    strength: number;
    intel: number;
    specialDomestic: string | null;
    specialDomesticName: string | null;
    specialDomesticInfo: string;
    specialWar: string | null;
    specialWarName: string | null;
    specialWarInfo: string;
    ego: string | null;
    dex: [number, number, number, number, number];
    imageServer: 0 | 1;
    picture: string;
}

export interface TurnDaemonSelectPoolReservation {
    poolName: string;
    hasGeneral: boolean;
    validUntil: string;
    candidates: TurnDaemonSelectPoolCandidate[];
}

export type TurnDaemonInheritanceAction =
    | {
          action: 'buyHiddenBuff';
          buffType:
              | 'warAvoidRatio'
              | 'warCriticalRatio'
              | 'warMagicTrialProb'
              | 'domesticSuccessProb'
              | 'domesticFailProb'
              | 'warAvoidRatioOppose'
              | 'warCriticalRatioOppose'
              | 'warMagicTrialProbOppose';
          level: number;
      }
    | { action: 'setNextSpecialWar'; specialKey: string }
    | { action: 'resetSpecialWar' }
    | { action: 'resetTurnTime' }
    | {
          action: 'resetStat';
          leadership: number;
          strength: number;
          intel: number;
          inheritBonusStat?: [number, number, number];
      }
    | { action: 'buyRandomUnique' }
    | { action: 'checkOwner'; targetGeneralId: number };

export type TurnDaemonCommand =
    | {
          type: 'run';
          requestId?: string;
          reason: RunReason;
          targetTime?: string;
          budget?: TurnRunBudget;
      }
    | {
          type: 'updateRuntimeSettings';
          requestId?: string;
          actionId: string;
          settings: RuntimeGameSettingsPatch;
      }
    | { type: 'pause'; requestId?: string; reason?: string }
    | { type: 'resume'; requestId?: string; reason?: string }
    | { type: 'shutdown'; requestId?: string; reason?: string }
    | {
          type: 'shiftSchedule';
          requestId?: string;
          actionId: string;
          deltaMinutes: number;
      }
    | { type: 'getStatus'; requestId?: string }
    | { type: 'troopCreate'; requestId?: string; userId: string; generalId: number; troopName: string }
    | { type: 'troopJoin'; requestId?: string; userId: string; generalId: number; troopId: number }
    | { type: 'troopExit'; requestId?: string; userId: string; generalId: number }
    | {
          type: 'troopKick';
          requestId?: string;
          userId: string;
          generalId: number;
          troopId: number;
          targetGeneralId: number;
      }
    | {
          type: 'troopRename';
          requestId?: string;
          userId: string;
          generalId: number;
          troopId: number;
          troopName: string;
      }
    | { type: 'ensureDieOnPrestartStatus'; requestId?: string; userId: string; generalId: number }
    | { type: 'dieOnPrestart'; requestId?: string; userId: string; generalId: number }
    | { type: 'buildNationCandidate'; requestId?: string; userId: string; generalId: number }
    | { type: 'instantRetreat'; requestId?: string; userId: string; generalId: number }
    | {
          type: 'messageRespond';
          requestId?: string;
          userId: string;
          generalId: number;
          messageId: number;
          response: boolean;
      }
    | {
          type: 'syncDiplomaticResponse';
          requestId?: string;
          userId: string;
          generalId: number;
          messageId: number;
          nationIds: number[];
          cityIds: number[];
      }
    | { type: 'vacation'; requestId?: string; userId: string; generalId: number }
    | {
          type: 'setMySetting';
          requestId?: string;
          userId: string;
          generalId: number;
          settings: {
              tnmt?: number;
              defence_train?: number;
              use_treatment?: number;
              use_auto_nation_turn?: number;
              use_auto_nation_war?: number;
              use_auto_nation_promotion?: number;
              use_auto_nation_finance?: number;
              use_auto_nation_capital?: number;
          };
      }
    | {
          type: 'dropItem';
          requestId?: string;
          userId: string;
          generalId: number;
          itemType: 'horse' | 'weapon' | 'book' | 'item';
      }
    | {
          type: 'auctionFinalize';
          requestId?: string;
          auctionId: number;
          expectedCloseAt?: string;
          expectedCloseTick: number;
      }
    | {
          type: 'auctionOpen';
          requestId?: string;
          userId: string;
          generalId: number;
          auctionType: 'BUY_RICE' | 'SELL_RICE' | 'UNIQUE_ITEM';
          amount: number;
          closeTurnCnt?: number;
          startBidAmount?: number;
          finishBidAmount?: number;
          itemKey?: string;
      }
    | {
          type: 'changePermission';
          requestId?: string;
          userId: string;
          generalId: number;
          isAmbassador: boolean;
          targetGeneralIds: number[];
      }
    | { type: 'kick'; requestId?: string; userId: string; generalId: number; destGeneralId: number }
    | {
          type: 'appoint';
          requestId?: string;
          userId: string;
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
          tournamentType?: number;
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
          userId: string;
          voteId: number;
          generalId: number;
          selection: number[];
      }
    | {
          type: 'setNationSetting';
          requestId?: string;
          userId: string;
          generalId: number;
          nationId: number;
          mutation:
              | { kind: 'notice'; message: string }
              | { kind: 'scoutMessage'; message: string }
              | { kind: 'rate'; amount: number }
              | { kind: 'bill'; amount: number }
              | { kind: 'secretLimit'; amount: number }
              | { kind: 'blockWar'; value: boolean }
              | { kind: 'blockScout'; value: boolean };
      }
    | {
          type: 'setNpcPolicy';
          requestId?: string;
          userId: string;
          generalId: number;
          nationId: number;
          expectedUpdatedAt: string | null;
          mutation:
              | { kind: 'nationPolicy'; values: Record<string, unknown> }
              | { kind: 'nationPriority'; priority: string[] }
              | { kind: 'generalPriority'; priority: string[] };
      }
    | {
          type: 'adjustGeneralResources';
          requestId?: string;
          reason?: string;
          adjustments: Array<{
              generalId: number;
              goldDelta?: number;
              riceDelta?: number;
              minGoldAfter?: number;
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
              specialWar?: string | null;
          };
      }
    | {
          type: 'inheritanceAction';
          requestId?: string;
          userId: string;
          input: TurnDaemonInheritanceAction;
      }
    | {
          type: 'adjustGeneralIcon';
          requestId?: string;
          userId: string;
          picture: string;
          imageServer: number;
          iconRevision: string;
          enforceCooldown?: boolean;
      }
    | {
          type: 'adjustGeneralIdentity';
          requestId?: string;
          userId: string;
          displayName: string;
          identityRevision: string;
      }
    | {
          type: 'joinCreateGeneral';
          requestId?: string;
          userId: string;
          ownerDisplayName: string;
          seedOwnerIdentity: string | number;
          name: string;
          leadership: number;
          strength: number;
          intel: number;
          pic: boolean;
          character: string;
          profileId: string;
          ownerPicture?: string;
          ownerImageServer?: number;
          ownerIconRevision?: string;
          ownerCanUsePicture?: boolean;
          ownerLegacyPenalty?: Record<string, unknown>;
          inheritSpecial?: string;
          inheritTurntimeZone?: number;
          inheritCity?: number;
          inheritBonusStat?: [number, number, number];
      }
    | {
          type: 'npcPossessGeneral';
          requestId?: string;
          userId: string;
          ownerDisplayName: string;
          profileId: string;
          ownerLegacyPenalty?: Record<string, unknown>;
          generalId: number;
          tokenNonce: number;
      }
    | {
          type: 'selectPoolReserve';
          requestId?: string;
          userId: string;
          seedOwnerIdentity: string | number;
      }
    | {
          type: 'selectPoolCreate';
          requestId?: string;
          userId: string;
          ownerDisplayName: string;
          uniqueName: string;
          personality: string;
          seedOwnerIdentity: string | number;
          ownerPicture?: string;
          ownerImageServer?: number;
          ownerIconRevision?: string;
      }
    | {
          type: 'selectPoolReselect';
          requestId?: string;
          userId: string;
          ownerDisplayName: string;
          uniqueName: string;
      }
    | {
          type: 'auctionBid';
          requestId?: string;
          userId: string;
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
          type: 'updateRuntimeSettings';
          ok: true;
          actionId: string;
          settings: RuntimeGameSettingsPatch;
          termChanged: boolean;
          previousTurnTermMinutes: number;
          turnTermMinutes: number;
          previousClockBaseTime: string;
          clockBaseTime: string;
          lastTurnTime: string;
          shiftedGenerals: number;
          reprojectedAuctions: number;
          reprojectedMessages: number;
          reprojectedVotes: number;
          checkpoint?: TurnCheckpoint;
      }
    | {
          type: 'updateRuntimeSettings';
          ok: false;
          actionId: string;
          reason: string;
      }
    | {
          type: 'shiftSchedule';
          ok: true;
          actionId: string;
          deltaMinutes: number;
          lastTurnTime: string;
          shiftedGenerals: number;
          shiftedAuctions: number;
          checkpoint?: TurnCheckpoint;
      }
    | {
          type: 'shiftSchedule';
          ok: false;
          actionId: string;
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
          type: 'auctionOpen';
          ok: true;
          auctionId: number;
          closeAt: string;
          closeTick: number;
      }
    | {
          type: 'auctionOpen';
          ok: false;
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
    | {
          type: 'ensureDieOnPrestartStatus';
          generalId: number;
          show: boolean;
          available: boolean;
          availableAt?: string;
      }
    | { type: 'dieOnPrestart'; ok: boolean; generalId: number; reason?: string }
    | { type: 'buildNationCandidate'; ok: boolean; generalId: number; reason?: string }
    | { type: 'instantRetreat'; ok: boolean; generalId: number; reason?: string }
    | {
          type: 'messageRespond';
          ok: boolean;
          generalId: number;
          messageId: number;
          action?: 'scout' | 'raiseInvader';
          reason: string;
      }
    | {
          type: 'syncDiplomaticResponse';
          ok: boolean;
          generalId: number;
          messageId: number;
          nations: number;
          diplomacy: number;
          cities: number;
          reason?: string;
      }
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
          type: 'setNationSetting';
          ok: true;
          nationId: number;
          updatedAt: string;
          availableCnt?: number;
      }
    | {
          type: 'setNationSetting';
          ok: false;
          code: 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'PRECONDITION_FAILED';
          nationId?: number;
          reason: string;
          currentUpdatedAt?: string | null;
      }
    | {
          type: 'setNpcPolicy';
          ok: true;
          nationId: number;
          updatedAt: string;
      }
    | {
          type: 'setNpcPolicy';
          ok: false;
          code: 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'PRECONDITION_FAILED' | 'CONFLICT';
          reason: string;
          nationId?: number;
          currentUpdatedAt?: string | null;
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
          type: 'inheritanceAction';
          ok: true;
          action: TurnDaemonInheritanceAction['action'];
          generalId: number;
          remainPoint: number;
          nextTurnTimeBase?: number;
          nextTurnTimeLabel?: string;
          stats?: { leadership: number; strength: number; intel: number };
          ownerName?: string;
          targetName?: string;
      }
    | {
          type: 'inheritanceAction';
          ok: false;
          action: TurnDaemonInheritanceAction['action'];
          code: 'BAD_REQUEST' | 'FORBIDDEN' | 'PRECONDITION_FAILED' | 'INTERNAL_SERVER_ERROR';
          reason: string;
      }
    | {
          type: 'adjustGeneralIcon';
          ok: true;
          generalId: number | null;
          updated: boolean;
      }
    | {
          type: 'adjustGeneralIcon';
          ok: false;
          code: 'CONFLICT' | 'PRECONDITION_FAILED' | 'TOO_MANY_REQUESTS';
          reason: string;
          availableAt?: string;
      }
    | {
          type: 'adjustGeneralIdentity';
          ok: true;
          generalId: number | null;
          updated: boolean;
      }
    | {
          type: 'adjustGeneralIdentity';
          ok: false;
          code: 'CONFLICT' | 'PRECONDITION_FAILED';
          reason: string;
      }
    | {
          type: 'joinCreateGeneral';
          ok: true;
          generalId: number;
      }
    | {
          type: 'joinCreateGeneral';
          ok: false;
          code: 'BAD_REQUEST' | 'FORBIDDEN' | 'PRECONDITION_FAILED' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR';
          reason: string;
      }
    | {
          type: 'npcPossessGeneral';
          ok: true;
          generalId: number;
      }
    | {
          type: 'npcPossessGeneral';
          ok: false;
          code: 'BAD_REQUEST' | 'NOT_FOUND' | 'PRECONDITION_FAILED' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR';
          reason: string;
      }
    | {
          type: 'selectPoolReserve';
          ok: true;
          reservation: TurnDaemonSelectPoolReservation;
      }
    | {
          type: 'selectPoolReserve';
          ok: false;
          code: 'BAD_REQUEST' | 'PRECONDITION_FAILED' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR';
          reason: string;
      }
    | {
          type: 'selectPoolCreate';
          ok: true;
          generalId: number;
      }
    | {
          type: 'selectPoolCreate';
          ok: false;
          code: 'BAD_REQUEST' | 'PRECONDITION_FAILED' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR';
          reason: string;
      }
    | {
          type: 'selectPoolReselect';
          ok: true;
          generalId: number;
      }
    | {
          type: 'selectPoolReselect';
          ok: false;
          code: 'BAD_REQUEST' | 'PRECONDITION_FAILED' | 'CONFLICT' | 'INTERNAL_SERVER_ERROR';
          reason: string;
      }
    | {
          type: 'auctionBid';
          ok: true;
          auctionId: number;
          closeAt: string;
          closeTick: number;
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
