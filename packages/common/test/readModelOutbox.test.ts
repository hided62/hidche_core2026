import { describe, expect, it } from 'vitest';

import {
    hasRealtimeReadModelChanges,
    parseReadModelOutboxPayload,
    readModelOutboxPayloadToChanges,
    resolveRealtimeReadModelInvalidation,
} from '../src/index.js';

describe('read-model outbox payload', () => {
    it('validates the version, domain, entity ID, and bigint revision', () => {
        expect(
            parseReadModelOutboxPayload({
                version: 1,
                changes: [
                    ['general.content', 7, '12'],
                    ['map.world', 0, '3'],
                ],
            })
        ).toEqual({
            version: 1,
            changes: [
                ['general.content', 7, '12'],
                ['map.world', 0, '3'],
            ],
        });
        expect(parseReadModelOutboxPayload({ version: 2, changes: [] })).toBeNull();
        expect(parseReadModelOutboxPayload({ version: 1, changes: [['unknown', 0, '1']] })).toBeNull();
        expect(parseReadModelOutboxPayload({ version: 1, changes: [['map.world', -1, '1']] })).toBeNull();
        expect(parseReadModelOutboxPayload({ version: 1, changes: [['map.world', 0, '-1']] })).toBeNull();
    });

    it('reconstructs an idempotent internal invalidation without broadening map-only changes', () => {
        const payload = parseReadModelOutboxPayload({
            version: 1,
            changes: [
                ['general.content', 7, '2'],
                ['map.general', 7, '2'],
                ['map.world', 0, '9'],
                ['front.general', 7, '3'],
                ['front.nation', 4, '5'],
                ['records.general', 7, '8'],
                ['reserved.general', 7, '4'],
                ['lobby.general', 7, '2'],
                ['contacts.world', 0, '6'],
            ],
        });
        if (!payload) throw new Error('valid payload rejected');

        const changes = readModelOutboxPayloadToChanges(payload);
        expect(changes).toMatchObject({
            generalIds: [7],
            mapGeneralIds: [7],
            mapChanged: true,
            frontStatusActorIds: [7],
            frontStatusNationIds: [4],
            recordGeneralIds: [7],
            reservedGeneralIds: [7],
            lobbyGeneralIds: [7],
            contactsChanged: true,
            worldChanged: false,
        });
        expect(hasRealtimeReadModelChanges(changes)).toBe(true);
        expect(resolveRealtimeReadModelInvalidation(changes, { generalId: 99, cityId: 2, nationId: 9 })).toMatchObject(
            {
                map: true,
                context: false,
                commands: false,
                lobby: false,
            }
        );
    });

    it('keeps access-only, tournament, and betting domains off the dashboard channel', () => {
        const payload = parseReadModelOutboxPayload({
            version: 1,
            changes: [
                ['access.general', 7, '1'],
                ['tournament', 0, '1'],
                ['betting', 0, '1'],
            ],
        });
        if (!payload) throw new Error('valid payload rejected');
        expect(hasRealtimeReadModelChanges(readModelOutboxPayloadToChanges(payload))).toBe(false);
    });
});
