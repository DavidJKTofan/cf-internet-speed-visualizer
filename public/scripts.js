// Frontend - Dynamic Endpoint Rendering

const CHART_COLORS = [
	'#3b82f6',
	'#8b5cf6',
	'#06b6d4',
	'#10b981',
	'#ec4899',
	'#f59e0b',
	'#ef4444',
	'#8b5cf6',
	'#14b8a6',
	'#f97316',
	'#a855f7',
	'#22c55e',
];

const TOOLTIP_CONTENT = {
	'throughput-tooltip-trigger': 'Measures sustained data transfer rates using macOS NetworkQuality (NQ) tool and Ookla Speedtest (ST) CLI.',
	'rtt-tooltip-trigger': 'Round-trip time (RTT) measures network delay via ICMP echo requests to infrastructure endpoints.',
	'ttfb-tooltip-trigger': 'Time to First Byte (TTFB) includes DNS lookup, TCP handshake, TLS negotiation, and server processing.',
	'responsiveness-tooltip-trigger': "Apple's RPM metric quantifies network quality under load.",
	'packet-loss-tooltip-trigger': 'Percentage of ICMP packets lost during transmission.',
	'dns-tooltip-trigger': 'DNS lookup duration measures time to resolve domain names to IP addresses.',
};

let allData = [];
let charts = {};
let currentTimeRange = 'all';
let lastUpdatedInterval;
let retryCount = 0;
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

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
	mtrTimestamp: document.getElementById('mtrTimestamp'),
	mtrSelector: document.getElementById('mtrSelector'),
};

const commonOptions = {
	responsive: true,
	maintainAspectRatio: false,
	interaction: { mode: 'index', intersect: false },
	plugins: {
		legend: {
			display: true,
			position: 'bottom',
			align: 'start',
			labels: { color: '#94a3b8', boxWidth: 12, padding: 20, font: { size: 12 } },
		},
		tooltip: {
			backgroundColor: 'rgba(15, 23, 42, 0.95)',
			titleColor: '#cbd5e1',
			bodyColor: '#cbd5e1',
			borderColor: '#334155',
			borderWidth: 1,
			padding: 10,
		},
	},
	scales: {
		x: {
			type: 'time',
			time: { unit: 'hour', displayFormats: { hour: 'MMM d, ha' } },
			ticks: { color: '#94a3b8', font: { size: 11 }, maxRotation: 0, autoSkip: true },
			grid: { color: 'rgba(51, 65, 85, 0.5)', drawBorder: false },
		},
		y: {
			ticks: { color: '#94a3b8', font: { size: 11 } },
			grid: { color: 'rgba(51, 65, 85, 0.5)', drawBorder: false },
			beginAtZero: true,
		},
	},
	animation: { duration: 400, easing: 'easeOutQuad' },
};

// --- Utility ---
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

function formatTimestamp(timestamp) {
	const date = new Date(timestamp);
	return date.toLocaleString('en-US', {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZoneName: 'short',
	});
}

function isValidNumber(value) {
	return typeof value === 'number' && !isNaN(value) && isFinite(value);
}

function safeNumber(value, defaultValue = null) {
	return isValidNumber(value) ? value : defaultValue;
}

function calculateStatistics(values) {
	const filtered = values.filter((v) => v !== null && v !== undefined && isValidNumber(v));
	if (!filtered.length) return { avg: 'N/A', max: 'N/A', min: 'N/A', p95: 'N/A', median: 'N/A', stddev: 'N/A' };

	const sorted = [...filtered].sort((a, b) => a - b);
	const sum = sorted.reduce((a, b) => a + b, 0);
	const avg = sum / sorted.length;
	const max = Math.max(...sorted);
	const min = Math.min(...sorted);
	const p95 = sorted[Math.floor(sorted.length * 0.95)] || sorted[sorted.length - 1];
	const median = sorted[Math.floor(sorted.length / 2)];
	const variance = sorted.reduce((acc, val) => acc + Math.pow(val - avg, 2), 0) / sorted.length;
	const stddev = Math.sqrt(variance);

	return {
		avg: avg.toFixed(1),
		max: max.toFixed(1),
		min: min.toFixed(1),
		p95: p95.toFixed(1),
		median: median.toFixed(1),
		stddev: stddev.toFixed(1),
	};
}

function parseEndpointResults(data, field) {
	return data.map((d) => {
		try {
			return typeof d[field] === 'string' ? JSON.parse(d[field]) : d[field] || [];
		} catch (e) {
			console.warn(`Failed to parse ${field}:`, e);
			return [];
		}
	});
}

