import {
  init,
  use,
  type EChartsCoreOption,
  type EChartsType,
} from 'echarts/core';
import { LineChart } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import {
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type Ref,
} from 'vue';

use([
  LineChart,
  GridComponent,
  TooltipComponent,
  CanvasRenderer,
]);

/** Owns one chart instance and its resize/theme lifecycle. */
export function useECharts(darkMode: Ref<boolean>) {
  const chartRef = ref<HTMLDivElement | null>(null);
  let instance: EChartsType | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let latestOptions: EChartsCoreOption | null = null;

  function ensureInstance(): EChartsType | null {
    if (!chartRef.value) return null;
    if (!instance) {
      instance = init(chartRef.value, darkMode.value ? 'dark' : undefined);
    }
    return instance;
  }

  function initChart(options: EChartsCoreOption) {
    latestOptions = options;
    ensureInstance()?.setOption(options, { notMerge: true, lazyUpdate: false });
  }

  function updateOption(options: EChartsCoreOption, notMerge = false) {
    latestOptions = options;
    ensureInstance()?.setOption(options, { notMerge, lazyUpdate: true });
  }

  function resize() {
    instance?.resize();
  }

  function disposeInstance() {
    instance?.dispose();
    instance = null;
  }

  function dispose() {
    resizeObserver?.disconnect();
    resizeObserver = null;
    disposeInstance();
    latestOptions = null;
  }

  watch(darkMode, async () => {
    await nextTick();
    disposeInstance();
    if (latestOptions) initChart(latestOptions);
  });

  onMounted(() => {
    if (!chartRef.value) return;
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(chartRef.value);
    if (latestOptions) initChart(latestOptions);
  });

  onUnmounted(dispose);

  return {
    chartRef,
    initChart,
    updateOption,
    resize,
    dispose,
    hasInstance: () => instance !== null,
    getInstance: () => instance,
  };
}
