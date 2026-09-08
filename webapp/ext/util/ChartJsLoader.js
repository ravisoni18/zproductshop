sap.ui.define([], function () {
	"use strict";

	var CHARTJS_SRC = "https://unpkg.com/chart.js@4.4.4/dist/chart.umd.js";

	var pLoadPromise = null;

	function loadScript(sSrc) {
		return new Promise(function (resolve, reject) {
			var oScript = document.createElement("script");
			oScript.src = sSrc;
			oScript.onload = function () { resolve(); };
			oScript.onerror = function () {
				reject(new Error("Failed to load " + sSrc + " (blocked by network/CSP or offline)."));
			};
			document.head.appendChild(oScript);
		});
	}

	return {
		/**
		 * Loads Chart.js from CDN (same runtime-injection approach as
		 * DeepChatLoader/MarkdownLoader) and resolves with the global
		 * `Chart` constructor.
		 */
		load: function () {
			if (pLoadPromise) {
				return pLoadPromise;
			}
			if (window.Chart) {
				pLoadPromise = Promise.resolve(window.Chart);
				return pLoadPromise;
			}
			pLoadPromise = loadScript(CHARTJS_SRC).then(function () { return window.Chart; });
			return pLoadPromise;
		}
	};
});
