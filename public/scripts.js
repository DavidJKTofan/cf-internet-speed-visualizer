// Enterprise-grade frontend with comprehensive error handling and validation

// Constants
const CHART_COLORS = {
	primary: '#3b82f6',
	secondary: '#8b5cf6',
	tertiary: '#06b6d4',
	quaternary: '#10b981',
	quinary: '#ec4899',
	senary: '#f59e0b',
};

const TOOLTIP_CONTENT = {
	'throughput-tooltip-trigger':
		"Measures sustained data transfer rates using macOS NetworkQuality tool (Apple's RPM standard) and Ookla Speedtest CLI. Download represents inbound capacity; upload represents outbound capacity. Variability indicates congestion, throttling, or infrastructure limitations.",
	'latency-tooltip-trigger':
		'Round-trip time (RTT) measures network delay to infrastructure endpoints. Time to First Byte (TTFB) includes DNS lookup, TCP handshake, and server processing time. Elevated latency can indicate routing issues or packet loss.',
	'responsiveness-tooltip-trigger':
		"Apple's Responsiveness Per Minute (RPM) metric quantifies network quality under load by measuring round-trips per minute during active data transfer. Higher RPM indicates better interactive performance (e.g., video calls, gaming).",
	'packet-loss-tooltip-trigger':
		'Percentage of ICMP packets lost during transmission. Packet loss directly impacts connection quality, causing retransmissions and degraded performance. Values above 1% may indicate network problems.',
	'dns-tooltip-trigger':
		'DNS lookup duration measures the time required to resolve domain names to IP addresses. This is the first step in any web request and directly impacts perceived load times. Values above 100ms can suggest DNS server issues. The `dig` tool provides more precise measurements than cURL.',
};

const METRIC_META = {
	download: { label: 'Avg Download', unit: 'Mbps', higherIsBetter: true },
	upload: { label: 'Avg Upload', unit: 'Mbps', higherIsBetter: true },
	latency: { label: 'Avg Latency', unit: 'ms', higherIsBetter: false },
	responsiveness: { label: 'Responsiveness', unit: 'RPM', higherIsBetter: true },
	packetLoss: { label: 'Packet Loss', unit: '%', higherIsBetter: false },
	totalTests: { label: 'Total Tests', unit: '', higherIsBetter: null },
};

// State
let allData = [];
let charts = {};
let currentTimeRange = 'all';
let lastUpdatedInterval;
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

// DOM Elements
const DOMElements = {
	loading: document.getElementById('loading'),
	emptyState: document.getElementById('emptyState'),
	error: document.getElementById('error'),
	errorText: document.getElementById('errorText'),
	content: document.getElementById('content'),
	statusBadge: document.getElementById('statusBadge'),
	statusText: document.getElementById('statusText'),
	lastUpdated: document.getElementById('lastUpdated'),
	statsGrid: document.getElementById('statsGrid'),
	highlightsGrid: document.getElementById('highlightsGrid'),
	timeRange: document.getElementById('timeRange'),
	mtrSection: document.getElementById('mtr-section'),
	mtrTableContainer: document.getElementById('mtrTableContainer'),
};

// Chart configuration
const commonOptions = {
	responsive: true,
	maintainAspectRatio: false,
	interaction: { mode: 'index', intersect: false },
	plugins: {
		legend: {
			display: true,
			position: 'bottom',
			align: 'start',
			labels: {
				color: '#94a3b8',
				boxWidth: 12,
				padding: 20,
				font: { size: 12 },
			},
		},
		tooltip: {
			backgroundColor: 'rgba(15, 23, 42, 0.95)',
			titleColor: '#cbd5e1',
			bodyColor: '#cbd5e1',
			borderColor: '#334155',
			borderWidth: 1,
			padding: 10,
			displayColors: true,
			usePointStyle: true,
		},
	},
	scales: {
		x: {
			type: 'time',
			time: {
				unit: 'hour',
				displayFormats: { hour: 'MMM d, ha' },
			},
			ticks: {
				color: '#94a3b8',
				font: { size: 11 },
				source: 'auto',
				maxRotation: 0,
				autoSkip: true,
				autoSkipPadding: 20,
			},
			grid: { color: 'rgba(51, 65, 85, 0.5)', drawBorder: false },
		},
		y: {
			ticks: { color: '#94a3b8', font: { size: 11 }, padding: 5 },
			grid: { color: 'rgba(51, 65, 85, 0.5)', drawBorder: false },
			beginAtZero: true,
		},
	},
	animation: {
		duration: 400,
		easing: 'easeOutQuad',
	},
};

