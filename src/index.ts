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

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Enhanced logging
		console.log({
			method: request.method,
			path: url.pathname,
			timestamp: new Date().toISOString(),
		});

		// CORS headers
		const corsHeaders = {
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
		};

		if (request.method === 'OPTIONS') {
			return new Response(null, { headers: corsHeaders });
		}

		try {
			// Upload endpoint
			if (url.pathname === '/upload' && request.method === 'POST') {
				console.log('Upload request received');

				let entries: NetworkQualityEntry[];
				try {
					entries = await request.json();
				} catch (parseError) {
					console.error('JSON parse error:', parseError);
					return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json', ...corsHeaders },
					});
				}

				if (!Array.isArray(entries)) {
					console.error('Invalid data format: not an array');
					return new Response(JSON.stringify({ error: 'Invalid data format: expected array' }), {
						status: 400,
						headers: { 'Content-Type': 'application/json', ...corsHeaders },
					});
				}

				console.log(`Processing ${entries.length} entries`);

				// Insert entries into D1
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

				const batchResult = await env.DB.batch(statements);
				console.log('Batch insert completed', { inserted: entries.length });

				return new Response(JSON.stringify({ success: true, inserted: entries.length }), {
					status: 200,
					headers: { 'Content-Type': 'application/json', ...corsHeaders },
				});
			}

			// API endpoint to retrieve data
			if (url.pathname === '/api/logs') {
				const limit = url.searchParams.get('limit') || '100';
				console.log(`Fetching logs with limit: ${limit}`);

				const { results } = await env.DB.prepare('SELECT * FROM network_logs ORDER BY timestamp DESC LIMIT ?').bind(parseInt(limit)).all();

				console.log(`Returned ${results.length} log entries`);

				return new Response(JSON.stringify(results || []), {
					status: 200,
					headers: { 'Content-Type': 'application/json', ...corsHeaders },
				});
			}

			// Serve static assets
			return env.ASSETS.fetch(request);
			// return new Response('Not Found', { status: 404 });
		} catch (error) {
			console.error('Worker error:', {
				message: (error as Error).message,
				stack: (error as Error).stack,
				path: url.pathname,
			});

			return new Response(
				JSON.stringify({
					error: 'Internal server error',
					details: (error as Error).message,
				}),
				{ status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
			);
		}
	},
};
