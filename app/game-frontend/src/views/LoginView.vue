<script setup lang="ts">
import { onMounted } from 'vue';

const gatewayUrl = import.meta.env.VITE_GATEWAY_WEB_URL || '/gateway/';

onMounted(() => {
    window.location.replace(gatewayUrl);
});
</script>

<template>
    <main class="login-redirect legacy-bg0">
        <h1>로그인 화면으로 이동합니다.</h1>
        <p>자동으로 이동하지 않으면 아래 버튼을 눌러 주세요.</p>
        <a class="legacy-button" :href="gatewayUrl">통합 로그인</a>
    </main>
</template>

<style scoped>
.login-redirect {
    box-sizing: border-box;
    min-width: 500px;
    min-height: 100vh;
    padding: 40px 10px;
    text-align: center;
}

h1 {
    margin: 0 0 12px;
    font-size: 20px;
    font-weight: 400;
}

p {
    margin: 0 0 16px;
    color: #ccc;
}

a {
    text-decoration: none;
}
</style>