// Utility functions
function timeAgo(date) {
	const seconds = Math.floor((new Date() - date) / 1000);
	let interval = seconds / 31536000;
	if (interval > 1) return Math.floor(interval) + ' years ago';
	interval = seconds / 2592000;
	if (interval > 1) return Math.floor(interval) + ' months ago';
	interval = seconds / 86400;
	if (interval > 1) return Math.floor(interval) + ' days ago';
	interval = seconds / 3600;
	if (interval > 1) return Math.floor(interval) + ' hours ago';
	interval = seconds / 60;
	if (interval > 1) return Math.floor(interval) + ' minutes ago';
	return 'just now';
}

function isValidNumber(value) {
	return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

function safeNumber(value, defaultValue = null) {
	return isValidNumber(value) ? value : defaultValue;
}

function calculateStatistics(values) {
	const filteredValues = values.filter((v) => v !== null && v !== undefined && isValidNumber(v));
	if (!filteredValues.length) return { avg: 'N/A', max: 'N/A', min: 'N/A', p95: 'N/A' };

	const sorted = [...filteredValues].sort((a, b) => a - b);
	const sum = sorted.reduce((a, b) => a + b, 0);
	const avg = sum / sorted.length;
	const max = Math.max(...sorted);
	const min = Math.min(...sorted);
	const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];

	return {
		avg: avg.toFixed(1),
		max: max.toFixed(1),
		min: min.toFixed(1),
		p95: p95.toFixed(1),
	};
}

// Data validation - Updated to match D1 flat structure
function isValidLogEntry(entry) {
	if (!entry || typeof entry !== 'object') return false;
	if (typeof entry.timestamp !== 'string') return false;
	// D1 returns flat structure, not nested objects
	return true;
}

function sanitizeLogEntry(entry) {
	// D1 returns flat structure - ensure all numeric fields are valid
	const sanitized = { ...entry };

	// Convert all numeric fields
	const numericFields = [
		'nq_download_mbps',
		'nq_upload_mbps',
		'nq_responsiveness_rpm',
		'ping_cf_packet_loss_percent',
		'ping_cf_rtt_avg',
		'ping_cf_rtt_min',
		'ping_cf_rtt_max',
		'ping_cf_rtt_stddev',
		'ping_google_packet_loss_percent',
		'ping_google_rtt_avg',
		'ping_google_rtt_min',
		'ping_google_rtt_max',
		'ping_google_rtt_stddev',
		'curl_us_dns_lookup_s',
		'curl_us_ttfb_s',
		'curl_eu_dns_lookup_s',
		'curl_eu_ttfb_s',
		'st_download_mbps',
		'st_upload_mbps',
		'st_ping_ms',
		'dns_cf_query_time_ms',
		'dns_google_query_time_ms',
	];

	numericFields.forEach((field) => {
		if (sanitized[field] !== null && sanitized[field] !== undefined) {
			sanitized[field] = safeNumber(parseFloat(sanitized[field]));
		}
	});

	return sanitized;
}

