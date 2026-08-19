<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { MessageType } from '@sammo-ts/logic';
import { legacyLuminanceTextColor } from '../../utils/legacyNationColor';
import SkeletonLines from '../ui/SkeletonLines.vue';
import MessagePlate from './MessagePlate.vue';

interface MessageTarget {
    generalId: number;
    generalName: string;
    nationId: number;
    nationName: string;
    color: string;
    icon: string;
}

interface MessageEntry {
    id: number;
    text: string;
    time: string;
    msgType: MessageType;
    src: MessageTarget;
    dest: MessageTarget | null;
    option?: Record<string, unknown> | null;
}

interface MessageBucket {
    private: MessageEntry[];
    public: MessageEntry[];
    national: MessageEntry[];
    diplomacy: MessageEntry[];
    permission: number;
    latestRead: {
        private: number;
        diplomacy: number;
    };
}

interface MailboxGroup {
    label: string;
    color?: string;
    options: Array<{
        label: string;
        value: number;
        disabled?: boolean;
        color?: string;
    }>;
}

const props = defineProps<{
    messages: MessageBucket | null;
    loading: boolean;
    targetMailbox: number;
    draftText: string;
    mailboxGroups: MailboxGroup[];
    generalId: number;
    generalName: string;
    nationId: number;
    canRespondDiplomacy: boolean;
}>();

const emit = defineEmits<{
    (event: 'update:targetMailbox', value: number): void;
    (event: 'update:draftText', value: string): void;
    (event: 'send'): void;
    (event: 'refresh'): void;
    (event: 'load-older', type: MessageType): void;
    (event: 'respond', messageId: number, response: boolean): void;
    (event: 'read-latest', type: 'private' | 'diplomacy', messageId: number): void;
    (event: 'delete', messageId: number): void;
}>();

const sections: Array<{ type: MessageType; label: string; className: string }> = [
    { type: 'public', label: '전체 메시지', className: 'PublicTalk' },
    { type: 'national', label: '국가 메시지', className: 'NationalTalk' },
    { type: 'private', label: '개인 메시지', className: 'PrivateTalk' },
    { type: 'diplomacy', label: '외교 메시지', className: 'DiplomacyTalk' },
];

const visibleLimits = reactive<Record<MessageType, number>>({
    public: Number.POSITIVE_INFINITY,
    national: Number.POSITIVE_INFINITY,
    private: Number.POSITIVE_INFINITY,
    diplomacy: Number.POSITIVE_INFINITY,
});

const bucket = (type: MessageType): MessageEntry[] => props.messages?.[type] ?? [];
const visibleMessages = (type: MessageType): MessageEntry[] => bucket(type).slice(0, visibleLimits[type]);

const permission = computed(() => props.messages?.permission ?? -1);
const replyableGeneralIds = computed(() =>
    props.mailboxGroups.flatMap((group) =>
        group.options
            .filter((option) => !option.disabled && option.value > 0 && option.value < 9000)
            .map((option) => option.value)
    )
);

const setMailbox = (value: string) => {
    const parsed = Number(value);
    emit('update:targetMailbox', Number.isFinite(parsed) ? parsed : 0);
};

const submit = () => {
    if (!props.draftText.trim()) {
        emit('refresh');
        return;
    }
    emit('send');
};

const newestIncomingId = (type: 'private' | 'diplomacy'): number =>
    bucket(type)
        .filter((message) => message.src.generalId !== props.generalId)
        .reduce((latest, message) => Math.max(latest, message.id), 0);

const canMarkRead = (type: 'private' | 'diplomacy'): boolean => {
    if (!props.messages) {
        return false;
    }
    const newest = newestIncomingId(type);
    return newest > props.messages.latestRead[type];
};

const markRead = (type: 'private' | 'diplomacy') => {
    const messageId = newestIncomingId(type);
    if (messageId > 0) {
        emit('read-latest', type, messageId);
    }
};

const setSectionMailbox = (type: MessageType) => {
    if (type === 'public') {
        emit('update:targetMailbox', 9999);
    } else if (type === 'national') {
        emit('update:targetMailbox', 9000 + props.nationId);
    }
};

const setReplyTarget = (type: MessageType, target: MessageTarget) => {
    const mailbox =
        (type === 'diplomacy' || type === 'national') && target.nationId !== props.nationId
            ? 9000 + target.nationId
            : target.generalId;
    if (mailbox > 0) {
        emit('update:targetMailbox', mailbox);
    }
};

const fold = (type: MessageType) => {
    if (bucket(type).length >= 10) {
        visibleLimits[type] = 10;
    }
};

const forwardResponse = (messageId: number, response: boolean) => {
    emit('respond', messageId, response);
};
</script>

