<script setup lang="ts">
import { computed } from 'vue';
import MainNavigationLink from './MainNavigationLink.vue';
import {
    buildGlobalNavigation,
    isNationNavigationEnabled,
    isNavigationConfigured,
    nationNavigation,
    quickNavigation,
    type MainNavigationLink as MainNavigationLinkItem,
    type NationNavigationAccess,
    type QuickNavigationItem,
} from './mainNavigation';
import { useMenuPopup } from './useMenuPopup';

const props = defineProps<{
    access: NationNavigationAccess;
    tournamentStage: number;
    nationColor: string;
    npcMode: number;
}>();

const emit = defineEmits<{
    refresh: [];
    lobby: [];
    quick: [item: QuickNavigationItem];
}>();

const { setRoot, openId, close, toggle } = useMenuPopup();
const globalEntries = computed(() => buildGlobalNavigation(props.npcMode));
const isActive = (link: MainNavigationLinkItem) => link.highlightStage === props.tournamentStage;

const onQuick = (item: QuickNavigationItem) => {
    close();
    emit('quick', item);
};
</script>

<template>
    <nav
        :ref="setRoot"
        class="main-mobile-bottom"
        :style="{ '--nation-menu-color': nationColor || '#000000' }"
        aria-label="모바일 빠른 메뉴"
    >
        <div class="bottom-item">
            <button
                class="bottom-trigger"
                type="button"
                data-bottom-menu="global"
                :aria-expanded="openId === 'global'"
                aria-controls="mobile-global-menu"
                @click="toggle('global', $event)"
            >
                외부 메뉴
                <span class="dropup-caret" aria-hidden="true"></span>
            </button>
            <ul v-show="openId === 'global'" id="mobile-global-menu" class="bottom-popup" role="menu">
                <template v-for="entry in globalEntries" :key="entry.id">
                    <li v-if="entry.kind === 'link'" role="none">
                        <MainNavigationLink
                            :link="entry"
                            :enabled="isNavigationConfigured(entry)"
                            compact
                            role="menuitem"
                            @navigate="close()"
                        />
                    </li>
                    <template v-else-if="entry.kind === 'group'">
                        <li class="bottom-heading" role="presentation">
                            {{ entry.label }}
                        </li>
                        <template v-for="item in entry.items" :key="item.id">
                            <li v-if="item.kind === 'divider'" class="bottom-divider" role="separator"></li>
                            <li v-else role="none">
                                <MainNavigationLink
                                    :link="item"
                                    :enabled="isNavigationConfigured(item)"
                                    compact
                                    role="menuitem"
                                    @navigate="close()"
                                />
                            </li>
                        </template>
                    </template>
                    <template v-else-if="entry.kind === 'split'">
                        <li role="none">
                            <MainNavigationLink
                                :link="entry.main"
                                :enabled="isNavigationConfigured(entry.main)"
                                compact
                                role="menuitem"
                                @navigate="close()"
                            />
                        </li>
                        <template v-for="item in entry.items" :key="item.id">
                            <li v-if="item.kind === 'divider'" class="bottom-divider" role="separator"></li>
                            <li v-else role="none">
                                <MainNavigationLink
                                    :link="item"
                                    :enabled="isNavigationConfigured(item)"
                                    compact
                                    role="menuitem"
                                    @navigate="close()"
                                />
                            </li>
                        </template>
                    </template>
                </template>
            </ul>
        </div>

        <div class="bottom-item nation-bottom-item">
            <button
                class="bottom-trigger nation-trigger"
                type="button"
                data-bottom-menu="nation"
                :aria-expanded="openId === 'nation'"
                aria-controls="mobile-nation-menu"
                @click="toggle('nation', $event)"
            >
                국가 메뉴
                <span class="dropup-caret" aria-hidden="true"></span>
            </button>
            <ul v-show="openId === 'nation'" id="mobile-nation-menu" class="bottom-popup" role="menu">
                <template v-for="entry in nationNavigation" :key="entry.id">
                    <li v-if="entry.kind === 'link'" role="none">
                        <MainNavigationLink
                            :link="entry"
                            :enabled="isNationNavigationEnabled(entry, access)"
                            :active="isActive(entry)"
                            compact
                            role="menuitem"
                            @navigate="close()"
                        />
                    </li>
                    <template v-else-if="entry.kind === 'split'">
                        <li v-for="item in entry.items" :key="item.id" role="none">
                            <template v-if="item.kind === 'link'">
                                <MainNavigationLink
                                    :link="item"
                                    :enabled="isNationNavigationEnabled(item, access)"
                                    compact
                                    role="menuitem"
                                    @navigate="close()"
                                />
                            </template>
                        </li>
                    </template>
                </template>
            </ul>
        </div>

        <div class="bottom-item">
            <button
                class="bottom-trigger quick-trigger"
                type="button"
                data-bottom-menu="quick"
                :aria-expanded="openId === 'quick'"
                aria-controls="mobile-quick-menu"
                @click="toggle('quick', $event)"
            >
                빠른 이동
                <span class="dropup-caret" aria-hidden="true"></span>
            </button>
            <ul v-show="openId === 'quick'" id="mobile-quick-menu" class="bottom-popup" role="menu">
                <template v-for="item in quickNavigation" :key="item.id">
                    <template v-if="'kind' in item">
                        <li class="bottom-heading" role="presentation">{{ item.label }}</li>
                        <li class="bottom-divider" role="separator"></li>
                    </template>
                    <li v-else role="none">
                        <button
                            class="quick-link"
                            type="button"
                            role="menuitem"
                            :data-quick-id="item.id"
                            @click="onQuick(item)"
                        >
                            {{ item.label }}
                        </button>
                    </li>
                </template>
                <li class="bottom-lobby" role="none">
                    <button class="quick-link lobby-link" type="button" role="menuitem" @click="emit('lobby')">
                        로비로
                    </button>
                </li>
            </ul>
        </div>

        <button
            class="bottom-trigger refresh-trigger"
            type="button"
            data-bottom-menu="refresh"
            @click="emit('refresh')"
        >
            갱신
        </button>
    </nav>
