<script setup lang="ts">
import MainNavigationLink from './MainNavigationLink.vue';
import {
    isNationNavigationEnabled,
    nationNavigation,
    type MainNavigationLink as MainNavigationLinkItem,
    type NationNavigationAccess,
} from './mainNavigation';
import { useMenuPopup } from './useMenuPopup';
import { legacyNationTextColor } from '../../utils/legacyNationColor';

const props = defineProps<{
    access: NationNavigationAccess;
    tournamentStage: number;
    nationColor: string;
}>();

const { setRoot, openId, close, toggle } = useMenuPopup();
const isActive = (link: MainNavigationLinkItem) => link.highlightStage === props.tournamentStage;
</script>

<template>
    <nav
        :ref="setRoot"
        class="main-nation-menu"
        :style="{ '--nation-menu-color': nationColor || '#000000' }"
        :class="{ 'dark-label': legacyNationTextColor(nationColor) === '#000000' }"
        aria-label="국가 메뉴"
    >
        <template v-for="entry in nationNavigation" :key="entry.id">
            <MainNavigationLink
                v-if="entry.kind === 'link'"
                :link="entry"
                :enabled="isNationNavigationEnabled(entry, access)"
                :active="isActive(entry)"
                lumen-variant="lumen"
            />
            <div v-else-if="entry.kind === 'split'" class="nation-menu-split legacy-split-button">
                <MainNavigationLink
                    :link="entry.main"
                    :enabled="isNationNavigationEnabled(entry.main, access)"
                    :active="isActive(entry.main)"
                    lumen-variant="lumen"
                />
                <button
                    class="main-menu-button nation-menu-split__toggle legacy-split-button__toggle legacy-button legacy-button--lumen"
                    type="button"
                    :data-menu-id="entry.id"
                    :aria-label="`${entry.main.label} 하위 메뉴`"
                    :aria-expanded="openId === entry.id"
                    :aria-controls="`nation-menu-${entry.id}`"
                    @click="toggle(entry.id, $event)"
                >
                    <span class="menu-caret" aria-hidden="true"></span>
                </button>
                <ul v-show="openId === entry.id" :id="`nation-menu-${entry.id}`" class="nation-menu-popup" role="menu">
                    <li v-for="item in entry.items" :key="item.id" role="none">
                        <template v-if="item.kind === 'link'">
                            <MainNavigationLink
                                :link="item"
                                :enabled="isNationNavigationEnabled(item, access)"
                                role="menuitem"
                                @navigate="close()"
                            />
                        </template>
                    </li>
                </ul>
            </div>
        </template>
    </nav>
</template>

<style scoped>
.main-nation-menu {
    position: relative;
    z-index: 29;
    display: grid;
    grid-template-columns: repeat(10, minmax(0, 1fr));
    gap: 1.6px;
    width: 100%;
    white-space: nowrap;
}

.main-nation-menu :deep(.main-menu-link),
.main-nation-menu .main-menu-button {
    --legacy-button-bg: var(--nation-menu-color);
    --legacy-button-border: color-mix(in srgb, var(--nation-menu-color) 90%, #000);
    --legacy-button-color: #fff;
    background-image: none;
}
.main-nation-menu.dark-label :deep(.main-menu-link),
.main-nation-menu.dark-label .main-menu-button {
    --legacy-button-color: #000;
}

.nation-menu-split {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28px;
    min-width: 0;
}

.nation-menu-split > :deep(.main-menu-link) {
    width: 100%;
}

.nation-menu-split__toggle {
    min-width: 28px;
    width: 28px;
    padding: 0;
}

.menu-caret {
    display: inline-block;
    border-top: 4px solid currentColor;
    border-right: 4px solid transparent;
    border-left: 4px solid transparent;
}

.nation-menu-popup {
    position: absolute;
    z-index: 120;
    top: calc(100% + 2px);
    right: 0;
    min-width: 180px;
    margin: 0;
    border: 1px solid #282828;
    border-radius: 3px;
    padding: 4px 0;
    background: #202020;
    box-shadow: 0 8px 18px rgb(0 0 0 / 45%);
    list-style: none;
}

.nation-menu-popup :deep(.main-menu-link) {
    min-height: 30px;
    justify-content: flex-start;
    border: 0;
    border-radius: 0;
    padding: 5px 16px;
    background: transparent;
}

@media (max-width: 939.98px) {
    .main-nation-menu {
        grid-template-columns: repeat(5, minmax(0, 1fr));
    }
}
</style>
