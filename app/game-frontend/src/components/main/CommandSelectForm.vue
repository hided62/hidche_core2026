<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import SkeletonLines from '../ui/SkeletonLines.vue';

type CommandAvailability = {
    key: string;
    name: string;
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
}>();

const emit = defineEmits<{
    (event: 'select', commandKey: string): void;
    (event: 'update:activeCategory', category: string): void;
}>();

const categories = computed(() => {
    if (!props.commandTable) {
        return [] as Array<{ label: string; category: string; groupType: 'general' | 'nation' }>;
    }
    const general = props.commandTable.general.map((group) => ({
        label: group.category,
        category: group.category,
        groupType: 'general' as const,
    }));
    const nation = props.commandTable.nation.map((group) => ({
        label: `국가:${group.category}`,
        category: group.category,
        groupType: 'nation' as const,
    }));
    return [...general, ...nation];
});

const selectedCategory = ref('');
const selectedGroup = computed(() => {
    if (!props.commandTable) {
        return null;
    }
    const base = props.commandTable.general.find((group) => group.category === selectedCategory.value);
    if (base) {
        return base;
    }
    return props.commandTable.nation.find((group) => group.category === selectedCategory.value) ?? null;
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
        if (!list.some((item) => item.category === selectedCategory.value)) {
            selectedCategory.value = list[0].category;
        }
    },
    { immediate: true }
);

watch(selectedCategory, (value) => {
    if (value) {
        emit('update:activeCategory', value);
    }
});

const statusLabel = (command: CommandAvailability) => {
    if (command.status === 'available') {
        return '가능';
    }
    if (command.status === 'needsInput') {
        return '입력 필요';
    }
    if (command.status === 'blocked') {
        return '불가';
    }
    return '확인 필요';
};
</script>

<template>
    <div class="command-form">
        <div v-if="props.loading">
            <SkeletonLines :lines="4" />
        </div>
        <div v-else-if="!props.commandTable" class="empty">
            명령 목록을 불러오지 못했습니다.
        </div>
        <div v-else>
            <div class="category-list">
                <button
                    v-for="category in categories"
                    :key="category.label"
                    :class="['category-btn', { active: selectedCategory === category.category }]"
                    @click="selectedCategory = category.category"
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
                    @click="emit('select', command.key)"
                >
                    <span class="command-name">{{ command.name }}</span>
                    <span class="command-status">{{ statusLabel(command) }}</span>
                </button>
            </div>
        </div>
    </div>
</template>

<style scoped>
.command-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.category-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(90px, 1fr));
    gap: 6px;
}

.category-btn {
    border: 1px solid rgba(201, 164, 90, 0.4);
    padding: 6px 8px;
    font-size: 0.75rem;
    cursor: pointer;
}

.category-btn.active {
    background: rgba(201, 164, 90, 0.2);
}

.command-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 6px;
}

.command-item {
    border: 1px solid rgba(201, 164, 90, 0.3);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    text-align: left;
    font-size: 0.75rem;
    cursor: pointer;
}

.command-item.ok {
    border-color: rgba(201, 164, 90, 0.6);
}

.command-item.blocked {
    opacity: 0.5;
    cursor: not-allowed;
}

.command-name {
    font-weight: 600;
}

.command-status {
    font-size: 0.7rem;
    color: rgba(232, 221, 196, 0.6);
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
