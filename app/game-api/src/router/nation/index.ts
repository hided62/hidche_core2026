import { router } from '../../trpc.js';
import { appoint } from './endpoints/appoint.js';
import { changePermission } from './endpoints/changePermission.js';
import { getBattleCenter } from './endpoints/getBattleCenter.js';
import { getChiefCenter } from './endpoints/getChiefCenter.js';
import { getCityOverview } from './endpoints/getCityOverview.js';
import { getGeneralList } from './endpoints/getGeneralList.js';
import { getGeneralLog } from './endpoints/getGeneralLog.js';
import { getNationInfo } from './endpoints/getNationInfo.js';
import { getPersonnelInfo } from './endpoints/getPersonnelInfo.js';
import { getStratFinan } from './endpoints/getStratFinan.js';
import { kick } from './endpoints/kick.js';
import { setBill } from './endpoints/setBill.js';
import { setBlockScout } from './endpoints/setBlockScout.js';
import { setBlockWar } from './endpoints/setBlockWar.js';
import { setNotice } from './endpoints/setNotice.js';
import { setRate } from './endpoints/setRate.js';
import { setScoutMsg } from './endpoints/setScoutMsg.js';
import { setSecretLimit } from './endpoints/setSecretLimit.js';

export const nationRouter = router({
    getNationInfo,
    getGeneralList,
    getCityOverview,
    getPersonnelInfo,
    getStratFinan,
    setNotice,
    setScoutMsg,
    setRate,
    setBill,
    setSecretLimit,
    setBlockWar,
    setBlockScout,
    getBattleCenter,
    getGeneralLog,
    getChiefCenter,
    changePermission,
    kick,
    appoint,
});
