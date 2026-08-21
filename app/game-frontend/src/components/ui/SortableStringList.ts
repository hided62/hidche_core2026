import { defineComponent, h, type PropType, type SlotsType, type VNode } from 'vue';
import VueDraggable from 'vuedraggable-es';

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
    slots: Object as SlotsType<{
        header?: () => VNode[];
        item: (props: { element: string; index: number }) => VNode[];
    }>,
    setup(props, { attrs, slots }) {
        return () =>
            h(
                VueDraggable,
                {
                    ...attrs,
                    list: props.list,
                    group: props.group,
                    itemKey: (item: string) => item,
                    tag: props.tag,
                },
                {
                    header: () => slots.header?.(),
                    item: ({ element, index }: { element: string; index: number }) =>
                        slots.item({ element, index }),
                }
            );
    },
});
