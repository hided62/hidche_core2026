import type { MonthlyEventActionHandler } from './monthlyEventHandler.js';

// 레거시 CreateAdminNPC::run()은 [class, "NYI"]만 반환하고 어떤 상태도
// 변경하지 않는다. 새 관리자 NPC를 임의로 만들지 않고 no-op 계약을 보존한다.
export const createCreateAdminNpcHandler = (): MonthlyEventActionHandler => () => undefined;
