// Cloudflare Worker - Modular Endpoint Architecture

interface Env {
	DB: D1Database;
	ASSETS: Fetcher;
	ENVIRONMENT?: string;
}

const CONFIG = {
	CACHE_TTL_SECONDS: 60,
	MAX_BATCH_SIZE: 100,
	MAX_QUERY_LIMIT: 10000,
	DEFAULT_QUERY_LIMIT: 1000,
	SCHEMA_VERSION: 3,
	ALLOWED_ORIGINS: ['*'],
} as const;

const CORS_HEADERS = {
	'Access-Control-Allow-Origin': CONFIG.ALLOWED_ORIGINS[0],
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type, X-Request-ID',
	'Access-Control-Max-Age': '86400',
} as const;

// --- Type Definitions ---
interface EndpointResult {
	id: string;
	name: string;
	[key: string]: unknown;
}

interface NetworkLogEntry {
	timestamp: string;
	networkquality: {
		download_mbps: number | null;
		upload_mbps: number | null;
		responsiveness_rpm: number | null;
	};
	speedtest: {
		download_mbps?: number | null;
		upload_mbps?: number | null;
		ping_ms?: number | null;
		server_location?: string | null;
		server_country?: string | null;
	};
	ping_results: EndpointResult[];
	curl_results: EndpointResult[];
	mtr_results: EndpointResult[];
	dns_results: EndpointResult[];
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

// --- Logging ---
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

// --- Validation ---
function isValidTimestamp(timestamp: string): boolean {
	const date = new Date(timestamp);
	const now = Date.now();
	const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
	const oneHourFuture = now + 60 * 60 * 1000;
	return !isNaN(date.getTime()) && date.getTime() >= oneYearAgo && date.getTime() <= oneHourFuture;
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
		Array.isArray(e.ping_results) &&
		Array.isArray(e.curl_results) &&
		Array.isArray(e.mtr_results) &&
		Array.isArray(e.dns_results)
	);
}

// --- Utility ---
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

