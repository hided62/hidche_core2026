<script setup lang="ts">
import type { RuntimeNavigationConfig } from '@sammo-ts/common/navigation/menuConfig';
import { onMounted, ref } from 'vue';
import defaultNavigationJson from '../../../../resources/navigation.json';

const menuOpen = ref(false);
const appBase = import.meta.env.BASE_URL;
const defaultNavigation = defaultNavigationJson as RuntimeNavigationConfig;
const navigation = ref(defaultNavigation.gateway);
const navigationUrl = (import.meta.env.VITE_GATEWAY_API_URL ?? '/api/trpc').replace(/\/trpc\/?$/u, '/navigation');

onMounted(() => {
    void fetch(navigationUrl, { headers: { Accept: 'application/json' } })
        .then(async (response) => {
            if (!response.ok) throw new Error(`메뉴 설정 조회 실패: HTTP ${response.status}`);
            return (await response.json()) as RuntimeNavigationConfig;
        })
        .then((config) => {
            navigation.value = config.gateway;
        })
        .catch((error: unknown) => {
            console.warn('운영 메뉴 설정을 불러오지 못해 기본 메뉴를 사용합니다.', error);
        });
});
</script>

<template>
    <div class="gateway-layout">
        <header class="gateway-navbar">
            <div class="navbar-inner">
                <RouterLink class="navbar-brand" :to="navigation.brand.to">{{ navigation.brand.label }}</RouterLink>
                <button
                    class="navbar-toggler"
                    type="button"
                    :aria-expanded="menuOpen"
                    aria-controls="gateway-navigation"
                    aria-label="메뉴 열기"
                    @click="menuOpen = !menuOpen"
                >
                    <span></span><span></span><span></span>
                </button>
                <nav id="gateway-navigation" :class="{ open: menuOpen }">
                    <a
                        v-for="item in navigation.items"
                        :key="item.id"
                        :href="item.href"
                        :target="item.newTab ? '_blank' : undefined"
                        :rel="item.newTab ? 'noopener noreferrer' : undefined"
                        :data-navigation-id="item.id"
                    >
                        {{ item.label }}
                    </a>
                </nav>
            </div>
        </header>

        <main>
            <slot />
        </main>

        <footer>
            <p>
                <a :href="`${appBase}terms.2.html`">개인정보처리방침</a>
                &amp;
                <a :href="`${appBase}terms.1.html`">이용약관</a>
            </p>
            <p>© 2023 • HideD</p>
            <p>크롬, 엣지, 파이어폭스에 최적화되어있습니다.</p>
        </footer>
    </div>
</template>

<style scoped>
.gateway-layout {
    display: flex;
    min-height: 100vh;
    flex-direction: column;
    background: #000;
    color: #fff;
}

.gateway-layout > main {
    flex: 1;
}

.gateway-navbar {
    position: fixed;
    z-index: 100;
    top: 0;
    right: 0;
    left: 0;
    box-sizing: border-box;
    height: 76px;
    border: 0;
    padding: 16px 0;
    background: #303030;
}

.navbar-inner {
    display: flex;
    width: 100%;
    align-items: center;
    padding: 0 1px;
}

.navbar-brand {
    margin-right: 16px;
    padding: 5px 0;
    color: #fff;
    font-size: 20px;
    line-height: 30px;
    text-decoration: none;
    white-space: nowrap;
}

nav {
    display: flex;
    flex-grow: 1;
    align-items: center;
    gap: 0;
}

nav a {
    padding: 8px;
    color: rgb(255 255 255 / 60%);
    font-size: 16px;
    line-height: 24px;
    text-decoration: none;
}

nav a:hover,
nav a:focus {
    color: #fff;
}

.navbar-toggler {
    display: none;
    width: 56px;
    height: 40px;
    margin-left: auto;
    border: 1px solid rgb(255 255 255 / 10%);
    border-radius: 4px;
    background: transparent;
    padding: 4px 12px;
}

.navbar-toggler span {
    display: block;
    height: 2px;
    margin: 5px 0;
    background: rgb(255 255 255 / 55%);
}

footer {
    border-top: 1px solid #303030;
    background: #171719;
    padding: 24px 16px;
    color: #666;
    font-size: 12px;
    text-align: center;
}

footer p {
    margin: 2px 0;
}

footer a {
    color: #666;
}

@media (max-width: 991.98px) {
    .navbar-inner {
        padding: 0 1px;
    }

    .navbar-toggler {
        display: block;
    }

    nav {
        position: absolute;
        top: 56px;
        right: 1px;
        left: 1px;
        display: none;
        width: auto;
        flex-direction: column;
        align-items: flex-start;
        gap: 0;
        padding: 0;
        background: #303030;
    }

    nav.open {
        display: flex;
    }

    nav a {
        width: 100%;
        padding: 8px 0;
        font-size: 16px;
        line-height: 24px;
    }
}
</style>
