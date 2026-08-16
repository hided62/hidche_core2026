<script setup lang="ts">
import { computed } from 'vue';
import { legacyNationTextColor } from '../../utils/legacyNationColor';
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
    realtimeEnabled: boolean;
    refreshing: boolean;
}>();

const emit = defineEmits<{
    refresh: [];
    toggleRealtime: [];
    lobby: [];
    quick: [item: QuickNavigationItem];
}>();

const { setRoot, openId, close, toggle } = useMenuPopup();
const globalEntries = computed(() => buildGlobalNavigation(props.npcMode));
const nationMenuColor = computed(() => props.nationColor || '#000000');
const nationMenuTextColor = computed(() => legacyNationTextColor(nationMenuColor.value));
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
        :style="{
            '--nation-menu-color': nationMenuColor,
            '--nation-menu-text-color': nationMenuTextColor,
        }"
        aria-label="모바일 빠른 메뉴"
    >
        <div class="bottom-item">
            <button
                class="bottom-trigger legacy-button legacy-button--navigation"
                type="button"
                data-bottom-menu="global"
                :aria-expanded="openId === 'global'"
                aria-controls="mobile-global-menu"
                @click="toggle('global', $event)"
            >
                외부 메뉴
                <span class="dropup-caret" aria-hidden="true"></span>
            </button>
            <ul v-if="openId === 'global'" id="mobile-global-menu" class="bottom-popup" role="menu">
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
                class="bottom-trigger nation-trigger legacy-button legacy-button--lumen"
                :style="{
                    '--legacy-button-bg': nationMenuColor,
                    '--legacy-button-border': 'color-mix(in srgb, var(--nation-menu-color) 90%, #000)',
                    '--legacy-button-color': nationMenuTextColor,
                }"
                type="button"
                data-bottom-menu="nation"
                :aria-expanded="openId === 'nation'"
                aria-controls="mobile-nation-menu"
                @click="toggle('nation', $event)"
            >
                국가 메뉴
                <span class="dropup-caret" aria-hidden="true"></span>
            </button>
            <ul v-if="openId === 'nation'" id="mobile-nation-menu" class="bottom-popup" role="menu">
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
                class="bottom-trigger quick-trigger legacy-button legacy-button--dark"
                type="button"
                data-bottom-menu="quick"
                :aria-expanded="openId === 'quick'"
                aria-controls="mobile-quick-menu"
                @click="toggle('quick', $event)"
            >
                빠른 이동
                <span class="dropup-caret" aria-hidden="true"></span>
            </button>
            <ul v-if="openId === 'quick'" id="mobile-quick-menu" class="bottom-popup" role="menu">
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
                    <button
                        class="quick-link lobby-link legacy-button legacy-button--navigation"
                        type="button"
                        role="menuitem"
                        @click="emit('lobby')"
                    >
                        로비로
                    </button>
                </li>
            </ul>
        </div>

        <div class="bottom-refresh-controls">
            <button
                class="bottom-trigger auto-refresh-trigger legacy-button legacy-button--navigation"
                :class="{ active: realtimeEnabled }"
                type="button"
                data-bottom-menu="auto-refresh"
                :aria-pressed="realtimeEnabled"
                @click="emit('toggleRealtime')"
            >
                <span>자동 갱신</span>
                <strong>{{ realtimeEnabled ? 'ON' : 'OFF' }}</strong>
            </button>
            <button
                class="bottom-trigger manual-refresh-trigger legacy-button legacy-button--dark"
                type="button"
                data-bottom-menu="manual-refresh"
                aria-label="직접 갱신"
                title="직접 갱신"
                :disabled="refreshing"
                :aria-busy="refreshing"
                @click="emit('refresh')"
            >
                <span aria-hidden="true">↻</span>
            </button>
        </div>
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

.bottom-refresh-controls {
    display: grid;
    width: 125px;
    height: 45px;
    grid-template-columns: minmax(0, 1fr) 40px;
}

.bottom-refresh-controls > .bottom-trigger {
    width: auto;
}

.bottom-trigger {
    box-sizing: border-box;
    width: 125px;
    height: 45px;
    padding: 6px 4px;
    font-family: inherit;
    font-size: 16px;
    line-height: 1.5;
    text-align: center;
    cursor: pointer;
}

.auto-refresh-trigger {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2px 1px;
    font-size: 12px;
    line-height: 1.15;
}

.auto-refresh-trigger strong {
    color: #bbb;
    font-size: 11px;
    line-height: 1;
}

.auto-refresh-trigger.active strong {
    color: #9ef0b8;
}

.manual-refresh-trigger {
    padding: 0;
    font-size: 22px;
    line-height: 1;
}

.manual-refresh-trigger:disabled {
    cursor: wait;
    filter: grayscale(0.6);
    opacity: 0.55;
}

.bottom-trigger.legacy-button:not(:disabled, [aria-disabled='true']):hover,
.bottom-trigger.legacy-button:not(:disabled, [aria-disabled='true'])[aria-expanded='true'] {
    height: 44px;
}

.bottom-trigger.legacy-button:not(:disabled, [aria-disabled='true']):active {
    height: 43px;
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
    padding: 5px 16px;
    font-family: inherit;
    font-size: 16px;
    line-height: 1.5;
    text-align: left;
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
}

.quick-link:not(.legacy-button) {
    border: 0;
    border-radius: 0;
    background: transparent;
    color: #fff;
}

.bottom-popup :deep(.main-menu-link:hover),
.bottom-popup :deep(.main-menu-link:focus-visible),
.quick-link:not(.legacy-button):hover,
.quick-link:not(.legacy-button):focus-visible {
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
    width: auto;
    height: 40px;
    min-height: 40px;
    justify-content: center;
    margin-right: auto;
    margin-left: auto;
    border-radius: 6px;
    padding: 6px 12px;
}

.lobby-link:hover {
    height: 39px;
    min-height: 39px;
}

.lobby-link:active {
    height: 38px;
    min-height: 38px;
}

@media (max-width: 939.98px) {
    .main-mobile-bottom {
        display: grid;
    }
}
</style>
