import { describe, expect, it } from 'vitest';

import { createInMemoryUserRepository } from '../src/auth/inMemoryUserRepository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('user icon library', () => {
    it('allows uploads without a cooldown while keeping five immutable active icons', async () => {
        const users = createInMemoryUserRepository();
        const user = await users.createUser({ username: 'five-icons', password: 'password' });
        const start = new Date('2026-08-01T00:00:00.000Z');

        for (let index = 0; index < 5; index += 1) {
            const now = new Date(start.getTime() + index);
            const stored = await users.addIconForWindow(user.id, `immutable-${index}.png`, 1, now, 5);
            expect(stored.ok).toBe(true);
        }

        const icons = await users.listIcons(user.id);
        expect(icons.map((icon) => icon.picture)).toEqual([
            'immutable-0.png',
            'immutable-1.png',
            'immutable-2.png',
            'immutable-3.png',
            'immutable-4.png',
        ]);
        const overLimit = await users.addIconForWindow(user.id, 'sixth.png', 1, new Date(start.getTime() + 5), 5);
        expect(overLimit).toEqual({ ok: false, reason: 'LIMIT' });
    });

    it('retires without deleting the durable record and allows one retirement per rolling 24 hours', async () => {
        const users = createInMemoryUserRepository();
        const user = await users.createUser({ username: 'retire-icons', password: 'password' });
        const firstAt = new Date('2026-08-01T00:00:00.000Z');
        const first = await users.addIconForWindow(user.id, 'hall-of-fame.png', 1, firstAt, 5);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const secondAt = new Date(firstAt.getTime() + 1);
        const second = await users.addIconForWindow(user.id, 'next.png', 1, secondAt, 5);
        expect(second.ok).toBe(true);
        if (!second.ok) return;

        const retired = await users.retireIconForWindow(
            user.id,
            first.icon.id,
            secondAt,
            new Date(secondAt.getTime() - DAY_MS)
        );
        expect(retired.ok).toBe(true);
        expect(await users.listIcons(user.id)).toHaveLength(1);
        expect(await users.listIcons(user.id, true)).toContainEqual(
            expect.objectContaining({ picture: 'hall-of-fame.png', retiredAt: secondAt.toISOString() })
        );

        const blocked = await users.retireIconForWindow(
            user.id,
            second.icon.id,
            new Date(secondAt.getTime() + DAY_MS - 1),
            new Date(secondAt.getTime() - 1)
        );
        expect(blocked).toEqual({ ok: false, reason: 'COOLDOWN' });
        const allowedAt = new Date(secondAt.getTime() + DAY_MS);
        await expect(
            users.retireIconForWindow(user.id, second.icon.id, allowedAt, new Date(allowedAt.getTime() - DAY_MS))
        ).resolves.toMatchObject({ ok: true });
    });
});