// --- Data Fetching ---
async function fetchData() {
	try {
		console.log('Fetching network logs...');
		const response = await fetch('/api/logs?limit=2000', { headers: { Accept: 'application/json' } });

		if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

		const data = await response.json();

		if (!Array.isArray(data)) throw new Error('Invalid data format');
		if (data.length === 0) {
			console.log('No data available');
			showUIState('empty');
			retryCount = 0;
			return;
		}

		allData = data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
		retryCount = 0;
		renderDashboard();
	} catch (error) {
		console.error('Failed to fetch data:', error);

		if (retryCount < MAX_RETRIES) {
			retryCount++;
			console.log(`Retrying (${retryCount}/${MAX_RETRIES})...`);
			showUIState('error', `Connection failed. Retrying... (${retryCount}/${MAX_RETRIES})`);
			setTimeout(fetchData, RETRY_DELAY);
		} else {
			showUIState('error', `Failed to load data: ${error.message}. Please refresh.`);
		}
	}
}

const filterDataByTimeRange = (hours) => {
	if (hours === 'all') return allData;
	const cutoff = Date.now() - hours * 60 * 60 * 1000;
	return allData.filter((d) => new Date(d.timestamp) >= cutoff);
};

// --- UI State ---
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
			break;
		case 'error':
			DOMElements.error.style.display = 'flex';
			DOMElements.errorText.textContent = message;
			DOMElements.statusBadge.style.background = 'var(--error)';
			DOMElements.statusText.textContent = 'Error';
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
		const lastTimestamp = allData[allData.length - 1].timestamp;
		DOMElements.lastUpdated.textContent = `Updated ${timeAgo(new Date(lastTimestamp))}`;
	}
}

// --- Rendering ---
function renderStats(data) {
	if (!data || data.length === 0) {
		DOMElements.statsGrid.innerHTML = '<p>No data</p>';
		return;
	}

	const pingResults = parseEndpointResults(data, 'ping_results');
	const firstPing = pingResults.find((r) => r.length > 0)?.[0];

	const stats = {
		download: calculateStatistics(data.map((d) => safeNumber(d.nq_download_mbps))),
		upload: calculateStatistics(data.map((d) => safeNumber(d.nq_upload_mbps))),
		latency: calculateStatistics(pingResults.flatMap((r) => r.map((e) => safeNumber(e.rtt_ms?.avg)))),
		responsiveness: calculateStatistics(data.map((d) => safeNumber(d.nq_responsiveness_rpm))),
		packetLoss: calculateStatistics(pingResults.flatMap((r) => r.map((e) => safeNumber(e.packet_loss_percent)))),
		totalTests: { avg: data.length },
	};

	const statHTML = (key, label, unit, higherIsBetter) => {
		const statData = stats[key];
		let indicator = '';
		if (higherIsBetter !== null) {
			indicator = `<span class="stat-indicator ${higherIsBetter ? 'good' : 'bad'}">${higherIsBetter ? '↑' : '↓'}</span>`;
		}
		let footer = `Min: ${statData.min}, Max: ${statData.max}`;
		if (key === 'latency') footer = `Median: ${statData.median}ms | P95: ${statData.p95}ms`;
		if (key === 'download' || key === 'upload') footer = `±${statData.stddev} ${unit} stddev`;
		if (key === 'totalTests') footer = 'Over selected time range';

		return `
			<div class="stat-card">
				<div class="stat-header">
					<div class="stat-label">${label}</div>
					${indicator}
				</div>
				<div class="stat-value">${statData.avg}<span class="stat-unit">${unit}</span></div>
				<div class="stat-footer">${footer}</div>
			</div>`;
	};

	DOMElements.statsGrid.innerHTML = [
		statHTML('download', 'Avg Download', 'Mbps', true),
		statHTML('upload', 'Avg Upload', 'Mbps', true),
		statHTML('latency', 'Avg Latency', 'ms', false),
		statHTML('responsiveness', 'Responsiveness', 'RPM', true),
		statHTML('packetLoss', 'Packet Loss', '%', false),
		statHTML('totalTests', 'Total Tests', '', null),
	].join('');
}

