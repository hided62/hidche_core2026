<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { MessageType } from '@sammo-ts/logic';
import { DEFAULT_GENERAL_ICON_URL, resolveMessageGeneralIconUrl, useDefaultGeneralIcon } from '../../utils/generalIcon';
import { isLegacyNationColorBright } from '../../utils/legacyNationColor';

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

const props = defineProps<{
    message: MessageEntry;
    generalId: number;
    generalName: string;
    nationId: number;
    permission: number;
    canRespondDiplomacy: boolean;
    replyableGeneralIds: number[];
}>();

const emit = defineEmits<{
    (event: 'set-target', type: MessageType, target: MessageTarget): void;
    (event: 'delete', messageId: number): void;
    (event: 'respond', messageId: number, response: boolean): void;
}>();

const now = ref(Date.now());
let deleteTimer: number | null = null;

const destination = computed<MessageTarget>(
    () =>
        props.message.dest ?? {
            generalId: 0,
            generalName: '',
            nationId: 0,
            nationName: '재야',
            color: '#000000',
            icon: DEFAULT_GENERAL_ICON_URL,
        }
);

const invalid = computed(() => props.message.option?.invalid === true);
const permissionRedacted = computed(() => props.message.option?.permissionRedacted === true);
const hasAction = computed(() => typeof props.message.option?.action === 'string');
const nationDirection = computed(() => {
    if (props.message.src.nationId === destination.value.nationId) {
        return 'local';
    }
    return props.message.src.nationId === props.nationId ? 'src' : 'dest';
});

const parseMessageTime = (): number => {
    const normalized = props.message.time.includes('T')
        ? props.message.time
        : `${props.message.time.replace(' ', 'T')}Z`;
    return Date.parse(normalized);
};

const deletable = computed(() => {
    if (invalid.value || hasAction.value || props.message.src.generalId !== props.generalId) {
        return false;
    }
    if (props.message.option?.deletable === false) {
        return false;
    }
    const sentAt = parseMessageTime();
    return Number.isFinite(sentAt) && sentAt + 5 * 60 * 1000 > now.value;
});

const scheduleDeleteExpiry = () => {
    const sentAt = parseMessageTime();
    if (!Number.isFinite(sentAt)) {
        return;
    }
    const delay = sentAt + 5 * 60 * 1000 - Date.now();
    if (delay <= 0) {
        now.value = Date.now();
        return;
    }
    deleteTimer = window.setTimeout(() => {
        now.value = Date.now();
    }, delay);
};

const iconUrl = computed(() => resolveMessageGeneralIconUrl(props.message.src.icon));
const canReplyToGeneral = (target: MessageTarget): boolean => props.replyableGeneralIds.includes(target.generalId);

const targetClass = (target: MessageTarget) => ({
    'msg-target': true,
    'msg-bright': isLegacyNationColorBright(target.color),
    'msg-dark': !isLegacyNationColorBright(target.color),
});

const setTarget = (target: MessageTarget) => {
    emit('set-target', props.message.msgType, target);
};

const requestDelete = () => {
    if (!window.confirm('삭제하시겠습니까?')) {
        return;
    }
    emit('delete', props.message.id);
};

const respond = (response: boolean) => {
    if (!window.confirm(response ? '수락하시겠습니까?' : '거절하시겠습니까?')) {
        return;
    }
    emit('respond', props.message.id, response);
};

onMounted(scheduleDeleteExpiry);
onBeforeUnmount(() => {
    if (deleteTimer !== null) {
        window.clearTimeout(deleteTimer);
    }
});
</script>

