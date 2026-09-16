import { createHash } from 'node:crypto';
import type { GamePrisma, InputJsonValue } from '@sammo-ts/infra';
import type { AuditCitySnapshot, AuditGeneralSnapshot, AuditNationSnapshot } from './snapshot.js';

export interface PendingAuditMonth {
    serverId: string;
    year: number;
    month: number;
    kind: 'MONTH_END' | 'FINAL' | 'INITIAL';
    tick: number | null;
    settlementsComplete: boolean;
    nations: AuditNationSnapshot[];
    cities: AuditCitySnapshot[];
    generals: AuditGeneralSnapshot[];
}

// JSON parameter 한 번에 전체 기수나 world를 전송하지 않는다.
const BATCH_SIZE = 200;
const asJson = (value: AuditNationSnapshot | AuditCitySnapshot | AuditGeneralSnapshot): InputJsonValue =>
    JSON.parse(JSON.stringify(value)) as InputJsonValue;

export const persistAuditMonth = async (
    tx: GamePrisma.TransactionClient,
    snapshot: PendingAuditMonth
): Promise<void> => {
    if (
        !snapshot.serverId.trim() ||
        !Number.isInteger(snapshot.year) ||
        !Number.isInteger(snapshot.month) ||
        snapshot.month < 1 ||
        snapshot.month > 12
    ) {
        throw new Error('Invalid play audit month identity');
    }
    const id = JSON.stringify([snapshot.serverId, snapshot.year, snapshot.month, snapshot.kind]);
    const hash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    const saved = await tx.playAuditMonth.upsert({
        where: { id },
        create: {
            id,
            serverId: snapshot.serverId,
            year: snapshot.year,
            month: snapshot.month,
            kind: snapshot.kind,
            tick: snapshot.tick,
            settlementsComplete: snapshot.settlementsComplete,
            hash,
        },
        update: {},
        select: { hash: true },
    });
    if (saved.hash !== hash) throw new Error('Play audit month replay payload conflict');
    for (let offset = 0; offset < snapshot.nations.length; offset += BATCH_SIZE) {
        await tx.playAuditNation.createMany({
            skipDuplicates: true,
            data: snapshot.nations
                .slice(offset, offset + BATCH_SIZE)
                .map((nation) => ({ sampleId: id, nationId: nation.id, data: asJson(nation) })),
        });
    }
    for (let offset = 0; offset < snapshot.cities.length; offset += BATCH_SIZE) {
        await tx.playAuditCity.createMany({
            skipDuplicates: true,
            data: snapshot.cities
                .slice(offset, offset + BATCH_SIZE)
                .map((city) => ({ sampleId: id, cityId: city.id, nationId: city.nationId, data: asJson(city) })),
        });
    }
    for (let offset = 0; offset < snapshot.generals.length; offset += BATCH_SIZE) {
        await tx.playAuditGeneral.createMany({
            skipDuplicates: true,
            data: snapshot.generals.slice(offset, offset + BATCH_SIZE).map((general) => ({
                sampleId: id,
                generalId: general.id,
                nationId: general.nationId,
                cityId: general.cityId,
                npcState: general.npcState,
                data: asJson(general),
            })),
        });
    }
};
