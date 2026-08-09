import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBroadcastTabCoordinator } from '../src/utils/broadcastTabCoordinator.ts';

type FakeMessage = { kind: string; tabId: string; sentAt: number; payload?: string };

class FakeBroadcastBus {
    readonly channels = new Set<FakeBroadcastChannel>();

    open(): FakeBroadcastChannel {
        const channel = new FakeBroadcastChannel(this);
        this.channels.add(channel);
        return channel;
    }
}

class FakeBroadcastChannel {
    onmessage: ((event: MessageEvent<FakeMessage>) => void) | null = null;
    private readonly bus: FakeBroadcastBus;

    constructor(bus: FakeBroadcastBus) {
        this.bus = bus;
    }

    postMessage(message: FakeMessage): void {
        for (const channel of this.bus.channels) {
            if (channel === this) continue;
            queueMicrotask(() => channel.onmessage?.({ data: message } as MessageEvent<FakeMessage>));
        }
    }

    close(): void {
        this.bus.channels.delete(this);
        this.onmessage = null;
    }
}

const wait = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs));

void test('one active tab owns broadcasts, followers consume its payload, and leave hands leadership over', async () => {
    const bus = new FakeBroadcastBus();
    const firstLeadership: boolean[] = [];
    const secondLeadership: boolean[] = [];
    const firstPayloads: string[] = [];
    const secondPayloads: string[] = [];
    const common = {
        createChannel: () => bus.open() as never,
        settleMs: 5,
        heartbeatMs: 100,
        peerExpiryMs: 500,
    };
    const first = createBroadcastTabCoordinator<string>('same-account', {
        ...common,
        createTabId: () => 'tab-b',
        onLeadershipChange: (leader) => firstLeadership.push(leader),
        onPayload: (payload) => firstPayloads.push(payload),
    });
    const second = createBroadcastTabCoordinator<string>('same-account', {
        ...common,
        createTabId: () => 'tab-a',
        onLeadershipChange: (leader) => secondLeadership.push(leader),
        onPayload: (payload) => secondPayloads.push(payload),
    });

    first.start();
    second.start();
    await wait(20);

    assert.equal(first.isLeader(), false);
    assert.equal(second.isLeader(), true);
    assert.equal(first.postFromLeader('ignored'), false);
    assert.equal(second.postFromLeader('shared-patch'), true);
    await wait(0);
    assert.deepEqual(firstPayloads, ['shared-patch']);
    assert.deepEqual(secondPayloads, []);

    second.stop();
    await wait(0);
    assert.equal(first.isLeader(), true);
    assert.equal(firstLeadership.at(-1), true);
    assert.deepEqual(secondLeadership, [true, false]);

    first.stop();
});