<template>
    <article
        :id="`msg_${message.id}`"
        :class="[
            'msg-plate',
            `msg-plate-${message.msgType}`,
            `msg-plate-${nationDirection}`,
            { 'msg-plate-permission-redacted': permissionRedacted },
        ]"
        :data-id="message.id"
    >
        <div class="msg-icon">
            <img
                class="general-icon"
                width="64"
                height="64"
                :src="iconUrl"
                :alt="message.src.generalName"
                @error="useDefaultGeneralIcon"
            />
        </div>
        <div class="msg-body">
            <div class="msg-header">
                <button v-if="deletable" class="delete-message" type="button" @click="requestDelete">❌</button>

                <template v-if="message.msgType === 'private'">
                    <template v-if="message.src.generalId === generalId">
                        <span :class="targetClass(message.src)" :style="{ backgroundColor: message.src.color }"
                            >나</span
                        >
                        <span class="msg-from-to">▶</span>
                        <button
                            v-if="canReplyToGeneral(destination)"
                            :class="targetClass(destination)"
                            :style="{ backgroundColor: destination.color }"
                            type="button"
                            @click="setTarget(destination)"
                        >
                            {{ destination.generalName }}:{{ destination.nationName }} | ↩
                        </button>
                        <span v-else :class="targetClass(destination)" :style="{ backgroundColor: destination.color }">
                            {{ destination.generalName }}:{{ destination.nationName }}
                        </span>
                    </template>
                    <template v-else>
                        <button
                            v-if="canReplyToGeneral(message.src)"
                            :class="targetClass(message.src)"
                            :style="{ backgroundColor: message.src.color }"
                            type="button"
                            @click="setTarget(message.src)"
                        >
                            {{ message.src.generalName }}:{{ message.src.nationName }} | ↩
                        </button>
                        <span v-else :class="targetClass(message.src)" :style="{ backgroundColor: message.src.color }">
                            {{ message.src.generalName }}:{{ message.src.nationName }}
                        </span>
                        <span class="msg-from-to">▶</span>
                        <span :class="targetClass(destination)" :style="{ backgroundColor: destination.color }"
                            >나</span
                        >
                    </template>
                </template>

                <template v-else-if="message.msgType === 'national' && message.src.nationId === destination.nationId">
                    <span :class="targetClass(message.src)" :style="{ backgroundColor: message.src.color }">
                        {{ message.src.generalName }}
                    </span>
                </template>

                <template
                    v-else-if="(message.msgType === 'national' || message.msgType === 'diplomacy') && permission >= 4"
                >
                    <template v-if="message.src.nationId === nationId">
                        <span :class="targetClass(message.src)" :style="{ backgroundColor: message.src.color }">
                            {{ message.src.generalName }}
                        </span>
                        <span class="msg-from-to">▶</span>
                        <button
                            :class="targetClass(destination)"
                            :style="{ backgroundColor: destination.color }"
                            type="button"
                            @click="setTarget(destination)"
                        >
                            {{ destination.nationName }} | ↩
                        </button>
                    </template>
                    <button
                        v-else
                        :class="targetClass(message.src)"
                        :style="{ backgroundColor: message.src.color }"
                        type="button"
                        @click="setTarget(message.src)"
                    >
                        {{ message.src.generalName }}:{{ message.src.nationName }} | ↩
                    </button>
                </template>

                <template v-else-if="message.msgType === 'national' || message.msgType === 'diplomacy'">
                    <template v-if="message.src.nationId === nationId">
                        <span :class="targetClass(message.src)" :style="{ backgroundColor: message.src.color }">
                            {{ message.src.generalName }}
                        </span>
                        <span class="msg-from-to">▶</span>
                        <span :class="targetClass(destination)" :style="{ backgroundColor: destination.color }">
                            {{ destination.nationName }}
                        </span>
                    </template>
                    <span v-else :class="targetClass(message.src)" :style="{ backgroundColor: message.src.color }">
                        {{ message.src.generalName }}:{{ message.src.nationName }}
                    </span>
                </template>

                <button
                    v-else-if="message.src.generalId !== generalId && canReplyToGeneral(message.src)"
                    :class="targetClass(message.src)"
                    :style="{ backgroundColor: message.src.color }"
                    type="button"
                    @click="setTarget(message.src)"
                >
                    {{ message.src.generalName }}:{{ message.src.nationName }} | ↩
                </button>
                <span
                    v-else-if="message.src.generalId !== generalId"
                    :class="targetClass(message.src)"
                    :style="{ backgroundColor: message.src.color }"
                >
                    {{ message.src.generalName }}:{{ message.src.nationName }}
                </span>
                <span v-else :class="targetClass(message.src)" :style="{ backgroundColor: message.src.color }">
                    {{ message.src.generalName }}
                </span>

                <span class="msg-time">&lt;{{ message.time }}&gt;</span>
            </div>

            <div
                :class="[
                    'msg-content',
                    invalid ? 'msg-invalid' : permissionRedacted ? 'msg-permission-redacted' : 'msg-valid',
                ]"
            >
                <strong v-if="permissionRedacted" class="permission-redacted-label">권한 제한</strong>
                {{ invalid ? '삭제된 메시지입니다' : message.text }}
            </div>

            <div v-if="hasAction && !invalid" class="message-response">
                <button
                    class="prompt-yes legacy-button legacy-button--primary"
                    type="button"
                    :disabled="message.msgType === 'diplomacy' && !canRespondDiplomacy"
                    @click="respond(true)"
                >
                    수락
                </button>
                <button
                    class="prompt-no legacy-button legacy-button--danger"
                    type="button"
                    :disabled="message.msgType === 'diplomacy' && !canRespondDiplomacy"
                    @click="respond(false)"
                >
                    거절
                </button>
            </div>
        </div>
    </article>
