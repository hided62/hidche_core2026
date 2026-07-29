import { defineConfig } from 'vitepress';

export default defineConfig({
    lang: 'ko-KR',
    title: 'core2026 핸드북',
    description: 'SAM core2026 개발자 내부 문서와 플레이어 이용 가이드',
    cleanUrls: true,
    lastUpdated: true,
    head: [['meta', { name: 'theme-color', content: '#6b3f22' }]],
    themeConfig: {
        siteTitle: 'core2026 핸드북',
        nav: [
            { text: '개발자', link: '/developer/' },
            { text: '플레이어', link: '/user/' },
            { text: '기준 커밋', link: '/reference-baseline' },
        ],
        sidebar: {
            '/developer/': [
                {
                    text: '개발자 핸드북',
                    items: [
                        { text: '시작하기', link: '/developer/' },
                        { text: '시스템 아키텍처', link: '/developer/system-architecture' },
                        { text: '요청·턴·저장 흐름', link: '/developer/request-turn-persistence' },
                        { text: '도메인 로직과 핵심 클래스', link: '/developer/domain-and-classes' },
                        { text: '파일 지도와 변경 절차', link: '/developer/code-map' },
                    ],
                },
            ],
            '/user/': [
                {
                    text: '플레이어 가이드',
                    items: [
                        { text: '시작하기', link: '/user/' },
                        { text: '시간과 턴', link: '/user/time-and-turns' },
                        { text: '커맨드와 실행 시기', link: '/user/commands-and-timing' },
                        { text: '커맨드 전체 목록', link: '/user/command-catalog.generated' },
                        { text: '국가 운영과 주요 기능', link: '/user/nation-and-features' },
                    ],
                },
            ],
        },
        search: {
            provider: 'local',
        },
        outline: {
            level: [2, 3],
            label: '이 페이지에서',
        },
        docFooter: {
            prev: '이전',
            next: '다음',
        },
        lastUpdated: {
            text: '마지막 변경',
        },
        footer: {
            message: '현재 구현을 설명하는 문서입니다. 기준 커밋과 검증 범위를 함께 확인해 주세요.',
        },
    },
});
