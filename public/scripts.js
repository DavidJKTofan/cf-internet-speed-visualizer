// Constants
const CHART_COLORS = {
	primary: '#3b82f6',
	secondary: '#8b5cf6',
	tertiary: '#06b6d4',
	quaternary: '#10b981',
	quinary: '#ec4899',
	senary: '#f59e0b',
};

// State
let allData = [];
let charts = {};
let currentTimeRange = 'all';

// Chart configuration
const commonOptions = {
	responsive: true,
	maintainAspectRatio: true,
	interaction: { mode: 'index', intersect: false },
	plugins: {
		legend: {
			position: 'top',
			labels: {
				color: '#cbd5e1',
				font: { size: 11 },
				padding: 15,
				usePointStyle: true,
				boxWidth: 6,
				boxHeight: 6,
			},
		},
		tooltip: {
			backgroundColor: 'rgba(15, 23, 42, 0.95)',
			titleColor: '#cbd5e1',
			bodyColor: '#cbd5e1',
			borderColor: '#334155',
			borderWidth: 1,
			padding: 12,
			displayColors: true,
		},
	},
	scales: {
		x: {
			ticks: { color: '#64748b', font: { size: 10 }, maxRotation: 45, minRotation: 45 },
			grid: { color: '#334155', drawBorder: false },
		},
		y: {
			ticks: { color: '#64748b', font: { size: 10 } },
			grid: { color: '#334155', drawBorder: false },
		},
	},
};

// Utility functions
function formatTimestamp(timestamp) {
	const date = new Date(timestamp);
	const now = new Date();
	const diffHours = Math.abs(now - date) / 36e5;

	if (diffHours < 24) {
		return date.toLocaleString('en-US', { hour: '2-digit', minute: '2-digit' });
	}
	return date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit' });
}

function calculateStatistics(values) {
	if (!values.length) return { avg: 'N/A', max: 'N/A', min: 'N/A', p95: 'N/A' };

	const sorted = [...values].sort((a, b) => a - b);
	const avg = values.reduce((a, b) => a + b, 0) / values.length;
	const p95 = sorted[Math.floor(sorted.length * 0.95)];

	return {
		avg: avg.toFixed(1),
		max: Math.max(...values).toFixed(1),
		min: Math.min(...values).toFixed(1),
		p95: p95.toFixed(1),
	};
}

// API
async function fetchData() {
	try {
		const response = await fetch('/api/logs?limit=1000');
		if (!response.ok) throw new Error(`HTTP ${response.status}`);

		const data = await response.json();
		if (!Array.isArray(data)) throw new Error('Invalid data format');
		if (data.length === 0) {
			showEmptyState();
			return;
		}

		allData = data.reverse();
		renderDashboard();
	} catch (error) {
		showError(`Failed to load: ${error.message}`);
	}
}

function filterDataByTimeRange(hours) {
	if (hours === 'all') return allData;
	const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
	return allData.filter((entry) => new Date(entry.timestamp) >= cutoff);
}

function calculateStats(data) {
	const downloads = data.filter((d) => d.nq_download_mbps).map((d) => d.nq_download_mbps);
	const uploads = data.filter((d) => d.nq_upload_mbps).map((d) => d.nq_upload_mbps);
	const pings = data.filter((d) => d.ping_cf_rtt_avg).map((d) => d.ping_cf_rtt_avg);
	const responsiveness = data.filter((d) => d.nq_responsiveness).map((d) => d.nq_responsiveness);
	const packetLoss = data.filter((d) => d.ping_cf_packet_loss != null).map((d) => d.ping_cf_packet_loss);

	return {
		download: calculateStatistics(downloads),
		upload: calculateStatistics(uploads),
		latency: calculateStatistics(pings),
		responsiveness: calculateStatistics(responsiveness),
		packetLoss: calculateStatistics(packetLoss),
		totalTests: data.length,
	};
}
// UI
function showEmptyState() {
	document.getElementById('loading').style.display = 'none';
	document.getElementById('emptyState').style.display = 'flex';
	document.getElementById('statusBadge').style.background = 'var(--text-muted)';
	document.getElementById('statusText').textContent = 'No Data';
}

function showError(message) {
	document.getElementById('loading').style.display = 'none';
	document.getElementById('error').style.display = 'flex';
	document.getElementById('errorText').textContent = message;
	document.getElementById('statusBadge').style.background = 'var(--error)';
	document.getElementById('statusText').textContent = 'Error';
}

