<script setup lang="ts">
import { computed } from 'vue';
import { resolveGeneralIconUrl, useDefaultGeneralIcon, type GeneralIconSource } from '../../utils/generalIcon';

const props = withDefaults(
    defineProps<{
        name: string;
        picture?: GeneralIconSource['picture'];
        imageServer?: GeneralIconSource['imageServer'];
        hideIcon?: boolean;
    }>(),
    {
        picture: null,
        imageServer: 0,
        hideIcon: false,
    }
);

const iconUrl = computed(() =>
    resolveGeneralIconUrl({
        picture: props.picture,
        imageServer: props.imageServer,
    })
);
</script>

<template>
    <span class="general-identity">
        <img
            v-if="!hideIcon && name !== '-'"
            class="general-identity-icon"
            :src="iconUrl"
            alt=""
            aria-hidden="true"
            @error="useDefaultGeneralIcon"
        />
        <span class="general-identity-name">{{ name }}</span>
    </span>
</template>

<style scoped>
.general-identity {
    display: inline-flex;
    min-width: 0;
    max-width: 100%;
    align-items: center;
    justify-content: center;
    gap: 5px;
    vertical-align: middle;
}
.general-identity-icon {
    width: var(--sammo-general-icon-size);
    height: var(--sammo-general-icon-size);
    flex: 0 0 var(--sammo-general-icon-size);
    border: 1px solid rgb(255 255 255 / 28%);
    background: #111;
    object-fit: cover;
}
.general-identity-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
</style>
