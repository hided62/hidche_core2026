export type MessageTypeKey = 'public' | 'private' | 'national' | 'diplomacy';

export interface TurnCompletedEvent {
    type: 'turnCompleted';
    at: string;
    lastTurnTime: string;
}

export interface MessageCreatedEvent {
    type: 'messageCreated';
    at: string;
    mailbox: number;
    msgType: MessageTypeKey;
    messageId: number;
    senderId: number;
}

export type RealtimeEvent =
    | TurnCompletedEvent
    | MessageCreatedEvent;
