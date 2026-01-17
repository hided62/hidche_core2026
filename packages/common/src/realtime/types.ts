import type { TurnRunResult } from '../turnDaemon/types.js';

export type MessageTypeKey = 'public' | 'private' | 'national' | 'diplomacy';

export type RealtimeEvent =
    | {
          type: 'turnCompleted';
          at: string;
          result: TurnRunResult;
      }
    | {
          type: 'messageCreated';
          at: string;
          mailbox: number;
          msgType: MessageTypeKey;
          messageId: number;
          senderId: number;
      };