function renderHighlights(data) {
	if (!data || data.length === 0) {
		DOMElements.highlightsGrid.innerHTML = '';
		return;
	}

	const curlResults = parseEndpointResults(data, 'curl_results');
	const pingResults = parseEndpointResults(data, 'ping_results');
	const dnsResults = parseEndpointResults(data, 'dns_results');

	const curlStats = {};
	const pingStats = {};
	const dnsStats = {};

	curlResults.forEach((results) => {
		results.forEach((r) => {
			if (!curlStats[r.id]) curlStats[r.id] = { name: r.name, values: [] };
			if (r.ttfb_s) curlStats[r.id].values.push(r.ttfb_s * 1000);
		});
	});

	pingResults.forEach((results) => {
		results.forEach((r) => {
			if (!pingStats[r.id]) pingStats[r.id] = { name: r.name, values: [] };
			if (r.rtt_ms?.avg) pingStats[r.id].values.push(r.rtt_ms.avg);
		});
	});

	dnsResults.forEach((results) => {
		results.forEach((r) => {
			if (!dnsStats[r.id]) dnsStats[r.id] = { name: r.name, values: [] };
			if (r.query_time_ms) dnsStats[r.id].values.push(r.query_time_ms);
		});
	});

	const compare = (stats) => {
		const calculated = Object.entries(stats)
			.map(([id, { name, values }]) => ({
				id,
				name,
				avg: calculateStatistics(values).avg,
			}))
			.filter((s) => s.avg !== 'N/A');

		if (calculated.length < 2) return 'Insufficient data';

		calculated.sort((a, b) => parseFloat(a.avg) - parseFloat(b.avg));
		const fastest = calculated[0];
		const slowest = calculated[calculated.length - 1];
		const diff = parseFloat(slowest.avg) - parseFloat(fastest.avg);
		const diffPercent = ((diff / parseFloat(fastest.avg)) * 100).toFixed(0);

		return `<span class="faster">${fastest.name}</span> is <span class="slower">${diffPercent}%</span> faster than ${slowest.name}.`;
	};

	const highlightHTML = (title, body, footer) => `
		<div class="highlight-card">
			<div class="highlight-title">${title}</div>
			<div class="highlight-body">${body}</div>
			<div class="highlight-footer">${footer}</div>
		</div>
	`;

	const curlComparison = compare(curlStats);
	const pingComparison = compare(pingStats);
	const dnsComparison = compare(dnsStats);

	const curlFooter = Object.entries(curlStats)
		.map(([id, { name, values }]) => `${name}: ${calculateStatistics(values).avg}ms`)
		.join(' vs ');

	const pingFooter = Object.entries(pingStats)
		.map(([id, { name, values }]) => `${name}: ${calculateStatistics(values).avg}ms`)
		.join(' vs ');

	const dnsFooter = Object.entries(dnsStats)
		.map(([id, { name, values }]) => `${name}: ${calculateStatistics(values).avg}ms`)
		.join(' vs ');

	DOMElements.highlightsGrid.innerHTML = [
		highlightHTML('Fastest Endpoint (TTFB)', curlComparison, curlFooter),
		highlightHTML('Fastest Ping (RTT)', pingComparison, pingFooter),
		highlightHTML('Fastest DNS Lookup', dnsComparison, dnsFooter),
	].join('');
}

function createDataset(label, data, color) {
	return {
		label,
		data: data.map((point) => ({ x: point.x, y: isValidNumber(point.y) ? point.y : null })),
		borderColor: color,
		backgroundColor: `${color}30`,
		tension: 0.3,
		fill: false,
		pointRadius: 1.5,
		pointHoverRadius: 4,
		borderWidth: 1.5,
		spanGaps: true,
	};
}

