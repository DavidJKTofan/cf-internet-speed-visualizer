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
		'DNS lookup duration measures the time required to resolve domain names to IP addresses. This is the first step in any web request and directly impacts perceived load times. Values above 100ms can suggest DNS server issues.',
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
};

// Chart configuration
const commonOptions = {
	responsive: true,
	maintainAspectRatio: false,
	interaction: { mode: 'index', intersect: false },
	plugins: {
		legend: { display: false },
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
			ticks: { color: '#94a3b8', font: { size: 11 }, maxRotation: 30, minRotation: 30 },
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
const formatTimestamp = (timestamp) => new Date(timestamp).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

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

function calculateStatistics(values) {
	const filteredValues = values.filter((v) => v !== null && !isNaN(v));
	if (!filteredValues.length) return { avg: 'N/A', max: 'N/A', min: 'N/A', p95: 'N/A' };

	const sorted = [...filteredValues].sort((a, b) => a - b);
	const sum = sorted.reduce((a, b) => a + b, 0);
	const avg = sum / sorted.length;
	const max = Math.max(...sorted);
	const min = Math.min(...sorted);
	const p95 = sorted[Math.floor(sorted.length * 0.95)];

	return {
		avg: avg.toFixed(1),
		max: max.toFixed(1),
		min: min.toFixed(1),
		p95: p95.toFixed(1),
	};
}

// API
async function fetchData() {
	try {
		const response = await fetch('/api/logs?limit=2000');
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const data = await response.json();
		if (!Array.isArray(data)) throw new Error('Invalid data format');

		if (data.length === 0) {
			showUIState('empty');
			return;
		}

		allData = data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
		renderDashboard();
	} catch (error) {
		showUIState('error', `Failed to load: ${error.message}`);
	}
}

// Data filtering
const filterDataByTimeRange = (hours) =>
	hours === 'all' ? allData : allData.filter((d) => new Date(d.timestamp) >= Date.now() - hours * 60 * 60 * 1000);

// UI State management
function showUIState(state, message = '') {
	DOMElements.loading.style.display = 'none';
	DOMElements.content.style.display = 'none';
	DOMElements.emptyState.style.display = 'none';
	DOMElements.error.style.display = 'none';

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
		const lastTimestamp = allData[allData.length - 1].timestamp;
		DOMElements.lastUpdated.textContent = `Updated ${timeAgo(new Date(lastTimestamp))}`;
	}
}

// Rendering
function renderStats(data) {
	const stats = {
		download: calculateStatistics(data.map((d) => d.nq_download_mbps)),
		upload: calculateStatistics(data.map((d) => d.nq_upload_mbps)),
		latency: calculateStatistics(data.map((d) => d.ping_cf_rtt_avg)),
		responsiveness: calculateStatistics(data.map((d) => d.nq_responsiveness)),
		packetLoss: calculateStatistics(data.map((d) => d.ping_cf_packet_loss)),
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

	DOMElements.statsGrid.innerHTML = Object.entries(stats).map(([key, data]) => statHTML(key, data)).join('');
}


function renderHighlights(data) {
	const ttfbUS = calculateStatistics(data.map((d) => (d.curl_us_ttfb ? d.curl_us_ttfb * 1000 : null)));
	const ttfbEU = calculateStatistics(data.map((d) => (d.curl_eu_ttfb ? d.curl_eu_ttfb * 1000 : null)));
	const rttCF = calculateStatistics(data.map((d) => d.ping_cf_rtt_avg));
	const rttGoogle = calculateStatistics(data.map((d) => d.ping_google_rtt_avg));
	const dnsUS = calculateStatistics(data.map((d) => (d.curl_us_dns_lookup ? d.curl_us_dns_lookup * 1000 : null)));
	const dnsEU = calculateStatistics(data.map((d) => (d.curl_eu_dns_lookup ? d.curl_eu_dns_lookup * 1000 : null)));

	const comparison = (a, b, nameA, nameB, unit) => {
		if (a.avg === 'N/A' || b.avg === 'N/A') return 'N/A';
		const faster = parseFloat(a.avg) < parseFloat(b.avg) ? nameA : nameB;
		const slower = faster === nameA ? nameB : nameA;
		const diff = Math.abs(a.avg - b.avg);
		const diffPercent = (diff / Math.min(a.avg, b.avg)) * 100;

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
		highlightHTML('Fastest Endpoint (TTFB)', comparison(ttfbUS, ttfbEU, 'US', 'EU', 'ms'), `US: ${ttfbUS.avg}ms vs EU: ${ttfbEU.avg}ms`),
		highlightHTML('Fastest Ping (RTT)', comparison(rttCF, rttGoogle, 'Cloudflare', 'Google', 'ms'), `CF: ${rttCF.avg}ms vs Google: ${rttGoogle.avg}ms`),
		highlightHTML('Fastest DNS Lookup', comparison(dnsUS, dnsEU, 'US', 'EU', 'ms'), `US: ${dnsUS.avg}ms vs EU: ${dnsEU.avg}ms`),
	].join('');
}

function createDataset(label, data, color, options = {}) {
	return {
		label,
		data,
		borderColor: color,
		backgroundColor: `${color}30`,
		tension: 0.3,
		fill: true,
		pointRadius: 1.5,
		pointHoverRadius: 4,
		borderWidth: 1.5,
		...options,
	};
}

function renderCharts(data) {
	const labels = data.map((d) => formatTimestamp(d.timestamp));

	Object.values(charts).forEach((chart) => chart.destroy());
	charts = {};

	const chartConfigs = {
		speedChart: {
			type: 'line',
			data: {
				datasets: [
					createDataset('NQ Download', data.map(d => d.nq_download_mbps), CHART_COLORS.primary),
					createDataset('NQ Upload', data.map(d => d.nq_upload_mbps), CHART_COLORS.secondary),
					createDataset('ST Download', data.map(d => d.st_download_mbps), CHART_COLORS.senary, { borderDash: [5, 5], fill: false }),
				],
			},
			options: { ...commonOptions, scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, title: { display: true, text: 'Mbps', color: '#94a3b8' } } } },
		},
		latencyChart: {
			type: 'line',
			data: {
				datasets: [
					createDataset('Cloudflare RTT', data.map(d => d.ping_cf_rtt_avg), CHART_COLORS.tertiary),
					createDataset('Google RTT', data.map(d => d.ping_google_rtt_avg), CHART_COLORS.quaternary),
					createDataset('US TTFB', data.map(d => d.curl_us_ttfb ? d.curl_us_ttfb * 1000 : null), CHART_COLORS.quinary, { fill: false, borderDash: [5, 5] }),
					createDataset('EU TTFB', data.map(d => d.curl_eu_ttfb ? d.curl_eu_ttfb * 1000 : null), CHART_COLORS.senary, { fill: false, borderDash: [5, 5] }),
				],
			},
			options: { ...commonOptions, scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, title: { display: true, text: 'ms', color: '#94a3b8' } } } },
		},
		responsivenessChart: {
			type: 'bar',
			data: {
				datasets: [
					{ label: 'RPM', data: data.map(d => d.nq_responsiveness), backgroundColor: `${CHART_COLORS.primary}CC`, borderColor: CHART_COLORS.primary, borderWidth: 1 },
				]
			},
			options: { ...commonOptions, scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, title: { display: true, text: 'RPM', color: '#94a3b8' } } } },
		},
		packetLossChart: {
			type: 'line',
			data: {
				datasets: [
					createDataset('Cloudflare Loss', data.map(d => d.ping_cf_packet_loss), CHART_COLORS.tertiary),
					createDataset('Google Loss', data.map(d => d.ping_google_packet_loss), CHART_COLORS.quaternary),
				],
			},
			options: { ...commonOptions, scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, max: 5, title: { display: true, text: '%', color: '#94a3b8' } } } },
		},
		dnsChart: {
			type: 'line',
			data: {
				datasets: [
					createDataset('US DNS', data.map(d => d.curl_us_dns_lookup ? d.curl_us_dns_lookup * 1000 : null), CHART_COLORS.quinary),
					createDataset('EU DNS', data.map(d => d.curl_eu_dns_lookup ? d.curl_eu_dns_lookup * 1000 : null), CHART_COLORS.senary),
				],
			},
			options: { ...commonOptions, scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, title: { display: true, text: 'ms', color: '#94a3b8' } } } },
		},
	};

	for (const [id, config] of Object.entries(chartConfigs)) {
		const ctx = document.getElementById(id);
		if (ctx) {
			config.data.labels = labels;
			charts[id] = new Chart(ctx, config);
		}
	}
}

function renderDashboard() {
	const filteredData = filterDataByTimeRange(currentTimeRange);
	if (filteredData.length === 0) {
		showUIState('empty');
		return;
	}

	showUIState('content');
	renderStats(filteredData);
	renderHighlights(filteredData);
	renderCharts(filteredData);
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