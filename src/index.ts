// Best practices for Cloudflare Workers with TypeScript

// Use specific and well-defined interfaces for your data structures.
// This improves type safety and makes your code easier to understand.
interface Env {
	DB: D1Database;
	ASSETS: Fetcher;
}

interface PingResult {
	host: string;
	packet_loss?: number;
	rtt_avg?: number;
}

interface CurlResult {
	url: string;
	dns_lookup?: number;
	ttfb?: number;
	http_code?: string;
}

interface SpeedtestResult {
	download_mbps?: number;
	upload_mbps?: number;
	ping_ms?: number;
}

interface NetworkQualityData {
	timestamp: string;
	networkquality: {
		download_mbps: number | null;
		upload_mbps: number | null;
		responsiveness: number | null;
	};
	ping: {
		cloudflare: PingResult;
		google: PingResult;
	};
	curl: {
		us_dlsdemo: CurlResult;
		eu_dlsdemo: CurlResult;
	};
	speedtest: SpeedtestResult;
}

// Constants
const CACHE_TTL_SECONDS = 60;
const CORS_HEADERS = {
	'Access-Control-Allow-Origin': '*',
	'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
	'Access-Control-Max-Age': '86400',
};

// SQL queries as constants for readability and maintainability.
const INSERT_NETWORK_LOG_SQL = `
  INSERT INTO network_logs (
    timestamp,
    nq_download_mbps, nq_upload_mbps, nq_responsiveness,
    ping_cf_host, ping_cf_packet_loss, ping_cf_rtt_avg,
    ping_google_host, ping_google_packet_loss, ping_google_rtt_avg,
    curl_us_url, curl_us_dns_lookup, curl_us_ttfb, curl_us_http_code,
    curl_eu_url, curl_eu_dns_lookup, curl_eu_ttfb, curl_eu_http_code,
    st_download_mbps, st_upload_mbps, st_ping_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

// Helper function for creating consistent JSON responses.
function jsonResponse(data: any, status: number = 200, extraHeaders: Record<string, string> = {}): Response {
	const headers = {
		'Content-Type': 'application/json',
		...CORS_HEADERS,
		...extraHeaders,
	};
	return new Response(JSON.stringify(data), { status, headers });
}

// More specific validation function.
function isValidEntry(entry: any): entry is NetworkQualityData {
	return (
		entry &&
		typeof entry === 'object' &&
		typeof entry.timestamp === 'string' &&
		typeof entry.networkquality === 'object' &&
		typeof entry.ping === 'object' &&
		typeof entry.curl === 'object' &&
		typeof entry.speedtest === 'object' &&
		'cloudflare' in entry.ping &&
		'google' in entry.ping &&
		'us_dlsdemo' in entry.curl &&
		'eu_dlsdemo' in entry.curl
	);
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
	const startTime = Date.now();

	let entries: NetworkQualityData[];
	try {
		entries = await request.json();
	} catch (e) {
		return jsonResponse({ error: 'Invalid JSON in request body' }, 400);
	}

	if (!Array.isArray(entries) || entries.length === 0) {
		return jsonResponse({ error: 'Request body must be a non-empty array of network quality entries' }, 400);
	}

	const validEntries = entries.filter(isValidEntry);
	if (validEntries.length !== entries.length) {
		const invalidCount = entries.length - validEntries.length;
		return jsonResponse({ error: `Invalid entry format found in ${invalidCount} entries.` }, 400);
	}

	try {
		const statements = validEntries.map((entry) => {
			const { networkquality, ping, curl, speedtest } = entry;
			return env.DB.prepare(INSERT_NETWORK_LOG_SQL).bind(
				entry.timestamp,
				networkquality.download_mbps,
				networkquality.upload_mbps,
				networkquality.responsiveness,
				ping.cloudflare.host,
				ping.cloudflare.packet_loss,
				ping.cloudflare.rtt_avg,
				ping.google.host,
				ping.google.packet_loss,
				ping.google.rtt_avg,
				curl.us_dlsdemo.url,
				curl.us_dlsdemo.dns_lookup,
				curl.us_dlsdemo.ttfb,
				curl.us_dlsdemo.http_code,
				curl.eu_dlsdemo.url,
				curl.eu_dlsdemo.dns_lookup,
				curl.eu_dlsdemo.ttfb,
				curl.eu_dlsdemo.http_code,
				speedtest.download_mbps,
				speedtest.upload_mbps,
				speedtest.ping_ms
			);
		});

		await env.DB.batch(statements);

		const duration = Date.now() - startTime;
		console.log(`Successfully inserted ${validEntries.length} entries in ${duration}ms`);

		return jsonResponse({ success: true, inserted: validEntries.length, duration_ms: duration }, 200, { 'Cache-Control': 'no-store' });
	} catch (dbError) {
		console.error('Database batch insert error:', dbError);
		return jsonResponse({ error: 'Database operation failed', details: (dbError as Error).message }, 500);
	}
}

async function handleGetLogs(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const limitParam = url.searchParams.get('limit');
	const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10), 1), 10000) : 1000;

	try {
		const cache = caches.default;
		const cacheKey = new Request(new URL(`/cache/logs_${limit}`, request.url).toString(), request);
		let response = await cache.match(cacheKey);

		if (response) {
			console.log('Cache hit for logs');
			const newHeaders = new Headers(response.headers);
			newHeaders.set('X-Cache', 'HIT');
			return new Response(response.body, { status: response.status, headers: newHeaders });
		}

		console.log('Cache miss for logs');
		const { results } = await env.DB.prepare('SELECT * FROM network_logs ORDER BY timestamp DESC LIMIT ?').bind(limit).all();

		response = jsonResponse(results || [], 200, {
			'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
			'X-Cache': 'MISS',
		});

		await cache.put(cacheKey, response.clone());
		return response;
	} catch (dbError) {
		console.error('Database query error:', dbError);
		return jsonResponse({ error: 'Failed to retrieve logs', details: (dbError as Error).message }, 500);
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: CORS_HEADERS });
		}

		try {
			switch (url.pathname) {
				case '/upload':
					if (request.method === 'POST') return handleUpload(request, env);
					return jsonResponse({ error: 'Method not allowed, expected POST' }, 405);
				case '/api/logs':
					if (request.method === 'GET') return handleGetLogs(request, env);
					return jsonResponse({ error: 'Method not allowed, expected GET' }, 405);
				case '/health':
					return jsonResponse({ status: 'healthy', timestamp: new Date().toISOString() });
				default:
					// For any other path, serve from ASSETS
					return env.ASSETS.fetch(request);
			}
		} catch (error) {
			console.error('Worker error:', error);
			return jsonResponse({ error: 'Internal Server Error', details: (error as Error).message }, 500);
		}
	},
};