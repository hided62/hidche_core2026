import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, it } from 'node:test';

const source = (relativePath: string) => readFile(path.resolve(import.meta.dirname, '../src', relativePath), 'utf8');

void describe('shared Lumen button family', () => {
    void it('keeps fixed-height state compensation in the shared control layer', async () => {
        const css = await source('assets/styles/legacy-controls.css');

        assert.match(css, /\.legacy-button\.legacy-button--fixed-height\s*\{/u);
        assert.match(css, /height:\s*calc\(var\(--legacy-button-height\) - 1px\)/u);
        assert.match(css, /height:\s*calc\(var\(--legacy-button-height\) - 2px\)/u);
    });

    void it('connects every reported control to a semantic Lumen variant', async () => {
        const [nationGenerals, tournamentHeader, reservedEditor] = await Promise.all([
            source('views/NationGeneralsView.vue'),
            source('components/tournament/TournamentPageHeader.vue'),
            source('components/command/ReservedCommandEditor.vue'),
        ]);

        assert.match(
            nationGenerals,
            /legacy-button legacy-button--navigation legacy-button--fixed-height top-button nation-button/u
        );
        assert.match(
            nationGenerals,
            /legacy-button legacy-button--primary legacy-button--fixed-height top-button mode-button/u
        );
        assert.match(
            nationGenerals,
            /legacy-button legacy-button--info legacy-button--fixed-height top-button columns-button/u
        );
        for (const label of ['돌아가기', '갱신', '보기 모드⌄', '열 선택⌄']) {
            assert.match(nationGenerals, new RegExp(label, 'u'));
        }
        for (const label of ['토너먼트', '베팅장', '창 닫기']) {
            assert.match(tournamentHeader, new RegExp(`legacy-button[\\s\\S]{0,260}${label}`, 'u'));
        }
        assert.match(tournamentHeader, /const closeWindow = \(\): void => window\.close\(\)/u);
        assert.doesNotMatch(tournamentHeader, /custom to="\/"/u);
        assert.match(reservedEditor, /legacy-button legacy-button--info legacy-button--fixed-height select-command/u);
        assert.match(reservedEditor, /명령 선택 ▾/u);
    });

    void it('uses the same family for audited Ref TopBackBar navigation controls', async () => {
        const files = [
            'views/AuctionView.vue',
            'views/BattleCenterView.vue',
            'views/BoardView.vue',
            'views/ChiefCenterView.vue',
            'views/GlobalInfoView.vue',
            'views/InheritView.vue',
            'views/NationBettingView.vue',
            'views/NationStratFinanView.vue',
            'views/NpcControlView.vue',
            'views/SurveyView.vue',
            'views/TroopView.vue',
            'views/YearbookView.vue',
        ];
        const contents = await Promise.all(files.map(source));

        for (const [index, content] of contents.entries()) {
            assert.match(
                content,
                /legacy-button legacy-button--navigation/u,
                `${files[index]} must opt its raised navigation control into the shared family`
            );
        }
    });

    void it('connects the information and office page actions to semantic Lumen variants', async () => {
        const files = {
            nationCities: await source('views/NationCitiesView.vue'),
            nationInfo: await source('views/NationInfoView.vue'),
            currentCity: await source('views/CurrentCityView.vue'),
            myPage: await source('views/MyPageView.vue'),
            personnel: await source('views/NationPersonnelView.vue'),
            diplomacy: await source('views/DiplomacyView.vue'),
        };

        assert.match(files.nationCities, /legacy-button legacy-button--navigation back-button/u);
        assert.match(files.nationCities, /legacy-button legacy-button--primary integration-button/u);
        assert.match(files.nationCities, /legacy-button legacy-button--secondary extra-sort-button/u);
        assert.match(files.nationCities, /legacy-button legacy-button--primary appointment-button/u);
        assert.match(files.nationInfo, /legacy-button legacy-button--navigation/u);
        assert.match(files.currentCity, /legacy-button legacy-button--navigation back-link/u);
        assert.match(files.myPage, /legacy-button legacy-button--navigation/u);
        assert.match(files.myPage, /legacy-button legacy-button--lumen legacy-button--fixed-height action-button/u);
        assert.match(files.myPage, /legacy-button legacy-button--secondary item-button/u);
        assert.match(
            files.personnel,
            /legacy-button legacy-button--lumen legacy-button--fixed-height personnel-change-button/u
        );
        assert.match(files.personnel, /legacy-button legacy-button--danger/u);
        assert.match(files.diplomacy, /legacy-button legacy-button--primary[^>]*[\s\S]{0,80}전송/u);
    });
});
