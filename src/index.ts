interface Env {
	DB: D1Database;
	ASSETS: Fetcher;
}

interface NetworkQualityEntry {
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

interface PingResult {
	host: string;
	packet_loss?: number;
	rtt_min?: number;
	rtt_avg?: number;
	rtt_max?: number;
	rtt_stddev?: number;
	error?: string;
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
	error?: string;
}

const CACHE_TTL = 60;

function getCorsHeaders(): Record<string, string> {
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
		'Access-Control-Max-Age': '86400',
	};
}

function validateEntry(entry: any): entry is NetworkQualityEntry {
	return (
		entry &&
		typeof entry === 'object' &&
		typeof entry.timestamp === 'string' &&
		entry.networkquality &&
		entry.ping &&
		entry.curl &&
		entry.speedtest
	);
}

async function handleUpload(request: Request, env: Env): Promise<Response> {
	const startTime = Date.now();
	console.log('Upload request received');

	let entries: NetworkQualityEntry[];
	try {
		const text = await request.text();
		if (!text || text.trim().length === 0) {
			return new Response(JSON.stringify({ error: 'Empty request body' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders() },
			});
		}

		entries = JSON.parse(text);
	} catch (parseError) {
		console.error('JSON parse error:', parseError);
		return new Response(JSON.stringify({ error: 'Invalid JSON format' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json', ...getCorsHeaders() },
		});
	}

	if (!Array.isArray(entries)) {
		console.error('Invalid data format: not an array');
		return new Response(JSON.stringify({ error: 'Expected array of entries' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json', ...getCorsHeaders() },
		});
	}

	if (entries.length === 0) {
		return new Response(JSON.stringify({ error: 'Empty array provided' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json', ...getCorsHeaders() },
		});
	}

	const invalidEntries = entries.filter((e) => !validateEntry(e));
	if (invalidEntries.length > 0) {
		console.error('Invalid entries found:', invalidEntries.length);
		return new Response(JSON.stringify({ error: 'Invalid entry format', count: invalidEntries.length }), {
			status: 400,
			headers: { 'Content-Type': 'application/json', ...getCorsHeaders() },
		});
	}

	console.log(`Processing ${entries.length} valid entries`);

	try {
		const statements = entries.map((entry) => {
			return env.DB.prepare(
				`
        INSERT INTO network_logs (
          timestamp,
          nq_download_mbps, nq_upload_mbps, nq_responsiveness,
          ping_cf_host, ping_cf_packet_loss, ping_cf_rtt_avg,
          ping_google_host, ping_google_packet_loss, ping_google_rtt_avg,
          curl_us_url, curl_us_dns_lookup, curl_us_ttfb, curl_us_http_code,
          curl_eu_url, curl_eu_dns_lookup, curl_eu_ttfb, curl_eu_http_code,
          st_download_mbps, st_upload_mbps, st_ping_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
			).bind(
				entry.timestamp,
				entry.networkquality.download_mbps,
				entry.networkquality.upload_mbps,
				entry.networkquality.responsiveness,
				entry.ping.cloudflare.host,
				entry.ping.cloudflare.packet_loss ?? null,
				entry.ping.cloudflare.rtt_avg ?? null,
				entry.ping.google.host,
				entry.ping.google.packet_loss ?? null,
				entry.ping.google.rtt_avg ?? null,
				entry.curl.us_dlsdemo.url,
				entry.curl.us_dlsdemo.dns_lookup ?? null,
				entry.curl.us_dlsdemo.ttfb ?? null,
				entry.curl.us_dlsdemo.http_code ?? null,
				entry.curl.eu_dlsdemo.url,
				entry.curl.eu_dlsdemo.dns_lookup ?? null,
				entry.curl.eu_dlsdemo.ttfb ?? null,
				entry.curl.eu_dlsdemo.http_code ?? null,
				entry.speedtest.download_mbps ?? null,
				entry.speedtest.upload_mbps ?? null,
				entry.speedtest.ping_ms ?? null
			);
		});

		await env.DB.batch(statements);

		const duration = Date.now() - startTime;
		console.log({
			event: 'batch_insert_completed',
			entries: entries.length,
			duration_ms: duration,
		});

		return new Response(
			JSON.stringify({
				success: true,
				inserted: entries.length,
				duration_ms: duration,
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'no-store',
					...getCorsHeaders(),
				},
			}
		);
	} catch (dbError) {
		console.error('Database error:', {
			message: (dbError as Error).message,
			stack: (dbError as Error).stack,
		});

		return new Response(
			JSON.stringify({
				error: 'Database operation failed',
				details: (dbError as Error).message,
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders() },
			}
		);
	}
}

async function handleGetLogs(request: Request, env: Env): Promise<Response> {
	const url = new URL(request.url);
	const limitParam = url.searchParams.get('limit');
	const limit = limitParam ? Math.min(Math.max(parseInt(limitParam), 1), 10000) : 1000;

	console.log({ event: 'fetch_logs', limit });

	try {
		const cacheKey = `logs_${limit}`;
		const cache = caches.default;
		const cacheUrl = new URL(request.url);
		cacheUrl.pathname = `/cache/${cacheKey}`;

		let response = await cache.match(cacheUrl);
		if (response) {
			console.log('Cache hit');
			return new Response(response.body, {
				headers: {
					...Object.fromEntries(response.headers),
					'X-Cache': 'HIT',
				},
			});
		}

		const { results } = await env.DB.prepare('SELECT * FROM network_logs ORDER BY timestamp DESC LIMIT ?').bind(limit).all();

		console.log({ event: 'logs_retrieved', count: results.length });

		response = new Response(JSON.stringify(results || []), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				'Cache-Control': `public, max-age=${CACHE_TTL}`,
				'X-Cache': 'MISS',
				...getCorsHeaders(),
			},
		});

		await cache.put(cacheUrl, response.clone());

		return response;
	} catch (dbError) {
		console.error('Database query error:', {
			message: (dbError as Error).message,
			stack: (dbError as Error).stack,
		});

		return new Response(
			JSON.stringify({
				error: 'Failed to retrieve logs',
				details: (dbError as Error).message,
			}),
			{
				status: 500,
				headers: { 'Content-Type': 'application/json', ...getCorsHeaders() },
			}
		);
	}
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);
		const clientIP = request.headers.get('CF-Connecting-IP') || 'unknown';

		console.log({
			event: 'request_received',
			method: request.method,
			path: url.pathname,
			timestamp: new Date().toISOString(),
			ip: clientIP,
		});

		const corsHeaders = getCorsHeaders();

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			if (url.pathname === '/upload' && request.method === 'POST') {
				return await handleUpload(request, env);
			}

			if (url.pathname === '/api/logs' && request.method === 'GET') {
				return await handleGetLogs(request, env);
			}

			if (url.pathname === '/health') {
				return new Response(
					JSON.stringify({
						status: 'healthy',
						timestamp: new Date().toISOString(),
					}),
					{
						status: 200,
						headers: { 'Content-Type': 'application/json', ...corsHeaders },
					}
				);
			}

			return env.ASSETS.fetch(request);
		} catch (error) {
			console.error({
				event: 'worker_error',
				message: (error as Error).message,
				stack: (error as Error).stack,
				path: url.pathname,
			});

			return new Response(
				JSON.stringify({
					error: 'Internal server error',
					details: (error as Error).message,
				}),
				{
					status: 500,
					headers: { 'Content-Type': 'application/json', ...corsHeaders },
				}
			);
		}
	},
};
