sap.ui.define([], function () {
	"use strict";

	var DEEP_CHAT_SRC = "https://unpkg.com/deep-chat@2.4.2/dist/deepChat.bundle.js";
	var DEFINE_TIMEOUT_MS = 8000;

	var pLoadPromise = null;

	function waitForCustomElement() {
		if (customElements.get("deep-chat")) {
			return Promise.resolve();
		}
		return Promise.race([
			customElements.whenDefined("deep-chat"),
			new Promise(function (resolve, reject) {
				setTimeout(function () {
					reject(new Error("Timed out waiting for <deep-chat> to be defined."));
				}, DEFINE_TIMEOUT_MS);
			})
		]);
	}

	return {
		/**
		 * Injects the deep-chat script tag at runtime (instead of a static
		 * <script> in index.html) and resolves once the <deep-chat> custom
		 * element is registered. Some hosting environments (e.g. sandboxed
		 * IDE previews) strip or block <script src> tags declared directly
		 * in the HTML template but allow runtime-injected ones, and this
		 * also lets callers show a diagnostic message instead of a blank
		 * pane when the CDN request itself is blocked (CSP, offline, etc.).
		 */
		load: function () {
			if (pLoadPromise) {
				return pLoadPromise;
			}
			if (customElements.get("deep-chat")) {
				pLoadPromise = Promise.resolve();
				return pLoadPromise;
			}

			pLoadPromise = new Promise(function (resolve, reject) {
				var oScript = document.createElement("script");
				oScript.type = "module";
				oScript.src = DEEP_CHAT_SRC;
				oScript.onerror = function () {
					reject(new Error("Failed to load deep-chat from " + DEEP_CHAT_SRC + " (blocked by network/CSP or offline)."));
				};
				document.head.appendChild(oScript);

				waitForCustomElement().then(resolve, reject);
			});

			return pLoadPromise;
		}
	};
});
