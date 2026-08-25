<script setup lang="ts">
import { computed } from 'vue';
import { resolveGeneralIconUrl, useDefaultGeneralIcon, type GeneralIconSource } from '../../utils/generalIcon';
import { getNpcColor } from '../../utils/npcColor';

const props = withDefaults(
    defineProps<{
        name: string;
        picture?: GeneralIconSource['picture'];
        imageServer?: GeneralIconSource['imageServer'];
        hideIcon?: boolean;
        placeholder?: boolean;
        npcState?: number | null;
    }>(),
    {
        picture: null,
        imageServer: 0,
        hideIcon: false,
        placeholder: false,
        npcState: null,
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
    <span class="general-identity" :class="{ 'general-identity--placeholder': placeholder }">
        <img
            v-if="!hideIcon && name !== '-' && !placeholder"
            class="general-identity-icon"
            :src="iconUrl"
            alt=""
            aria-hidden="true"
            @error="useDefaultGeneralIcon"
        />
        <span
            v-else-if="!hideIcon && placeholder"
            class="general-identity-icon general-identity-icon--placeholder"
            aria-hidden="true"
        />
        <span v-if="$slots.details" class="general-identity-copy">
            <span class="general-identity-name" :title="name" :style="{ color: getNpcColor(npcState ?? 0) }">{{
                name
            }}</span>
            <span class="general-identity-details"><slot name="details" /></span>
        </span>
        <span v-else class="general-identity-name" :title="name" :style="{ color: getNpcColor(npcState ?? 0) }">{{
            name
        }}</span>
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
.general-identity-icon--placeholder {
    background:
        linear-gradient(135deg, transparent 47%, rgb(255 255 255 / 8%) 48%, rgb(255 255 255 / 8%) 52%, transparent 53%),
        #17110f;
}
.general-identity-copy {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    flex-direction: column;
    justify-content: center;
}
.general-identity-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.general-identity-details {
    min-width: 0;
}
.general-identity--placeholder {
    color: #91847e;
}
</style>
