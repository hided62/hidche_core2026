<script setup lang="ts">
import { ref } from 'vue';

const menuOpen = ref(false);
</script>

<template>
    <div class="gateway-layout">
        <header class="gateway-navbar">
            <div class="navbar-inner">
                <RouterLink class="navbar-brand" to="/">삼국지 모의전투 HiDCHe</RouterLink>
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
                    <a href="/bbs/board" target="_blank" rel="noreferrer">삼모게시판</a>
                    <a href="/bbs/tip" target="_blank" rel="noreferrer">팁/강좌</a>
                    <a href="/bbs/news" target="_blank" rel="noreferrer">삼국 일보</a>
                    <a href="/bbs/history2" target="_blank" rel="noreferrer">개인 열전</a>
                    <a href="/bbs/history3" target="_blank" rel="noreferrer">국가 열전</a>
                    <a href="/bbs/patch" target="_blank" rel="noreferrer">패치 내역</a>
                </nav>
            </div>
        </header>

        <main>
            <slot />
        </main>

        <footer>
            <p>
                <a href="./terms.2.html">개인정보처리방침</a>
                &amp;
                <a href="./terms.1.html">이용약관</a>
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
    min-height: 56px;
    border-bottom: 1px solid #222;
    background: #303030;
}

.navbar-inner {
    display: flex;
    min-height: 56px;
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
    align-items: center;
    gap: 16px;
}

nav a {
    color: rgb(255 255 255 / 55%);
    font-size: 14px;
    text-decoration: none;
}

nav a:hover,
nav a:focus {
    color: #fff;
}

.navbar-toggler {
    display: none;
    width: 56px;
    height: 42px;
    margin-left: auto;
    border: 1px solid rgb(255 255 255 / 15%);
    border-radius: 6px;
    background: transparent;
    padding: 8px 12px;
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

@media (max-width: 759px) {
    .navbar-inner {
        flex-wrap: wrap;
        padding: 8px 1px;
    }

    .navbar-toggler {
        display: block;
    }

    nav {
        display: none;
        width: 100%;
        flex-direction: column;
        align-items: flex-start;
        gap: 0;
        padding: 8px 12px;
    }

    nav.open {
        display: flex;
    }

    nav a {
        width: 100%;
        padding: 7px 0;
    }
}
</style>
