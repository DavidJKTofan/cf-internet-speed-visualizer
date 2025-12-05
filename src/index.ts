// Enterprise-grade Cloudflare Worker with comprehensive error handling and observability

interface Env {
	DB: D1Database;
	ASSETS: Fetcher;
	ENVIRONMENT?: string;
}

// --- Configuration ---
const CONFIG = {
	CACHE_TTL_SECONDS: 60,
	MAX_BATCH_SIZE: 100,
	MAX_QUERY_LIMIT: 10000,
	DEFAULT_QUERY_LIMIT: 1000,
	SCHEMA_VERSION: 2,
	ALLOWED_ORIGINS: ['*'], // Configure per environment
} as const;

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': CONFIG.ALLOWED_ORIGINS[0],
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID',
	'Access-Control-Max-Age': '86400',
} as const;

// --- Enhanced Type Definitions ---
interface RttStats {
	min: number | null;
	avg: number | null;
	max: number | null;
	stddev: number | null;
}

interface PingResult {
	host: string;
	packet_loss_percent?: number | null;
	rtt_ms?: RttStats | null;
	error?: string;
}

interface CurlResult {
	url: string;
	dns_lookup_s?: number | null;
	ttfb_s?: number | null;
	http_code?: string | null;
	error?: string;
}

interface SpeedtestResult {
	download_mbps?: number | null;
	upload_mbps?: number | null;
	ping_ms?: number | null;
	server_location?: string | null;
	server_country?: string | null;
	error?: string;
}

interface NetworkQualityResult {
	download_mbps: number | null;
	upload_mbps: number | null;
	responsiveness_rpm: number | null;
	error?: string;
}

interface MtrHop {
	hop: number;
	host: string;
	loss_percent: number;
	avg_ms: number;
}

interface MtrResult {
	host: string;
	hops?: MtrHop[];
	error?: string;
}

interface DnsResult {
	domain: string;
	resolver: string;
	query_time_ms?: number | null;
	error?: string;
}

interface NetworkLogEntry {
	timestamp: string;
	networkquality: NetworkQualityResult;
	speedtest: SpeedtestResult;
	ping: {
		cloudflare: PingResult;
		google: PingResult;
	};
	curl: {
		us_dlsdemo: CurlResult;
		eu_dlsdemo: CurlResult;
	};
	mtr: {
		cloudflare: MtrResult;
		google: MtrResult;
	};
	dns: {
		cloudflare: DnsResult;
		google: DnsResult;
	};
}

interface ErrorResponse {
	error: string;
	details?: string;
	request_id?: string;
	timestamp: string;
}

interface SuccessResponse {
	success: boolean;
	inserted?: number;
	duration_ms?: number;
	request_id?: string;
	timestamp: string;
}

// --- Structured Logging ---
enum LogLevel {
	DEBUG = 'DEBUG',
	INFO = 'INFO',
	WARN = 'WARN',
	ERROR = 'ERROR',
}

class Logger {
	constructor(private requestId: string, private env: string) {}

	private log(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
		const logEntry = {
			timestamp: new Date().toISOString(),
			level,
			message,
			request_id: this.requestId,
			environment: this.env,
			...meta,
		};
		console.log(JSON.stringify(logEntry));
	}

	debug(message: string, meta?: Record<string, unknown>): void {
		this.log(LogLevel.DEBUG, message, meta);
	}

	info(message: string, meta?: Record<string, unknown>): void {
		this.log(LogLevel.INFO, message, meta);
	}

	warn(message: string, meta?: Record<string, unknown>): void {
		this.log(LogLevel.WARN, message, meta);
	}

	error(message: string, error?: Error, meta?: Record<string, unknown>): void {
		this.log(LogLevel.ERROR, message, {
			error_message: error?.message,
			error_stack: error?.stack,
			...meta,
		});
	}
}

// --- Validation Functions ---
function isValidTimestamp(timestamp: string): boolean {
	const date = new Date(timestamp);
	const now = Date.now();
	const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
	const oneHourFuture = now + 60 * 60 * 1000;

	return !isNaN(date.getTime()) && date.getTime() >= oneYearAgo && date.getTime() <= oneHourFuture;
}

