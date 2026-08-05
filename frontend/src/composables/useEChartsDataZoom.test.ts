import { describe, expect, it, vi } from 'vitest';
import { useEChartsDataZoom } from './useEChartsDataZoom';

const echartsMocks = vi.hoisted(() => ({
  use: vi.fn(),
  dataZoom: {},
}));

vi.mock('echarts/core', () => ({ use: echartsMocks.use }));
vi.mock('echarts/components', () => ({ DataZoomComponent: echartsMocks.dataZoom }));

describe('useEChartsDataZoom', () => {
  it('registers the history-only component once', () => {
    useEChartsDataZoom();
    useEChartsDataZoom();

    expect(echartsMocks.use).toHaveBeenCalledOnce();
    expect(echartsMocks.use).toHaveBeenCalledWith([echartsMocks.dataZoom]);
  });
});
