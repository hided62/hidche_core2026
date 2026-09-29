import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { fixture } from './load-fixtures.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(root, 'app/game-frontend/package.json'));
const { chromium } = require('@playwright/test');
const out = process.env.TYPOGRAPHY_OUTPUT_DIR ?? path.join(root, 'test-results/typography-audit');
const phase = process.env.PHASE ?? 'capture';
const origin = process.env.CAPTURE_ORIGIN ?? 'http://127.0.0.1:15329';
const prefix = '/' + (process.env.PLAYWRIGHT_GAME_BASE_PATH ?? 'che').replace(/^\/+|\/+$/g, '');
const profile = process.env.PLAYWRIGHT_GAME_PROFILE ?? 'che:default';
const fontRoot = process.env.TYPOGRAPHY_FONT_ROOT;
process.env.FRONTEND_PARITY_IMAGE_ROOT = path.resolve(
    process.env.FRONTEND_PARITY_IMAGE_ROOT ?? path.join(root, '../image')
);
process.env.LEGACY_IMAGE_ROOT = path.resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT ?? path.join(root, '../image'));
const modules = {};
async function m(name) {
    return (modules[name] ??= await fixture(name.includes('/') ? name : `app/game-frontend/e2e/${name}.spec.ts`));
}
const stateMain = () => ({
    officerLevel: 12,
    permission: 4,
    nationLevel: 3,
    stage: 5,
    npcMode: 1,
    generalMeCalls: 0,
    operations: [],
    validMapImages: true,
});
const stateMenus = () => ({ permission: 'head', myset: 0, settingMutations: [], accessPages: [], richMyInfo: true });
const setup = {
    audit: async (p) => (await m('playAudit')).install(p),
    login: async (p) => {
        await p.route('**/gateway/', (r) => r.fulfill({ status: 204 }));
    },
    selection: async (p) => {
        await p.addInitScript(() => {
            localStorage.setItem('sammo-game-token', 'ga_selection_fixture');
            localStorage.setItem('sammo-game-profile', 'che:default');
        });
        await p.route('**/che/api/trpc/**', async (r) => {
            const ops = decodeURIComponent(new URL(r.request().url()).pathname.split('/trpc/')[1]).split(',');
            const rows = ops.map((op) => ({
                result: {
                    data:
                        {
                            'auth.status': { ok: true },
                            'lobby.info': { myGeneral: null },
                            'join.getConfig': {
                                nations: [{ id: 1, name: '촉', color: '#008000', scoutMessage: '임관 안내' }],
                                selectionPool: { enabled: true, hasGeneral: false, allowOptions: [] },
                                personalities: [],
                                user: { icons: [] },
                                iconChoices: [],
                            },
                            'join.getSelectionPool': {
                                reservationId: 'fixture',
                                hasGeneral: false,
                                validUntil: '2030-01-01T00:00:00Z',
                                candidates: [0, 1, 2].map((i) => ({
                                    uniqueName: 'candidate' + i,
                                    generalName: '장수이름',
                                    leadership: 90,
                                    strength: 80,
                                    intel: 70,
                                    dex: [1000, 2000, 3000, 4000, 5000],
                                    picture: 'default.jpg',
                                    imageServer: 0,
                                    specialDomesticName: '인덕',
                                    specialDomesticInfo: '내정 특기',
                                    specialWarName: '귀모',
                                    specialWarInfo: '전투 특기',
                                })),
                            },
                        }[op] ?? {},
                },
            }));
            await r.fulfill({ contentType: 'application/json', body: JSON.stringify(rows) });
        });
    },
    public: async (p) => {
        const x = await m('tools/frontend-legacy-parity/fixtures/canonical.ts');
        const f = x.canonicalFrontendFixture.game;
        await p.route('**/che/api/trpc/**', async (r) => {
            const ops = decodeURIComponent(new URL(r.request().url()).pathname.split('/trpc/')[1]).split(',');
            const data = ops.map((op) => ({
                result: {
                    data:
                        {
                            'auth.status': { ok: true },
                            'lobby.info': { myGeneral: null },
                            'public.getMapLayout': f.mapLayout,
                            'public.getCachedMap': {
                                ...f.map,
                                nationList: f.map.nationList.map((row, i) => [
                                    row[0],
                                    row[1],
                                    i ? '#800000' : '#008000',
                                    row[3],
                                ]),
                            },
                            'public.getWorldTrend': { year: 217, month: 7, turnTerm: 10, records: [], history: [] },
                            'public.getNationList': [
                                { id: 1, name: '촉', color: '#008000', generalCount: 100, cityCount: 8 },
                            ],
                            'public.getGeneralList': [
                                {
                                    id: 1,
                                    name: '유비',
                                    npcState: 0,
                                    nationName: '촉',
                                    nationId: 1,
                                    officerLevel: 12,
                                    picture: 'default.jpg',
                                    cityName: '낙양',
                                },
                            ],
                        }[op] ?? {},
                },
            }));
            await r.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
        });
    },
    messages: async (p) => {
        const x = await m('mainNavigation');
        await x.installRealtimeHarness(p);
        const state = stateMain();
        state.messages = {
            ...x.emptyMessages(4),
            public: [
                {
                    id: 801,
                    text: '최대 길이 장수명과 국가명을 확인합니다.',
                    time: '2026-09-15 12:00:00',
                    msgType: 'public',
                    src: {
                        generalId: 7,
                        generalName: '작성장수',
                        nationId: 1,
                        nationName: '위',
                        color: '#008000',
                        icon: '/image/icons/default.jpg',
                    },
                    dest: null,
                    option: {},
                },
            ],
            private: [
                {
                    id: 802,
                    text: '메시지 본문과 삭제 동작의 간격을 확인합니다.',
                    time: '2026-09-15 12:00:00',
                    msgType: 'private',
                    src: {
                        generalId: 7,
                        generalName: '작성장수',
                        nationId: 1,
                        nationName: '위',
                        color: '#008000',
                        icon: '/image/icons/default.jpg',
                    },
                    dest: { generalId: 8, generalName: '수신장수', nationId: 2, nationName: '촉', color: '#800000' },
                    option: {},
                },
            ],
        };
        await x.installFixture(p, state);
    },
    main: async (p) => {
        const x = await m('mainNavigation');
        await x.installRealtimeHarness(p);
        await x.installFixture(p, stateMain());
    },
    commands: async (p) => (await m('commandArguments')).install(p),
    menus: async (p) => (await m('inGameMenus')).install(p, stateMenus()),
    info: async (p) => (await m('inGameInfo')).install(p),
    directories: async (p) => (await m('directoryLists')).install(p),
    officers: async (p) => (await m('nationOffices')).installFixture(p, { role: 'leader', rate: 20 }),
    tournament: async (p) => (await m('tournamentBracket')).installFixture(p),
    nationBetting: async (p) => (await m('nationBetting')).installFixture(p),
    archives: async (p) => (await m('legacyArchiveViews')).installArchiveViews(p),
    secret: async (p) => (await m('nationGeneralSecret')).install(p, true, false, 4),
    troop: async (p) => {
        const x = await m('troop');
        await x.installApiFixture(p, { me: { id: 1, troopId: 1 }, permission: 4, troops: x.baseTroops() });
    },
    board: async (p) => {
        const x = await m('board');
        await x.installApi(p, {
            permission: 4,
            canMeeting: true,
            canSecret: true,
            articles: x.initialArticles(),
            requests: [],
        });
    },
    auction: async (p) => (await m('auction')).installFixture(p, { resourceBidCount: 0, uniqueBidCount: 0 }),
    diplomacy: async (p) => (await m('diplomacy')).installFixture(p, 4),
    past: async (p) => (await m('pastPlays')).installArchive(p),
    npc: async (p) => (await m('npcPolicy')).installFixture(p, { permissionLevel: 4, mutations: [] }),
    possession: async (p) =>
        (await m('npcPossession')).installFixture(p, {
            reservationCalls: 0,
            reservationInputs: [],
            rawBodies: [],
            possessInputs: [],
            hasGeneral: false,
            injectTimeout: false,
        }),
    join: async (p) => (await m('joinLayout')).installFixture(p, { mapRequests: 0, generalRequests: 0 }),
    simulator: async (p) =>
        (await m('battleSimulator')).installApi(p, {
            hasGeneral: true,
            requests: [],
            preparedPayloads: [],
            serverResults: [],
        }),
    ranking: async (p) =>
        (await m('tools/frontend-legacy-parity/visual-parity.spec.ts')).installAuthenticatedGameFixture(p),
    inherit: async (p) => (await m('tools/frontend-legacy-parity/inheritance-management.spec.ts')).installFixture(p),
};
const scenes = [
    ['audit', 'audit', 'play-audit', '#play-audit-container'],
    [
        'audit-nation',
        'audit',
        'play-audit?tab=nations&nation=2&fromYear=190&fromMonth=1&year=190&month=6',
        '#play-audit-container',
    ],
    ['audit-generals', 'audit', 'play-audit?tab=generals&at=month&year=190&month=6', '#play-audit-container'],
    ['audit-cities', 'audit', 'play-audit?tab=cities&year=190&month=6', '#play-audit-container'],
    [
        'audit-diplomacy',
        'audit',
        'play-audit?tab=diplomacy&nation=2&otherNation=3&year=190&month=6',
        '#play-audit-container',
    ],
    ['audit-policy', 'audit', 'play-audit?tab=policies&nation=2&year=190&month=6', '#play-audit-container'],
    ['board-secret', 'board', 'board/secret', 'main'],
    ['affairs-redirect', 'officers', 'nation/affairs', 'main'],
    ['recruit-redirect', 'officers', 'nation/recruit-message', 'main'],
    ['login', 'login', 'login', '.login-redirect'],
    ['messages', 'messages', '', '.msg-plate'],
    ['recruitment', 'commands', '', '.main-page'],
    ['personnel-picker', 'officers', 'nation/personnel', 'main'],
    ['unique-auction', 'auction', 'auction?type=unique', 'main'],
    ['main', 'main', '', '.main-page'],
    ['selection', 'selection', 'select-general', 'main'],
    ['notfound', 'public', 'typography-not-found', 'h1'],
    ['public', 'public', 'public', '.public-page'],
    ['my-page', 'menus', 'my-page', '.legacy-page'],
    ['settings', 'menus', 'my-settings', 'main'],
    ['traffic', 'menus', 'traffic', 'main'],
    ['battle-center', 'menus', 'battle-center', '.battle-page'],
    ['chief', 'commands', 'chief-center', '.chief-page'],
    ['nation-info', 'info', 'nation/info', 'main'],
    ['global', 'info', 'global-info', 'main'],
    ['current-city', 'info', 'current-city', 'main'],
    ['nation-cities', 'info', 'nation/cities', 'main'],
    ['nation-list', 'directories', 'nation-list', 'main'],
    ['general-list', 'directories', 'general-list', 'main'],
    ['npc-list', 'directories', 'npc-list', 'main'],
    ['personnel', 'officers', 'nation/personnel', 'main'],
    ['finance', 'officers', 'nation/finance', 'main'],
    ['tournament', 'tournament', 'tournament', 'main'],
    ['betting', 'tournament', 'betting', 'main'],
    ['nation-betting', 'nationBetting', 'nation-betting', 'main'],
    ['hall', 'archives', 'hall-of-fame', 'main'],
    ['dynasty', 'archives', 'dynasty', 'main'],
    ['dynasty-detail', 'archives', 'dynasty/1', 'main'],
    ['yearbook', 'archives', 'yearbook', 'main'],
    ['nation-generals', 'secret', 'nation/generals', 'main'],
    ['secret', 'secret', 'nation/secret', 'main'],
    ['troop', 'troop', 'troop', 'main'],
    ['board', 'board', 'board', 'main'],
    ['auction', 'auction', 'auction', 'main'],
    ['diplomacy', 'diplomacy', 'diplomacy', '.diplomacy-view'],
    ['past', 'past', 'past-plays', 'main'],
    ['npc-policy', 'npc', 'npc-control', 'main'],
    ['possession', 'possession', 'join', 'main'],
    ['join', 'join', 'join', 'main'],
    ['simulator', 'simulator', 'battle-simulator', 'main'],
    ['best', 'ranking', 'best-general', 'main'],
    ['survey', 'ranking', 'survey', 'main'],
    ['inherit', 'inherit', 'inherit', 'main'],
];
// Keep the inventory tied to the active router, including redirects and fallback.
const routerSource = await fs.readFile(path.join(root, 'app/game-frontend/src/router/index.ts'), 'utf8');
const routePaths = [...routerSource.matchAll(/\bpath: '([^']+)'/g)].map((match) => match[1]);
const normalizeRoute = (route) => {
    const pathname = '/' + route.split('?')[0];
    if (pathname === '/typography-not-found') return '/:pathMatch(.*)*';
    return pathname.replace(/^\/dynasty\/[^/]+$/, '/dynasty/:id');
};
const sceneRoutes = new Set(scenes.map((scene) => normalizeRoute(scene[2])));
const missingRoutes = routePaths.filter((route) => !sceneRoutes.has(route));
if (missingRoutes.length) throw new Error('Routes without typography scenes: ' + missingRoutes.join(', '));
await fs.mkdir(out, { recursive: true });
await fs.writeFile(path.join(out, 'route-coverage.json'), JSON.stringify({ routePaths, scenes }, null, 2));
const filter = process.env.SCENES?.split(',');
const nameKind = process.env.NAME_KIND ?? 'cjk';
const generalName =
    nameKind === 'ascii'
        ? 'W'.repeat(18)
        : nameKind === 'short4'
          ? '가나다라'
          : nameKind === 'mid7'
            ? '가나다라마바사'
            : '가나다라마바사아자';
