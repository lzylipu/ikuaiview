const API_BASE = '/api';
const DEFAULT_TIMEOUT_MS = 15_000;
const CSRF_COOKIE = '__Host-ikuaiview_csrf';

export const API_UNAUTHORIZED_EVENT = 'ikuaiview:unauthorized';

type JsonRecord = Record<string, unknown>;
type Parser<T> = (value: unknown, path: string) => T;

export interface ApiErrorDetail {
  code: string;
  message: string;
  fields: Record<string, unknown>;
  request_id: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly detail: ApiErrorDetail;

  constructor(status: number, detail: ApiErrorDetail) {
    super(detail.message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
  }
}

export class ApiSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiSchemaError';
  }
}

interface ApiRequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  timeoutMs?: number;
  invalidateSessionOnUnauthorized?: boolean;
}

function schemaError(path: string, expected: string): never {
  throw new ApiSchemaError(`Invalid API response at ${path}: expected ${expected}`);
}

function asRecord(value: unknown, path = 'response'): JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return schemaError(path, 'object');
  }
  return value as JsonRecord;
}

function asString(value: unknown, path: string): string {
  return typeof value === 'string' ? value : schemaError(path, 'string');
}

function asBoolean(value: unknown, path: string): boolean {
  return typeof value === 'boolean' ? value : schemaError(path, 'boolean');
}

function asNumber(value: unknown, path: string): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : schemaError(path, 'finite number');
}

function asInteger(value: unknown, path: string): number {
  const number = asNumber(value, path);
  return Number.isSafeInteger(number) ? number : schemaError(path, 'safe integer');
}

function asNullableString(value: unknown, path: string): string | null {
  return value === null ? null : asString(value, path);
}

function optional<T>(
  record: JsonRecord,
  key: string,
  parser: (value: unknown, path: string) => T,
): T | undefined {
  return record[key] === undefined ? undefined : parser(record[key], `response.${key}`);
}

function arrayOf<T>(value: unknown, path: string, parser: Parser<T>): T[] {
  if (!Array.isArray(value)) return schemaError(path, 'array');
  return value.map((item, index) => parser(item, `${path}[${index}]`));
}

function readAlias<T>(
  record: JsonRecord,
  canonical: string,
  legacy: string,
  parser: (value: unknown, path: string) => T,
): T {
  const key = record[canonical] !== undefined ? canonical : legacy;
  return parser(record[key], `response.${key}`);
}

function parseErrorDetail(value: unknown): ApiErrorDetail | null {
  try {
    const envelope = asRecord(value);
    const error = asRecord(envelope.error, 'response.error');
    const fields = error.fields === undefined
      ? {}
      : asRecord(error.fields, 'response.error.fields');
    return {
      code: asString(error.code, 'response.error.code'),
      message: asString(error.message, 'response.error.message'),
      fields,
      request_id: asString(error.request_id, 'response.error.request_id'),
    };
  } catch {
    return null;
  }
}

function csrfTokenFromCookie(): string | null {
  if (typeof document === 'undefined') return null;
  for (const rawPart of document.cookie.split(';')) {
    const part = rawPart.trimStart();
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator) !== CSRF_COOKIE) continue;
    return part.slice(separator + 1);
  }
  return null;
}

function isMutation(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method);
}

function emitUnauthorized(detail: ApiErrorDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(API_UNAUTHORIZED_EVENT, { detail }));
}