</template>

<style scoped>
.msg-plate {
    display: grid;
    grid-template-columns: 64px minmax(0, 1fr);
    width: 100%;
    min-height: 64px;
    outline: 1px solid gray;
    color: #fff;
    font-size: 12.5px;
    word-break: break-all;
}

.msg-plate-private {
    background-color: #5d1e1a;
}

.msg-plate-private.msg-plate-dest {
    background-color: #5d461a;
}

.msg-plate-public {
    background-color: #141c65;
}

.msg-plate-national,
.msg-plate-diplomacy {
    background-color: #00582c;
}

.msg-plate-national.msg-plate-dest,
.msg-plate-diplomacy.msg-plate-dest {
    background-color: #704615;
}

.msg-plate-national.msg-plate-src,
.msg-plate-diplomacy.msg-plate-src {
    background-color: #70153b;
}

.msg-icon {
    width: 64px;
    height: 64px;
    border-right: 1px solid gray;
}

.general-icon {
    display: block;
    width: 64px;
    max-width: none;
    height: 64px;
    object-fit: fill;
}

.msg-body {
    min-width: 0;
    padding-left: 0;
}

.msg-header {
    position: relative;
    margin-bottom: 3px;
    color: #fff;
    font-weight: 700;
}

.msg-target {
    display: inline-block;
    margin: 2px 2px 0;
    border: 0;
    border-radius: 3px;
    padding: 2px 3px;
    box-shadow: 2px 2px #000;
    font: inherit;
    font-weight: inherit;
}

button.msg-target {
    cursor: pointer;
}

.msg-bright {
    color: #000;
}

.msg-dark {
    color: #fff;
}

.msg-from-to {
    display: inline-block;
}

.msg-time {
    font-size: 0.75em;
    font-weight: 400;
}

.delete-message {
    position: absolute;
    z-index: 1;
    top: 0;
    right: 0;
    margin: 2px 2px 0;
    border: 1px solid #ffc107;
    border-radius: 3px;
    background: transparent;
    padding: 2px 4px;
    color: #ffc107;
    font-size: 8px;
    cursor: pointer;
}

.msg-content {
    overflow: hidden;
    margin-right: 5px;
    margin-left: 10px;
    white-space: pre-wrap;
}

.msg-invalid {
    color: rgba(255, 255, 255, 0.5);
}

.msg-plate-permission-redacted {
    outline: 1px dashed #d7b86c;
    background: #3b3427;
}

.msg-plate-permission-redacted .general-icon {
    filter: grayscale(1);
    opacity: 0.55;
}

.msg-permission-redacted {
    color: rgba(255, 244, 214, 0.72);
    font-style: italic;
}

.permission-redacted-label {
    display: inline-block;
    margin-right: 6px;
    border: 1px solid #d7b86c;
    padding: 1px 4px;
    color: #ffe0a0;
    font-style: normal;
}

.message-response {
    display: flex;
    justify-content: flex-end;
    gap: 4px;
    margin-top: 5px;
    margin-right: 5px;
}

.message-response .legacy-button {
    min-width: 42px;
    padding: 2px 8px;
    font-size: 12.5px;
    cursor: pointer;
}

.message-response button:disabled {
    cursor: not-allowed;
    opacity: 0.65;
}
</style>
