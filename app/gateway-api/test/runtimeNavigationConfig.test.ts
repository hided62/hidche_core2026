import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { RuntimeNavigationConfigStore } from '../src/navigation/runtimeNavigationConfig.js';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sammo-navigation-'));
    temporaryDirectories.push(directory);
    return directory;
};

afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })));
});

describe('RuntimeNavigationConfigStore', () => {
    it('운영 override가 없으면 저장소 기본 메뉴를 읽는다', async () => {
        const store = new RuntimeNavigationConfigStore(
            '/definitely-missing/navigation.json',
            path.resolve(import.meta.dirname, '../../../resources/navigation.json')
        );

        const config = await store.get();

        expect(config.gateway.items.map((item) => item.label)).toEqual([
            '공지사항',
            '커뮤니티',
            '건의/제안/개발',
            '신고/문의',
            '자주 묻는 질문',
            '패치 내역',
            'Git Repo.',
            '위키',
            '공식 오픈 톡',
            '잡담 오픈 톡',
        ]);
        expect(config.game.items.map((item) => (item.kind === 'split' ? item.main.label : item.label))).toEqual([
            '천통국 베팅',
            '세력일람',
            '장수일람',
            '명장일람',
            '연감',
            '게임 정보',
            '커뮤니티',
            '설문조사',
        ]);
    });

    it('프로세스를 재시작하지 않아도 운영 JSON 수정이 다음 조회에 반영된다', async () => {
        const directory = await createTemporaryDirectory();
        const overridePath = path.join(directory, 'navigation.json');
        const defaultPath = path.resolve(import.meta.dirname, '../../../resources/navigation.json');
        const raw = JSON.parse(await fs.readFile(defaultPath, 'utf8')) as {
            gateway: { items: Array<{ label: string }> };
        };
        await fs.writeFile(overridePath, JSON.stringify(raw));
        const store = new RuntimeNavigationConfigStore(overridePath, defaultPath);

        expect((await store.get()).gateway.items[0]?.label).toBe('공지사항');
        raw.gateway.items[0]!.label = '운영 공지';
        await fs.writeFile(overridePath, JSON.stringify(raw));
        expect((await store.get()).gateway.items[0]?.label).toBe('운영 공지');
    });

    it('실행 가능한 스크립트 URL과 목적지가 없는 링크를 거부한다', async () => {
        const directory = await createTemporaryDirectory();
        const overridePath = path.join(directory, 'navigation.json');
        const invalid = {
            version: 1,
            gateway: {
                brand: { label: '삼국지 모의전투 HiDCHe', to: '/' },
                items: [{ id: 'unsafe', label: '위험', href: 'javascript:alert(1)' }],
            },
            game: { items: [{ kind: 'link', id: 'empty', label: '빈 링크' }] },
        };
        await fs.writeFile(overridePath, JSON.stringify(invalid));
        const store = new RuntimeNavigationConfigStore(overridePath, overridePath);

        await expect(store.get()).rejects.toThrow('메뉴 설정 파일이 올바르지 않습니다');
    });
});
