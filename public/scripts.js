let allData = [];
let charts = {};

async function fetchData() {
	try {
		const response = await fetch('/api/logs?limit=1000');
		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}
		allData = await response.json();

		if (!Array.isArray(allData)) {
			throw new Error('Invalid data format received');
		}

		if (allData.length === 0) {
			showEmptyState();
			return;
		}

		allData.reverse();
		renderDashboard();
	} catch (error) {
		showError(`Failed to load data: ${error.message}`);
	}
}

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

function filterDataByTimeRange(hours) {
	if (hours === 'all') return allData;
	const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
	return allData.filter((entry) => new Date(entry.timestamp) >= cutoff);
}

function calculateStats(data) {
	const validDownloads = data.filter((d) => d.nq_download_mbps).map((d) => d.nq_download_mbps);
	const validUploads = data.filter((d) => d.nq_upload_mbps).map((d) => d.nq_upload_mbps);
	const validPings = data.filter((d) => d.ping_cf_rtt_avg).map((d) => d.ping_cf_rtt_avg);
	const validResponsiveness = data.filter((d) => d.nq_responsiveness).map((d) => d.nq_responsiveness);
	const validPacketLoss = data.filter((d) => d.ping_cf_packet_loss != null).map((d) => d.ping_cf_packet_loss);

	const avg = (arr) => (arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : 'N/A');
	const max = (arr) => (arr.length ? Math.max(...arr).toFixed(1) : 'N/A');
	const min = (arr) => (arr.length ? Math.min(...arr).toFixed(1) : 'N/A');

	return {
		avgDownload: avg(validDownloads),
		maxDownload: max(validDownloads),
		minDownload: min(validDownloads),
		avgUpload: avg(validUploads),
		maxUpload: max(validUploads),
		minUpload: min(validUploads),
		avgLatency: avg(validPings),
		minLatency: min(validPings),
		avgResponsiveness: avg(validResponsiveness),
		avgPacketLoss: avg(validPacketLoss),
		totalTests: data.length,
	};
}