// API with retry logic
async function fetchData() {
	try {
		console.log('Fetching network logs...');
		const response = await fetch('/api/logs?limit=2000', {
			headers: {
				Accept: 'application/json',
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const contentType = response.headers.get('content-type');
		if (!contentType || !contentType.includes('application/json')) {
			throw new Error('Invalid content type: expected JSON');
		}

		const data = await response.json();

		if (!Array.isArray(data)) {
			throw new Error('Invalid data format: expected array');
		}

		if (data.length === 0) {
			console.log('No data available');
			showUIState('empty');
			retryCount = 0;
			return;
		}

		// Validate and sanitize entries
		const validData = data.filter(isValidLogEntry).map(sanitizeLogEntry);

		if (validData.length === 0) {
			throw new Error('All entries failed validation');
		}

		if (validData.length < data.length) {
			console.warn(`${data.length - validData.length} invalid entries filtered out`);
		}

		allData = validData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
		retryCount = 0;
		renderDashboard();
	} catch (error) {
		console.error('Failed to fetch data:', error);

		if (retryCount < MAX_RETRIES) {
			retryCount++;
			console.log(`Retrying in ${RETRY_DELAY / 1000}s (attempt ${retryCount}/${MAX_RETRIES})`);
			showUIState('error', `Connection failed. Retrying... (${retryCount}/${MAX_RETRIES})`);
			setTimeout(fetchData, RETRY_DELAY);
		} else {
			showUIState('error', `Failed to load data: ${error.message}. Please refresh the page.`);
		}
	}
}

// Data filtering
const filterDataByTimeRange = (hours) => {
	if (hours === 'all') return allData;
	const cutoff = Date.now() - hours * 60 * 60 * 1000;
	return allData.filter((d) => {
		try {
			return new Date(d.timestamp) >= cutoff;
		} catch (e) {
			console.warn('Invalid timestamp:', d.timestamp);
			return false;
		}
	});
};

// UI State management
function showUIState(state, message = '') {
	DOMElements.loading.style.display = 'none';
	DOMElements.content.style.display = 'none';
	DOMElements.emptyState.style.display = 'none';
	DOMElements.error.style.display = 'none';
	DOMElements.mtrSection.style.display = 'none';

	clearInterval(lastUpdatedInterval);

	switch (state) {
		case 'loading':
			DOMElements.loading.style.display = 'flex';
			break;
		case 'empty':
			DOMElements.emptyState.style.display = 'flex';
			DOMElements.statusBadge.style.background = 'var(--text-muted)';
			DOMElements.statusText.textContent = 'No Data';
			DOMElements.lastUpdated.textContent = '';
			break;
		case 'error':
			DOMElements.error.style.display = 'flex';
			DOMElements.errorText.textContent = message;
			DOMElements.statusBadge.style.background = 'var(--error)';
			DOMElements.statusText.textContent = 'Error';
			DOMElements.lastUpdated.textContent = '';
			break;
		case 'content':
			DOMElements.content.style.display = 'block';
			DOMElements.statusBadge.style.background = 'var(--success)';
			DOMElements.statusText.textContent = 'Live';
			updateLastUpdated();
			lastUpdatedInterval = setInterval(updateLastUpdated, 60000);
			break;
	}
}

function updateLastUpdated() {
	if (allData.length > 0) {
		try {
			const lastTimestamp = allData[allData.length - 1].timestamp;
			DOMElements.lastUpdated.textContent = `Updated ${timeAgo(new Date(lastTimestamp))}`;
		} catch (e) {
			console.error('Error updating last updated time:', e);
		}
	}
}

// Rendering functions
function renderStats(data) {
	if (!data || data.length === 0) {
		DOMElements.statsGrid.innerHTML = '<p>No data to display</p>';
		return;
	}

	const stats = {
		download: calculateStatistics(data.map((d) => safeNumber(d.nq_download_mbps))),
		upload: calculateStatistics(data.map((d) => safeNumber(d.nq_upload_mbps))),
		latency: calculateStatistics(data.map((d) => safeNumber(d.ping_cf_rtt_avg))),
		responsiveness: calculateStatistics(data.map((d) => safeNumber(d.nq_responsiveness_rpm))),
		packetLoss: calculateStatistics(data.map((d) => safeNumber(d.ping_cf_packet_loss_percent))),
		totalTests: { avg: data.length },
	};

	const statHTML = (key, statData) => {
		const meta = METRIC_META[key];
		if (!meta) return '';

		let indicator = '';
		if (meta.higherIsBetter !== null) {
			indicator = `<span class="stat-indicator ${meta.higherIsBetter ? 'good' : 'bad'}">${meta.higherIsBetter ? '↑' : '↓'}</span>`;
		}

		let footer = `Min: ${statData.min}, Max: ${statData.max}`;
		if (key === 'latency') footer = `P95: ${statData.p95}`;
		if (key === 'totalTests') footer = 'Over selected time range';

		return `
      <div class="stat-card">
        <div class="stat-header">
          <div class="stat-label">${meta.label}</div>
          ${indicator}
        </div>
        <div class="stat-value">${statData.avg}<span class="stat-unit">${meta.unit}</span></div>
        <div class="stat-footer">${footer}</div>
      </div>`;
	};

	const filteredStatKeys = ['download', 'upload', 'latency', 'responsiveness', 'packetLoss', 'totalTests'];
	DOMElements.statsGrid.innerHTML = filteredStatKeys.map((key) => statHTML(key, stats[key])).join('');
}

function renderHighlights(data) {
	if (!data || data.length === 0) {
		DOMElements.highlightsGrid.innerHTML = '';
		return;
	}

	const ttfbUS = calculateStatistics(data.map((d) => (d.curl_us_ttfb_s ? safeNumber(d.curl_us_ttfb_s * 1000) : null)));
	const ttfbEU = calculateStatistics(data.map((d) => (d.curl_eu_ttfb_s ? safeNumber(d.curl_eu_ttfb_s * 1000) : null)));
	const rttCF = calculateStatistics(data.map((d) => safeNumber(d.ping_cf_rtt_avg)));
	const rttGoogle = calculateStatistics(data.map((d) => safeNumber(d.ping_google_rtt_avg)));
	const dnsCF = calculateStatistics(data.map((d) => safeNumber(d.dns_cf_query_time_ms)));
	const dnsGoogle = calculateStatistics(data.map((d) => safeNumber(d.dns_google_query_time_ms)));

	const comparison = (a, b, nameA, nameB) => {
		if (a.avg === 'N/A' || b.avg === 'N/A') return 'N/A';
		const avgA = parseFloat(a.avg);
		const avgB = parseFloat(b.avg);
		if (avgA === avgB) return `${nameA} and ${nameB} are similar.`;

		const faster = avgA < avgB ? nameA : nameB;
		const slower = faster === nameA ? nameB : nameA;
		const diff = Math.abs(avgA - avgB);
		const diffPercent = (diff / Math.min(avgA, avgB)) * 100;

		return `<span class="faster">${faster}</span> is <span class="slower">${diffPercent.toFixed(0)}%</span> faster than ${slower}.`;
	};

	const highlightHTML = (title, body, footer) => `
		<div class="highlight-card">
			<div class="highlight-title">${title}</div>
			<div class="highlight-body">${body}</div>
			<div class="highlight-footer">${footer}</div>
		</div>
	`;

	DOMElements.highlightsGrid.innerHTML = [
		highlightHTML('Fastest Endpoint (TTFB)', comparison(ttfbUS, ttfbEU, 'US', 'EU'), `US: ${ttfbUS.avg}ms vs EU: ${ttfbEU.avg}ms`),
		highlightHTML(
			'Fastest Ping (RTT)',
			comparison(rttCF, rttGoogle, 'Cloudflare', 'Google'),
			`CF: ${rttCF.avg}ms vs Google: ${rttGoogle.avg}ms`
		),
		highlightHTML(
			'Fastest DNS Lookup',
			comparison(dnsCF, dnsGoogle, 'Cloudflare DNS', 'Google DNS'),
			`CF: ${dnsCF.avg}ms vs Google: ${dnsGoogle.avg}ms`
		),
	].join('');
}

function createDataset(label, data, color, options = {}) {
	// Filter out invalid data points
	const validData = data.map((point) => ({
		x: point.x,
		y: isValidNumber(point.y) ? point.y : null,
	}));

	return {
		label,
		data: validData,
		borderColor: color,
		backgroundColor: `${color}30`,
		tension: 0.3,
		fill: false,
		pointRadius: 1.5,
		pointHoverRadius: 4,
		borderWidth: 1.5,
		spanGaps: true,
		...options,
	};
}

function renderCharts(data) {
	if (!data || data.length === 0) {
		console.warn('No data to render charts');
		return;
	}

	Object.values(charts).forEach((chart) => {
		try {
			chart.destroy();
		} catch (e) {
			console.warn('Error destroying chart:', e);
		}
	});
	charts = {};

	const chartConfigs = {
		speedChart: {
			type: 'line',
			data: {
				datasets: [
					createDataset(
						'NQ Download',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.nq_download_mbps) })),
						CHART_COLORS.primary,
						{ fill: true }
					),
					createDataset(
						'NQ Upload',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.nq_upload_mbps) })),
						CHART_COLORS.secondary,
						{ fill: true }
					),
					createDataset(
						'ST Download',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.st_download_mbps) })),
						CHART_COLORS.senary,
						{ borderDash: [5, 5], fill: false }
					),
				],
			},
			options: {
				...commonOptions,
				scales: {
					...commonOptions.scales,
					y: { ...commonOptions.scales.y, title: { display: true, text: 'Mbps', color: '#94a3b8' } },
				},
			},
		},
		latencyChart: {
			type: 'line',
			data: {
				datasets: [
					createDataset(
						'Cloudflare RTT Avg',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.ping_cf_rtt_avg) })),
						CHART_COLORS.tertiary
					),
					createDataset(
						'Cloudflare RTT Min',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.ping_cf_rtt_min) })),
						CHART_COLORS.tertiary,
						{
							fill: '-1',
							backgroundColor: `${CHART_COLORS.tertiary}1A`,
							borderColor: 'transparent',
							pointRadius: 0,
							pointHoverRadius: 0,
							tension: 0.4,
						}
					),
					createDataset(
						'Cloudflare RTT Max',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.ping_cf_rtt_max) })),
						CHART_COLORS.tertiary,
						{
							fill: '1',
							backgroundColor: `${CHART_COLORS.tertiary}1A`,
							borderColor: 'transparent',
							pointRadius: 0,
							pointHoverRadius: 0,
							tension: 0.4,
						}
					),
					createDataset(
						'Google RTT Avg',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.ping_google_rtt_avg) })),
						CHART_COLORS.quaternary
					),
					createDataset(
						'Google RTT Min',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.ping_google_rtt_min) })),
						CHART_COLORS.quaternary,
						{
							fill: '-1',
							backgroundColor: `${CHART_COLORS.quaternary}1A`,
							borderColor: 'transparent',
							pointRadius: 0,
							pointHoverRadius: 0,
							tension: 0.4,
						}
					),
					createDataset(
						'Google RTT Max',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.ping_google_rtt_max) })),
						CHART_COLORS.quaternary,
						{
							fill: '1',
							backgroundColor: `${CHART_COLORS.quaternary}1A`,
							borderColor: 'transparent',
							pointRadius: 0,
							pointHoverRadius: 0,
							tension: 0.4,
						}
					),
					createDataset(
						'US TTFB',
						data.map((d) => ({
							x: new Date(d.timestamp),
							y: d.curl_us_ttfb_s ? safeNumber(d.curl_us_ttfb_s * 1000) : null,
						})),
						CHART_COLORS.quinary,
						{ fill: false, borderDash: [5, 5] }
					),
					createDataset(
						'EU TTFB',
						data.map((d) => ({
							x: new Date(d.timestamp),
							y: d.curl_eu_ttfb_s ? safeNumber(d.curl_eu_ttfb_s * 1000) : null,
						})),
						CHART_COLORS.senary,
						{ fill: false, borderDash: [5, 5] }
					),
				],
			},
			options: {
				...commonOptions,
				scales: {
					...commonOptions.scales,
					y: { ...commonOptions.scales.y, title: { display: true, text: 'ms', color: '#94a3b8' } },
				},
			},
		},
		responsivenessChart: {
			type: 'bar',
			data: {
				datasets: [
					{
						label: 'RPM',
						data: data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.nq_responsiveness_rpm) })),
						backgroundColor: `${CHART_COLORS.primary}CC`,
						borderColor: CHART_COLORS.primary,
						borderWidth: 1,
					},
				],
			},
			options: {
				...commonOptions,
				scales: {
					...commonOptions.scales,
					y: { ...commonOptions.scales.y, title: { display: true, text: 'RPM', color: '#94a3b8' } },
				},
			},
		},
		packetLossChart: {
			type: 'line',
			data: {
				datasets: [
					createDataset(
						'Cloudflare Loss',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.ping_cf_packet_loss_percent) })),
						CHART_COLORS.tertiary
					),
					createDataset(
						'Google Loss',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.ping_google_packet_loss_percent) })),
						CHART_COLORS.quaternary
					),
				],
			},
			options: {
				...commonOptions,
				scales: {
					...commonOptions.scales,
					y: { ...commonOptions.scales.y, max: 5, title: { display: true, text: '%', color: '#94a3b8' } },
				},
			},
		},
		dnsChart: {
			type: 'line',
			data: {
				datasets: [
					createDataset(
						'Cloudflare DNS',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.dns_cf_query_time_ms) })),
						CHART_COLORS.quinary
					),
					createDataset(
						'Google DNS',
						data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.dns_google_query_time_ms) })),
						CHART_COLORS.senary
					),
				],
			},
			options: {
				...commonOptions,
				scales: {
					...commonOptions.scales,
					y: { ...commonOptions.scales.y, title: { display: true, text: 'ms', color: '#94a3b8' } },
				},
			},
		},
	};

	for (const [id, config] of Object.entries(chartConfigs)) {
		const ctx = document.getElementById(id);
		if (ctx) {
			try {
				charts[id] = new Chart(ctx, config);
			} catch (e) {
				console.error(`Error creating chart ${id}:`, e);
			}
		}
	}
}