function renderStats(stats) {
	document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-label">Avg Download</div>
        <div class="stat-icon">↓</div>
      </div>
      <div class="stat-value">${stats.download.avg}<span class="stat-unit">Mbps</span></div>
      <div class="stat-footer">
        <span>Max: ${stats.download.max}</span>
        <span>Min: ${stats.download.min}</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-label">Avg Upload</div>
        <div class="stat-icon">↑</div>
      </div>
      <div class="stat-value">${stats.upload.avg}<span class="stat-unit">Mbps</span></div>
      <div class="stat-footer">
        <span>Max: ${stats.upload.max}</span>
        <span>Min: ${stats.upload.min}</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-label">Avg Latency</div>
        <div class="stat-icon">⚡</div>
      </div>
      <div class="stat-value">${stats.latency.avg}<span class="stat-unit">ms</span></div>
      <div class="stat-footer">
        <span>P95: ${stats.latency.p95}</span>
      </div>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-label">Responsiveness</div>
        <div class="stat-icon">◉</div>
      </div>
      <div class="stat-value">${stats.responsiveness.avg}<span class="stat-unit">RPM</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-label">Packet Loss</div>
        <div class="stat-icon">×</div>
      </div>
      <div class="stat-value">${stats.packetLoss.avg}<span class="stat-unit">%</span></div>
    </div>
    <div class="stat-card">
      <div class="stat-header">
        <div class="stat-label">Total Tests</div>
        <div class="stat-icon">#</div>
      </div>
      <div class="stat-value">${stats.totalTests}</div>
    </div>
  `;
}

function createDataset(label, data, color, options = {}) {
	return {
		label,
		data,
		borderColor: color,
		backgroundColor: color + '20',
		tension: 0.3,
		fill: true,
		pointRadius: 2,
		pointHoverRadius: 5,
		...options,
	};
}

function renderCharts(data) {
	const labels = data.map((d) => formatTimestamp(d.timestamp));

	Object.values(charts).forEach((chart) => chart.destroy());
	charts = {};

	charts.speed = new Chart(document.getElementById('speedChart'), {
		type: 'line',
		data: {
			labels,
			datasets: [
				createDataset(
					'NQ Download',
					data.map((d) => d.nq_download_mbps),
					CHART_COLORS.primary
				),
				createDataset(
					'NQ Upload',
					data.map((d) => d.nq_upload_mbps),
					CHART_COLORS.secondary
				),
				createDataset(
					'ST Download',
					data.map((d) => d.st_download_mbps),
					CHART_COLORS.senary,
					{ borderDash: [5, 5] }
				),
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: { ...commonOptions.scales.y, beginAtZero: true, title: { display: true, text: 'Mbps', color: '#64748b' } },
			},
		},
	});

	charts.latency = new Chart(document.getElementById('latencyChart'), {
		type: 'line',
		data: {
			labels,
			datasets: [
				createDataset(
					'Cloudflare RTT',
					data.map((d) => d.ping_cf_rtt_avg),
					CHART_COLORS.tertiary
				),
				createDataset(
					'Google RTT',
					data.map((d) => d.ping_google_rtt_avg),
					CHART_COLORS.quaternary
				),
				createDataset(
					'US TTFB',
					data.map((d) => (d.curl_us_ttfb ? d.curl_us_ttfb * 1000 : null)),
					CHART_COLORS.quinary
				),
				createDataset(
					'EU TTFB',
					data.map((d) => (d.curl_eu_ttfb ? d.curl_eu_ttfb * 1000 : null)),
					CHART_COLORS.senary
				),
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: { ...commonOptions.scales.y, beginAtZero: true, title: { display: true, text: 'ms', color: '#64748b' } },
			},
		},
	});

	charts.responsiveness = new Chart(document.getElementById('responsivenessChart'), {
		type: 'bar',
		data: {
			labels,
			datasets: [
				{
					label: 'RPM',
					data: data.map((d) => d.nq_responsiveness),
					backgroundColor: CHART_COLORS.primary + 'CC',
					borderColor: CHART_COLORS.primary,
					borderWidth: 1,
				},
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: { ...commonOptions.scales.y, beginAtZero: true, title: { display: true, text: 'RPM', color: '#64748b' } },
			},
		},
	});

	charts.packetLoss = new Chart(document.getElementById('packetLossChart'), {
		type: 'line',
		data: {
			labels,
			datasets: [
				createDataset(
					'Cloudflare',
					data.map((d) => d.ping_cf_packet_loss),
					CHART_COLORS.tertiary
				),
				createDataset(
					'Google',
					data.map((d) => d.ping_google_packet_loss),
					CHART_COLORS.quaternary
				),
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: { ...commonOptions.scales.y, beginAtZero: true, max: 5, title: { display: true, text: '%', color: '#64748b' } },
			},
		},
	});

	charts.dns = new Chart(document.getElementById('dnsChart'), {
		type: 'line',
		data: {
			labels,
			datasets: [
				createDataset(
					'US DNS',
					data.map((d) => (d.curl_us_dns_lookup ? d.curl_us_dns_lookup * 1000 : null)),
					CHART_COLORS.quinary
				),
				createDataset(
					'EU DNS',
					data.map((d) => (d.curl_eu_dns_lookup ? d.curl_eu_dns_lookup * 1000 : null)),
					CHART_COLORS.senary
				),
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: { ...commonOptions.scales.y, beginAtZero: true, title: { display: true, text: 'ms', color: '#64748b' } },
			},
		},
	});
}

function renderDashboard() {
	const filteredData = filterDataByTimeRange(currentTimeRange);
	if (filteredData.length === 0) {
		showEmptyState();
		return;
	}

	const stats = calculateStats(filteredData);
	renderStats(stats);
	renderCharts(filteredData);

	document.getElementById('loading').style.display = 'none';
	document.getElementById('content').style.display = 'block';
	document.getElementById('statusBadge').style.background = 'var(--success)';
	document.getElementById('statusText').textContent = 'Live';
}

// Events
document.getElementById('timeRange')?.addEventListener('change', (e) => {
	currentTimeRange = e.target.value;
	renderDashboard();
});

// Initialize
fetchData();
setInterval(fetchData, 300000);
