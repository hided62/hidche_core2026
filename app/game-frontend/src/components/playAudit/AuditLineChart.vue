<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
    Chart,
    CategoryScale,
    LinearScale,
    LineController,
    LineElement,
    PointElement,
    Tooltip,
    Legend,
} from 'chart.js';

Chart.register(CategoryScale, LinearScale, LineController, LineElement, PointElement, Tooltip, Legend);
const props = defineProps<{
    title: string;
    labels: string[];
    lines: { label: string; values: (number | null)[]; color: string }[];
}>();
const canvas = ref<HTMLCanvasElement | null>(null);
let chart: Chart<'line'> | undefined;
const render = () => {
    if (!canvas.value) return;
    chart?.destroy();
    chart = new Chart(canvas.value, {
        type: 'line',
        data: {
            labels: props.labels,
            datasets: props.lines.map((line) => ({
                label: line.label,
                data: line.values,
                borderColor: line.color,
                backgroundColor: line.color,
                borderWidth: 2,
                pointRadius: 3,
                pointHitRadius: 12,
                spanGaps: false,
            })),
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { legend: { labels: { color: '#e5eee9' } } },
            scales: {
                x: { ticks: { color: '#c3d0c8', maxTicksLimit: 12 }, grid: { color: '#34473e' } },
                y: { ticks: { color: '#c3d0c8' }, grid: { color: '#34473e' } },
            },
        },
    });
};
onMounted(render);
watch(() => [props.labels, props.lines], render, { deep: true });
onBeforeUnmount(() => chart?.destroy());
</script>

<template>
    <section class="audit-chart" :aria-label="title">
        <h3>{{ title }}</h3>
        <div class="chart-canvas">
            <canvas
                ref="canvas"
                role="img"
                :aria-label="`${title}. 아래 수치 표에서 정확한 값을 확인할 수 있습니다.`"
            />
        </div>
        <p v-if="!lines.some((line) => line.values.some((value) => value !== null))">이 기간에 수집된 값이 없습니다.</p>
    </section>
</template>

<style scoped>
.audit-chart {
    min-width: 0;
    padding: 12px;
    background: #14231c;
    border: 1px solid #536b60;
    border-radius: 6px;
}
h3 {
    margin: 0 0 8px;
    font-size: var(--sammo-font-size-emphasis);
}
.chart-canvas {
    position: relative;
    height: 300px;
    min-width: 0;
}
@media (max-width: 600px) {
    .chart-canvas {
        height: 260px;
    }
}
</style>