function renderMtrTable(data) {
	if (!data || data.length === 0) {
		DOMElements.mtrSection.style.display = 'none';
		document.getElementById('mtr-google-section').style.display = 'none';
		return;
	}

	const latestEntry = data[data.length - 1];

	// Render Cloudflare MTR
	DOMElements.mtrSection.style.display = 'block';
	let mtrHopsCF = [];

	try {
		if (latestEntry.mtr_cloudflare_hops) {
			mtrHopsCF = JSON.parse(latestEntry.mtr_cloudflare_hops);
		}
	} catch (e) {
		console.error('Error parsing Cloudflare MTR hops:', e);
		DOMElements.mtrTableContainer.innerHTML = `<p class="chart-description">MTR data parsing failed.</p>`;
	}

	if (mtrHopsCF.length === 0 || (mtrHopsCF[0] && mtrHopsCF[0].error === 'failed')) {
		DOMElements.mtrTableContainer.innerHTML = `<p class="chart-description">MTR data not available or test failed.</p>`;
	} else {
		DOMElements.mtrTableContainer.innerHTML = generateMtrTableHTML(mtrHopsCF);
	}

	// Render Google MTR
	const mtrGoogleSection = document.getElementById('mtr-google-section');
	const mtrGoogleContainer = document.getElementById('mtrGoogleTableContainer');

	if (!mtrGoogleSection || !mtrGoogleContainer) return;

	mtrGoogleSection.style.display = 'block';
	let mtrHopsGoogle = [];

	try {
		if (latestEntry.mtr_google_hops) {
			mtrHopsGoogle = JSON.parse(latestEntry.mtr_google_hops);
		}
	} catch (e) {
		console.error('Error parsing Google MTR hops:', e);
		mtrGoogleContainer.innerHTML = `<p class="chart-description">MTR data parsing failed.</p>`;
		return;
	}

	if (mtrHopsGoogle.length === 0 || (mtrHopsGoogle[0] && mtrHopsGoogle[0].error === 'failed')) {
		mtrGoogleContainer.innerHTML = `<p class="chart-description">MTR data not available or test failed.</p>`;
	} else {
		mtrGoogleContainer.innerHTML = generateMtrTableHTML(mtrHopsGoogle);
	}
}

