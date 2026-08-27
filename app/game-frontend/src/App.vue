<script setup lang="ts">
import { RouterView } from 'vue-router';
import GameServerConnectionNotice from './components/ui/GameServerConnectionNotice.vue';
import GameFeedbackLayer from './components/ui/GameFeedbackLayer.vue';
import { useDeploymentVersionNotice } from './composables/useDeploymentVersionNotice';

useDeploymentVersionNotice();
</script>

<template>
    <RouterView />
    <GameServerConnectionNotice />
    <GameFeedbackLayer />
</template>

<style>
/* Global styles can live in assets/main.css */
</style>
