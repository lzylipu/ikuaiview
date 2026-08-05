import { use } from 'echarts/core';
import { DataZoomComponent } from 'echarts/components';

let registered = false;

/** Registers the history-only zoom controls without inflating the dashboard chart chunk. */
export function useEChartsDataZoom(): void {
  if (registered) return;
  use([DataZoomComponent]);
  registered = true;
}
