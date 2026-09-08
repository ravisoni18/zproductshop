sap.ui.define([], function () {
	"use strict";

	var MARKED_SRC = "https://unpkg.com/marked@12.0.2/marked.min.js";
	var PURIFY_SRC = "https://unpkg.com/dompurify@3.1.6/dist/purify.min.js";

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
		 * Loads `marked` (GFM markdown -> HTML, incl. tables) and `DOMPurify`
		 * (HTML sanitizer) from CDN, the same runtime-injection approach used
		 * by DeepChatLoader. Resolves with { marked, DOMPurify }.
		 */
		load: function () {
			if (pLoadPromise) {
				return pLoadPromise;
			}
			if (window.marked && window.DOMPurify) {
				pLoadPromise = Promise.resolve({ marked: window.marked, DOMPurify: window.DOMPurify });
				return pLoadPromise;
			}
			pLoadPromise = Promise.all([
				window.marked ? Promise.resolve() : loadScript(MARKED_SRC),
				window.DOMPurify ? Promise.resolve() : loadScript(PURIFY_SRC)
			]).then(function () {
				return { marked: window.marked, DOMPurify: window.DOMPurify };
			});
			return pLoadPromise;
		}
	};
});