function isValidNumber(value: unknown, min?: number, max?: number): value is number {
	if (typeof value !== 'number' || isNaN(value) || !isFinite(value)) {
		return false;
	}
	if (min !== undefined && value < min) return false;
	if (max !== undefined && value > max) return false;
	return true;
}

function isValidRttStats(stats: unknown): stats is RttStats {
	if (!stats || typeof stats !== 'object') return true; // Nullable
	const s = stats as Partial<RttStats>;
	return (
		(s.min === null || isValidNumber(s.min, 0)) &&
		(s.avg === null || isValidNumber(s.avg, 0)) &&
		(s.max === null || isValidNumber(s.max, 0)) &&
		(s.stddev === null || isValidNumber(s.stddev, 0))
	);
}

function isValidPingResult(ping: unknown): ping is PingResult {
	if (!ping || typeof ping !== 'object') return false;
	const p = ping as Partial<PingResult>;
	return (
		typeof p.host === 'string' &&
		(p.packet_loss_percent === undefined || p.packet_loss_percent === null || isValidNumber(p.packet_loss_percent, 0, 100)) &&
		(p.rtt_ms === undefined || p.rtt_ms === null || isValidRttStats(p.rtt_ms))
	);
}

function isValidEntry(entry: unknown): entry is NetworkLogEntry {
	if (!entry || typeof entry !== 'object') return false;
	const e = entry as Partial<NetworkLogEntry>;

	return (
		typeof e.timestamp === 'string' &&
		isValidTimestamp(e.timestamp) &&
		e.networkquality !== undefined &&
		typeof e.networkquality === 'object' &&
		e.speedtest !== undefined &&
		typeof e.speedtest === 'object' &&
		e.ping !== undefined &&
		typeof e.ping === 'object' &&
		isValidPingResult(e.ping.cloudflare) &&
		isValidPingResult(e.ping.google) &&
		e.curl !== undefined &&
		typeof e.curl === 'object' &&
		'us_dlsdemo' in e.curl &&
		'eu_dlsdemo' in e.curl &&
		e.mtr !== undefined &&
		typeof e.mtr === 'object' &&
		'cloudflare' in e.mtr &&
		'google' in e.mtr &&
		e.dns !== undefined &&
		typeof e.dns === 'object' &&
		'cloudflare' in e.dns &&
		'google' in e.dns
	);
}