function renderStats(stats) {
	const statsGrid = document.getElementById('statsGrid');
	statsGrid.innerHTML = `
        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-label">Avg Download</div>
            <div class="stat-icon">↓</div>
          </div>
          <div class="stat-value">${stats.avgDownload}<span class="stat-unit">Mbps</span></div>
          <div class="stat-footer">
            <span>Max: ${stats.maxDownload}</span>
            <span>Min: ${stats.minDownload}</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-label">Avg Upload</div>
            <div class="stat-icon">↑</div>
          </div>
          <div class="stat-value">${stats.avgUpload}<span class="stat-unit">Mbps</span></div>
          <div class="stat-footer">
            <span>Max: ${stats.maxUpload}</span>
            <span>Min: ${stats.minUpload}</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-label">Avg Latency</div>
            <div class="stat-icon">⚡</div>
          </div>
          <div class="stat-value">${stats.avgLatency}<span class="stat-unit">ms</span></div>
          <div class="stat-footer">
            <span>Min: ${stats.minLatency} ms</span>
          </div>
        </div>
        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-label">Responsiveness</div>
            <div class="stat-icon">◉</div>
          </div>
          <div class="stat-value">${stats.avgResponsiveness}<span class="stat-unit">RPM</span></div>
        </div>
        <div class="stat-card">
          <div class="stat-header">
            <div class="stat-label">Packet Loss</div>
            <div class="stat-icon">×</div>
          </div>
          <div class="stat-value">${stats.avgPacketLoss}<span class="stat-unit">%</span></div>
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

function renderCharts(data) {
	const labels = data.map((d) => {
		const date = new Date(d.timestamp);
		return date.toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});
	});

	Object.values(charts).forEach((chart) => chart.destroy());
	charts = {};

	const commonOptions = {
		responsive: true,
		maintainAspectRatio: true,
		plugins: {
			legend: {
				position: 'top',
				labels: {
					color: '#cbd5e1',
					font: { size: 11 },
					padding: 15,
					usePointStyle: true,
				},
			},
		},
		scales: {
			x: {
				ticks: { color: '#64748b', font: { size: 10 } },
				grid: { color: '#334155' },
			},
			y: {
				ticks: { color: '#64748b', font: { size: 10 } },
				grid: { color: '#334155' },
			},
		},
	};

	// Speed Chart
	charts.speed = new Chart(document.getElementById('speedChart'), {
		type: 'line',
		data: {
			labels,
			datasets: [
				{
					label: 'NQ Download',
					data: data.map((d) => d.nq_download_mbps),
					borderColor: '#3b82f6',
					backgroundColor: '#3b82f620',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
				},
				{
					label: 'NQ Upload',
					data: data.map((d) => d.nq_upload_mbps),
					borderColor: '#8b5cf6',
					backgroundColor: '#8b5cf620',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
				},
				{
					label: 'ST Download',
					data: data.map((d) => d.st_download_mbps),
					borderColor: '#f59e0b',
					backgroundColor: '#f59e0b20',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
					borderDash: [5, 5],
				},
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: {
					...commonOptions.scales.y,
					beginAtZero: true,
					title: { display: true, text: 'Mbps', color: '#64748b' },
				},
			},
		},
	});

	// Latency Chart
	charts.latency = new Chart(document.getElementById('latencyChart'), {
		type: 'line',
		data: {
			labels,
			datasets: [
				{
					label: 'Cloudflare RTT',
					data: data.map((d) => d.ping_cf_rtt_avg),
					borderColor: '#06b6d4',
					backgroundColor: '#06b6d420',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
				},
				{
					label: 'Google RTT',
					data: data.map((d) => d.ping_google_rtt_avg),
					borderColor: '#10b981',
					backgroundColor: '#10b98120',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
				},
				{
					label: 'US TTFB',
					data: data.map((d) => (d.curl_us_ttfb ? d.curl_us_ttfb * 1000 : null)),
					borderColor: '#ec4899',
					backgroundColor: '#ec489920',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
				},
				{
					label: 'EU TTFB',
					data: data.map((d) => (d.curl_eu_ttfb ? d.curl_eu_ttfb * 1000 : null)),
					borderColor: '#f59e0b',
					backgroundColor: '#f59e0b20',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
				},
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: {
					...commonOptions.scales.y,
					beginAtZero: true,
					title: { display: true, text: 'ms', color: '#64748b' },
				},
			},
		},
	});

	// Responsiveness Chart
	charts.responsiveness = new Chart(document.getElementById('responsivenessChart'), {
		type: 'bar',
		data: {
			labels,
			datasets: [
				{
					label: 'RPM',
					data: data.map((d) => d.nq_responsiveness),
					backgroundColor: '#3b82f6CC',
					borderColor: '#3b82f6',
					borderWidth: 1,
				},
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: {
					...commonOptions.scales.y,
					beginAtZero: true,
					title: { display: true, text: 'Requests per Minute', color: '#64748b' },
				},
			},
		},
	});

	// Packet Loss Chart
	charts.packetLoss = new Chart(document.getElementById('packetLossChart'), {
		type: 'line',
		data: {
			labels,
			datasets: [
				{
					label: 'Cloudflare Loss',
					data: data.map((d) => d.ping_cf_packet_loss),
					borderColor: '#06b6d4',
					backgroundColor: '#06b6d420',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
				},
				{
					label: 'Google Loss',
					data: data.map((d) => d.ping_google_packet_loss),
					borderColor: '#10b981',
					backgroundColor: '#10b98120',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
				},
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: {
					...commonOptions.scales.y,
					beginAtZero: true,
					title: { display: true, text: 'Packet Loss %', color: '#64748b' },
					max: 10,
				},
			},
		},
	});

	// DNS Chart
	charts.dns = new Chart(document.getElementById('dnsChart'), {
		type: 'line',
		data: {
			labels,
			datasets: [
				{
					label: 'US DNS Lookup',
					data: data.map((d) => (d.curl_us_dns_lookup ? d.curl_us_dns_lookup * 1000 : null)),
					borderColor: '#ec4899',
					backgroundColor: '#ec489920',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
				},
				{
					label: 'EU DNS Lookup',
					data: data.map((d) => (d.curl_eu_dns_lookup ? d.curl_eu_dns_lookup * 1000 : null)),
					borderColor: '#f59e0b',
					backgroundColor: '#f59e0b20',
					tension: 0.3,
					fill: true,
					pointRadius: 2,
					pointHoverRadius: 4,
				},
			],
		},
		options: {
			...commonOptions,
			scales: {
				...commonOptions.scales,
				y: {
					...commonOptions.scales.y,
					beginAtZero: true,
					title: { display: true, text: 'ms', color: '#64748b' },
				},
			},
		},
	});
}

function renderDashboard() {
	const timeRange = document.getElementById('timeRange').value;
	const filteredData = filterDataByTimeRange(timeRange);
	const stats = calculateStats(filteredData);

	renderStats(stats);
	renderCharts(filteredData);

	document.getElementById('loading').style.display = 'none';
	document.getElementById('content').style.display = 'block';
}

document.getElementById('timeRange').addEventListener('change', renderDashboard);

fetchData();
