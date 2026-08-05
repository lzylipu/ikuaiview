import {
  ApiError,
  type TrafficHistoryPoint,
  type TrafficHistoryResponse,
} from '@/api';

export interface ResolvedTrafficTotals {
  downloadBytes: bigint;
  uploadBytes: bigint;
  exactDownloadBytes: bigint | null;
  exactUploadBytes: bigint | null;
  estimatedDownloadBytes: bigint | null;
  estimatedUploadBytes: bigint | null;
  estimated: boolean;
  complete: boolean;
  coverageRatio: number | null;
  requestedDurationMs: number | null;
  exactDurationMs: number | null;
  estimatedDurationMs: number | null;
  coveredDurationMs: number | null;
  gapCount: number | null;
}

const MAX_INFERRED_LEGACY_DURATION_MS = 60_000;

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function byteCount(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value >= 0n ? value : null;
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0
      ? BigInt(value)
      : null;
  }
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return BigInt(value.trim());
  }
  return null;
}

function pointBytes(
  point: TrafficHistoryPoint,
  direction: 'download' | 'upload',
  legacyDurationSecs: number,
): { bytes: bigint; estimated: boolean } {
  const explicit = byteCount(point[`${direction}_bytes`]);
  if (explicit !== null) {
    return { bytes: explicit, estimated: point.estimated === true };
  }

  const bps = finiteNumber(point[`${direction}_bps`]) ?? 0;
  const durationMs = finiteNumber(point.duration_ms);
  const durationSecs = durationMs !== null
    ? Math.max(0, durationMs) / 1_000
    : legacyDurationSecs;

  const derivedBytes = Math.max(0, bps) * durationSecs / 8;
  return {
    bytes: Number.isFinite(derivedBytes) ? BigInt(Math.round(derivedBytes)) : 0n,
    estimated: true,
  };
}

function inferLegacyDurationSecs(
  points: TrafficHistoryPoint[],
  index: number,
  fallbackIntervalSecs: number,
): number {
  const timestamp = finiteNumber(points[index]?.timestamp_ms);
  const nextTimestamp = finiteNumber(points[index + 1]?.timestamp_ms);
  const previousTimestamp = finiteNumber(points[index - 1]?.timestamp_ms);
  const nextDelta = timestamp !== null && nextTimestamp !== null
    ? nextTimestamp - timestamp
    : null;
  const previousDelta = timestamp !== null && previousTimestamp !== null
    ? timestamp - previousTimestamp
    : null;
  const adjacentDelta = nextDelta !== null && nextDelta > 0
    ? nextDelta
    : previousDelta !== null && previousDelta > 0
      ? previousDelta
      : null;
  const fallbackMs = Math.max(0, fallbackIntervalSecs) * 1_000;
  const durationMs = adjacentDelta ?? fallbackMs;

  // A missing sample is a coverage gap, not permission to bill the last rate
  // across the whole gap. Legacy data is stored at either 5 s or 60 s cadence.
  return Math.min(durationMs, MAX_INFERRED_LEGACY_DURATION_MS) / 1_000;
}

interface DirectionTotals {
  total: bigint;
  exact: bigint | null;
  estimated: bigint | null;
  inferredEstimated: boolean;
}

function resolveDirection(
  response: TrafficHistoryResponse,
  direction: 'download' | 'upload',
  fallbackIntervalSecs: number,
): DirectionTotals {
  const totals = response.totals;
  const direct = byteCount(
    totals?.[`total_${direction}_bytes`] ?? totals?.[`${direction}_bytes`],
  );
  const exact = byteCount(totals?.[`exact_${direction}_bytes`]);
  const estimated = byteCount(totals?.[`estimated_${direction}_bytes`]);
  const hasBreakdown = exact !== null || estimated !== null;

  if (direct !== null || hasBreakdown) {
    return {
      total: direct ?? (exact ?? 0n) + (estimated ?? 0n),
      exact,
      estimated,
      inferredEstimated: (estimated ?? 0n) > 0n,
    };
  }

  let total = 0n;
  let anyEstimated = false;
  for (const [index, point] of response.points.entries()) {
    const durationSecs = inferLegacyDurationSecs(
      response.points,
      index,
      fallbackIntervalSecs,
    );
    const resolved = pointBytes(point, direction, durationSecs);
    total += resolved.bytes;
    if (resolved.estimated) {
      anyEstimated = true;
    }
  }

  return {
    total,
    exact: null,
    estimated: null,
    inferredEstimated: anyEstimated,
  };
}

