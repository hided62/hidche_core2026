import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveTournamentStageName } from '../src/utils/tournamentStatus.ts';

void describe('tournament status labels', () => {
    void it('describes inactive and active tournament stages', () => {
        assert.equal(resolveTournamentStageName(0), '경기 없음');
        assert.equal(resolveTournamentStageName(1), '참가 모집중');
        assert.equal(resolveTournamentStageName(6), '베팅 진행중');
        assert.equal(resolveTournamentStageName(10), '결승 진행중');
    });

    void it('uses a safe fallback for an unknown stage', () => {
        assert.equal(resolveTournamentStageName(11), '상태 확인 중');
        assert.equal(resolveTournamentStageName(-1), '상태 확인 중');
    });
});