<template>
    <div class="MessagePanel">
        <div class="MessageInputForm">
            <div id="mailbox_list-col">
                <select
                    id="mailbox_list"
                    class="message-select"
                    :value="targetMailbox"
                    aria-label="메시지 수신 대상"
                    @change="setMailbox(($event.target as HTMLSelectElement).value)"
                >
                    <optgroup
                        v-for="group in mailboxGroups"
                        :key="group.label"
                        :label="group.label"
                        :style="{
                            backgroundColor: group.color ?? '#000000',
                            color: legacyLuminanceTextColor(group.color ?? '#000000'),
                        }"
                    >
                        <option
                            v-for="option in group.options"
                            :key="`${group.label}-${option.value}`"
                            :value="option.value"
                            :disabled="option.disabled"
                            :style="{
                                backgroundColor: option.color ?? '#000000',
                                color: legacyLuminanceTextColor(option.color ?? '#000000'),
                            }"
                        >
                            {{ option.label }}
                        </option>
                    </optgroup>
                </select>
            </div>
            <div id="msg_input-col">
                <input
                    class="message-text"
                    type="text"
                    maxlength="99"
                    :value="draftText"
                    aria-label="메시지 입력"
                    @input="emit('update:draftText', ($event.target as HTMLInputElement).value)"
                    @keydown.enter="submit"
                />
            </div>
            <div id="msg_submit-col">
                <button class="message-send" type="button" @click="submit">서신전달&amp;갱신</button>
            </div>
        </div>

        <div v-if="loading && !messages" class="message-loading">
            <SkeletonLines :lines="4" />
        </div>

        <template v-else>
            <section
                v-for="section in sections"
                :key="section.type"
                :class="['message-section', section.className]"
                :data-message-type="section.type"
            >
                <div class="stickyAnchor"></div>
                <header class="BoardHeader">
                    <div class="header-label">{{ section.label }}</div>
                    <button
                        v-if="section.type === 'public' || section.type === 'national'"
                        class="btn-more-small action-primary"
                        type="button"
                        @click="setSectionMailbox(section.type)"
                    >
                        ↩ 여기로
                    </button>
                    <button
                        v-else
                        class="btn-more-small action-secondary"
                        type="button"
                        :disabled="!canMarkRead(section.type)"
                        @click="markRead(section.type)"
                    >
                        모두 읽음
                    </button>
                </header>

                <div v-if="bucket(section.type).length === 0" class="empty-message">메시지가 없습니다.</div>
                <div v-else class="MessageList">
                    <MessagePlate
                        v-for="message in visibleMessages(section.type)"
                        :key="message.id"
                        :message="message"
                        :general-id="generalId"
                        :general-name="generalName"
                        :nation-id="nationId"
                        :permission="permission"
                        :can-respond-diplomacy="canRespondDiplomacy"
                        :replyable-general-ids="replyableGeneralIds"
                        @set-target="setReplyTarget"
                        @delete="emit('delete', $event)"
                        @respond="forwardResponse"
                    />
                    <div class="Actions">
                        <button class="fold-message" type="button" @click="fold(section.type)">접기</button>
                        <button class="load-older" type="button" @click="emit('load-older', section.type)">
                            이전 메시지 불러오기
                        </button>
                    </div>
                </div>
            </section>
        </template>
    </div>
</template>

<style scoped>
.MessagePanel {
    color: #fff;
    font-size: 14px;
}

.MessageInputForm {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 4fr) minmax(0, 1fr);
    grid-template-areas: 'mailbox input submit';
    background-color: #302016;
    background-image: var(--sammo-texture-walnut);
}

#mailbox_list-col {
    grid-area: mailbox;
}

#msg_input-col {
    grid-area: input;
}

#msg_submit-col {
    grid-area: submit;
}

#mailbox_list-col,
#msg_input-col,
#msg_submit-col {
    display: grid;
}

.message-select,
.message-text,
.message-send {
    height: 35.5px;
    border: 1px solid #6c757d;
    border-radius: 4px;
    font: inherit;
}

.message-select {
    width: 100%;
    background-color: #212529;
    padding: 4px 30px 4px 12px;
    color: #fff;
    font-weight: 700;
}

.message-text {
    width: 100%;
    background-color: #fff;
    padding: 4px 8px;
    color: #212529;
}

.message-send,
.action-primary {
    background-color: #337ab7;
    color: #fff;
}

.message-send {
    padding: 4px 8px;
    cursor: pointer;
}

.message-send:hover {
    background-color: #375a7f;
}

.message-send:focus,
.message-send:focus-visible {
    outline: none !important;
    outline-width: 0 !important;
    box-shadow: none !important;
}

.message-loading {
    padding: 8px;
}

.message-section {
    min-width: 0;
}

.BoardHeader {
    display: flex;
    min-height: 25px;
    align-items: center;
    outline: 1px solid gray;
    background-color: #302016;
    background-image: var(--sammo-texture-walnut);
    color: #fff;
}

.header-label {
    flex: 1;
}

.btn-more-small {
    margin: 1px;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 2px 6px;
    font-size: 11.2px;
    line-height: 1.5;
    cursor: pointer;
}

.action-secondary {
    border-color: #6c757d;
    background-color: #6c757d;
    color: #fff;
}

.btn-more-small:disabled {
    cursor: default;
    opacity: 0.65;
}

.empty-message {
    min-height: 0;
    padding: 2px 7px;
}

.MessageList {
    overflow-x: hidden;
}

.Actions {
    display: grid;
}

.fold-message,
.load-older {
    border: 1px solid transparent;
    padding: 6px 12px;
    color: #fff;
    font: inherit;
    cursor: pointer;
}

.fold-message {
    background-color: #212529;
}

.load-older {
    background-color: #6c757d;
}

@media (min-width: 940px) {
    .MessagePanel {
        display: grid;
        grid-template-columns: 1fr 1fr;
    }

    .MessageInputForm,
    .message-loading {
        grid-column: 1 / 3;
    }

    .PublicTalk,
    .PrivateTalk {
        border-right: 1px solid gray;
    }

    .fold-message {
        display: none;
    }

    .MessageList {
        max-height: 650px;
        overflow-y: auto;
    }
}

@media (max-width: 939.98px) {
    .MessageInputForm {
        position: sticky;
        z-index: 5;
        top: 0;
        grid-template-columns: 1fr 1fr;
        grid-template-areas:
            'mailbox submit'
            'input input';
    }

    .message-text {
        height: 33.5px;
    }

    .BoardHeader {
        position: sticky;
        z-index: 4;
        top: 62px;
    }
}
</style>
