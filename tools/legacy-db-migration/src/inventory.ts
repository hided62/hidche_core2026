import type { ResolvedMigrationStage } from './config.js';

export interface MigrationInventoryItem {
    source: string;
    target: string;
    strategy: 'append' | 'rescan' | 'filesystem-season';
    contents: string;
}

export const GATEWAY_MIGRATION_INVENTORY: readonly MigrationInventoryItem[] = [
    {
        source: 'member',
        target: 'app_user + legacy_data',
        strategy: 'rescan',
        contents: '계정 식별자, 레거시 역할/제재, OAuth 메타데이터와 비밀번호 복구 자료',
    },
    {
        source: 'member_log',
        target: 'legacy_member_log',
        strategy: 'append',
        contents: '계정 변경 감사 기록',
    },
    {
        source: 'banned_member',
        target: 'legacy_banned_member',
        strategy: 'rescan',
        contents: '해시 이메일 차단 기록',
    },
    {
        source: 'storage',
        target: 'legacy_root_key_value',
        strategy: 'rescan',
        contents: 'Gateway 장기 key/value 원문',
    },
    {
        source: 'system',
        target: 'system',
        strategy: 'rescan',
        contents: '가입/로그인 스위치와 공지',
    },
];

export const GAME_MIGRATION_INVENTORY: readonly MigrationInventoryItem[] = [
    {
        source: 'ng_games',
        target: 'legacy_archive.game_history',
        strategy: 'rescan',
        contents: '지난 기수, 시나리오, 개장 시각, 승자와 원본 환경',
    },
    {
        source: 'ng_old_generals',
        target: 'legacy_archive.general',
        strategy: 'append',
        contents: '지난 장수의 능력치, 숙련, 경험, 공헌, 자원, 전투 집계, 특기, 장수 열전과 원본 JSON',
    },
    {
        source: 'logs/preserved/<server_id>/batres<general_no>.txt',
        target: 'legacy_archive.general_battle_result',
        strategy: 'filesystem-season',
        contents: '구형 기수의 장수별 전투 결과 요약; batlog 페이즈 상세는 제외',
    },
    {
        source: 'hall',
        target: 'legacy_archive.hall',
        strategy: 'append',
        contents: '명예의 전당 순위와 점수',
    },
    {
        source: 'ng_old_nations',
        target: 'legacy_archive.nation',
        strategy: 'append',
        contents: '지난 국가 구성, 장수 목록과 국가 연혁',
    },
    {
        source: 'emperior',
        target: 'legacy_archive.emperor',
        strategy: 'append',
        contents: '왕조 일람, 통일 국가/황제/관직/국력/연혁',
    },
    {
        source: 'inheritance_result',
        target: 'inheritance_result',
        strategy: 'append',
        contents: '유산 결과 원문과 점수',
    },
    {
        source: 'user_record',
        target: 'inheritance_log',
        strategy: 'append',
        contents: '사용자별 유산 획득/사용 장기 기록',
    },
    {
        source: 'storage:inheritance_* / user_*',
        target: 'legacy_game_storage + inheritance_point + inheritance_user_state',
        strategy: 'rescan',
        contents: '유산 포인트와 사용자 유산 상태 및 원본 tuple',
    },
    {
        source: 'ng_history',
        target: 'legacy_archive.yearbook',
        strategy: 'append',
        contents: '월별 지도, 국가, 천하 동향과 전체 기록 연감',
    },
];

export const migrationInventoryForStage = (stage: ResolvedMigrationStage): readonly MigrationInventoryItem[] =>
    stage.kind === 'gateway'
        ? GATEWAY_MIGRATION_INVENTORY
        : GAME_MIGRATION_INVENTORY.filter(
              (item) => item.strategy !== 'filesystem-season' || stage.battleResults !== undefined
          );
