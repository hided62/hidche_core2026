<script setup lang="ts"></script>

<template>
    <div class="min-h-screen flex flex-col bg-black text-gray-200">
        <!-- Header / Navigation -->
        <header class="bg-zinc-900 border-b border-zinc-800 py-2 px-4">
            <div class="max-w-6xl mx-auto flex justify-between items-center">
                <div class="flex items-center space-x-6">
                    <h1 class="text-xl font-bold text-white">삼국지 모의전투 HiDCHe</h1>
                    <nav class="hidden md:flex space-x-4 text-sm">
                        <a href="#" class="hover:text-white">공지사항</a>
                        <a href="#" class="hover:text-white">커뮤니티</a>
                        <a href="#" class="hover:text-white">건의/제안/개발</a>
                        <a href="#" class="hover:text-white">신고/문의</a>
                        <a href="#" class="hover:text-white">자주 묻는 질문</a>
                        <a href="#" class="hover:text-white">패치 내역</a>
                        <a href="#" class="hover:text-white">Git Repo.</a>
                        <a href="#" class="hover:text-white">위키</a>
                        <RouterLink to="/admin" class="hover:text-white">관리자</RouterLink>
                    </nav>
                </div>
                <div class="flex space-x-4 text-sm">
                    <a href="#" class="hover:text-white">공식 오픈 톡</a>
                    <a href="#" class="hover:text-white">잡담 오픈 톡</a>
                </div>
            </div>
        </header>

        <!-- Main Content -->
        <main class="flex-grow">
            <slot />
        </main>

        <!-- Footer -->
        <footer class="bg-zinc-900 border-t border-zinc-800 py-6 px-4 text-center text-xs text-zinc-500">
            <div class="space-x-4 mb-2">
                <a href="#" class="hover:text-zinc-300">개인정보처리방침</a>
                <a href="#" class="hover:text-zinc-300">이용약관</a>
            </div>
            <p>© 2023 • HideD</p>
            <p class="mt-1">크롬, 엣지, 파이어폭스에 최적화되어있습니다.</p>
        </footer>
    </div>
</template>
