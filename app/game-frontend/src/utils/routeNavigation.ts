import { reactive } from 'vue';
import type { Router } from 'vue-router';

export const routeNavigation = reactive({ href: '', state: 'idle' as 'idle' | 'loading' | 'slow' | 'failed' });

export const installRouteNavigation = (router: Router): void => {
    let pendingPath = '';
    let visibleTimer: ReturnType<typeof setTimeout> | undefined;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTimers = () => {
        clearTimeout(visibleTimer);
        clearTimeout(slowTimer);
    };
    router.beforeEach((to) => {
        clearTimers();
        pendingPath = to.fullPath;
        routeNavigation.href = router.resolve(to).href;
        routeNavigation.state = 'idle';
        visibleTimer = setTimeout(() => (routeNavigation.state = 'loading'), 350);
        slowTimer = setTimeout(() => (routeNavigation.state = 'slow'), 10_000);
    });
    router.afterEach((to) => {
        if (to.fullPath !== pendingPath) return;
        clearTimers();
        routeNavigation.state = 'idle';
        pendingPath = '';
    });
    router.onError((_error, to) => {
        if (to.fullPath !== pendingPath) return;
        clearTimers();
        // 실패한 dynamic import는 같은 탭에서 캐시된다. RouterLink 재클릭 대신
        // 원래 목적지의 문서를 새로 받아 모듈 캐시와 세션 초기화를 다시 시작한다.
        routeNavigation.state = 'failed';
    });
};