async function apiRequest<T>(
  path: string,
  parser: Parser<T>,
  options: ApiRequestOptions = {},
): Promise<T> {
  const {
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    invalidateSessionOnUnauthorized = true,
    signal: callerSignal,
    headers: initialHeaders,
    ...fetchOptions
  } = options;
  const method = (fetchOptions.method ?? 'GET').toUpperCase();
  const headers = new Headers(initialHeaders);
  const csrf = isMutation(method) ? csrfTokenFromCookie() : null;
  if (csrf !== null && !headers.has('X-CSRF-Token')) {
    headers.set('X-CSRF-Token', csrf);
  }
  if (body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const controller = new AbortController();
  const abortFromCaller = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) abortFromCaller();
  else callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  const timeout = setTimeout(() => {
    controller.abort(new DOMException('API request timed out', 'TimeoutError'));
  }, timeoutMs);

  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...fetchOptions,
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal: controller.signal,
    });

    let payload: unknown = undefined;
    if (response.status !== 204) {
      const text = await response.text();
      if (text.length > 0) {
        try {
          payload = JSON.parse(text) as unknown;
        } catch {
          if (response.ok) throw new ApiSchemaError('API response is not valid JSON');
        }
      }
    }

    if (!response.ok) {
      const detail = parseErrorDetail(payload) ?? {
        code: 'http_error',
        message: `Request failed with HTTP ${response.status}`,
        fields: {},
        request_id: '',
      };
      if (response.status === 401 && invalidateSessionOnUnauthorized) emitUnauthorized(detail);
      throw new ApiError(response.status, detail);
    }

    return parser(payload, 'response');
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
}

function parseVoid(value: unknown): void {
  if (value !== undefined) schemaError('response', 'empty response');
}

export interface HealthResponse {
  status: 'ok';
  version: string;
}

function parseHealth(value: unknown): HealthResponse {
  const record = asRecord(value);
  const status = asString(record.status, 'response.status');
  if (status !== 'ok') schemaError('response.status', '"ok"');
  return { status, version: asString(record.version, 'response.version') };
}

export async function fetchHealth(): Promise<HealthResponse> {
  return apiRequest('/health', parseHealth);
}

// Authentication

export type UserRole = 'admin' | 'viewer';
export type Capability = 'read' | 'configure' | 'manage_devices' | 'manage_sessions';
export type AuthMethod = 'password' | 'oidc' | 'pairing';

export interface OidcStatus {
  provider_name: string;
  available: boolean;
}

export interface AuthStatus {
  setup_required: boolean;
  authenticated: boolean;
  oidc: OidcStatus | null;
}

export interface AuthUser {
  username: string;
  display_name: string;
  role: UserRole;
  session_kind: string;
  auth_method: AuthMethod;
  provider_name: string | null;
  capabilities: Capability[];
}

export interface AuthSession {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  session_kind: string;
  auth_method: AuthMethod;
  provider_name: string | null;
  label: string | null;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  active: boolean;
}

export interface PairingResult {
  code: string;
  expires_at: number;
  role: UserRole;
  label: string;
}

function parseRole(value: unknown, path: string): UserRole {
  const role = asString(value, path);
  return role === 'admin' || role === 'viewer'
    ? role
    : schemaError(path, 'admin or viewer');
}

function parseCapability(value: unknown, path: string): Capability {
  const capability = asString(value, path);
  return ['read', 'configure', 'manage_devices', 'manage_sessions'].includes(capability)
    ? capability as Capability
    : schemaError(path, 'known capability');
}

function parseAuthMethod(value: unknown, path: string): AuthMethod {
  const authMethod = asString(value, path);
  return ['password', 'oidc', 'pairing'].includes(authMethod)
    ? authMethod as AuthMethod
    : schemaError(path, 'password, oidc, or pairing');
}

function parseOidcStatus(value: unknown, path: string): OidcStatus | null {
  if (value === null) return null;
  const record = asRecord(value, path);
  return {
    provider_name: asString(record.provider_name, `${path}.provider_name`),
    available: asBoolean(record.available, `${path}.available`),
  };
}

function parseAuthStatus(value: unknown): AuthStatus {
  const record = asRecord(value);
  return {
    setup_required: asBoolean(record.setup_required, 'response.setup_required'),
    authenticated: asBoolean(record.authenticated, 'response.authenticated'),
    oidc: parseOidcStatus(record.oidc, 'response.oidc'),
  };
}

function parseAuthUser(value: unknown): AuthUser {
  const record = asRecord(value);
  return {
    username: asString(record.username, 'response.username'),
    display_name: asString(record.display_name, 'response.display_name'),
    role: parseRole(record.role, 'response.role'),
    session_kind: asString(record.session_kind, 'response.session_kind'),
    auth_method: parseAuthMethod(record.auth_method, 'response.auth_method'),
    provider_name: asNullableString(record.provider_name, 'response.provider_name'),
    capabilities: arrayOf(record.capabilities, 'response.capabilities', parseCapability),
  };
}

