<script setup lang="ts">
import { computed, ref } from 'vue';
import SkeletonLines from '../ui/SkeletonLines.vue';
import type { MessageType } from '@sammo-ts/logic';

interface MessageEntry {
    id: number;
    text: string;
    time: string;
    msgType: MessageType;
}

interface MessageBucket {
    private: MessageEntry[];
    public: MessageEntry[];
    national: MessageEntry[];
    diplomacy: MessageEntry[];
}

const props = defineProps<{
    messages: MessageBucket | null;
    loading: boolean;
    targetMailbox: number;
    draftText: string;
    mailboxOptions: Array<{ label: string; value: number; disabled?: boolean }>;
}>();

const emit = defineEmits<{
    (event: 'update:targetMailbox', value: number): void;
    (event: 'update:draftText', value: string): void;
    (event: 'send'): void;
    (event: 'refresh'): void;
    (event: 'load-older', type: MessageType): void;
}>();

const messageTabs: Array<{ key: MessageType; label: string }> = [
    { key: 'public', label: '전체' },
    { key: 'national', label: '국가' },
    { key: 'private', label: '개인' },
    { key: 'diplomacy', label: '외교' },
];

const activeTab = ref<MessageType>('public');

const activeMessages = computed(() => {
    if (!props.messages) {
        return [] as MessageEntry[];
    }
    return props.messages[activeTab.value] ?? [];
});

const setMailbox = (value: string) => {
    const parsed = Number(value);
    emit('update:targetMailbox', Number.isFinite(parsed) ? parsed : 0);
};
</script>

<template>
    <div class="message-panel">
        <div class="message-input">
            <select
                class="message-select"
                :value="targetMailbox"
                @change="setMailbox(($event.target as HTMLSelectElement).value)"
            >
                <option
                    v-for="option in mailboxOptions"
                    :key="option.label"
                    :value="option.value"
                    :disabled="option.disabled"
                >
                    {{ option.label }}
                </option>
            </select>
            <input
                class="message-text"
                type="text"
                maxlength="99"
                :value="draftText"
                placeholder="메시지 입력"
                @input="emit('update:draftText', ($event.target as HTMLInputElement).value)"
                @keydown.enter="emit('send')"
            />
            <button class="message-send" @click="emit('send')">전송</button>
        </div>

        <div class="message-tabs">
            <button
                v-for="tab in messageTabs"
                :key="tab.key"
                :class="{ active: activeTab === tab.key }"
                @click="activeTab = tab.key"
            >
                {{ tab.label }}
            </button>
            <button class="refresh" @click="emit('refresh')">갱신</button>
        </div>

        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.messages" class="empty">
            메시지를 불러오지 못했습니다.
        </div>
        <div v-else class="message-list">
            <div v-if="activeMessages.length === 0" class="empty">메시지가 없습니다.</div>
            <div v-else>
                <div v-for="message in activeMessages" :key="message.id" class="message-item">
                    <div class="text">{{ message.text }}</div>
                    <div class="time">{{ message.time }}</div>
                </div>
                <button class="load-older" @click="emit('load-older', activeTab)">이전 메시지</button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.message-panel {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.message-input {
    display: grid;
    grid-template-columns: minmax(90px, 120px) 1fr auto;
    gap: 6px;
}

.message-select,
.message-text {
    background: rgba(16, 16, 16, 0.8);
    border: 1px solid rgba(201, 164, 90, 0.4);
    color: inherit;
    padding: 6px;
    font-size: 0.75rem;
}

.message-send {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 10px;
    font-size: 0.75rem;
    cursor: pointer;
}

.message-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.message-tabs button {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 4px 8px;
    font-size: 0.7rem;
    cursor: pointer;
}

.message-tabs button.active {
    background: rgba(201, 164, 90, 0.2);
}

.message-tabs .refresh {
    margin-left: auto;
}

.message-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.message-item {
    border: 1px solid rgba(201, 164, 90, 0.2);
    padding: 6px;
    font-size: 0.75rem;
}

.message-item .time {
    margin-top: 4px;
    font-size: 0.65rem;
    color: rgba(232, 221, 196, 0.6);
}

.load-older {
    border: 1px dashed rgba(201, 164, 90, 0.3);
    padding: 6px;
    font-size: 0.7rem;
    cursor: pointer;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
