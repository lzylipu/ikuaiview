import { describe, expect, it } from 'vitest';
import { buildTrafficChartOption } from './charts';

describe('buildTrafficChartOption', () => {
  it('omits dataZoom when the dashboard does not register the component', () => {
    const option = buildTrafficChartOption([], false, '5M');

    expect(option).not.toHaveProperty('dataZoom');
  });

  it('includes dataZoom when the history view explicitly enables it', () => {
    const option = buildTrafficChartOption([], false, '24H', { dataZoom: true });

    expect(option).toHaveProperty('dataZoom');
  });
});
