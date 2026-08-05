import { describe, expect, it } from 'vitest';
import {
  formatByteCount,
  isAbortError,
  resolveTrafficTotals,
  trafficHistoryErrorMessage,
} from './trafficHistory';
import { ApiError } from '@/api';

describe('resolveTrafficTotals', () => {
  it('integrates legacy bit rates as estimated bytes using each point duration', () => {
    const totals = resolveTrafficTotals({
      interval_secs: 2,
      points: [
        {
          timestamp_ms: 1_000,
          download_bps: 8_000,
          upload_bps: 16_000,
          duration_ms: 1_000,
        },
        {
          timestamp_ms: 3_000,
          download_bps: 8_000,
          upload_bps: 4_000,
        },
      ],
    });

    expect(totals.downloadBytes).toBe(3_000n);
    expect(totals.uploadBytes).toBe(3_000n);
    expect(totals.estimated).toBe(true);
    expect(totals.complete).toBe(true);
  });

  it('infers mixed 60-second and 5-second legacy sample durations', () => {
    const totals = resolveTrafficTotals({
      interval_secs: 5,
      points: [
        { timestamp_ms: 0, download_bps: 8, upload_bps: 8 },
        { timestamp_ms: 60_000, download_bps: 16, upload_bps: 16 },
        { timestamp_ms: 120_000, download_bps: 24, upload_bps: 24 },
        { timestamp_ms: 125_000, download_bps: 32, upload_bps: 32 },
        { timestamp_ms: 130_000, download_bps: 40, upload_bps: 40 },
      ],
    });

    expect(totals.downloadBytes).toBe(240n);
    expect(totals.uploadBytes).toBe(240n);
  });

  it('caps inferred durations so collection gaps do not inflate usage', () => {
    const totals = resolveTrafficTotals({
      interval_secs: 5,
      points: [
        { timestamp_ms: 0, download_bps: 8_000, upload_bps: 0 },
        { timestamp_ms: 600_000, download_bps: 8_000, upload_bps: 0 },
      ],
    });

    expect(totals.downloadBytes).toBe(120_000n);
  });

  it('adds exact and estimated decimal-string totals without precision loss', () => {
    const totals = resolveTrafficTotals({
      points: [],
      totals: {
        exact_download_bytes: '9007199254740993',
        estimated_download_bytes: '7',
        exact_upload_bytes: '12345678901234567',
        estimated_upload_bytes: '0',
        complete: false,
        coverage_ratio: 1.25,
      },
    });

    expect(totals.downloadBytes).toBe(9_007_199_254_741_000n);
    expect(totals.uploadBytes).toBe(12_345_678_901_234_567n);
    expect(totals.exactDownloadBytes).toBe(9_007_199_254_740_993n);
    expect(totals.estimatedDownloadBytes).toBe(7n);
    expect(totals.estimated).toBe(true);
    expect(totals.complete).toBe(false);
    expect(totals.coverageRatio).toBe(1);
  });

  it('uses authoritative total fields when the backend provides them', () => {
    const totals = resolveTrafficTotals({
      interval_secs: 60,
      points: [{ timestamp_ms: 1, download_bps: 1, upload_bps: 1 }],
      totals: {
        total_download_bytes: '9007199254740993',
        total_upload_bytes: '42',
        estimated: false,
      },
    });

    expect(totals.downloadBytes).toBe(9_007_199_254_740_993n);
    expect(totals.uploadBytes).toBe(42n);
    expect(totals.estimated).toBe(false);
  });

  it('uses canonical v4 coverage durations instead of display point completeness', () => {
    const totals = resolveTrafficTotals({
      schema_version: 4,
      points: [],
      totals: {
        download_bytes: '9',
        upload_bytes: '5',
        exact_download_bytes: '8',
        exact_upload_bytes: '4',
        estimated_download_bytes: '1',
        estimated_upload_bytes: '1',
        estimated: true,
        complete: false,
        coverage_ratio: 0.9,
      },
      coverage: {
        requested_duration_ms: 1_000,
        exact_duration_ms: 800,
        estimated_duration_ms: 100,
        covered_duration_ms: 900,
        completeness: 0.9,
        gap_count: 1,
      },
    });

    expect(totals.complete).toBe(false);
    expect(totals.estimated).toBe(true);
    expect(totals.coverageRatio).toBe(0.9);
    expect(totals.exactDurationMs).toBe(800);
    expect(totals.estimatedDurationMs).toBe(100);
    expect(totals.gapCount).toBe(1);
  });

  it('rejects unsafe or fractional JSON numbers as byte counters', () => {
    const totals = resolveTrafficTotals({
      points: [{
        timestamp_ms: 1,
        download_bps: 8_000,
        upload_bps: 16_000,
        duration_ms: 1_000,
        download_bytes: (Number.MAX_SAFE_INTEGER + 1) as unknown as string,
        upload_bytes: 1.5 as unknown as string,
      }],
      totals: {
        total_download_bytes: (Number.MAX_SAFE_INTEGER + 1) as unknown as string,
        total_upload_bytes: 1.5 as unknown as string,
      },
    });

    expect(totals.downloadBytes).toBe(1_000n);
    expect(totals.uploadBytes).toBe(2_000n);
    expect(totals.estimated).toBe(true);
  });
});

describe('traffic history helpers', () => {
  it('formats large byte counts without a Number conversion', () => {
    expect(formatByteCount(0n)).toBe('0 B');
    expect(formatByteCount(1_500n)).toBe('2 KB');
    expect(formatByteCount(1_050_000_000n)).toBe('1.1 GB');
    expect(formatByteCount(9_007_199_254_740_993n)).toBe('9.0 PB');
  });

  it('recognizes browser and cross-realm abort errors', () => {
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isAbortError({ name: 'AbortError' })).toBe(true);
    expect(isAbortError(new Error('network failed'))).toBe(false);
  });

  it('localizes traffic history API failures without exposing backend messages', () => {
    const detail = {
      code: 'traffic_history_not_found',
      message: 'traffic history has not been initialized',
      fields: {},
      request_id: 'request-1',
    };

    expect(trafficHistoryErrorMessage(new ApiError(404, detail))).toBe(
      '所选范围或接口尚无流量历史数据',
    );
    expect(trafficHistoryErrorMessage(new Error('Failed to fetch'))).toBe(
      '历史数据加载失败，请稍后重试',
    );
  });
});