function renderCharts(data) {
	if (!data || data.length === 0) return;

	Object.values(charts).forEach((chart) => chart.destroy());
	charts = {};

	const pingResults = parseEndpointResults(data, 'ping_results');
	const curlResults = parseEndpointResults(data, 'curl_results');
	const dnsResults = parseEndpointResults(data, 'dns_results');

	// Speed Chart
	charts.speedChart = new Chart(document.getElementById('speedChart'), {
		type: 'line',
		data: {
			datasets: [
				createDataset(
					'NQ Download',
					data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.nq_download_mbps) })),
					CHART_COLORS[0]
				),
				createDataset(
					'NQ Upload',
					data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.nq_upload_mbps) })),
					CHART_COLORS[1]
				),
				createDataset(
					'ST Download',
					data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.st_download_mbps) })),
					CHART_COLORS[5]
				),
			],
		},
		options: {
			...commonOptions,
			scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, title: { display: true, text: 'Mbps', color: '#94a3b8' } } },
		},
	});

	// RTT Chart - Dynamic endpoints
	const rttDatasets = [];
	const endpointRttData = {};

	pingResults.forEach((results, dataIndex) => {
		results.forEach((endpoint) => {
			if (!endpointRttData[endpoint.id]) {
				endpointRttData[endpoint.id] = { name: endpoint.name, data: [] };
			}
			endpointRttData[endpoint.id].data.push({
				x: new Date(data[dataIndex].timestamp),
				y: safeNumber(endpoint.rtt_ms?.avg),
			});
		});
	});

	Object.entries(endpointRttData).forEach(([id, { name, data: rttData }], index) => {
		rttDatasets.push(createDataset(name, rttData, CHART_COLORS[index % CHART_COLORS.length]));
	});

	charts.rttChart = new Chart(document.getElementById('rttChart'), {
		type: 'line',
		data: { datasets: rttDatasets },
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: { ...commonOptions.scales.y, title: { display: true, text: 'Latency (ms)', color: '#94a3b8' } },
			},
		},
	});

	// TTFB Chart - Dynamic endpoints
	const ttfbDatasets = [];
	const endpointTtfbData = {};

	curlResults.forEach((results, dataIndex) => {
		results.forEach((endpoint) => {
			if (!endpointTtfbData[endpoint.id]) {
				endpointTtfbData[endpoint.id] = { name: endpoint.name, data: [] };
			}
			endpointTtfbData[endpoint.id].data.push({
				x: new Date(data[dataIndex].timestamp),
				y: endpoint.ttfb_s ? safeNumber(endpoint.ttfb_s * 1000) : null,
			});
		});
	});

	Object.entries(endpointTtfbData).forEach(([id, { name, data: ttfbData }], index) => {
		ttfbDatasets.push(createDataset(`${name} TTFB`, ttfbData, CHART_COLORS[index + (4 % CHART_COLORS.length)]));
	});

	charts.ttfbChart = new Chart(document.getElementById('ttfbChart'), {
		type: 'line',
		data: { datasets: ttfbDatasets },
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: { ...commonOptions.scales.y, title: { display: true, text: 'Latency (ms)', color: '#94a3b8' } },
			},
		},
	});

	// Responsiveness Chart
	charts.responsivenessChart = new Chart(document.getElementById('responsivenessChart'), {
		type: 'bar',
		data: {
			datasets: [
				{
					label: 'RPM',
					data: data.map((d) => ({ x: new Date(d.timestamp), y: safeNumber(d.nq_responsiveness_rpm) })),
					backgroundColor: `${CHART_COLORS[0]}CC`,
					borderColor: CHART_COLORS[0],
					borderWidth: 1,
				},
			],
		},
		options: {
			...commonOptions,
			scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, title: { display: true, text: 'RPM', color: '#94a3b8' } } },
		},
	});

	// Packet Loss Chart - Dynamic endpoints
	const lossDatasets = [];
	const endpointLossData = {};

	pingResults.forEach((results, dataIndex) => {
		results.forEach((endpoint) => {
			if (!endpointLossData[endpoint.id]) {
				endpointLossData[endpoint.id] = { name: endpoint.name, data: [] };
			}
			endpointLossData[endpoint.id].data.push({
				x: new Date(data[dataIndex].timestamp),
				y: safeNumber(endpoint.packet_loss_percent),
			});
		});
	});

	Object.entries(endpointLossData).forEach(([id, { name, data: lossData }], index) => {
		lossDatasets.push(createDataset(`${name} Loss`, lossData, CHART_COLORS[index % CHART_COLORS.length]));
	});

	charts.packetLossChart = new Chart(document.getElementById('packetLossChart'), {
		type: 'line',
		data: { datasets: lossDatasets },
		options: {
			...commonOptions,
			scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, max: 5, title: { display: true, text: '%', color: '#94a3b8' } } },
		},
	});

	// DNS Chart - Dynamic endpoints
	const dnsDatasets = [];
	const endpointDnsData = {};

	dnsResults.forEach((results, dataIndex) => {
		results.forEach((endpoint) => {
			if (!endpointDnsData[endpoint.id]) {
				endpointDnsData[endpoint.id] = { name: endpoint.name, data: [] };
			}
			endpointDnsData[endpoint.id].data.push({
				x: new Date(data[dataIndex].timestamp),
				y: safeNumber(endpoint.query_time_ms),
			});
		});
	});

	Object.entries(endpointDnsData).forEach(([id, { name, data: dnsData }], index) => {
		dnsDatasets.push(createDataset(name, dnsData, CHART_COLORS[index + (4 % CHART_COLORS.length)]));
	});

	charts.dnsChart = new Chart(document.getElementById('dnsChart'), {
		type: 'line',
		data: { datasets: dnsDatasets },
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: { ...commonOptions.scales.y, title: { display: true, text: 'Latency (ms)', color: '#94a3b8' } },
			},
		},
	});
}

