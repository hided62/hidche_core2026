import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAutorunUserDetail } from '../src/utils/autorunUser.ts';

void test('uses the Ref and Gateway autorun option order and lets recruit_high replace recruit', () => {
    assert.equal(
        formatAutorunUserDetail({
            limitMinutes: 1_440,
            options: ['chief', 'recruit', 'battle', 'train', 'recruit_high', 'warp', 'develop'],
        }),
        '내정, 순간이동, 모병, 훈련/사기진작, 출병, 사령턴, 24시간 유효'
    );
});

void test('formats minute and always-valid autorun limits like Ref', () => {
    assert.equal(formatAutorunUserDetail({ limitMinutes: 90, options: ['recruit'] }), '징병, 90분 유효');
    assert.equal(formatAutorunUserDetail({ limitMinutes: 43_200, options: ['develop'] }), '내정, 항상 유효');
});
