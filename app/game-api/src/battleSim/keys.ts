export interface BattleSimQueueKeys {
    queueKey: string;
    resultKeyPrefix: string;
    notifyKeyPrefix: string;
}

export const buildBattleSimQueueKeys = (profileName: string): BattleSimQueueKeys => ({
    queueKey: `sammo:${profileName}:battle-sim:queue`,
    resultKeyPrefix: `sammo:${profileName}:battle-sim:result:`,
    notifyKeyPrefix: `sammo:${profileName}:battle-sim:notify:`,
});