function parseSession(value: unknown, path = 'response'): AuthSession {
  const record = asRecord(value, path);
  return {
    id: asString(record.id, `${path}.id`),
    username: asString(record.username, `${path}.username`),
    display_name: asString(record.display_name, `${path}.display_name`),
    role: parseRole(record.role, `${path}.role`),
    session_kind: asString(record.session_kind, `${path}.session_kind`),
    auth_method: parseAuthMethod(record.auth_method, `${path}.auth_method`),
    provider_name: asNullableString(record.provider_name, `${path}.provider_name`),
    label: asNullableString(record.label, `${path}.label`),
    created_at: asInteger(record.created_at, `${path}.created_at`),
    last_seen_at: asInteger(record.last_seen_at, `${path}.last_seen_at`),
    expires_at: asInteger(record.expires_at, `${path}.expires_at`),
    active: asBoolean(record.active, `${path}.active`),
  };
}

function parseSessions(value: unknown): AuthSession[] {
  const record = asRecord(value);
  return arrayOf(record.sessions, 'response.sessions', parseSession);
}

function parsePairing(value: unknown): PairingResult {
  const record = asRecord(value);
  return {
    code: asString(record.code, 'response.code'),
    expires_at: asInteger(record.expires_at, 'response.expires_at'),
    role: parseRole(record.role, 'response.role'),
    label: asString(record.label, 'response.label'),
  };
}

export async function fetchAuthStatus(): Promise<AuthStatus> {
  return apiRequest('/auth/status', parseAuthStatus);
}

export async function fetchMe(): Promise<AuthUser> {
  return apiRequest('/auth/me', parseAuthUser);
}

export async function login(username: string, password: string): Promise<AuthUser> {
  return apiRequest('/auth/login', parseAuthUser, {
    method: 'POST',
    body: { username, password },
  });
}

export async function setupAdmin(
  token: string,
  username: string,
  password: string,
): Promise<AuthUser> {
  return apiRequest('/auth/setup', parseAuthUser, {
    method: 'POST',
    body: { token, username, password },
    invalidateSessionOnUnauthorized: false,
  });
}

export async function logout(): Promise<void> {
  return apiRequest('/auth/logout', parseVoid, { method: 'POST' });
}

export async function pair(code: string): Promise<AuthUser> {
  return apiRequest('/auth/pair', parseAuthUser, {
    method: 'POST',
    body: { code },
  });
}

export async function fetchSessions(): Promise<AuthSession[]> {
  return apiRequest('/auth/sessions', parseSessions);
}

export async function revokeSession(id: string): Promise<void> {
  return apiRequest(`/auth/sessions/${encodeURIComponent(id)}`, parseVoid, {
    method: 'DELETE',
  });
}