const nationName = nameKind === 'ascii' ? 'M'.repeat(18) : '대한민국천하통일국';
function transform(value, key = '', parent = '') {
    if (Array.isArray(value)) {
        if (key === 'nationList')
            return value.map((row) =>
                Array.isArray(row) ? row.map((v, i) => (i === 1 ? nationName : v)) : transform(row, key, parent)
            );
        return value.map((v) => transform(v, key, parent));
    }
    if (!value || typeof value !== 'object') return value;
    const obj = {};
    const isGeneral =
        ['npcState', 'officerLevel', 'picture', 'stats', 'leadership', 'crew', 'generalId'].some((k) => k in value) ||
        /general|chief|officer|leader|participant|candidate|winner|loser|owner/i.test(key);
    const isNation =
        /nation/i.test(key) || ('color' in value && ('level' in value || 'capital' in value || 'power' in value));
    for (const [k, v] of Object.entries(value)) {
        if (typeof v === 'string' && /^(nationName|nation|국가)$/i.test(k)) obj[k] = nationName;
        else if (
            typeof v === 'string' &&
            /^(generalName|authorName|sellerName|hostName|bidderName|leaderName|chiefName|officerName|kingName|l\d+name)$/i.test(
                k
            )
        )
            obj[k] = generalName;
        else if (k === 'name' && typeof v === 'string' && (isGeneral || isNation))
            obj[k] = isGeneral ? generalName : nationName;
        else obj[k] = transform(v, k, key);
    }
    return obj;
}
const browser = await chromium.launch({ headless: true });
const manifest = [];
for (const [id, group, route, ready] of scenes.filter((s) => !filter || filter.includes(s[0]))) {
    for (const width of (process.env.WIDTHS ?? '500,1000').split(',').map(Number)) {
        const dir = path.join(out, phase, `${id}-${width}-${nameKind}`);
        await fs.mkdir(dir, { recursive: true });
        const context = await browser.newContext({
            baseURL: origin + prefix + '/',
            viewport: { width: process.env.MOBILE ? 390 : width, height: process.env.MOBILE ? 844 : 900 },
            isMobile: !!process.env.MOBILE,
            deviceScaleFactor: 1,
            locale: 'ko-KR',
            timezoneId: 'UTC',
            colorScheme: 'dark',
        });
        const page = await context.newPage();
        await page.addInitScript(() => {
            window.__typographyCanvasFonts = [];
            const original = CanvasRenderingContext2D.prototype.fillText;
            CanvasRenderingContext2D.prototype.fillText = function (...args) {
                if (!window.__typographyCanvasFonts.includes(this.font)) window.__typographyCanvasFonts.push(this.font);
                return original.apply(this, args);
            };
        });
        const errors = [],
            responses = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const proxy = new Proxy(page, {
            get(target, key) {
                if (key === 'route')
                    return async (pattern, handler, options) =>
                        target.route(
                            typeof pattern === 'string' ? pattern.replaceAll('/che/', prefix + '/') : pattern,
                            async (route, request) => {
                                const rp = new Proxy(route, {
                                    get(rt, rk) {
                                        if (rk === 'fulfill')
                                            return async (options) => {
                                                let body = options.json;
                                                if (
                                                    body === undefined &&
                                                    typeof options.body === 'string' &&
                                                    (options.body.startsWith('[') || options.body.startsWith('{'))
                                                )
                                                    try {
                                                        body = JSON.parse(options.body);
                                                    } catch {
                                                        // Non-JSON fixture bodies are passed through unchanged.
                                                    }
                                                if (body !== undefined) {
                                                    body = transform(body);
                                                    responses.push({ url: request.url(), body });
                                                    return rt.fulfill({
                                                        ...options,
                                                        json: undefined,
                                                        body: JSON.stringify(body),
                                                    });
                                                }
                                                return rt.fulfill(options);
                                            };
                                        const v = Reflect.get(rt, rk, rt);
                                        return typeof v === 'function' ? v.bind(rt) : v;
                                    },
                                });
                                try {
                                    return await handler(rp, request);
                                } catch (e) {
                                    errors.push('fixture: ' + e.message);
                                    await route.fulfill({
                                        status: 500,
                                        contentType: 'application/json',
                                        body: JSON.stringify({
                                            error: {
                                                message: e.message,
                                                code: -32603,
                                                data: { code: 'INTERNAL_SERVER_ERROR', httpStatus: 500 },
                                            },
                                        }),
                                    });
                                }
                            },
                            options
                        );
                const v = Reflect.get(target, key, target);
                return typeof v === 'function' ? v.bind(target) : v;
            },
        });
        try {
            await setup[group](proxy);
            await page.addInitScript(
                ({ mode, profile }) => {
                    localStorage.setItem('sammo-game-profile', profile);
                    localStorage.setItem('sam.screenMode', mode);
                    localStorage.removeItem('sam_customCSS');
                },
                { mode: process.env.MOBILE ? `${width}px` : 'auto', profile }
            );
            // Serve the exact installed source font faces and real workspace images.
            if (fontRoot) {
                await page.route('**/pretendard.css', (r) =>
                    r.fulfill({ contentType: 'text/css', path: path.join(fontRoot, 'source.css') })
                );
                await page.route('**/*.woff2', async (r) => {
                    const file = new URL(r.request().url()).pathname.split('/').at(-1);
                    try {
                        await r.fulfill({ contentType: 'font/woff2', path: path.join(fontRoot, file) });
                    } catch {
                        await r.abort();
                    }
                });
            }
            await page.route(/\/(?:image\/|sam-image\.hided\.net\/)/, async (r) => {
                const u = new URL(r.request().url());
                let rel = u.pathname.replace(/^\/image\//, '');
                if (u.hostname === 'sam-image.hided.net') rel = u.pathname.slice(1);
                if (rel.includes('..')) return r.abort();
                try {
                    const body = await fs.readFile(path.resolve(process.env.FRONTEND_PARITY_IMAGE_ROOT, rel));
                    await r.fulfill({
                        body,
                        contentType: rel.endsWith('.png')
                            ? 'image/png'
                            : rel.endsWith('.gif')
                              ? 'image/gif'
                              : 'image/jpeg',
                    });
                } catch {
                    await r.fallback();
                }
            });
            await page.goto(origin + prefix + '/' + route, { waitUntil: 'networkidle', timeout: 30000 });
            await page.locator(ready).first().waitFor({ state: 'visible', timeout: 5000 });
            const requestedPath = route.split('?')[0];
            const expectedPath = ['nation/affairs', 'nation/recruit-message'].includes(requestedPath)
                ? 'nation/finance'
                : requestedPath;
            if (new URL(page.url()).pathname !== `${prefix}/${expectedPath}`)
                throw new Error(`Unexpected route after guard: ${page.url()}`);

            if (id === 'messages') await page.locator('.msg-plate:visible').first().scrollIntoViewIfNeeded();
            if (id === 'recruitment') {
                await page.getByRole('button', { name: '1턴 명령 입력', exact: true }).click();
                const picker = page.getByTestId('command-picker');
                await picker.getByRole('button', { name: '내정', exact: true }).click();
                await picker.getByRole('button', { name: '징병', exact: true }).click();
                await page.getByTestId('recruitment-command-form').waitFor();
            }
            if (id === 'personnel-picker') {
                await page.getByRole('button', { name: '주부 변경하기', exact: true }).click();
                await page.getByTestId('personnel-selection-dialog').waitFor();
            }
            if (id === 'nation-betting') {
                await page.getByRole('button', { name: /두 번째 천통국 베팅/u }).click();
                await page.getByRole('spinbutton', { name: '베팅 금액' }).waitFor();
            }
            if (id === 'join') {
                await page.locator('input[type=text]').first().fill(generalName);
            }
            if (id === 'simulator') {
                for (const input of await page.getByLabel('이름', { exact: true }).all()) await input.fill(generalName);
            }

            await page.evaluate(async () => {
                await document.fonts.ready;
                await Promise.all([...document.images].map((i) => i.decode().catch(() => {})));
            });
            await page.waitForTimeout(150);
            const data = await page.evaluate(
                ({ generalName, nationName }) => {
                    const nodes = [];
                    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                    let n;
                    function selector(e) {
                        const parts = [];
                        for (let p = e; p && p !== document.body; p = p.parentElement) {
                            let s = p.tagName.toLowerCase();
                            if (p.id) s += '#' + p.id;
                            else if (p.classList.length) s += '.' + [...p.classList].join('.');
                            parts.unshift(s);
                        }
                        return parts.join(' > ');
                    }
                    while ((n = walker.nextNode())) {
                        const text = n.textContent.trim();
                        const e = n.parentElement;
                        if (!text || !e || ['SCRIPT', 'STYLE', 'OPTION'].includes(e.tagName)) continue;
                        const s = getComputedStyle(e);
                        if (s.display === 'none' || s.visibility === 'hidden' || !e.getClientRects().length) continue;
                        const range = document.createRange();
                        range.selectNodeContents(n);
                        const r = range.getBoundingClientRect();
                        if (!r.width || !r.height) continue;
                        const er = e.getBoundingClientRect();
                        const isName = text.includes(generalName) || text.includes(nationName);
                        const clipped = [];
                        for (let p = e; p && p !== document.body; p = p.parentElement) {
                            const ps = getComputedStyle(p),
                                pr = p.getBoundingClientRect();
                            if (
                                ['hidden', 'clip', 'auto', 'scroll'].includes(ps.overflowX) &&
                                (r.left < pr.left - 1 || r.right > pr.right + 1)
                            )
                                clipped.push({ selector: selector(p), axis: 'x', overflow: ps.overflowX });
                            if (
                                ['hidden', 'clip'].includes(ps.overflowY) &&
                                (r.top < pr.top - 1 || r.bottom > pr.bottom + 1)
                            )
                                clipped.push({ selector: selector(p), axis: 'y', overflow: ps.overflowY });
                        }
                        nodes.push({
                            text,
                            fitMax: e.dataset.fontFitMax ?? null,
                            isSubordinate: !!e.closest('small, sub, sup, .legacy-small, .sammo-text-smaller'),
                            selector: selector(e),
                            isName,
                            font: s.fontSize,
                            lineHeight: s.lineHeight,
                            weight: s.fontWeight,
                            whiteSpace: s.whiteSpace,
                            textOverflow: s.textOverflow,
                            rect: { x: r.x, y: r.y, width: r.width, height: r.height },
                            element: { x: er.x, y: er.y, width: er.width, height: er.height },
                            clipped,
                        });
                    }
                    return {
                        url: location.href,
                        canvasFonts: window.__typographyCanvasFonts,
                        smallSteps: [...document.querySelectorAll('small, sub, sup, .legacy-small')]
                            .filter(
                                (element) =>
                                    element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden'
                            )
                            .map((element) => ({
                                selector: selector(element),
                                font: getComputedStyle(element).fontSize,
                                parentFont: getComputedStyle(element.parentElement).fontSize,
                            })),
                        viewport: {
                            width: innerWidth,
                            height: innerHeight,
                            scale: visualViewport?.scale,
                            visualWidth: visualViewport?.width,
                            mode: localStorage.getItem('sam.screenMode'),
                        },
                        document: {
                            width: document.documentElement.scrollWidth,
                            height: document.documentElement.scrollHeight,
                        },
                        fontLoaded: document.fonts.check('14px Pretendard'),
                        fontFaces: [...document.fonts].map((f) => ({
                            family: f.family,
                            weight: f.weight,
                            status: f.status,
                        })),
                        nodes,
                        images: [...document.images].map((i) => ({
                            src: i.getAttribute('src'),
                            naturalWidth: i.naturalWidth,
                            naturalHeight: i.naturalHeight,
                            objectFit: getComputedStyle(i).objectFit,
                        })),
                    };
                },
                { generalName, nationName }
            );
            if (!data.fontFaces.some((f) => f.family.includes('Pretendard') && f.status === 'loaded'))
                throw new Error('Pretendard was not loaded');
            const nextSize = { '24px': '16px', '16px': '14px', '14px': '12px', '12px': '10px', '10px': '10px' };
            const wrongSteps = data.smallSteps.filter(
                (node) => nextSize[node.parentFont] && node.font !== nextSize[node.parentFont]
            );
            if (wrongSteps.length) errors.push('Small step mismatch: ' + JSON.stringify(wrongSteps));
            const offTier = data.nodes.filter(
                (n) =>
                    !['0px', '12px', '14px', '16px', '24px'].includes(n.font) &&
                    !(n.font === '10px' && n.isSubordinate) &&
                    !(
                        n.fitMax &&
                        [12, 14, 16, 24].includes(Number(n.fitMax)) &&
                        parseFloat(n.font) <= Number(n.fitMax) &&
                        parseFloat(n.font) >= 10
                    )
            );
            if (offTier.length)
                errors.push(
                    'Off-tier text: ' +
                        JSON.stringify(offTier.map((n) => ({ font: n.font, selector: n.selector })).slice(0, 20))
                );
            await page.screenshot({ path: path.join(dir, 'full.png'), fullPage: true });
            await page.screenshot({ path: path.join(dir, 'viewport.png') });
            await fs.writeFile(path.join(dir, 'dom.json'), JSON.stringify(data, null, 2));
            await fs.writeFile(path.join(dir, 'dom.html'), await page.content());
            await fs.writeFile(path.join(dir, 'responses.json'), JSON.stringify(responses, null, 2));
            const entry = {
                id,
                width,
                nameKind,
                status: 'captured',
                nodes: data.nodes.length,
                names: data.nodes.filter((n) => n.isName).length,
                clippedNames: data.nodes.filter((n) => n.isName && n.clipped.length).length,
                fontLoaded: data.fontLoaded,
                errors,
            };
            manifest.push(entry);
            console.log(JSON.stringify(entry));
        } catch (e) {
            const entry = { id, width, nameKind, status: 'failed', error: e.message, errors };
            manifest.push(entry);
            console.log(JSON.stringify(entry));
            await page.screenshot({ path: path.join(dir, 'failure.png'), fullPage: true }).catch(() => {});
            await fs.writeFile(path.join(dir, 'failure.html'), await page.content());
        }
        await context.close();
        await fs.writeFile(path.join(out, `${phase}-${nameKind}-manifest.json`), JSON.stringify(manifest, null, 2));
    }
}
await browser.close();
const failures = manifest.filter((row) => row.status !== 'captured' || row.errors.length);
console.log(
    JSON.stringify({
        captures: manifest.length,
        failures: failures.length,
        profile,
        prefix,
        browser: browser.version(),
    })
);
if (failures.length) process.exitCode = 1;