</template>

<style scoped>
.main-mobile-bottom {
    position: fixed;
    z-index: 99;
    bottom: 0;
    left: 50%;
    display: none;
    width: 500px;
    max-width: 100vw;
    height: 45px;
    grid-template-columns: repeat(4, 125px);
    transform: translateX(-50%);
    border-top: 1px solid #111;
    background: #202020;
    box-shadow: 0 -1px 0 #212529;
}

.bottom-item {
    position: relative;
}

.bottom-trigger {
    box-sizing: border-box;
    width: 125px;
    height: 45px;
    border: 1px solid #1f1712;
    padding: 6px 4px;
    background: #302016 var(--sammo-texture-walnut);
    color: #fff;
    font-family: inherit;
    font-size: 16px;
    line-height: 1.5;
    text-align: center;
    cursor: pointer;
}

.nation-trigger {
    border-color: color-mix(in srgb, var(--nation-menu-color) 85%, #000);
    background: var(--nation-menu-color);
}

.quick-trigger {
    background: #212529;
}

.bottom-trigger:hover,
.bottom-trigger:focus-visible,
.bottom-trigger[aria-expanded='true'] {
    filter: brightness(1.14);
}

.bottom-trigger:active {
    filter: brightness(0.82);
}

.dropup-caret {
    display: inline-block;
    margin-left: 4px;
    border-right: 4px solid transparent;
    border-bottom: 4px solid currentColor;
    border-left: 4px solid transparent;
    vertical-align: middle;
}

.bottom-popup {
    position: absolute;
    z-index: 120;
    bottom: 47px;
    left: 0;
    columns: 3;
    width: max-content;
    min-width: 375px;
    max-width: 500px;
    max-height: calc(100vh - 50px);
    margin: 0;
    border: 1px solid #282828;
    border-radius: 3px;
    padding: 4px 0;
    overflow-y: auto;
    background: #202020;
    box-shadow: 0 -8px 18px rgb(0 0 0 / 45%);
    list-style: none;
}

.nation-bottom-item .bottom-popup {
    left: -125px;
}

.bottom-item:nth-child(3) .bottom-popup {
    right: -125px;
    left: auto;
}

.bottom-popup li {
    break-inside: avoid;
    min-width: 125px;
    font-size: 16px;
}

.bottom-popup :deep(.main-menu-link),
.quick-link {
    box-sizing: border-box;
    display: flex;
    width: 100%;
    min-height: 34px;
    align-items: center;
    justify-content: flex-start;
    border: 0;
    border-radius: 0;
    padding: 5px 16px;
    background: transparent;
    color: #fff;
    font-family: inherit;
    font-size: 16px;
    line-height: 1.5;
    text-align: left;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
}

.bottom-popup :deep(.main-menu-link:hover),
.bottom-popup :deep(.main-menu-link:focus-visible),
.quick-link:hover,
.quick-link:focus-visible {
    background: #353535;
}

.bottom-heading {
    padding: 5px 16px;
    color: #888;
    white-space: nowrap;
}

.bottom-divider {
    height: 1px;
    margin: 4px 0;
    background: #555;
}

.bottom-lobby {
    margin-top: 4px;
}

.lobby-link {
    justify-content: center;
    background: #302016 var(--sammo-texture-walnut);
}

@media (max-width: 939.98px) {
    .main-mobile-bottom {
        display: grid;
    }
}
</style>
