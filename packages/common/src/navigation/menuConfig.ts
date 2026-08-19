export type RuntimeNavigationAction = 'show-version';
export type RuntimeNavigationVisibility = 'always' | 'npc-enabled';
export type RuntimeNavigationHighlight = 'nation-betting' | 'vote';

export interface RuntimeNavigationLink {
    kind: 'link';
    id: string;
    label: string;
    to?: string;
    href?: string;
    action?: RuntimeNavigationAction;
    newTab?: boolean;
    showWhen?: RuntimeNavigationVisibility;
    highlightWhen?: RuntimeNavigationHighlight;
}

export interface RuntimeNavigationDivider {
    kind: 'divider';
    id: string;
}

export interface RuntimeNavigationGroup {
    kind: 'group';
    id: string;
    label: string;
    items: Array<RuntimeNavigationLink | RuntimeNavigationDivider>;
}

export interface RuntimeNavigationSplit {
    kind: 'split';
    id: string;
    main: RuntimeNavigationLink;
    items: Array<RuntimeNavigationLink | RuntimeNavigationDivider>;
}

export type RuntimeNavigationEntry = RuntimeNavigationLink | RuntimeNavigationGroup | RuntimeNavigationSplit;

export interface GatewayNavigationLink {
    id: string;
    label: string;
    href: string;
    newTab?: boolean;
}

export interface RuntimeNavigationConfig {
    version: 1;
    gateway: {
        brand: {
            label: string;
            to: string;
        };
        items: GatewayNavigationLink[];
    };
    game: {
        items: RuntimeNavigationEntry[];
    };
}
