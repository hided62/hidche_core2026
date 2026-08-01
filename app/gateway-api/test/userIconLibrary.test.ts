import { describe, expect, it } from 'vitest';

import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('user icon library', () => {
    it('keeps five immutable active icons and enforces the rolling upload window', async () => {
        const users = createInMemoryUserRepository();
        const user = await users.createUser({ username: 'five-icons', password: 'password' });
        const start = new Date('2026-08-01T00:00:00.000Z');

        for (let index = 0; index < 5; index += 1) {
            const now = new Date(start.getTime() + index * DAY_MS);
            const stored = await users.addIconForWindow(
                user.id,
                `immutable-${index}.png`,
                1,
                now,
                new Date(now.getTime() - DAY_MS),
                5
            );
            expect(stored.ok).toBe(true);
            if (index === 0) {
                const blocked = await users.addIconForWindow(
                    user.id,
                    'too-soon.png',
                    1,
                    new Date(now.getTime() + DAY_MS - 1),
                    new Date(now.getTime() - 1),
                    5
                );
                expect(blocked).toEqual({ ok: false, reason: 'COOLDOWN' });
            }
        }

        const icons = await users.listIcons(user.id);
        expect(icons.map((icon) => icon.picture)).toEqual([
            'immutable-0.png',
            'immutable-1.png',
            'immutable-2.png',
            'immutable-3.png',
            'immutable-4.png',
        ]);
        const overLimit = await users.addIconForWindow(
            user.id,
            'sixth.png',
            1,
            new Date(start.getTime() + 5 * DAY_MS),
            new Date(start.getTime() + 4 * DAY_MS),
            5
        );
        expect(overLimit).toEqual({ ok: false, reason: 'LIMIT' });
    });

    it('retires without deleting the durable record and allows retirement only every seven days', async () => {
        const users = createInMemoryUserRepository();
        const user = await users.createUser({ username: 'retire-icons', password: 'password' });
        const firstAt = new Date('2026-08-01T00:00:00.000Z');
        const first = await users.addIconForWindow(
            user.id,
            'hall-of-fame.png',
            1,
            firstAt,
            new Date(firstAt.getTime() - DAY_MS),
            5
        );
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const secondAt = new Date(firstAt.getTime() + DAY_MS);
        const second = await users.addIconForWindow(
            user.id,
            'next.png',
            1,
            secondAt,
            new Date(secondAt.getTime() - DAY_MS),
            5
        );
        expect(second.ok).toBe(true);
        if (!second.ok) return;

        const retired = await users.retireIconForWindow(
            user.id,
            first.icon.id,
            secondAt,
            new Date(secondAt.getTime() - 7 * DAY_MS)
        );
        expect(retired.ok).toBe(true);
        expect(await users.listIcons(user.id)).toHaveLength(1);
        expect(await users.listIcons(user.id, true)).toContainEqual(
            expect.objectContaining({ picture: 'hall-of-fame.png', retiredAt: secondAt.toISOString() })
        );

        const blocked = await users.retireIconForWindow(
            user.id,
            second.icon.id,
            new Date(secondAt.getTime() + 7 * DAY_MS - 1),
            new Date(secondAt.getTime() - 1)
        );
        expect(blocked).toEqual({ ok: false, reason: 'COOLDOWN' });
    });
});
