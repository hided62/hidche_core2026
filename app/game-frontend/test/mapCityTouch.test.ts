import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { useMapCityTouch } from '../src/composables/useMapCityTouch.ts';

const point = (x: number, y = 0, identifier = 1) => ({ clientX: x, clientY: y, identifier }) as Touch;
const touchList = (touches: Touch[]): TouchList =>
    Object.assign(touches, { item: (index: number) => touches[index] ?? null });
const event = (touches: Touch[], changedTouches = touches) =>
    Object.assign(new Event('touchend', { cancelable: true }), {
        touches: touchList(touches),
        changedTouches: touchList(changedTouches),
    }) as TouchEvent;

void describe('map city touch gestures', () => {
    void it('accepts small movement and consumes the synthetic click only once', () => {
        let taps = 0;
        const touch = useMapCityTouch(
            () => {
                taps += 1;
            },
            () => undefined
        );
        touch.touchstart(event([point(0)]));
        touch.touchmove(event([point(4, 2)]));
        const end = event([], [point(4, 2)]);
        touch.touchend(end);
        touch.touchend(end);
        assert.equal(taps, 1);
        assert.equal(end.defaultPrevented, true);
    });
    void it('rejects a drag even if the finger returns to its starting point', () => {
        let taps = 0;
        const touch = useMapCityTouch(
            () => {
                taps += 1;
            },
            () => undefined
        );
        touch.touchstart(event([point(0)]));
        touch.touchmove(event([point(20)]));
        touch.touchmove(event([point(0)]));
        touch.touchend(event([], [point(0)]));
        assert.equal(taps, 0);
    });
    void it('checks the final coordinates even without a touchmove event', () => {
        let taps = 0;
        const touch = useMapCityTouch(
            () => {
                taps += 1;
            },
            () => undefined
        );
        touch.touchstart(event([point(0)]));
        touch.touchend(event([], [point(30)]));
        assert.equal(taps, 0);
    });
    void it('cancels pinch and interrupted gestures but permits a new tap', () => {
        let taps = 0;
        const touch = useMapCityTouch(
            () => {
                taps += 1;
            },
            () => undefined
        );
        touch.touchstart(event([point(0)]));
        touch.touchstart(event([point(0), point(10, 0, 2)]));
        touch.touchend(event([], [point(0)]));
        touch.touchstart(event([point(0)]));
        touch.touchcancel();
        touch.touchend(event([], [point(0)]));
        assert.equal(taps, 0);
        touch.touchstart(event([point(0)]));
        touch.touchend(event([], [point(0)]));
        assert.equal(taps, 1);
    });
});
