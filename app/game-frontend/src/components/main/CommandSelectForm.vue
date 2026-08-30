<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import SkeletonLines from '../ui/SkeletonLines.vue';

type CommandAvailability = {
    key: string;
    name: string;
    turnDurationText?: string;
    costText?: string;
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
    allowBlocked?: boolean;
}>();

const emit = defineEmits<{
    (event: 'select', commandKey: string): void;
    (event: 'update:activeCategory', category: string): void;
}>();

const nationCategoryOrder = ['휴식', '인사', '외교', '특수', '전략', '기타'] as const;
const effectiveScope = computed(() => {
    if (props.commandTable?.general.length === 0 && props.commandTable.nation.length > 0) return 'nation';
    if (props.commandTable?.nation.length === 0 && props.commandTable.general.length > 0) return 'general';
    return props.scope ?? 'all';
});
const scopedGroups = computed(() => {
    if (!props.commandTable) return { general: [] as CommandGroup[], nation: [] as CommandGroup[] };
    const nationCommands = props.commandTable.nation.flatMap((group) =>
        group.values.map((command) => ({ category: group.category === '국가' ? '특수' : group.category, command }))
    );
    const nation = nationCategoryOrder.map((category) => ({
        category,
        values: nationCommands.filter((entry) => entry.category === category).map((entry) => entry.command),
    }));
    return { general: props.commandTable.general, nation };
});

const categories = computed(() => {
    if (!props.commandTable) {
        return [] as Array<{ id: string; label: string; category: string; groupType: 'general' | 'nation' }>;
    }
    const general = scopedGroups.value.general.map((group) => ({
        id: `general:${group.category}`,
        label: group.category,
        category: group.category,
        groupType: 'general' as const,
    }));
    const nation = scopedGroups.value.nation.map((group) => ({
        id: `nation:${group.category}`,
        label: effectiveScope.value === 'nation' ? group.category : `국가:${group.category}`,
        category: group.category,
        groupType: 'nation' as const,
    }));
    if (effectiveScope.value === 'general') return general;
    if (effectiveScope.value === 'nation') return nation;
    return [...general, ...nation];
});

const selectedCategory = ref(props.activeCategory ?? '');
const selectedGroup = computed(() => {
    if (!props.commandTable) {
        return null;
    }
    const [scope, ...categoryParts] = selectedCategory.value.split(':');
    const category = categoryParts.join(':');
    return (
        scopedGroups.value[scope === 'nation' ? 'nation' : 'general'].find((group) => group.category === category) ??
        null
    );
});

watch(
    () => props.activeCategory,
    (value) => {
        selectedCategory.value = value ?? '';
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

watch(
    selectedCategory,
    (value) => {
        if (value) {
            emit('update:activeCategory', value);
        }
    },
    { immediate: true }
);

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
                    :class="[
                        'category-btn',
                        'legacy-button',
                        'legacy-button--lumen',
                        { active: selectedCategory === category.id },
                    ]"
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
                        'legacy-button',
                        'legacy-button--lumen',
                        command.status === 'available' ? 'ok' : '',
                        command.status === 'blocked' ? 'blocked' : '',
                        command.status === 'blocked' && props.allowBlocked ? 'reservable' : '',
                    ]"
                    :disabled="!props.allowBlocked && !command.possible"
                    :title="commandTitle(command)"
                    @click="emit('select', command.key)"
                >
                    <span class="command-name">{{ command.name }}</span>
                    <small v-if="command.turnDurationText" class="command-duration">
                        /{{ command.turnDurationText }}
                    </small>
                    <small v-if="command.costText" class="command-cost">{{ command.costText }}</small>
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
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0;
}

.category-btn.legacy-button--lumen {
    --legacy-button-bg: #173d27;
    --legacy-button-border: #153723;
    --legacy-button-color: #fff;
    min-height: 0;
    padding-inline: 4px;
    font-size: 12px;
}

.category-btn.legacy-button--lumen.active {
    --legacy-button-bg: #28633f;
    --legacy-button-border: #245939;
    --legacy-button-color: #ffe38a;
}

.command-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
}

.command-item.legacy-button--lumen {
    --legacy-button-bg: #302016 var(--sammo-texture-walnut);
    --legacy-button-border: #2b1d14;
    --legacy-button-color: #fff;
    min-height: 0;
    padding-inline: 5px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    font-size: 12px;
}

.command-item.ok {
    color: #d9f7df;
}

.command-item.blocked {
    color: #888;
    opacity: 0.72;
    cursor: not-allowed;
}

.command-item.blocked.reservable {
    color: #d8ccb1;
    opacity: 1;
    cursor: pointer;
}

.command-item.blocked .command-name {
    color: #e74c3c;
    text-decoration-line: line-through;
    text-decoration-color: #e74c3c;
}

.command-name {
    font-weight: 600;
}

.command-duration {
    display: block;
    font-size: 0.875em;
    font-weight: 400;
    line-height: 1.1;
    white-space: nowrap;
}

.command-cost {
    display: block;
    color: #f3d58b;
    font-size: 0.875em;
    font-weight: 400;
    line-height: 1.1;
    overflow-wrap: anywhere;
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
