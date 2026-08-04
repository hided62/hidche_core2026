<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import SkeletonLines from '../ui/SkeletonLines.vue';

type CommandAvailability = {
    key: string;
    name: string;
    reqArg: boolean;
    status: 'available' | 'blocked' | 'needsInput' | 'unknown';
    possible: boolean;
    reason?: string;
};

type CommandGroup = {
    category: string;
    values: CommandAvailability[];
};

type CommandTable = {
    general: CommandGroup[];
    nation: CommandGroup[];
};

const props = defineProps<{
    commandTable: CommandTable | null;
    loading: boolean;
    activeCategory?: string;
    scope?: 'all' | 'general' | 'nation';
}>();

const emit = defineEmits<{
    (event: 'select', commandKey: string): void;
    (event: 'update:activeCategory', category: string): void;
}>();

const categories = computed(() => {
    if (!props.commandTable) {
        return [] as Array<{ id: string; label: string; category: string; groupType: 'general' | 'nation' }>;
    }
    const general = props.commandTable.general.map((group) => ({
        id: `general:${group.category}`,
        label: group.category,
        category: group.category,
        groupType: 'general' as const,
    }));
    const nation = props.commandTable.nation.map((group) => ({
        id: `nation:${group.category}`,
        label: `국가:${group.category}`,
        category: group.category,
        groupType: 'nation' as const,
    }));
    if (props.scope === 'general') return general;
    if (props.scope === 'nation') {
        return nation.map((entry) => ({ ...entry, label: entry.category === '국가' ? '기타' : entry.category }));
    }
    return [...general, ...nation];
});

const selectedCategory = ref('');
const selectedGroup = computed(() => {
    if (!props.commandTable) {
        return null;
    }
    const [scope, ...categoryParts] = selectedCategory.value.split(':');
    const category = categoryParts.join(':');
    return (
        props.commandTable[scope === 'nation' ? 'nation' : 'general'].find((group) => group.category === category) ??
        null
    );
});

watch(
    () => props.activeCategory,
    (value) => {
        if (value) {
            selectedCategory.value = value;
        }
    }
);

watch(
    categories,
    (list) => {
        if (!list.length) {
            selectedCategory.value = '';
            return;
        }
        if (!list.some((item) => item.id === selectedCategory.value)) {
            selectedCategory.value = list[0].id;
        }
    },
    { immediate: true }
);

watch(selectedCategory, (value) => {
    if (value) {
        emit('update:activeCategory', value);
    }
});

const commandTitle = (command: CommandAvailability) =>
    command.reason || (command.reqArg ? '대상을 선택하는 명령입니다.' : command.possible ? '실행 가능' : '실행 불가');
</script>

<template>
    <div class="command-form">
        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.commandTable" class="empty">명령 목록을 불러오지 못했습니다.</div>
        <div v-else>
            <div class="category-list">
                <button
                    v-for="category in categories"
                    :key="category.id"
                    :class="['category-btn', { active: selectedCategory === category.id }]"
                    @click="selectedCategory = category.id"
                >
                    {{ category.label }}
                </button>
            </div>
            <div v-if="!selectedGroup" class="empty">명령이 없습니다.</div>
            <div v-else class="command-grid">
                <button
                    v-for="command in selectedGroup.values"
                    :key="command.key"
                    :class="[
                        'command-item',
                        command.status === 'available' ? 'ok' : '',
                        command.status === 'blocked' ? 'blocked' : '',
                    ]"
                    :disabled="!command.possible"
                    :title="commandTitle(command)"
                    @click="emit('select', command.key)"
                >
                    <span class="command-name">{{ command.name }}</span>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.command-form {
    display: flex;
    flex-direction: column;
    gap: 0;
    border-top: 1px solid #666;
    border-left: 1px solid #666;
}

.category-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
}

.category-btn {
    min-height: 24px;
    border: 0;
    border-right: 1px solid #666;
    border-bottom: 1px solid #666;
    padding: 2px 4px;
    background: #173d27;
    color: #fff;
    font-size: 12px;
    cursor: pointer;
}

.category-btn.active {
    background: #28633f;
    color: #ffe38a;
}

.command-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
}

.command-item {
    min-height: 24px;
    border: 0;
    border-right: 1px solid #666;
    border-bottom: 1px solid #666;
    padding: 2px 5px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #302016 var(--sammo-texture-walnut);
    color: #fff;
    text-align: center;
    font-size: 12px;
    cursor: pointer;
}

.command-item.ok {
    color: #d9f7df;
}

.command-item.blocked {
    color: #888;
    opacity: 0.72;
    cursor: not-allowed;
}

.command-name {
    font-weight: 600;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
