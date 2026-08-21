import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveTournamentSectionVisibility, resolveTournamentStageName } from '../src/utils/tournamentStatus.ts';

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

    void it('reveals tournament sections only after their stage begins and retains completed results', () => {
        assert.deepEqual(resolveTournamentSectionVisibility(0), {
            preliminary: false,
            final: false,
            knockout: false,
        });
        assert.deepEqual(resolveTournamentSectionVisibility(1), {
            preliminary: true,
            final: false,
            knockout: false,
        });
        assert.deepEqual(resolveTournamentSectionVisibility(3), {
            preliminary: true,
            final: true,
            knockout: false,
        });
        assert.deepEqual(resolveTournamentSectionVisibility(5), {
            preliminary: true,
            final: true,
            knockout: true,
        });
        assert.deepEqual(resolveTournamentSectionVisibility(0, 7), {
            preliminary: true,
            final: true,
            knockout: true,
        });
    });
});
