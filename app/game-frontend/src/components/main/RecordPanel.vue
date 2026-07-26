<script setup lang="ts">
defineProps<{
    title: string;
}>();
</script>

<template>
    <section class="record-panel">
        <h2 class="record-title">{{ title }}</h2>
        <div class="record-body">
            <slot />
        </div>
    </section>
</template>

<style scoped>
.record-panel {
    min-width: 0;
    color: #fff;
    font-size: 14px;
    font-weight: 400;
    line-height: 21px;
}

.record-title {
    box-sizing: border-box;
    height: 23px;
    margin: 0;
    border-top: 1px solid gray;
    border-bottom: 1px solid gray;
    background-color: #14241b;
    background-image: url('/image/game/back_green.jpg');
    color: #fff;
    font: inherit;
    text-align: center;
}

.record-body {
    padding: 0;
}
</style>
