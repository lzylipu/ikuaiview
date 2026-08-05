import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import { useECharts } from './useECharts';

const echartsMocks = vi.hoisted(() => ({
  init: vi.fn(),
  use: vi.fn(),
}));

vi.mock('echarts/core', () => ({
  init: echartsMocks.init,
  use: echartsMocks.use,
}));
vi.mock('echarts/charts', () => ({ LineChart: {} }));
vi.mock('echarts/components', () => ({
  GridComponent: {},
  TooltipComponent: {},
}));
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }));

function chartInstance() {
  return {
    setOption: vi.fn(),
    resize: vi.fn(),
    dispose: vi.fn(),
  };
}

describe('useECharts', () => {
  beforeEach(() => {
    echartsMocks.init.mockReset();
    echartsMocks.init.mockImplementation(() => chartInstance());
  });

  it('recreates the chart for theme changes and disposes it on unmount', async () => {
    let chart: ReturnType<typeof useECharts>;
    const dark = ref(false);
    const Host = defineComponent({
      setup() {
        chart = useECharts(dark);
        return () => h('div', { ref: chart.chartRef });
      },
    });
    const wrapper = mount(Host);
    const options: EChartsCoreOption = { xAxis: {}, yAxis: {}, series: [] };

    chart!.initChart(options);
    const first = echartsMocks.init.mock.results[0].value;
    expect(echartsMocks.init).toHaveBeenCalledWith(chart!.chartRef.value, undefined);
    expect(first.setOption).toHaveBeenCalledWith(options, {
      notMerge: true,
      lazyUpdate: false,
    });

    dark.value = true;
    await nextTick();
    await flushPromises();

    const second = echartsMocks.init.mock.results[1].value;
    expect(first.dispose).toHaveBeenCalledOnce();
    expect(echartsMocks.init).toHaveBeenLastCalledWith(chart!.chartRef.value, 'dark');
    expect(second.setOption).toHaveBeenCalledWith(options, {
      notMerge: true,
      lazyUpdate: false,
    });

    wrapper.unmount();
    expect(second.dispose).toHaveBeenCalledOnce();
  });
});
