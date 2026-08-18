import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
    listBattleResultSeasons,
    readBattleResultSeason,
    resolveBattleResultSourceConfig,
} from '../src/battleResultSource.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
    );
});

const fixture = async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'sammo-battle-results-'));
    temporaryDirectories.push(root);
    const season = path.join(root, 'che_190815_w0sU');
    await mkdir(season);
    await writeFile(path.join(season, 'batres17.txt'), '<S>◆</>190년 1월:첫 전투\n<S>◆</>190년 2월:둘째 전투\n');
    await writeFile(path.join(season, 'batlog17.txt'), '페이즈 상세는 제외\n');
    await mkdir(path.join(root, 'not-a-season'));
    return { root, season };
};

describe('preserved battle-result source', () => {
    it('maps only batres files by profile/server/general and preserves source text', async () => {
        const { root } = await fixture();
        const source = await resolveBattleResultSourceConfig({ directory: root }, 'fixture:che', 'che', process.cwd());
        const seasons = await listBattleResultSeasons(source, 'che');

        expect(seasons).toHaveLength(1);
        expect(seasons[0]).toMatchObject({ serverId: 'che_190815_w0sU', fileCount: 1 });
        expect(seasons[0]?.files[0]).toMatchObject({ generalNo: 17 });

        const loaded = await readBattleResultSeason(source, 'che', 'che_190815_w0sU');
        expect(loaded.manifest.manifestHash).toBe(seasons[0]?.manifestHash);
        expect(loaded.files).toHaveLength(1);
        expect(loaded.files[0]).toMatchObject({ generalNo: 17, lineCount: 2 });
        expect(loaded.files[0]?.content).toContain('둘째 전투');
    });

    it('builds a password-free source identity for the configured SSH location', async () => {
        const source = await resolveBattleResultSourceConfig(
            { directory: '/srv/sammo/che/logs/preserved', sshHost: 'serv' },
            'cutover:che',
            'che',
            process.cwd()
        );

        expect(source).toMatchObject({ kind: 'ssh', sshHost: 'serv' });
        expect(source.identity.key).toBe('cutover:che:battle-results');
        expect(source.identity.fingerprint).toMatch(/^[a-f0-9]{64}$/u);
    });

    it('rejects invalid UTF-8 during preflight instead of failing after target writes begin', async () => {
        const { root, season } = await fixture();
        await writeFile(path.join(season, 'batres18.txt'), Buffer.from([0xff]));
        const source = await resolveBattleResultSourceConfig({ directory: root }, 'fixture:che', 'che', process.cwd());

        await expect(listBattleResultSeasons(source, 'che')).rejects.toThrow();
    });
});