function renderMtrTable(data) {
	if (!data || data.length === 0) {
		DOMElements.mtrSection.style.display = 'none';
		document.getElementById('mtr-google-section').style.display = 'none';
		return;
	}

	const mtrResults = parseEndpointResults(data, 'mtr_results');
	const entriesWithMTR = data.filter((_, index) => mtrResults[index] && mtrResults[index].length > 0);

	if (entriesWithMTR.length === 0) {
		DOMElements.mtrSection.style.display = 'none';
		document.getElementById('mtr-google-section').style.display = 'none';
		return;
	}

	const selectorHTML = entriesWithMTR
		.reverse()
		.map((entry, index) => `<option value="${index}">${formatTimestamp(entry.timestamp)}</option>`)
		.join('');

	DOMElements.mtrSelector.innerHTML = selectorHTML;
	displayMtrForIndex(0, entriesWithMTR, mtrResults.reverse());
}

function displayMtrForIndex(index, entriesWithMTR, mtrResults) {
	const entry = entriesWithMTR[index];
	const results = mtrResults[index];

	DOMElements.mtrTimestamp.textContent = `Captured: ${formatTimestamp(entry.timestamp)}`;
	DOMElements.mtrSection.style.display = 'block';

	if (!results || results.length === 0) {
		DOMElements.mtrTableContainer.innerHTML = `<p class="chart-description">No MTR data available.</p>`;
		return;
	}

	// Display first endpoint (usually Cloudflare)
	const firstEndpoint = results[0];
	if (!firstEndpoint.hops || firstEndpoint.hops.length === 0) {
		DOMElements.mtrTableContainer.innerHTML = `<p class="chart-description">MTR test failed or incomplete.</p>`;
	} else {
		DOMElements.mtrTableContainer.innerHTML = generateMtrTableHTML(firstEndpoint.hops);
	}

	// Handle Google MTR if exists
	const googleSection = document.getElementById('mtr-google-section');
	const googleContainer = document.getElementById('mtrGoogleTableContainer');
	if (results.length > 1 && googleSection && googleContainer) {
		googleSection.style.display = 'block';
		const secondEndpoint = results[1];
		if (secondEndpoint.hops && secondEndpoint.hops.length > 0) {
			googleContainer.innerHTML = generateMtrTableHTML(secondEndpoint.hops);
		} else {
			googleContainer.innerHTML = `<p class="chart-description">MTR test failed.</p>`;
		}
	}
}

function generateMtrTableHTML(hops) {
	let html = `
		<table class="mtr-table">
			<thead>
				<tr>
					<th>Hop</th><th>Host</th><th>Loss %</th><th>Sent</th>
					<th>Last (ms)</th><th>Avg (ms)</th><th>Best (ms)</th><th>Worst (ms)</th><th>StdDev</th>
				</tr>
			</thead>
			<tbody>
	`;

	hops.forEach((hop) => {
		const lossPercent = safeNumber(hop.loss_percent, 0);
		const lossClass = lossPercent > 10 ? 'loss-high' : lossPercent > 0 ? 'loss-medium' : '';
		html += `
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

	html += `</tbody></table>`;
	return html;
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
		showUIState('error', 'Failed to render dashboard. Please refresh.');
	}
}

// --- Tooltips ---
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

// --- Event Listeners ---
DOMElements.timeRange?.addEventListener('change', (e) => {
	currentTimeRange = e.target.value;
	renderDashboard();
});

DOMElements.mtrSelector?.addEventListener('change', (e) => {
	const index = parseInt(e.target.value, 10);
	const filteredData = filterDataByTimeRange(currentTimeRange);
	const mtrResults = parseEndpointResults(filteredData, 'mtr_results');
	const entriesWithMTR = filteredData.filter((_, i) => mtrResults[i] && mtrResults[i].length > 0).reverse();
	displayMtrForIndex(index, entriesWithMTR, mtrResults.reverse());
});

// --- Initialize ---
document.addEventListener('DOMContentLoaded', () => {
	showUIState('loading');
	fetchData();
	setInterval(fetchData, 300000);
	initializeTooltips();
});
