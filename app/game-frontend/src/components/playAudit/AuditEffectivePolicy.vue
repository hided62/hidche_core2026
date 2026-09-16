<script setup lang="ts">
import type { trpc } from '../../utils/trpc';
import { fieldLabels } from './policyLabels';
type Step = Awaited<ReturnType<typeof trpc.playAudit.decisionDetail.query>>['chunks'][number]['steps'][number];
type Policy = NonNullable<Extract<Step, { kind: 'DECISION_START' }>['effectivePolicy']>;
defineProps<{ policy: Policy }>();
const label = (key: string) => fieldLabels[key.replace('Npc', 'NPC')] ?? key;
</script>

<template>
    <details>
        <summary>당시 합성 정책</summary>
        <p>기본값·서버·국가 설정과 유저 자동턴 옵션이 반영된 정책입니다. 현재 설정으로 재계산하지 않습니다.</p>
        <section v-for="(part, key) in { general: policy.general, nation: policy.nation }" :key="key">
            <h4>{{ key === 'general' ? '개인 행동' : '수뇌 행동' }}</h4>
            <p>우선순위: {{ part.priority.join(' → ') || '없음' }}</p>
            <ul>
                <li v-for="(enabled, action) in part.flags" :key="action">
                    {{ action }}: {{ enabled ? '허용' : '제외' }}
                </li>
            </ul>
        </section>
        <h4>국가 정책 수치</h4>
        <dl>
            <template v-for="(value, key) in policy.nation.values" :key="key">
                <dt>{{ label(key) }}</dt>
                <dd>{{ value }}</dd>
            </template>
            <dt>전투 부대 편성 (장수: 출발·목적 도시)</dt>
            <dd>{{ JSON.stringify(policy.nation.combatForce) }}</dd>
            <dt>지원 부대 장수</dt>
            <dd>{{ policy.nation.supportForce.join(', ') || '없음' }}</dd>
            <dt>내정 부대 장수</dt>
            <dd>{{ policy.nation.developForce.join(', ') || '없음' }}</dd>
        </dl>
        <p>실행 직전의 자원 지급 상한·개별 후보 조건과 별도 자동화 권한 판정은 이 정책 표에 포함되지 않습니다.</p>
    </details>
</template>

<style scoped>
details {
    min-width: 0;
    overflow-wrap: anywhere;
}
dd {
    margin-left: 12px;
    margin-bottom: 6px;
}
</style>
