<script setup lang="ts">
import { formatServerDateTime } from '@sammo-ts/common/time/ServerDateTime';
import { computed } from 'vue';

type AutorunUser = {
    limitMinutes: number;
    options: string[];
};

const props = defineProps<{
    profileName: string;
    preopenAt: string | null | undefined;
    openAt: string | null | undefined;
    scenarioTitle: string;
    turnTermMinutes: number;
    fictionMode: string;
    npcMode: number;
    defaultStatTotal: number;
    otherTextInfo: string;
    autorunUser: AutorunUser | null;
    scheduledAt?: string | null;
    testIdPrefix: 'profile' | 'upcoming-reset';
}>();

const formatAnnouncementDate = (value: string | null | undefined): string =>
    formatServerDateTime(value, { fallback: '-' });
const npcModeText = (mode: number): string => ['불가', '가능', '선택 생성'][mode] ?? '불가';
const autorunDetailText = (autorun: AutorunUser): string => {
    const enabled = new Set(autorun.options);
    const labels: string[] = [];
    if (enabled.has('develop')) labels.push('내정');
    if (enabled.has('warp')) labels.push('순간이동');
    if (enabled.has('recruit_high')) labels.push('모병');
    else if (enabled.has('recruit')) labels.push('징병');
    if (enabled.has('train')) labels.push('훈련/사기진작');
    if (enabled.has('battle')) labels.push('출병');
    if (enabled.has('chief')) labels.push('사령턴');

    const limit =
        autorun.limitMinutes >= 43_200
            ? '항상 유효'
            : autorun.limitMinutes % 60 === 0
              ? `${autorun.limitMinutes / 60}시간 유효`
              : `${autorun.limitMinutes}분 유효`;
    labels.push(limit);
    return labels.join(', ');
};
const safeProfileName = computed(() => props.profileName.replaceAll(/[^a-zA-Z0-9_-]/g, '-'));
const autorunTooltipId = computed(() => `profile-autorun-${props.testIdPrefix}-${safeProfileName.value}`);
const buildTimeTooltipId = computed(() => `reserved-announcement-build-time-${safeProfileName.value}`);
</script>

<template>
    <div class="preopen-announcement" :data-testid="`${testIdPrefix}-announcement`">
        <div v-if="preopenAt" :data-testid="`${testIdPrefix}-preopen-at`">
            - 가오픈 일시 : {{ formatAnnouncementDate(preopenAt) }} -
        </div>
        <div :data-testid="`${testIdPrefix}-open-at`">- 오픈 일시 : {{ formatAnnouncementDate(openAt) }} -</div>
        <div :data-testid="`${testIdPrefix}-scenario-announcement`">
            <span class="text-orange-400" :data-testid="`${testIdPrefix}-scenario-title`">{{ scenarioTitle }}</span
            >{{ ' ' }}
            <span class="text-green-400">{{ turnTermMinutes }}분 턴 서버</span>
            <span
                v-if="scheduledAt"
                class="reserved-announcement-badge"
                tabindex="0"
                aria-label="예약 공지의 실제 빌드 시작 시각 보기"
                :aria-describedby="buildTimeTooltipId"
                data-testid="reserved-announcement-badge"
            >
                예약 공지
                <span
                    :id="buildTimeTooltipId"
                    class="reserved-announcement-build-tooltip"
                    role="tooltip"
                    data-testid="reserved-announcement-build-tooltip"
                    >실제 빌드 시작 : {{ formatAnnouncementDate(scheduledAt) }}</span
                >
            </span>
        </div>
        <div class="profile-announcement-settings text-xs text-zinc-500">
            (상성 설정:{{ fictionMode }}), (빙의 여부:{{ npcModeText(npcMode) }}), (최대 스탯:{{ defaultStatTotal }}),
            (기타 설정:<template v-if="otherTextInfo"
                >{{ otherTextInfo }}<template v-if="autorunUser">, </template></template
            ><span v-if="autorunUser" class="copyable-autorun" tabindex="0" :aria-describedby="autorunTooltipId"
                >자율행동<span :id="autorunTooltipId" class="copyable-autorun-detail" role="tooltip"
                    ><span class="copyable-autorun-bracket">[</span><span>{{ autorunDetailText(autorunUser) }}</span
                    ><span class="copyable-autorun-bracket">]</span></span
                ></span
            >)
        </div>
    </div>
</template>

<style scoped>
.preopen-announcement {
    line-height: 1.5;
}

.reserved-announcement-badge {
    position: relative;
    display: inline-flex;
    align-items: center;
    margin-left: 6px;
    padding: 1px 4px;
    border: 1px solid #d97706;
    border-radius: 2px;
    background: rgb(120 53 15 / 35%);
    color: #fbbf24;
    cursor: help;
    font-size: 10px;
    font-weight: 700;
    line-height: 14px;
    user-select: none;
    vertical-align: text-bottom;
}

.reserved-announcement-build-tooltip {
    position: absolute;
    z-index: 30;
    bottom: calc(100% + 6px);
    left: 50%;
    visibility: hidden;
    box-sizing: border-box;
    width: max-content;
    max-width: min(320px, calc(100vw - 32px));
    padding: 6px 8px;
    border: 1px solid #52525b;
    border-radius: 4px;
    background: #18181b;
    box-shadow: 0 4px 12px rgb(0 0 0 / 45%);
    color: #f4f4f5;
    font-size: 12px;
    font-weight: 400;
    line-height: 1.4;
    opacity: 0;
    pointer-events: none;
    text-align: left;
    transform: translateX(-50%);
    white-space: nowrap;
}

.reserved-announcement-badge:hover .reserved-announcement-build-tooltip,
.reserved-announcement-badge:focus-visible .reserved-announcement-build-tooltip {
    visibility: visible;
    opacity: 1;
}

.reserved-announcement-badge:focus-visible {
    outline: 2px solid #fdba74;
    outline-offset: 2px;
}

.copyable-autorun {
    position: relative;
    cursor: help;
    text-decoration: underline;
    text-underline-offset: 2px;
}

.copyable-autorun-detail {
    display: inline;
    color: transparent;
    font-size: 0;
}

.copyable-autorun-bracket {
    color: transparent;
    font-size: 0;
}

.copyable-autorun:hover .copyable-autorun-detail,
.copyable-autorun:focus-visible .copyable-autorun-detail {
    position: absolute;
    z-index: 30;
    right: 0;
    bottom: calc(100% + 6px);
    display: block;
    box-sizing: border-box;
    width: max-content;
    max-width: min(520px, calc(100vw - 32px));
    padding: 6px 8px;
    border: 1px solid #52525b;
    border-radius: 4px;
    background: #18181b;
    box-shadow: 0 4px 12px rgb(0 0 0 / 45%);
    color: #f4f4f5;
    font-size: 12px;
    line-height: 1.4;
    text-align: left;
    white-space: normal;
}

.copyable-autorun:focus-visible {
    border-radius: 2px;
    outline: 2px solid #fdba74;
    outline-offset: 2px;
}

@media (max-width: 640px) {
    .reserved-announcement-badge:hover .reserved-announcement-build-tooltip,
    .reserved-announcement-badge:focus-visible .reserved-announcement-build-tooltip,
    .copyable-autorun:hover .copyable-autorun-detail,
    .copyable-autorun:focus-visible .copyable-autorun-detail {
        position: fixed;
        top: auto;
        right: 16px;
        bottom: 16px;
        left: 16px;
        width: auto;
        max-width: none;
        transform: none;
        white-space: normal;
    }
}
</style>
