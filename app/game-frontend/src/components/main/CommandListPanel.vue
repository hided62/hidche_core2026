<script setup lang="ts">
import { computed } from 'vue';
import SkeletonLines from '../ui/SkeletonLines.vue';

interface TurnCommandAvailability {
    name: string;
    status: string;
}

interface TurnCommandGroup {
    category: string;
    values: TurnCommandAvailability[];
}

interface TurnCommandTable {
    general: TurnCommandGroup[];
    nation: TurnCommandGroup[];
}

const props = defineProps<{
    commandTable: TurnCommandTable | null;
    loading: boolean;
}>();

const generalGroups = computed(() => props.commandTable?.general ?? []);
const nationGroups = computed(() => props.commandTable?.nation ?? []);

const takePreview = (group: TurnCommandGroup): TurnCommandAvailability[] => group.values.slice(0, 6);
</script>

<template>
    <div class="command-list">
        <div v-if="props.loading">
            <SkeletonLines :lines="5" />
        </div>
        <div v-else-if="!props.commandTable" class="empty">
            명령 목록을 불러오지 못했습니다.
        </div>
        <div v-else class="command-body">
            <div class="group" v-for="group in generalGroups" :key="`g-${group.category}`">
                <div class="group-title">{{ group.category }}</div>
                <div class="commands">
                    <span v-for="command in takePreview(group)" :key="command.name" class="command">
                        {{ command.name }}
                    </span>
                </div>
            </div>
            <div v-if="nationGroups.length" class="divider">국가 명령</div>
            <div class="group" v-for="group in nationGroups" :key="`n-${group.category}`">
                <div class="group-title">{{ group.category }}</div>
                <div class="commands">
                    <span v-for="command in takePreview(group)" :key="command.name" class="command">
                        {{ command.name }}
                    </span>
                </div>
            </div>
        </div>
    </div>
</template>

<style scoped>
.command-list {
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.group {
    display: flex;
    flex-direction: column;
    gap: 6px;
}

.group-title {
    font-size: 0.85rem;
    color: rgba(232, 221, 196, 0.75);
}

.commands {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
}

.command {
    padding: 2px 6px;
    border: 1px solid rgba(201, 164, 90, 0.35);
    font-size: 0.75rem;
}

.divider {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed rgba(201, 164, 90, 0.3);
    font-size: 0.8rem;
    color: rgba(232, 221, 196, 0.7);
}

.empty {
    color: rgba(232, 221, 196, 0.6);
}
</style>
