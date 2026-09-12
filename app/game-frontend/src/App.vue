<script setup lang="ts">
import { useClockDisplayRefresh } from './composables/useClockDisplayRefresh';
import { RouterView } from 'vue-router';
import GameServerConnectionNotice from './components/ui/GameServerConnectionNotice.vue';
import GameFeedbackLayer from './components/ui/GameFeedbackLayer.vue';
import GameNavigationNotice from './components/ui/GameNavigationNotice.vue';
import { useDeploymentVersionNotice } from './composables/useDeploymentVersionNotice';

useDeploymentVersionNotice();
useClockDisplayRefresh();
</script>

<template>
    <RouterView />
    <GameServerConnectionNotice />
    <GameFeedbackLayer />
    <GameNavigationNotice />
</template>

<style>
/* Global styles can live in assets/main.css */
</style>