// --- SQL ---
const INSERT_SQL = `
  INSERT INTO network_logs (
    timestamp, schema_version,
    nq_download_mbps, nq_upload_mbps, nq_responsiveness_rpm,
    st_download_mbps, st_upload_mbps, st_ping_ms, st_server_location, st_server_country,
    ping_results, curl_results, mtr_results, dns_results
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const CHECK_DUPLICATE_SQL = `SELECT COUNT(*) as count FROM network_logs WHERE timestamp = ? LIMIT 1`;

// --- Handlers ---
async function handleUpload(request: Request, env: Env, logger: Logger, requestId: string): Promise<Response> {
	const startTime = Date.now();

	let entries: unknown;
	try {
		entries = await request.json();
	} catch (e) {
		logger.warn('Invalid JSON', { error: (e as Error).message });
		return errorResponse('Invalid JSON in request body', 400, requestId);
	}

	if (!Array.isArray(entries)) {
		logger.warn('Not an array');
		return errorResponse('Request body must be an array', 400, requestId);
	}

	if (entries.length === 0) {
		logger.warn('Empty array');
		return errorResponse('Request body must contain at least one entry', 400, requestId);
	}

	if (entries.length > CONFIG.MAX_BATCH_SIZE) {
		logger.warn('Batch too large', { count: entries.length });
		return errorResponse(`Batch size exceeds maximum of ${CONFIG.MAX_BATCH_SIZE}`, 400, requestId);
	}

	const validEntries = entries.filter(isValidEntry);
	if (validEntries.length !== entries.length) {
		const invalidCount = entries.length - validEntries.length;
		logger.warn('Invalid entries', { invalid_count: invalidCount });
		return errorResponse(`Invalid entry format in ${invalidCount} of ${entries.length} entries`, 400, requestId);
	}

	try {
		const duplicateChecks = await Promise.all(
			validEntries.map((entry) => env.DB.prepare(CHECK_DUPLICATE_SQL).bind(entry.timestamp).first<{ count: number }>())
		);

		const duplicates = duplicateChecks.filter((result) => result?.count && result.count > 0);
		if (duplicates.length > 0) {
			logger.info('Duplicates detected', { duplicate_count: duplicates.length });
			return errorResponse(`${duplicates.length} duplicate timestamps rejected`, 409, requestId);
		}

		const statements = validEntries.map((entry) => {
			const { networkquality, speedtest } = entry;
			return env.DB.prepare(INSERT_SQL).bind(
				entry.timestamp,
				CONFIG.SCHEMA_VERSION,
				networkquality.download_mbps,
				networkquality.upload_mbps,
				networkquality.responsiveness_rpm,
				speedtest.download_mbps ?? null,
				speedtest.upload_mbps ?? null,
				speedtest.ping_ms ?? null,
				speedtest.server_location ?? null,
				speedtest.server_country ?? null,
				JSON.stringify(entry.ping_results),
				JSON.stringify(entry.curl_results),
				JSON.stringify(entry.mtr_results),
				JSON.stringify(entry.dns_results)
			);
		});

		await env.DB.batch(statements);

		const duration = Date.now() - startTime;
		logger.info('Successfully inserted', { count: validEntries.length, duration_ms: duration });

		const response: SuccessResponse = {
			success: true,
			inserted: validEntries.length,
			duration_ms: duration,
			request_id: requestId,
			timestamp: new Date().toISOString(),
		};

		return jsonResponse(response, 200, { 'Cache-Control': 'no-store' });
	} catch (dbError) {
		logger.error('Database error', dbError as Error);
		return errorResponse('Database operation failed', 500, requestId);
	}
}

async function handleGetLogs(request: Request, env: Env, logger: Logger, requestId: string): Promise<Response> {
	const url = new URL(request.url);
	const limitParam = url.searchParams.get('limit');
	const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), CONFIG.MAX_QUERY_LIMIT) : CONFIG.DEFAULT_QUERY_LIMIT;

	if (limitParam && isNaN(parseInt(limitParam, 10))) {
		logger.warn('Invalid limit', { limit: limitParam });
		return errorResponse('Invalid limit parameter', 400, requestId);
	}

	try {
		logger.debug('Fetching logs', { limit });
		const result = await env.DB.prepare('SELECT * FROM network_logs ORDER BY timestamp DESC LIMIT ?').bind(limit).all();

		if (!result.success) {
			throw new Error('D1 query failed');
		}

		const results = result.results || [];
		logger.info('Fetched logs', { count: results.length });

		return jsonResponse(results, 200, {
			'Cache-Control': 'public, max-age=60',
			'X-Request-ID': requestId,
		});
	} catch (dbError) {
		logger.error('Database query error', dbError as Error);
		return errorResponse('Failed to retrieve logs', 500, requestId);
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
		logger.error('Health check failed', error as Error);
		health.checks.database = 'unhealthy';
		health.status = 'degraded';
	}

	const status = health.status === 'healthy' ? 200 : 503;
	return jsonResponse(health, status, { 'Cache-Control': 'no-store' });
}

// --- Main ---
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const requestId = generateRequestId();
		const environment = env.ENVIRONMENT || 'production';
		const logger = new Logger(requestId, environment);

		const url = new URL(request.url);
		logger.info('Request received', {
			method: request.method,
			path: url.pathname,
		});

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS });
		}

		try {
			switch (url.pathname) {
				case '/upload':
					if (request.method !== 'POST') {
						return errorResponse('Method not allowed', 405, requestId);
					}
					return await handleUpload(request, env, logger, requestId);

				case '/api/logs':
					if (request.method !== 'GET') {
						return errorResponse('Method not allowed', 405, requestId);
					}
					return await handleGetLogs(request, env, logger, requestId);

				case '/health':
					return await handleHealth(env, logger);

				default:
					logger.debug('Serving static asset', { path: url.pathname });
					return env.ASSETS.fetch(request);
			}
		} catch (error) {
			logger.error('Unhandled error', error as Error);
			return errorResponse('Internal Server Error', 500, requestId);
		}
	},
};
