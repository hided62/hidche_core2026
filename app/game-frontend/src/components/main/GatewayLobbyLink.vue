<script setup lang="ts">
import { gameFrontendRuntimeConfig } from '../../config/runtimeConfig';

const handleClick = (event: MouseEvent): void => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
        return;
    }

    event.preventDefault();
    window.location.replace(gameFrontendRuntimeConfig.gatewayWebUrl);
};
</script>

<template>
    <a :href="gameFrontendRuntimeConfig.gatewayWebUrl" @click="handleClick"><slot>로비로</slot></a>
</template>