export async function createPairing(
  label: string,
  role: UserRole,
  password?: string,
): Promise<PairingResult> {
  try {
    return await apiRequest('/auth/pairings', parsePairing, {
      method: 'POST',
      body: { label, role, ...(password === undefined ? {} : { password }) },
      invalidateSessionOnUnauthorized: false,
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;

    let sessionStillValid = false;
    try {
      const status = await apiRequest('/auth/status', parseAuthStatus, {
        invalidateSessionOnUnauthorized: false,
      });
      sessionStillValid = status.authenticated;
    } catch {
      // A session that cannot be verified must not remain trusted locally.
    }
    if (!sessionStillValid) emitUnauthorized(error.detail);
    throw error;
  }
}

// Traffic history

export interface TrafficRouterMetadata {
  id: string;
  hardware_identity: string | null;
  fallback_target: string;
  identity_source: string;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
}

export interface TrafficInterfaceMetadata {
  id: string;
  name: string;
  kind: string;
  hardware_id: string | null;
  aggregate: boolean;
  first_seen_at_ms: number;
  last_seen_at_ms: number;
}

export interface TrafficCoverage {
  requested_duration_ms: number;
  exact_duration_ms: number;
  estimated_duration_ms: number;
  covered_duration_ms: number;
  completeness: number;
  gap_count: number;
}

export interface TrafficHistoryPoint {
  timestamp_ms: number;
  download_bps: number;
  upload_bps: number;
  wan_name?: string | null;
  started_at_ms?: number;
  ended_at_ms?: number;
  duration_ms?: number;
  download_bytes?: string;
  upload_bytes?: string;
  exact_download_bytes?: string;
  exact_upload_bytes?: string;
  estimated_download_bytes?: string;
  estimated_upload_bytes?: string;
  exact_duration_ms?: number;
  estimated_duration_ms?: number;
  sample_count?: number;
  estimated?: boolean;
  complete?: boolean;
}

export interface TrafficHistoryTotals {
  download_bytes?: number | string;
  upload_bytes?: number | string;
  total_download_bytes?: string;
  total_upload_bytes?: string;
  exact_download_bytes?: string;
  exact_upload_bytes?: string;
  estimated_download_bytes?: string;
  estimated_upload_bytes?: string;
  estimated?: boolean;
  complete?: boolean;
  coverage_ratio?: number;
}

export interface TrafficHistoryResponse {
  schema_version?: 4;
  router?: TrafficRouterMetadata;
  interface?: TrafficInterfaceMetadata;
  wan_interfaces?: TrafficInterfaceMetadata[];
  points: TrafficHistoryPoint[];
  interval_secs?: number;
  bucket_size_ms?: number;
  wan_names?: string[];
  totals?: TrafficHistoryTotals;
  coverage?: TrafficCoverage;
}

export type TrafficHistorySelector =
  | { interfaceId: string; wanName?: never }
  | { wanName: string; interfaceId?: never };

function asDecimalString(value: unknown, path: string): string {
  const string = asString(value, path);
  return /^\d+$/.test(string) ? string : schemaError(path, 'unsigned decimal string');
}

function parseTrafficRouter(value: unknown, path: string): TrafficRouterMetadata {
  const record = asRecord(value, path);
  return {
    id: asString(record.id, `${path}.id`),
    hardware_identity: asNullableString(record.hardware_identity, `${path}.hardware_identity`),
    fallback_target: asString(record.fallback_target, `${path}.fallback_target`),
    identity_source: asString(record.identity_source, `${path}.identity_source`),
    first_seen_at_ms: asInteger(record.first_seen_at_ms, `${path}.first_seen_at_ms`),
    last_seen_at_ms: asInteger(record.last_seen_at_ms, `${path}.last_seen_at_ms`),
  };
}

function parseTrafficInterface(value: unknown, path: string): TrafficInterfaceMetadata {
  const record = asRecord(value, path);
  return {
    id: asString(record.id, `${path}.id`),
    name: asString(record.name, `${path}.name`),
    kind: asString(record.kind, `${path}.kind`),
    hardware_id: asNullableString(record.hardware_id, `${path}.hardware_id`),
    aggregate: asBoolean(record.aggregate, `${path}.aggregate`),
    first_seen_at_ms: asInteger(record.first_seen_at_ms, `${path}.first_seen_at_ms`),
    last_seen_at_ms: asInteger(record.last_seen_at_ms, `${path}.last_seen_at_ms`),
  };
}

function parseTrafficCoverage(value: unknown, path: string): TrafficCoverage {
  const record = asRecord(value, path);
  return {
    requested_duration_ms: asInteger(record.requested_duration_ms, `${path}.requested_duration_ms`),
    exact_duration_ms: asInteger(record.exact_duration_ms, `${path}.exact_duration_ms`),
    estimated_duration_ms: asInteger(
      record.estimated_duration_ms,
      `${path}.estimated_duration_ms`,
    ),
    covered_duration_ms: asInteger(record.covered_duration_ms, `${path}.covered_duration_ms`),
    completeness: asNumber(record.completeness, `${path}.completeness`),
    gap_count: asInteger(record.gap_count, `${path}.gap_count`),
  };
}

function parseTrafficPoint(
  value: unknown,
  path = 'response',
  canonical = false,
): TrafficHistoryPoint {
  const record = asRecord(value, path);
  const integer = (key: string) => canonical
    ? asInteger(record[key], `${path}.${key}`)
    : record[key] === undefined ? undefined : asInteger(record[key], `${path}.${key}`);
  const decimal = (key: string) => canonical
    ? asDecimalString(record[key], `${path}.${key}`)
    : record[key] === undefined ? undefined : asDecimalString(record[key], `${path}.${key}`);
  return {
    timestamp_ms: asInteger(record.timestamp_ms, `${path}.timestamp_ms`),
    download_bps: asNumber(record.download_bps, `${path}.download_bps`),
    upload_bps: asNumber(record.upload_bps, `${path}.upload_bps`),
    wan_name: record.wan_name === undefined
      ? undefined
      : asNullableString(record.wan_name, `${path}.wan_name`),
    started_at_ms: integer('started_at_ms'),
    ended_at_ms: integer('ended_at_ms'),
    duration_ms: integer('duration_ms'),
    download_bytes: decimal('download_bytes'),
    upload_bytes: decimal('upload_bytes'),
    exact_download_bytes: decimal('exact_download_bytes'),
    exact_upload_bytes: decimal('exact_upload_bytes'),
    estimated_download_bytes: decimal('estimated_download_bytes'),
    estimated_upload_bytes: decimal('estimated_upload_bytes'),
    exact_duration_ms: integer('exact_duration_ms'),
    estimated_duration_ms: integer('estimated_duration_ms'),
    sample_count: integer('sample_count'),
    estimated: canonical
      ? asBoolean(record.estimated, `${path}.estimated`)
      : record.estimated === undefined
        ? undefined
        : asBoolean(record.estimated, `${path}.estimated`),
    complete: canonical
      ? asBoolean(record.complete, `${path}.complete`)
      : record.complete === undefined
        ? undefined
        : asBoolean(record.complete, `${path}.complete`),
  };
}

function parseTrafficTotals(
  value: unknown,
  path = 'response.totals',
  canonical = false,
): TrafficHistoryTotals {
  const record = asRecord(value, path);
  const decimal = (key: string) => record[key] === undefined
    ? undefined
    : asDecimalString(record[key], `${path}.${key}`);
  const requiredDecimal = (key: string) => asDecimalString(record[key], `${path}.${key}`);
  const legacyBytes = (key: string): number | string | undefined => {
    const candidate = record[key];
    if (candidate === undefined) return undefined;
    if (typeof candidate === 'number') return asNumber(candidate, `${path}.${key}`);
    return asDecimalString(candidate, `${path}.${key}`);
  };
  return {
    download_bytes: canonical ? requiredDecimal('download_bytes') : legacyBytes('download_bytes'),
    upload_bytes: canonical ? requiredDecimal('upload_bytes') : legacyBytes('upload_bytes'),
    total_download_bytes: decimal('total_download_bytes'),
    total_upload_bytes: decimal('total_upload_bytes'),
    exact_download_bytes: canonical
      ? requiredDecimal('exact_download_bytes')
      : decimal('exact_download_bytes'),
    exact_upload_bytes: canonical
      ? requiredDecimal('exact_upload_bytes')
      : decimal('exact_upload_bytes'),
    estimated_download_bytes: canonical
      ? requiredDecimal('estimated_download_bytes')
      : decimal('estimated_download_bytes'),
    estimated_upload_bytes: canonical
      ? requiredDecimal('estimated_upload_bytes')
      : decimal('estimated_upload_bytes'),
    estimated: canonical
      ? asBoolean(record.estimated, `${path}.estimated`)
      : optional(record, 'estimated', asBoolean),
    complete: canonical
      ? asBoolean(record.complete, `${path}.complete`)
      : optional(record, 'complete', asBoolean),
    coverage_ratio: canonical
      ? asNumber(record.coverage_ratio, `${path}.coverage_ratio`)
      : optional(record, 'coverage_ratio', asNumber),
  };
}

function parseTrafficHistory(value: unknown): TrafficHistoryResponse {
  const record = asRecord(value);
  const rawSchemaVersion = record.schema_version;
  const schemaVersion = rawSchemaVersion === undefined
    ? undefined
    : asInteger(rawSchemaVersion, 'response.schema_version');
  if (schemaVersion !== undefined && schemaVersion !== 4) {
    schemaError('response.schema_version', '4');
  }
  const canonical = schemaVersion === 4;
  return {
    schema_version: canonical ? 4 : undefined,
    router: canonical
      ? parseTrafficRouter(record.router, 'response.router')
      : record.router === undefined ? undefined : parseTrafficRouter(record.router, 'response.router'),
    interface: canonical
      ? parseTrafficInterface(record.interface, 'response.interface')
      : record.interface === undefined
        ? undefined
        : parseTrafficInterface(record.interface, 'response.interface'),
    wan_interfaces: canonical
      ? arrayOf(record.wan_interfaces, 'response.wan_interfaces', parseTrafficInterface)
      : record.wan_interfaces === undefined
        ? undefined
        : arrayOf(record.wan_interfaces, 'response.wan_interfaces', parseTrafficInterface),
    points: arrayOf(
      record.points,
      'response.points',
      (point, path) => parseTrafficPoint(point, path, canonical),
    ),
    interval_secs: canonical
      ? asInteger(record.interval_secs, 'response.interval_secs')
      : optional(record, 'interval_secs', asInteger),
    bucket_size_ms: canonical
      ? asInteger(record.bucket_size_ms, 'response.bucket_size_ms')
      : optional(record, 'bucket_size_ms', asInteger),
    wan_names: record.wan_names === undefined
      ? undefined
      : arrayOf(record.wan_names, 'response.wan_names', asString),
    totals: canonical
      ? parseTrafficTotals(record.totals, 'response.totals', true)
      : record.totals === undefined ? undefined : parseTrafficTotals(record.totals),
    coverage: canonical
      ? parseTrafficCoverage(record.coverage, 'response.coverage')
      : record.coverage === undefined
        ? undefined
        : parseTrafficCoverage(record.coverage, 'response.coverage'),
  };
}

export async function fetchTrafficHistory(
  start: number,
  end: number,
  selector?: TrafficHistorySelector,
  signal?: AbortSignal,
): Promise<TrafficHistoryResponse> {
  const query = new URLSearchParams({ start: String(start), end: String(end) });
  if (selector?.interfaceId) query.set('interface_id', selector.interfaceId);
  if (selector?.wanName) query.set('wan_name', selector.wanName);
  return apiRequest(`/traffic?${query.toString()}`, parseTrafficHistory, { signal });
}

// Device overrides and OUI

export interface DeviceOverride {
  mac: string;
  custom_name: string | null;
  custom_type: string | null;
  updated_at: number;
}

export interface UpdateOverrideRequest {
  custom_name?: string | null;
  custom_type?: string | null;
}

function parseDeviceOverride(value: unknown, path = 'response'): DeviceOverride {
  const record = asRecord(value, path);
  return {
    mac: asString(record.mac, `${path}.mac`),
    custom_name: asNullableString(record.custom_name, `${path}.custom_name`),
    custom_type: asNullableString(record.custom_type, `${path}.custom_type`),
    updated_at: asInteger(record.updated_at, `${path}.updated_at`),
  };
}

function parseDeviceOverrides(value: unknown): DeviceOverride[] {
  return arrayOf(value, 'response', parseDeviceOverride);
}

export async function fetchDeviceOverrides(): Promise<DeviceOverride[]> {
  return apiRequest('/devices', parseDeviceOverrides);
}

export async function updateDeviceOverride(
  mac: string,
  data: UpdateOverrideRequest,
): Promise<DeviceOverride[]> {
  return apiRequest(`/devices/${encodeURIComponent(mac)}`, parseDeviceOverrides, {
    method: 'PUT',
    body: data,
  });
}

export interface OuiEntry {
  mac: string;
  vendor: string | null;
}

function parseOuiEntries(value: unknown): OuiEntry[] {
  const record = asRecord(value);
  return arrayOf(record.entries, 'response.entries', (item, path = 'response.entries') => {
    const entry = asRecord(item, path);
    return {
      mac: asString(entry.mac, `${path}.mac`),
      vendor: entry.vendor === undefined
        ? null
        : asNullableString(entry.vendor, `${path}.vendor`),
    };
  });
}

export async function fetchOuiEntries(macs: string[]): Promise<OuiEntry[]> {
  const query = macs.map(encodeURIComponent).join(',');
  return apiRequest(`/oui/lookup?macs=${query}`, parseOuiEntries);
}

// Configuration

export interface FullConfig {
  router_type: 'ikuai';
  revision: number;
  router_host: string;
  router_port: number;
  router_scheme: 'http' | 'https';
  router_username: string;
  password_set: boolean;
  router_configured: boolean;
  accept_invalid_certs: boolean;
  allow_insecure_router_http: boolean;
  poll_interval_secs: number;
  probe_interval_secs: number;
  db_raw_retention_days: number;
  db_total_retention_days: number;
  latency_good_ms: number;
  latency_poor_ms: number;
  theme: string;
  wizard_completed: boolean;
}

export interface ConfigResponse {
  router_host: string;
  router_port: number;
  router_scheme: string;
  poll_interval_secs: number;
  probe_interval_secs: number;
}

export interface ConfigUpdateResult {
  saved: string[];
  requires_restart: string[];
  revision: number;
}

export interface ConnectionDraft {
  router_type?: 'ikuai';
  router_host: string;
  router_port: number;
  router_scheme: 'http' | 'https';
  router_username: string;
  router_password: string;
  accept_invalid_certs: boolean;
}

export interface ConnectionTestResult {
  success: boolean;
  model?: string;
  version?: string;
  error?: string;
}

function parseScheme(value: unknown, path: string): 'http' | 'https' {
  const scheme = asString(value, path);
  return scheme === 'http' || scheme === 'https'
    ? scheme
    : schemaError(path, 'http or https');
}

function parseFullConfig(value: unknown): FullConfig {
  const record = asRecord(value);
  const routerType = record.router_type === undefined
    ? 'ikuai'
    : asString(record.router_type, 'response.router_type');
  if (routerType !== 'ikuai') schemaError('response.router_type', 'ikuai');
  return {
    router_type: routerType,
    revision: asInteger(record.revision, 'response.revision'),
    router_host: readAlias(record, 'router_host', 'ikuai_host', asString),
    router_port: readAlias(record, 'router_port', 'ikuai_port', asInteger),
    router_scheme: readAlias(record, 'router_scheme', 'ikuai_scheme', parseScheme),
    router_username: readAlias(record, 'router_username', 'ikuai_username', asString),
    password_set: record.password_set === undefined
      ? readAlias(record, 'router_configured', 'ikuai_configured', asBoolean)
      : asBoolean(record.password_set, 'response.password_set'),
    router_configured: readAlias(record, 'router_configured', 'ikuai_configured', asBoolean),
    accept_invalid_certs: asBoolean(record.accept_invalid_certs, 'response.accept_invalid_certs'),
    allow_insecure_router_http: asBoolean(
      record.allow_insecure_router_http,
      'response.allow_insecure_router_http',
    ),
    poll_interval_secs: asInteger(record.poll_interval_secs, 'response.poll_interval_secs'),
    probe_interval_secs: asInteger(record.probe_interval_secs, 'response.probe_interval_secs'),
    db_raw_retention_days: asInteger(record.db_raw_retention_days, 'response.db_raw_retention_days'),
    db_total_retention_days: asInteger(record.db_total_retention_days, 'response.db_total_retention_days'),
    latency_good_ms: asInteger(record.latency_good_ms, 'response.latency_good_ms'),
    latency_poor_ms: asInteger(record.latency_poor_ms, 'response.latency_poor_ms'),
    theme: asString(record.theme, 'response.theme'),
    wizard_completed: asBoolean(record.wizard_completed, 'response.wizard_completed'),
  };
}

function parseConfigUpdate(value: unknown): ConfigUpdateResult {
  const record = asRecord(value);
  return {
    saved: arrayOf(record.saved, 'response.saved', asString),
    requires_restart: arrayOf(record.requires_restart, 'response.requires_restart', asString),
    revision: asInteger(record.revision, 'response.revision'),
  };
}

function parseConnectionTest(value: unknown): ConnectionTestResult {
  const record = asRecord(value);
  return {
    success: asBoolean(record.success, 'response.success'),
    model: optional(record, 'model', asString),
    version: optional(record, 'version', asString),
    error: optional(record, 'error', asString),
  };
}

let latestConfigRevision: number | null = null;
let configMutationQueue: Promise<void> = Promise.resolve();
let configMutationEpoch = 0;

export async function fetchFullConfig(): Promise<FullConfig> {
  const config = await apiRequest('/config', parseFullConfig);
  latestConfigRevision = config.revision;
  return config;
}

export async function fetchConfig(): Promise<ConfigResponse> {
  const config = await fetchFullConfig();
  return {
    router_host: config.router_host,
    router_port: config.router_port,
    router_scheme: config.router_scheme,
    poll_interval_secs: config.poll_interval_secs,
    probe_interval_secs: config.probe_interval_secs,
  };
}

export async function updateConfig(
  patch: Record<string, unknown>,
): Promise<ConfigUpdateResult> {
  const operationEpoch = configMutationEpoch;
  const operation = configMutationQueue.then(async () => {
    if (operationEpoch !== configMutationEpoch) {
      throw new ApiError(409, {
        code: 'stale_config_mutation',
        message: 'Configuration changed before this update could be sent',
        fields: {},
        request_id: '',
      });
    }
    if (latestConfigRevision === null) await fetchFullConfig();
    const expectedRevision = latestConfigRevision;
    if (expectedRevision === null) throw new ApiSchemaError('Configuration revision is unavailable');

    try {
      const result = await apiRequest('/config', parseConfigUpdate, {
        method: 'PUT',
        body: { ...patch, expected_revision: expectedRevision },
      });
      latestConfigRevision = result.revision;
      return result;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        configMutationEpoch++;
        await fetchFullConfig().catch(() => undefined);
      }
      throw error;
    }
  });
  configMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

export async function testConnection(
  params?: ConnectionDraft | Record<string, unknown>,
  signal?: AbortSignal,
): Promise<ConnectionTestResult> {
  return apiRequest('/config/test-connection', parseConnectionTest, {
    method: 'POST',
    body: params ?? {},
    timeoutMs: 30_000,
    signal,
  });
}

// Probe targets

export interface ProbeTarget {
  id?: number;
  name: string;
  host: string;
  category: string;
  sort_order?: number;
}

export interface ProbeTargetsResponse {
  targets: ProbeTarget[];
}

function parseProbe(value: unknown, path = 'response'): ProbeTarget {
  const record = asRecord(value, path);
  return {
    id: record.id === undefined ? undefined : asInteger(record.id, `${path}.id`),
    name: asString(record.name, `${path}.name`),
    host: asString(record.host, `${path}.host`),
    category: asString(record.category, `${path}.category`),
    sort_order: record.sort_order === undefined
      ? undefined
      : asInteger(record.sort_order, `${path}.sort_order`),
  };
}

function parseProbes(value: unknown): ProbeTargetsResponse {
  const record = asRecord(value);
  return { targets: arrayOf(record.targets, 'response.targets', parseProbe) };
}

export async function fetchProbeTargets(): Promise<ProbeTargetsResponse> {
  return apiRequest('/probes', parseProbes);
}

export async function updateProbeTargets(targets: ProbeTarget[]): Promise<ProbeTargetsResponse> {
  return apiRequest('/probes', parseProbes, { method: 'PUT', body: targets });
}

export async function resetProbeTargets(): Promise<ProbeTargetsResponse> {
  return apiRequest('/probes/reset', parseProbes, { method: 'POST' });
}

export function __resetApiStateForTests(): void {
  latestConfigRevision = null;
  configMutationQueue = Promise.resolve();
  configMutationEpoch = 0;
}
