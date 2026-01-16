<script setup lang="ts">
import SkeletonLines from '../ui/SkeletonLines.vue';

interface MessageEntry {
    id: number;
    text: string;
    time: string;
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
}>();

const preview = (items: MessageEntry[]): MessageEntry | null => (items.length ? items[0] : null);

const trimText = (value: string): string => {
    const clean = value.replace(/\s+/g, ' ').trim();
    if (clean.length <= 60) {
        return clean;
    }
    return `${clean.slice(0, 60)}...`;
};
</script>

<template>
    <div class="message-panel">
        <div v-if="props.loading">
            <SkeletonLines :lines="5" />
        </div>
        <div v-else-if="!props.messages" class="empty">
            메시지를 불러오지 못했습니다.
        </div>
        <div v-else class="message-body">
            <div class="bucket">
                <div class="bucket-title">개인</div>
                <div class="bucket-item" v-if="preview(props.messages.private)">
                    <div class="text">{{ trimText(preview(props.messages.private)?.text ?? '') }}</div>
                    <div class="time">{{ preview(props.messages.private)?.time }}</div>
                </div>
                <div v-else class="bucket-empty">메시지 없음</div>
            </div>
            <div class="bucket">
                <div class="bucket-title">공공</div>
                <div class="bucket-item" v-if="preview(props.messages.public)">
                    <div class="text">{{ trimText(preview(props.messages.public)?.text ?? '') }}</div>
                    <div class="time">{{ preview(props.messages.public)?.time }}</div>
                </div>
                <div v-else class="bucket-empty">메시지 없음</div>
            </div>
            <div class="bucket">
                <div class="bucket-title">국가</div>
                <div class="bucket-item" v-if="preview(props.messages.national)">
                    <div class="text">{{ trimText(preview(props.messages.national)?.text ?? '') }}</div>
                    <div class="time">{{ preview(props.messages.national)?.time }}</div>
                </div>
                <div v-else class="bucket-empty">메시지 없음</div>
            </div>
            <div class="bucket">
                <div class="bucket-title">외교</div>
                <div class="bucket-item" v-if="preview(props.messages.diplomacy)">
                    <div class="text">{{ trimText(preview(props.messages.diplomacy)?.text ?? '') }}</div>
                    <div class="time">{{ preview(props.messages.diplomacy)?.time }}</div>
                </div>
                <div v-else class="bucket-empty">메시지 없음</div>
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

.bucket {
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.bucket-title {
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.7);
}

.bucket-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 0.85rem;
}

.bucket-item .time {
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.6);
}

.bucket-empty {
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.5);
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
