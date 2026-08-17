<script setup lang="ts">
import { computed } from 'vue';
import MainNavigationLink from './MainNavigationLink.vue';
import {
    buildGlobalNavigation,
    isNavigationConfigured,
    type MainNavigationLink as MainNavigationLinkItem,
} from './mainNavigation';
import { useMenuPopup } from './useMenuPopup';

const props = defineProps<{
    npcMode: number;
    voteActive: boolean;
}>();

const entries = computed(() => buildGlobalNavigation(props.npcMode));
const { setRoot, openId, close, toggle } = useMenuPopup();
const isActive = (link: MainNavigationLinkItem) => link.id === 'survey' && props.voteActive;
</script>

<template>
    <nav :ref="setRoot" class="main-global-menu" aria-label="게임 공통 메뉴">
        <template v-for="entry in entries" :key="entry.id">
            <MainNavigationLink
                v-if="entry.kind === 'link'"
                :link="entry"
                :enabled="isNavigationConfigured(entry)"
                :active="isActive(entry)"
                lumen-variant="navigation"
            />
            <div v-else-if="entry.kind === 'group'" class="main-menu-popup">
                <button
                    class="main-menu-button legacy-button legacy-button--navigation"
                    type="button"
                    :data-menu-id="entry.id"
                    :aria-expanded="openId === entry.id"
                    :aria-controls="`global-menu-${entry.id}`"
                    @click="toggle(entry.id, $event)"
                >
                    {{ entry.label }}
                    <span class="menu-caret" aria-hidden="true"></span>
                </button>
                <ul
                    v-show="openId === entry.id"
                    :id="`global-menu-${entry.id}`"
                    class="main-menu-popup__list"
                    role="menu"
                >
                    <template v-for="item in entry.items" :key="item.id">
                        <li v-if="item.kind === 'divider'" class="main-menu-divider" role="separator"></li>
                        <li v-else role="none">
                            <MainNavigationLink
                                :link="item"
                                :enabled="isNavigationConfigured(item)"
                                role="menuitem"
                                @navigate="close()"
                            />
                        </li>
                    </template>
                </ul>
            </div>
            <div v-else class="main-menu-split">
                <MainNavigationLink
                    :link="entry.main"
                    :enabled="isNavigationConfigured(entry.main)"
                    :active="isActive(entry.main)"
                    lumen-variant="navigation"
                />
                <button
                    class="main-menu-button main-menu-split__toggle legacy-button legacy-button--navigation"
                    type="button"
                    :data-menu-id="entry.id"
                    :aria-label="`${entry.main.label} 하위 메뉴`"
                    :aria-expanded="openId === entry.id"
                    :aria-controls="`global-menu-${entry.id}`"
                    @click="toggle(entry.id, $event)"
                >
                    <span class="menu-caret" aria-hidden="true"></span>
                </button>
                <ul
                    v-show="openId === entry.id"
                    :id="`global-menu-${entry.id}`"
                    class="main-menu-popup__list"
                    role="menu"
                >
                    <template v-for="item in entry.items" :key="item.id">
                        <li v-if="item.kind === 'divider'" class="main-menu-divider" role="separator"></li>
                        <li v-else role="none">
                            <MainNavigationLink
                                :link="item"
                                :enabled="isNavigationConfigured(item)"
                                role="menuitem"
                                @navigate="close()"
                            />
                        </li>
                    </template>
                </ul>
            </div>
        </template>
    </nav>
</template>

<style scoped>
.main-global-menu {
    position: relative;
    z-index: 30;
    display: grid;
    grid-template-columns: repeat(8, minmax(0, 1fr));
    gap: 1.6px;
    width: 100%;
    white-space: nowrap;
}

.main-menu-popup,
.main-menu-split {
    position: relative;
    min-width: 0;
}

.main-menu-popup > .main-menu-button,
.main-menu-split > :deep(.main-menu-link) {
    width: 100%;
}

.main-menu-split {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 28px;
}

.main-menu-split__toggle {
    min-width: 28px;
    width: 28px;
    padding: 0;
    border-left-width: 0;
    border-radius: 0 5.25px 5.25px 0;
}

.main-menu-split > :deep(.main-menu-link) {
    border-radius: 5.25px 0 0 5.25px;
}

.menu-caret {
    display: inline-block;
    margin-left: 5px;
    border-top: 4px solid currentColor;
    border-right: 4px solid transparent;
    border-left: 4px solid transparent;
    vertical-align: middle;
}

.main-menu-popup__list {
    position: absolute;
    z-index: 120;
    top: calc(100% + 2px);
    left: 0;
    min-width: max(100%, 180px);
    margin: 0;
    border: 1px solid #282828;
    border-radius: 3px;
    padding: 4px 0;
    background: #202020;
    box-shadow: 0 8px 18px rgb(0 0 0 / 45%);
    list-style: none;
}

.main-global-menu[data-menu-position='bottom'] .main-menu-popup__list {
    top: auto;
    bottom: calc(100% + 2px);
    box-shadow: 0 -8px 18px rgb(0 0 0 / 45%);
}

.main-global-menu[data-menu-position='bottom'] .menu-caret {
    border-top-width: 0;
    border-bottom: 4px solid currentColor;
}

.main-menu-split .main-menu-popup__list {
    right: 0;
    left: auto;
}

.main-menu-popup__list :deep(.main-menu-link) {
    min-height: 30px;
    justify-content: flex-start;
    border: 0;
    border-radius: 0;
    padding: 5px 16px;
    background: transparent;
}

.main-menu-divider {
    height: 1px;
    margin: 4px 0;
    background: #555;
}

@media (max-width: 939.98px) {
    .main-global-menu {
        grid-template-columns: repeat(4, minmax(0, 1fr));
    }
}
</style>
