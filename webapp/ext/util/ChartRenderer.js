sap.ui.define([], function () {
	"use strict";

	var PALETTE = ["#5B8FF9", "#61DDAA", "#F6BD16", "#F87070", "#7262FD", "#78D3F8", "#9661BC", "#F6903D"];

	var iChartCounter = 0;

	function toBase64Json(oValue) {
		return btoa(unescape(encodeURIComponent(JSON.stringify(oValue))));
	}

	/**
	 * Builds a Chart.js config from a {type, title, data:[{label,value}]}
	 * spec. Bar charts use a horizontal layout (indexAxis:'y') so long
	 * real-world labels (customer names, etc.) read left-to-right instead
	 * of needing to be rotated/truncated.
	 */
	function buildConfig(oSpec) {
		var bPie = oSpec.type === "pie";
		return {
			type: bPie ? "pie" : "bar",
			data: {
				labels: oSpec.data.map(function (oPoint) { return String(oPoint.label); }),
				datasets: [{
					data: oSpec.data.map(function (oPoint) { return Number(oPoint.value) || 0; }),
					backgroundColor: oSpec.data.map(function (oPoint, i) { return PALETTE[i % PALETTE.length]; }),
					borderColor: "#ffffff",
					borderWidth: bPie ? 2 : 0,
					borderRadius: bPie ? 0 : 4
				}]
			},
			options: {
				responsive: true,
				maintainAspectRatio: false,
				indexAxis: bPie ? undefined : "y",
				plugins: {
					title: oSpec.title ? { display: true, text: oSpec.title, font: { size: 14 } } : { display: false },
					legend: { display: bPie, position: "right" },
					tooltip: { enabled: true }
				},
				scales: bPie ? undefined : { x: { beginAtZero: true } }
			}
		};
	}

	function estimateHeight(oSpec) {
		if (oSpec.type === "bar") {
			return Math.max(220, Math.min(560, oSpec.data.length * 42 + 80));
		}
		return Math.max(260, Math.min(440, 260 + Math.floor(oSpec.data.length / 4) * 24));
	}

	/**
	 * Renders a {type, title, data:[{label,value}]} spec to an interactive
	 * Chart.js chart: a <canvas> carrying the (base64-encoded) config in a
	 * data attribute, which InteractiveRenderer instantiates once the
	 * markup has actually been inserted into deep-chat's DOM (Chart.js
	 * needs a real, attached canvas - it can't render from an HTML string).
	 * Returns null if the spec is malformed or has no plottable data -
	 * callers should fall back to plain text in that case.
	 */
	function renderChart(oSpec) {
		if (!oSpec || !Array.isArray(oSpec.data) || !oSpec.data.length) {
			return null;
		}
		var aData = oSpec.data.filter(function (oPoint) {
			return oPoint && typeof oPoint.label !== "undefined" && !isNaN(Number(oPoint.value));
		});
		if (!aData.length) {
			return null;
		}
		var oCleanSpec = { type: oSpec.type, title: oSpec.title, data: aData };
		iChartCounter++;
		var sId = "mcpChart" + Date.now() + iChartCounter;
		var iHeight = estimateHeight(oCleanSpec);
		return "<div class='mcpChartCanvasWrap' style='height:" + iHeight + "px'>" +
			"<canvas id='" + sId + "' data-chart-config='" + toBase64Json(buildConfig(oCleanSpec)) + "'></canvas>" +
			"</div>";
	}

	return {
		renderChart: renderChart
	};
});