function generateMtrTableHTML(hops) {
	let tableHTML = `
        <table class="mtr-table">
            <thead>
                <tr>
                    <th>Hop</th>
                    <th>Host</th>
                    <th>Loss %</th>
                    <th>Sent</th>
                    <th>Last (ms)</th>
                    <th>Avg (ms)</th>
                    <th>Best (ms)</th>
                    <th>Worst (ms)</th>
                    <th>StdDev</th>
                </tr>
            </thead>
            <tbody>
    `;

	hops.forEach((hop) => {
		const lossPercent = safeNumber(hop.loss_percent, 0);
		const lossClass = lossPercent > 10 ? 'loss-high' : lossPercent > 0 ? 'loss-medium' : '';
		tableHTML += `
            <tr>
                <td>${hop.count || hop.hop || 'N/A'}</td>
                <td>${hop.host || 'N/A'}</td>
                <td class="${lossClass}">${lossPercent.toFixed(1)}%</td>
                <td>${hop.sent || 'N/A'}</td>
                <td>${safeNumber(hop.last_ms, 0).toFixed(1)}</td>
                <td>${safeNumber(hop.avg_ms, 0).toFixed(1)}</td>
                <td>${safeNumber(hop.best_ms, 0).toFixed(1)}</td>
                <td>${safeNumber(hop.worst_ms, 0).toFixed(1)}</td>
                <td>${safeNumber(hop.stddev, 0).toFixed(1)}</td>
            </tr>
        `;
	});

	tableHTML += `
            </tbody>
        </table>
    `;
	return tableHTML;
}

