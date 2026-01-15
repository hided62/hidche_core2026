<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import DefaultLayout from '../layouts/DefaultLayout.vue';
import { trpc } from '../utils/trpc';

const router = useRouter();
const username = ref('');
const password = ref('');

onMounted(async () => {
    try {
        const me = await trpc.me.query();
        if (me) {
            await router.push('/lobby');
        }
    } catch (e) {
        // Not logged in or error
    }
});

const handleLogin = async () => {
    try {
        // TODO: Implement login mutation
        // const result = await trpc.auth.login.mutation({ username: username.value, password: password.value });
        // if (result.success) router.push('/lobby');
        console.log('Login attempt:', username.value);
    } catch (e) {
        alert('로그인 실패');
    }
};

const handleJoin = () => {
    console.log('Join attempt');
};
</script>

<template>
    <DefaultLayout>
        <div class="max-w-4xl mx-auto py-12 px-4 flex flex-col items-center space-y-12">
            <!-- Logo / Title -->
            <div class="text-center">
                <h2 class="text-4xl font-serif font-bold text-white tracking-widest">삼국지 모의전투 HiDCHe</h2>
            </div>

            <!-- Login Box -->
            <div class="w-full max-w-md bg-zinc-800 border border-zinc-700 rounded shadow-2xl overflow-hidden">
                <div class="bg-zinc-700 px-6 py-2 text-center font-bold text-white border-b border-zinc-600">
                    로그인
                </div>
                <div class="p-6 space-y-4">
                    <div class="flex items-center space-x-4">
                        <label class="w-20 text-sm font-medium">계정명</label>
                        <input
                            v-model="username"
                            type="text"
                            class="flex-grow bg-zinc-900 border border-zinc-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
                            placeholder="계정명"
                        />
                    </div>
                    <div class="flex items-center space-x-4">
                        <label class="w-20 text-sm font-medium">비밀번호</label>
                        <input
                            v-model="password"
                            type="password"
                            class="flex-grow bg-zinc-900 border border-zinc-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-blue-500"
                            placeholder="비밀번호"
                        />
                    </div>
                    <div class="flex space-x-2 pt-2">
                        <button
                            class="flex-1 bg-yellow-600 hover:bg-yellow-500 text-black font-bold py-2 rounded transition-colors flex items-center justify-center space-x-2"
                            @click="handleJoin"
                        >
                            <span>가입 & 로그인</span>
                        </button>
                        <button
                            class="flex-[2] bg-blue-700 hover:bg-blue-600 text-white font-bold py-2 rounded transition-colors"
                            @click="handleLogin"
                        >
                            로그인
                        </button>
                    </div>
                </div>
            </div>

            <!-- Server Status Placeholder -->
            <div class="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden shadow-xl">
                <div class="bg-zinc-800 px-4 py-2 border-b border-zinc-700 flex justify-between items-center">
                    <span class="font-bold text-sm">체 현황</span>
                    <span class="text-xs text-zinc-400">西紀 197年 7月 秋</span>
                </div>
                <div class="aspect-video bg-zinc-950 relative flex items-center justify-center">
                    <!-- Map Placeholder -->
                    <div class="text-zinc-700 text-lg italic">지도 이미지 및 현황 데이터 영역</div>

                    <!-- Example of a city dot if we wanted to mock it -->
                    <div class="absolute bottom-4 right-4 text-[10px] text-blue-400">도시명 표기 끄기</div>
                </div>
                <div class="p-4 bg-black text-xs space-y-1 font-mono">
                    <div class="flex items-start space-x-2">
                        <span class="text-blue-400">◆</span>
                        <span
                            >197년 7월: [대회] 황제 수장의 명으로 전력전 대회가 개최됩니다! 천하의 영웅들을 모집하고
                            있습니다!</span
                        >
                    </div>
                    <div class="flex items-start space-x-2">
                        <span class="text-cyan-400">●</span>
                        <span>197년 7월: [재난] 탐라 호토에 메뚜기 떼가 발생하여 도시가 황폐해지고 있습니다.</span>
                    </div>
                    <div class="flex items-start space-x-2">
                        <span class="text-green-400">●</span>
                        <span>197년 7월: [자금] 가을이 되어 봉록에 따라 군량이 지급됩니다.</span>
                    </div>
                    <div class="flex items-start space-x-2">
                        <span class="text-red-400">●</span>
                        <span>197년 4월: [재난] 남피, 무안에 홍수로 인해 피해가 급증하고 있습니다.</span>
                    </div>
                    <!-- ... more logs ... -->
                    <div class="text-zinc-600 pt-2 italic text-center">최근 진행 상황 로그 (Placeholder)</div>
                </div>
            </div>
        </div>
    </DefaultLayout>
</template>

<style scoped>
/* Custom styles for the home view */
</style>
