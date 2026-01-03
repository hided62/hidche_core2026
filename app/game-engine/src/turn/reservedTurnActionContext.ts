import type {
    ActionContextBase,
    ActionContextBuilder,
    ActionContextOptions,
    ActionResolveContext,
} from '@sammo-ts/logic';

export type ActionContextBuilderMap = Map<string, ActionContextBuilder>;

// 커맨드 모듈에서 제공한 컨텍스트 빌더로 확장한다.
export const buildActionContext = (
    key: string,
    base: ActionContextBase,
    options: ActionContextOptions,
    builders?: ActionContextBuilderMap
): ActionResolveContext | null => {
    const builder = builders?.get(key);
    return builder ? builder(base, options) : base;
};
