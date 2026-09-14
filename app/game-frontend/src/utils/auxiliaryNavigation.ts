import { gameFrontendRuntimeConfig } from '../config/runtimeConfig';

// 이름은 앱이 직접 연 탭에만 부여한다. URL/sessionStorage 표식은 링크 복사나
// 브라우저의 새 탭 열기에도 전달될 수 있으므로 닫기 권한 판정에 사용하지 않는다.
const auxiliaryWindowPrefix = 'sammo-auxiliary:';

export const isAuxiliaryWindow = (): boolean => window.name.startsWith(auxiliaryWindowPrefix);

export const installAuxiliaryNavigation = (): void => {
    document.addEventListener(
        'click',
        (event: MouseEvent) => {
            if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.ctrlKey ||
                event.metaKey ||
                event.shiftKey ||
                event.altKey
            )
                return;
            const link = event.target instanceof Element ? event.target.closest('a') : null;
            if (!link || link.target !== '_blank' || link.hasAttribute('download')) return;
            const url = new URL(link.href, window.location.href);
            const basePath = gameFrontendRuntimeConfig.appBasePath;
            if (url.origin !== window.location.origin || !url.pathname.startsWith(basePath)) return;

            event.preventDefault();
            const child = window.open('about:blank', '_blank');
            if (!child) {
                // 팝업 차단 시 현재 탭에서 열어 돌아가기 동작을 제공한다.
                window.location.assign(url.href);
                return;
            }
            child.name = `${auxiliaryWindowPrefix}${crypto.randomUUID()}`;
            child.opener = null;
            // 새 문서 소유의 링크로 이동해야 원본 링크의 referrer 정책도 적용된다.
            const destination = child.document.createElement('a');
            destination.href = url.href;
            destination.rel = link.rel;
            destination.referrerPolicy = link.referrerPolicy;
            child.document.body.append(destination);
            destination.click();
        },
        true
    );
};