// --- Utility Functions ---
function generateRequestId(): string {
	return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function jsonResponse(
	data: ErrorResponse | SuccessResponse | unknown,
	status: number = 200,
	extraHeaders: Record<string, string> = {}
): Response {
	const headers = {
		'Content-Type': 'application/json',
		...CORS_HEADERS,
		...extraHeaders,
	};
	return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(error: string, status: number, requestId: string, details?: string): Response {
	const response: ErrorResponse = {
		error,
		details,
		request_id: requestId,
		timestamp: new Date().toISOString(),
	};
	return jsonResponse(response, status, { 'Cache-Control': 'no-store' });
}

// --- SQL Statements ---
const INSERT_NETWORK_LOG_SQL = `
  INSERT INTO network_logs (
    timestamp, schema_version,
    nq_download_mbps, nq_upload_mbps, nq_responsiveness_rpm,
    ping_cf_host, ping_cf_packet_loss_percent, ping_cf_rtt_avg, ping_cf_rtt_min, ping_cf_rtt_max, ping_cf_rtt_stddev,
    ping_google_host, ping_google_packet_loss_percent, ping_google_rtt_avg, ping_google_rtt_min, ping_google_rtt_max, ping_google_rtt_stddev,
    curl_us_url, curl_us_dns_lookup_s, curl_us_ttfb_s, curl_us_http_code,
    curl_eu_url, curl_eu_dns_lookup_s, curl_eu_ttfb_s, curl_eu_http_code,
    st_download_mbps, st_upload_mbps, st_ping_ms, st_server_location, st_server_country,
    dns_cf_query_time_ms, dns_google_query_time_ms,
    mtr_cloudflare_hops, mtr_google_hops
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const CHECK_DUPLICATE_SQL = `
  SELECT COUNT(*) as count FROM network_logs WHERE timestamp = ? LIMIT 1
`;

// --- Request Handlers ---
async function handleUpload(request: Request, env: Env, logger: Logger, requestId: string): Promise<Response> {
	const startTime = Date.now();

	let entries: unknown;
	try {
		entries = await request.json();
	} catch (e) {
		logger.warn('Invalid JSON in request body', { error: (e as Error).message });
		return errorResponse('Invalid JSON in request body', 400, requestId);
	}

	if (!Array.isArray(entries)) {
		logger.warn('Request body is not an array');
		return errorResponse('Request body must be an array of network log entries', 400, requestId);
	}

	if (entries.length === 0) {
		logger.warn('Empty array received');
		return errorResponse('Request body must contain at least one entry', 400, requestId);
	}

	if (entries.length > CONFIG.MAX_BATCH_SIZE) {
		logger.warn('Batch size exceeds limit', { count: entries.length, max: CONFIG.MAX_BATCH_SIZE });
		return errorResponse(`Batch size exceeds maximum of ${CONFIG.MAX_BATCH_SIZE} entries`, 400, requestId);
	}

	const validEntries = entries.filter(isValidEntry);
	if (validEntries.length !== entries.length) {
		const invalidCount = entries.length - validEntries.length;
		logger.warn('Invalid entries detected', { invalid_count: invalidCount, total: entries.length });
		return errorResponse(
			`Invalid entry format found in ${invalidCount} of ${entries.length} entries`,
			400,
			requestId,
			'Ensure all entries match the required schema and timestamp is valid'
		);
	}

	try {
		// Check for duplicates
		const duplicateChecks = await Promise.all(
			validEntries.map((entry) => env.DB.prepare(CHECK_DUPLICATE_SQL).bind(entry.timestamp).first<{ count: number }>())
		);

		const duplicates = duplicateChecks.filter((result) => result?.count && result.count > 0);
		if (duplicates.length > 0) {
			logger.info('Duplicate timestamps detected', { duplicate_count: duplicates.length });
			return errorResponse(
				`${duplicates.length} entries with duplicate timestamps rejected`,
				409,
				requestId,
				'Entries with existing timestamps are not allowed'
			);
		}

		const statements = validEntries.map((entry) => {
			const { networkquality, ping, curl, speedtest, dns, mtr } = entry;
			return env.DB.prepare(INSERT_NETWORK_LOG_SQL).bind(
				entry.timestamp,
				CONFIG.SCHEMA_VERSION,
				networkquality.download_mbps,
				networkquality.upload_mbps,
				networkquality.responsiveness_rpm,
				ping.cloudflare.host,
				ping.cloudflare.packet_loss_percent ?? null,
				ping.cloudflare.rtt_ms?.avg ?? null,
				ping.cloudflare.rtt_ms?.min ?? null,
				ping.cloudflare.rtt_ms?.max ?? null,
				ping.cloudflare.rtt_ms?.stddev ?? null,
				ping.google.host,
				ping.google.packet_loss_percent ?? null,
				ping.google.rtt_ms?.avg ?? null,
				ping.google.rtt_ms?.min ?? null,
				ping.google.rtt_ms?.max ?? null,
				ping.google.rtt_ms?.stddev ?? null,
				curl.us_dlsdemo.url,
				curl.us_dlsdemo.dns_lookup_s ?? null,
				curl.us_dlsdemo.ttfb_s ?? null,
				curl.us_dlsdemo.http_code ?? null,
				curl.eu_dlsdemo.url,
				curl.eu_dlsdemo.dns_lookup_s ?? null,
				curl.eu_dlsdemo.ttfb_s ?? null,
				curl.eu_dlsdemo.http_code ?? null,
				speedtest.download_mbps ?? null,
				speedtest.upload_mbps ?? null,
				speedtest.ping_ms ?? null,
				speedtest.server_location ?? null,
				speedtest.server_country ?? null,
				dns.cloudflare.query_time_ms ?? null,
				dns.google.query_time_ms ?? null,
				mtr.cloudflare.hops ? JSON.stringify(mtr.cloudflare.hops) : null,
				mtr.google.hops ? JSON.stringify(mtr.google.hops) : null
			);
		});

		await env.DB.batch(statements);

		const duration = Date.now() - startTime;
		logger.info('Successfully inserted entries', { count: validEntries.length, duration_ms: duration });

		const response: SuccessResponse = {
			success: true,
			inserted: validEntries.length,
			duration_ms: duration,
			request_id: requestId,
			timestamp: new Date().toISOString(),
		};

		return jsonResponse(response, 200, { 'Cache-Control': 'no-store' });
	} catch (dbError) {
		logger.error('Database batch insert error', dbError as Error, { entry_count: validEntries.length });
		return errorResponse('Database operation failed', 500, requestId, 'Internal server error during data insertion');
	}
}

async function handleGetLogs(request: Request, env: Env, logger: Logger, requestId: string): Promise<Response> {
	const url = new URL(request.url);
	const limitParam = url.searchParams.get('limit');
	const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), CONFIG.MAX_QUERY_LIMIT) : CONFIG.DEFAULT_QUERY_LIMIT;

	if (limitParam && isNaN(parseInt(limitParam, 10))) {
		logger.warn('Invalid limit parameter', { limit: limitParam });
		return errorResponse('Invalid limit parameter, must be a number', 400, requestId);
	}

	try {
		logger.debug('Fetching logs from D1', { limit });
		const result = await env.DB.prepare('SELECT * FROM network_logs ORDER BY timestamp DESC LIMIT ?').bind(limit).all();

		if (!result.success) {
			throw new Error('D1 query returned success=false');
		}

		const results = result.results || [];
		logger.info('Successfully fetched logs', { count: results.length, limit });

		return jsonResponse(results, 200, {
			'Cache-Control': 'public, max-age=60',
			'X-Cache': 'MISS',
			'X-Request-ID': requestId,
		});
	} catch (dbError) {
		logger.error('Database query error', dbError as Error, { limit });
		return errorResponse('Failed to retrieve logs', 500, requestId, 'Internal server error during data retrieval');
	}
}

async function handleHealth(env: Env, logger: Logger): Promise<Response> {
	const health = {
		status: 'healthy',
		timestamp: new Date().toISOString(),
		schema_version: CONFIG.SCHEMA_VERSION,
		checks: {
			database: 'unknown' as 'healthy' | 'unhealthy' | 'unknown',
		},
	};

	try {
		const result = await env.DB.prepare('SELECT 1 as test').first();
		health.checks.database = result?.test === 1 ? 'healthy' : 'unhealthy';
	} catch (error) {
		logger.error('Database health check failed', error as Error);
		health.checks.database = 'unhealthy';
		health.status = 'degraded';
	}

	const status = health.status === 'healthy' ? 200 : 503;
	return jsonResponse(health, status, { 'Cache-Control': 'no-store' });
}

// --- Main Fetch Handler ---
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const requestId = generateRequestId();
		const environment = env.ENVIRONMENT || 'production';
		const logger = new Logger(requestId, environment);

		const url = new URL(request.url);
		logger.info('Request received', {
			method: request.method,
			path: url.pathname,
			user_agent: request.headers.get('User-Agent'),
		});

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS });
		}

		try {
			switch (url.pathname) {
				case '/upload':
					if (request.method !== 'POST') {
						return errorResponse('Method not allowed, expected POST', 405, requestId);
					}
					return await handleUpload(request, env, logger, requestId);

				case '/api/logs':
					if (request.method !== 'GET') {
						return errorResponse('Method not allowed, expected GET', 405, requestId);
					}
					return await handleGetLogs(request, env, logger, requestId);

				case '/health':
					return await handleHealth(env, logger);

				default:
					// Serve static assets
					logger.debug('Serving static asset', { path: url.pathname });
					return env.ASSETS.fetch(request);
			}
		} catch (error) {
			logger.error('Unhandled worker error', error as Error, { path: url.pathname });
			return errorResponse('Internal Server Error', 500, requestId, 'An unexpected error occurred');
		}
	},
};
