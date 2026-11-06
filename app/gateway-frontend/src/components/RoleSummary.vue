<script setup lang="ts">
import { computed } from 'vue';
import { formatRoleGroups } from '../utils/roleDisplay';

const props = defineProps<{ roles: readonly string[] }>();
const groups = computed(() => formatRoleGroups(props.roles));
</script>

<template>
    <span class="role-summary" aria-label="보유 권한">
        <template v-for="(group, index) in groups" :key="index">
            <span v-if="index">, </span><span class="role-group">{{ group }}</span>
        </template>
        <template v-if="!groups.length">-</template>
    </span>
</template>

<style scoped>
.role-summary {
    white-space: normal;
    overflow-wrap: anywhere;
}
.role-group {
    white-space: normal;
    overflow-wrap: anywhere;
}
</style>
