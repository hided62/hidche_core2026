// 도시의 작은 터치 영역에서도 손떨림은 탭으로, 스크롤·핀치는 취소로 처리한다.
export const useMapCityTouch = (onTap: (event: TouchEvent) => void, onCancel: () => void) => {
    const tapSlop = 10;
    let start: { id: number; x: number; y: number } | null = null;

    const touchcancel = () => {
        start = null;
        onCancel();
    };
    const touchstart = (event: TouchEvent) => {
        const touch = event.touches[0];
        if (event.touches.length !== 1 || !touch) {
            touchcancel();
            return;
        }
        start = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
    };
    const touchmove = (event: TouchEvent) => {
        const touch = Array.from(event.touches).find((item) => item.identifier === start?.id);
        if (
            !start ||
            event.touches.length !== 1 ||
            !touch ||
            Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > tapSlop
        ) {
            touchcancel();
        }
    };
    const touchend = (event: TouchEvent) => {
        const touch = Array.from(event.changedTouches).find((item) => item.identifier === start?.id);
        const tapped =
            start &&
            touch &&
            event.touches.length === 0 &&
            Math.hypot(touch.clientX - start.x, touch.clientY - start.y) <= tapSlop;
        start = null;
        // 브라우저의 합성 click 유무에 기대지 않고 유효한 탭만 한 번 활성화한다.
        if (event.cancelable) event.preventDefault();
        if (tapped) {
            event.stopPropagation();
            onTap(event);
        } else {
            onCancel();
        }
    };
    return { touchstart, touchmove, touchend, touchcancel };
};
