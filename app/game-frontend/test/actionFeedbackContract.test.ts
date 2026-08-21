import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const migratedViewNames = [
    'AuctionView.vue',
    'BettingView.vue',
    'InheritView.vue',
    'NationBettingView.vue',
    'NationStratFinanView.vue',
    'NpcControlView.vue',
    'SurveyView.vue',
    'TournamentView.vue',
    'TroopView.vue',
] as const;

void describe('transient action feedback contract', () => {
    for (const viewName of migratedViewNames) {
        void it(`${viewName} sends action feedback through the shared toast layer`, async () => {
            const source = await readFile(path.resolve(import.meta.dirname, `../src/views/${viewName}`), 'utf8');
            const template = source.slice(source.indexOf('<template>'));

            assert.match(source, /useGameFeedback/);
            assert.doesNotMatch(template, /role="status"/);
            assert.doesNotMatch(template, /class="[^"]*(?:success|status)[^"]*"[^>]*>\s*\{\{/);
        });
    }
});
