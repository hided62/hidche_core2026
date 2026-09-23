import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
    dexConversionPreview,
    dexGradeName,
    equipmentOptionText,
    nationTypeRows,
} from '../src/components/command/commandPersonalDetails.ts';

void test('equipment options mark unavailable purchases and sales like Ref (불가)', () => {
    assert.equal(equipmentOptionText({ value: 'che_명마_적토', label: '적토마', availableNow: false }), '적토마 (불가)');
    assert.equal(equipmentOptionText({ value: 'che_명마_노기', label: '노기', availableNow: true }), '노기');
    assert.equal(equipmentOptionText({ value: 'None', label: '명마 판매' }), '명마 판매');
});

void test('dex conversion preview uses the executed integer cut and Ref grade names', () => {
    const armTypes = [
        { value: 1, label: '보병' },
        { value: 2, label: '궁병' },
    ];
    const rows = dexConversionPreview(1, 2, armTypes, { '1': 1001, '2': 3000 });
    // cut = trunc(1001 × 0.4) = 400, add = trunc(400 × 0.9) = 360.
    assert.deepEqual(
        rows?.map((row) => [row.armName, row.before.amount, row.before.name, row.after.amount, row.after.name]),
        [
            ['보병', 1001, 'F', 601, 'F'],
            ['궁병', 3000, 'F+', 3360, 'F+'],
        ]
    );
    assert.equal(rows?.[1]?.after.color, 'navy');
    assert.equal(dexConversionPreview(1, 1, armTypes, { '1': 1001 }), null);
    assert.equal(dexConversionPreview(1, 2, armTypes, undefined), null);
    assert.equal(dexGradeName(3500), 'E-');
    assert.equal(dexGradeName(undefined), undefined);
});

void test('nation type rows split Core trait info back into Ref pros and cons', () => {
    assert.deepEqual(
        nationTypeRows([
            { value: 'che_도적', label: '도적', description: '계략↑ 금수입↓ 치안↓ 민심↓' },
            { value: 'che_덕가', label: '덕가', description: '치안↑ 인구↑ 민심↑ 쌀수입↓ 수성↓' },
        ]),
        [
            { value: 'che_도적', name: '도적', pros: '계략↑', cons: '금수입↓ 치안↓ 민심↓' },
            { value: 'che_덕가', name: '덕가', pros: '치안↑ 인구↑ 민심↑', cons: '쌀수입↓ 수성↓' },
        ]
    );
});