function renderDashboard() {
	try {
		const filteredData = filterDataByTimeRange(currentTimeRange);
		if (filteredData.length === 0) {
			showUIState('empty');
			return;
		}

		showUIState('content');
		renderStats(filteredData);
		renderHighlights(filteredData);
		renderCharts(filteredData);
		renderMtrTable(filteredData);
	} catch (e) {
		console.error('Error rendering dashboard:', e);
		showUIState('error', 'Failed to render dashboard. Please try refreshing.');
	}
}

// Tooltips
function initializeTooltips() {
	for (const [triggerId, content] of Object.entries(TOOLTIP_CONTENT)) {
		const trigger = document.getElementById(triggerId);
		if (!trigger) continue;

		const tooltip = document.createElement('div');
		tooltip.className = 'tooltip';
		tooltip.textContent = content;
		tooltip.style.visibility = 'hidden';
		tooltip.style.opacity = '0';

		trigger.parentNode.appendChild(tooltip);

		trigger.addEventListener('mouseenter', () => {
			const triggerRect = trigger.getBoundingClientRect();
			const parentRect = trigger.parentNode.getBoundingClientRect();

			tooltip.style.left = `${triggerRect.left - parentRect.left + triggerRect.width / 2}px`;
			tooltip.style.top = `${triggerRect.top - parentRect.top - tooltip.offsetHeight - 10}px`;

			tooltip.style.visibility = 'visible';
			tooltip.style.opacity = '1';
		});

		trigger.addEventListener('mouseleave', () => {
			tooltip.style.visibility = 'hidden';
			tooltip.style.opacity = '0';
		});
	}
}

// Event Listeners
DOMElements.timeRange?.addEventListener('change', (e) => {
	currentTimeRange = e.target.value;
	renderDashboard();
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
	showUIState('loading');
	fetchData();
	setInterval(fetchData, 300000); // Refresh every 5 minutes
	initializeTooltips();
});
