<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
const props = defineProps<{
    serverId?: string;
    summary?: { generalId: number; nationId: number; ids: string[] };
}>();
const visible = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
let identity = '';
let sessionSeen = new Set<string>();
const count = computed(() => props.summary?.ids.length ?? 0);
const dismiss = () => {
    visible.value = false;
    clearTimeout(timer);
};
watch(
    () => [props.serverId, props.summary] as const,
    () => {
        const summary = props.summary;
        if (!summary || !props.serverId) {
            dismiss();
            return;
        }
        const key = `state.${props.serverId}.${summary.generalId}.${summary.nationId}.officeRequests`;
        if (identity !== key) {
            dismiss();
            identity = key;
            sessionSeen = new Set();
        }
        if (!summary.ids.length) {
            dismiss();
            return;
        }
        let seen: string[] = [];
        try {
            const stored: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
            if (Array.isArray(stored)) seen = stored.filter((id): id is string => typeof id === 'string');
        } catch {
            /* 저장소를 사용할 수 없어도 요청 목록은 표시한다. */
        }
        const fresh = summary.ids.some((id) => !seen.includes(id) && !sessionSeen.has(id));
        if (!fresh) return;
        try {
            localStorage.setItem(key, JSON.stringify([...new Set([...seen, ...summary.ids])].slice(-500)));
        } catch {
            /* private browsing */
        }
        summary.ids.forEach((id) => sessionSeen.add(id));
        visible.value = true;
        clearTimeout(timer);
        timer = setTimeout(dismiss, 60_000);
    },
    { immediate: true, deep: true }
);
onUnmounted(() => clearTimeout(timer));
</script>

<template>
    <RouterLink v-if="count" class="office-request-link" to="/nation/personnel#city-office-requests"
        >인사부 · 관직 요청 {{ count }}건</RouterLink
    >
    <aside v-if="visible && count" class="office-request-notice" role="status" aria-live="polite">
        <div>
            <strong>새 관직 요청</strong
            ><button type="button" aria-label="관직 요청 알림 닫기" @click="dismiss">×</button>
        </div>
        <RouterLink to="/nation/personnel#city-office-requests" @click="dismiss"
            >대기 {{ count }}건 · 인사부에서 확인</RouterLink
        >
    </aside>
</template>

<style scoped>
.office-request-link {
    display: block;
    padding: 5px 8px;
    background: #30302c;
    color: #ffe7a3;
    text-align: center;
}
.office-request-notice {
    position: fixed;
    z-index: 1050;
    bottom: 100px;
    left: 12px;
    width: 280px;
    max-width: calc(100vw - 24px);
    padding: 12px;
    background: #282823;
    color: #fff;
    border: 1px solid #d4bd77;
    box-shadow: 0 3px 12px #0008;
}
.office-request-notice > div {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
}
.office-request-notice button {
    background: none;
    border: 0;
    color: #fff;
    cursor: pointer;
    min-width: 30px;
    min-height: 30px;
}
.office-request-notice a {
    color: #ffe7a3;
}
</style>
