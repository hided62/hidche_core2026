export type TriggerActionType = '장비매매';

export type TriggerActionPhase = '판매' | '구매';

export type TriggerDomesticActionType =
    | '상업'
    | '농업'
    | '성벽'
    | '수비'
    | '치안'
    | '인재탐색'
    | '징병'
    | '징집인구'
    | '계략'
    | '민심'
    | '인구'
    | '기술'
    | '모병'
    | '단련'
    | '조달';

export type TriggerDomesticVarType = 'cost' | 'score' | 'success' | 'fail' | 'train' | 'atmos' | 'rice' | 'probability';

export type TriggerStrategicActionType = '의병모집' | '허보' | '필사즉생' | '백성동원' | '이호경식' | '수몰' | '급습';

export type TriggerStrategicVarType = 'delay' | 'globalDelay';

export type TriggerNationalIncomeType = 'gold' | 'rice' | 'pop';

export type GeneralStatName =
    | 'leadership'
    | 'strength'
    | 'intelligence'
    | 'experience'
    | 'dedication'
    | 'sabotageDefence'
    | 'sabotageAttack';

export type WarStatName =
    | GeneralStatName
    | 'cityBattleOrder'
    | 'initWarPhase'
    | 'bonusTrain'
    | 'bonusAtmos'
    | 'warCriticalRatio'
    | 'warAvoidRatio'
    | 'killRice'
    | 'criticalDamageRange'
    | 'warMagicSuccessDamage'
    | 'warMagicTrialProb'
    | 'warMagicSuccessProb'
    | `dex${number}`;