export function resolveTrafficTotals(
  response: TrafficHistoryResponse,
): ResolvedTrafficTotals {
  const totals = response.totals;
  const intervalSecs = Math.max(0, finiteNumber(response.interval_secs) ?? 0);
  const download = resolveDirection(response, 'download', intervalSecs);
  const upload = resolveDirection(response, 'upload', intervalSecs);
  const pointEstimated = response.points.some((point) => point.estimated === true);
  const pointIncomplete = response.points.some((point) => point.complete === false);
  const coverage = response.coverage;
  const rawCoverage = finiteNumber(coverage?.completeness ?? totals?.coverage_ratio);
  const requestedDurationMs = finiteNumber(coverage?.requested_duration_ms);
  const coveredDurationMs = finiteNumber(coverage?.covered_duration_ms);
  const exactDurationMs = finiteNumber(coverage?.exact_duration_ms);
  const estimatedDurationMs = finiteNumber(coverage?.estimated_duration_ms);
  const gapCount = finiteNumber(coverage?.gap_count);

  return {
    downloadBytes: download.total,
    uploadBytes: upload.total,
    exactDownloadBytes: download.exact,
    exactUploadBytes: upload.exact,
    estimatedDownloadBytes: download.estimated,
    estimatedUploadBytes: upload.estimated,
    estimated: totals?.estimated
      ?? ((estimatedDurationMs ?? 0) > 0
        || pointEstimated
        || download.inferredEstimated
        || upload.inferredEstimated),
    complete: coverage === undefined
      ? totals?.complete ?? !pointIncomplete
      : requestedDurationMs !== null
        && coveredDurationMs !== null
        && coveredDurationMs === requestedDurationMs,
    coverageRatio: rawCoverage === null
      ? null
      : Math.max(0, Math.min(1, rawCoverage)),
    requestedDurationMs,
    exactDurationMs,
    estimatedDurationMs,
    coveredDurationMs,
    gapCount,
  };
}

/** Format an integer byte count without converting it through Number. */
export function formatByteCount(bytes: bigint): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const negative = bytes < 0n;
  const absolute = negative ? -bytes : bytes;
  let unitIndex = 0;
  let divisor = 1n;
  while (unitIndex < units.length - 1 && absolute >= divisor * 1_000n) {
    divisor *= 1_000n;
    unitIndex++;
  }

  if (unitIndex === 0) return `${bytes.toString()} B`;
  const decimals = unitIndex >= 3 ? 1 : 0;
  const precision = decimals === 1 ? 10n : 1n;
  const rounded = (absolute * precision + divisor / 2n) / divisor;
  const whole = rounded / precision;
  const fraction = rounded % precision;
  const sign = negative ? '-' : '';
  const value = decimals === 0
    ? `${sign}${whole.toString()}`
    : `${sign}${whole.toString()}.${fraction.toString()}`;
  return `${value} ${units[unitIndex]}`;
}

export function isAbortError(error: unknown): boolean {
  return (typeof DOMException !== 'undefined'
      && error instanceof DOMException
      && error.name === 'AbortError')
    || (typeof error === 'object'
      && error !== null
      && 'name' in error
      && error.name === 'AbortError');
}

export function trafficHistoryErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.detail.code === 'traffic_history_not_found') {
      return '所选范围或接口尚无流量历史数据';
    }
    if (error.status === 429 || error.detail.code === 'rate_limited') {
      return '历史数据查询繁忙，请稍后重试';
    }
  }
  return '历史数据加载失败，请稍后重试';
}
