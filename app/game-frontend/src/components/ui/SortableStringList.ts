import { cloneVNode, computed, defineComponent, h, ref, type PropType, type SlotsType, type VNode } from 'vue';
import { useDraggable, type DraggableEvent, type UseDraggableOptions } from 'vue-draggable-plus';

const SORTABLE_ITEM_ATTRIBUTE = 'data-sortable-string-list-item';

// SortableJS allows only one active drag, so this preserves the exact string across grouped lists.
let activeStringDrag: { value: string } | null = null;

const restoreItem = (event: DraggableEvent<string>) => {
    if (event.oldIndex === undefined) return;
    event.item.remove();
    event.from.insertBefore(event.item, event.from.children[event.oldIndex] ?? null);
};

const moveItem = (list: string[], from: number, to: number): string[] => {
    if (from === to) return list;
    const next = [...list];
    const [item] = next.splice(from, 1);
    if (item === undefined) return list;
    next.splice(to, 0, item);
    return next;
};

export default defineComponent({
    name: 'SortableStringList',
    inheritAttrs: false,
    props: {
        list: {
            type: Array as PropType<string[]>,
            required: true,
        },
        group: {
            type: String,
            default: undefined,
        },
        tag: {
            type: String,
            default: 'div',
        },
    },
    emits: {
        'update:list': (list: string[]) => Array.isArray(list),
    },
    slots: Object as SlotsType<{
        header?: () => VNode[];
        item: (props: { element: string; index: number }) => VNode[];
    }>,
    setup(props, { attrs, emit, slots }) {
        const root = ref<HTMLElement | null>(null);
        let initialChildren: ChildNode[] | null = null;

        const options = computed<UseDraggableOptions<string>>(() => ({
            group: props.group,
            draggable: `[${SORTABLE_ITEM_ATTRIBUTE}]`,
            dataIdAttr: SORTABLE_ITEM_ATTRIBUTE,
            onStart: (event) => {
                initialChildren = Array.from(event.from.childNodes);
                if (event.oldDraggableIndex === undefined) {
                    activeStringDrag = null;
                    return;
                }
                const value = props.list[event.oldDraggableIndex];
                activeStringDrag = value === undefined ? null : { value };
            },
            onUpdate: (event) => {
                restoreItem(event);
                if (event.oldDraggableIndex === undefined || event.newDraggableIndex === undefined) return;
                emit('update:list', moveItem(props.list, event.oldDraggableIndex, event.newDraggableIndex));
            },
            onRemove: (event) => {
                restoreItem(event);
                if (event.pullMode === 'clone') {
                    event.clone.remove();
                    return;
                }
                if (event.oldDraggableIndex === undefined) return;
                const next = [...props.list];
                next.splice(event.oldDraggableIndex, 1);
                emit('update:list', next);
            },
            onAdd: (event) => {
                event.item.remove();
                if (event.newDraggableIndex === undefined) return;
                const value = activeStringDrag?.value ?? event.item.getAttribute(SORTABLE_ITEM_ATTRIBUTE);
                if (value === null) return;
                const next = [...props.list];
                next.splice(event.newDraggableIndex, 0, value);
                emit('update:list', next);
            },
            onEnd: (event) => {
                if (event.from === event.to && event.oldIndex === event.newIndex && initialChildren) {
                    for (const child of initialChildren) event.from.append(child);
                }
                initialChildren = null;
                activeStringDrag = null;
            },
        }));

        useDraggable(root, options);

        return () => {
            const header = slots.header?.() ?? [];
            const items = props.list.flatMap((element, index) =>
                slots.item({ element, index }).map((node) =>
                    cloneVNode(node, {
                        key: element,
                        [SORTABLE_ITEM_ATTRIBUTE]: element,
                    })
                )
            );
            return h(props.tag, { ...attrs, ref: root }, [...header, ...items]);
        };
    },
});
