sap.ui.define([
	"customer/ravi/zproductshop/ext/util/Tools",
	"customer/ravi/zproductshop/ext/util/ChartRenderer",
	"customer/ravi/zproductshop/ext/util/MarkdownLoader"
], function (Tools, ChartRenderer, MarkdownLoader) {
	"use strict";

	var OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
	var MAX_TOOL_ROUNDS = 6;
	var CHART_BLOCK_RE = /```chart\s*([\s\S]*?)```/i;

	// LLMs have no reliable notion of "today" on their own (often defaulting
	// to their training cutoff), so relative dates like "last 10 days" need
	// the actual current date spelled out in the prompt. Local time, not
	// UTC, so it matches what the user actually means by "today".
	function formatLocalDate(oDate) {
		var sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
		var sDay = String(oDate.getDate()).padStart(2, "0");
		return oDate.getFullYear() + "-" + sMonth + "-" + sDay;
	}

	/**
	 * Drives the OpenRouter chat completion + client-side tool-calling loop.
	 * Deep Chat calls `createDeepChatHandler()` as its `connect.handler`; all
	 * OData "tool" execution happens locally in the browser, no middle layer.
	 */
	function ChatOrchestrator(oSettings) {
		this.apiKey = oSettings.openrouterKey;
		this.model = oSettings.openrouterModel;
		this.entitySet = oSettings.odataEntitySet || "";
		this.customPrompt = oSettings.systemPrompt || "";
		this.odataClient = null;
		this.serviceUrl = "";
		this.language = "en";
		this.messages = [];
	}

	ChatOrchestrator.prototype.setODataClient = function (oClient, sServiceUrl) {
		this.odataClient = oClient;
		this.serviceUrl = sServiceUrl;
	};

	ChatOrchestrator.prototype.setLanguage = function (sLanguage) {
		this.language = sLanguage;
		if (this.messages.length) {
			this.messages[0] = this._buildSystemMessage();
		}
	};

	ChatOrchestrator.prototype._buildSystemMessage = function () {
		var sLangName = this.language === "es" ? "Spanish" : "English";
		var bV4 = !!(this.odataClient && this.odataClient.isV4);
		var sText = [
			"You are an assistant embedded in a SAP Fiori app that helps users explore and manage data",
			"in a connected SAP OData service, by calling the tools provided to you.",
			this.serviceUrl ? ("The connected OData service root is: " + this.serviceUrl) : "No OData service is connected yet - tell the user to configure one in Settings.",
			this.entitySet ? ("The user's default/preferred entity set is '" + this.entitySet + "' - use it for requests that don't name a different entity set explicitly.") : "",
			"Today's date is " + formatLocalDate(new Date()) + " (YYYY-MM-DD). Use this as the reference point for ANY relative date/time expression the user gives - 'last N days', 'this month', 'yesterday', 'this year', etc. Compute the actual date range from this, never from your training data or any other assumed date.",
			"Call get_metadata first if you are unsure about entity set or field names.",
			bV4 ?
				"This service is OData V4, not V2: write $filter expressions using OData V4 syntax only." :
				"This service is OData V2, not V4: write $filter expressions using OData V2 syntax only.",
			bV4 ?
				"For substring/text search use contains(Property,'text'), startswith(Property,'text') or endswith(Property,'text')." :
				"For substring/text search use substringof('text', Property), startswith(Property,'text') or endswith(Property,'text').",
			bV4 ?
				"Never use substringof(...) - it is OData V2-only syntax and does not exist in V4; the backend will reject it." :
				"Never use contains(...), and(), or() as functions, or any other OData V4 filter function - they do not exist in V2 and the backend will reject them.",
			bV4 ?
				"Date/time literals in a V4 $filter are plain ISO-8601, e.g. DocCreatedDate ge 2023-09-20T00:00:00Z - never wrapped like datetime'...', which is OData V2-only syntax and will be rejected." :
				"Date/time literals in a V2 $filter MUST be wrapped as datetime'...', e.g. DocCreatedDate ge datetime'2023-09-20T00:00:00' - never a bare ISO string like 2023-09-20T00:00:00Z (no datetime prefix, no trailing Z), which the backend will reject as an invalid token.",
			"Always ask for confirmation before calling create_entity, update_entity or delete_entity.",
			"For any question about counts, totals, sums, averages, 'top N', or a breakdown/distribution by some field - especially when the matching set isn't obviously tiny - call aggregate_entities instead of query_entities. It pages through the data and computes the summary in the browser, returning only the small result, so it won't blow up the context window the way pulling hundreds of raw rows would. Only use query_entities when the user wants to see actual individual records.",
			"Keep answers concise and format tabular results as a GitHub-flavored markdown table (pipe syntax) - it will be rendered as a real HTML table for the user.",
			"Proactively include a chart - not only when the user explicitly asks for one - whenever the reply is an overview, a summary, an analysis, or a comparison/breakdown across categories, suppliers, dates or any other dimension: append (after your normal text reply) a single fenced code block starting with ```chart on its own line, containing ONLY compact JSON of the form " +
				'{"type":"pie"|"bar","title":"...","data":[{"label":"...","value":number}, ...]}' +
				", then a closing ``` line. aggregate_entities' response is already in {label,value} shape, so you can usually copy its groups straight in. Use real aggregated numbers, not placeholders. Also include this block whenever a chart, graph, or visual/graphical view is asked for explicitly.",
			"A chart needs at least 2-3 meaningful data points to be worth showing: break the numbers down by whatever dimension the user's request implies (e.g. by customer, status, category, date) rather than collapsing everything into a single 'Total' slice/bar, which renders as one useless solid-colored shape. If the data truly has only one point - or the reply is a simple lookup/detail question with nothing to compare - skip the chart block and just state the number in text instead.",
			"Use 'bar' for comparing counts/amounts across more than ~5 categories or when labels are long, and 'pie' only for a small number (2-6) of parts of one whole.",
			"Always respond in " + sLangName + ", regardless of the language of the tool data.",
			this.customPrompt ? ("Additional instructions from the user, which take priority over style preferences above but never override the OData/tool-calling rules above: " + this.customPrompt) : ""
		].filter(Boolean).join(" ");
		return { role: "system", content: sText };
	};

	ChatOrchestrator.prototype.resetContext = function () {
		this.messages = [this._buildSystemMessage()];
	};

	ChatOrchestrator.prototype._callOpenRouter = function () {
		if (!this.apiKey) {
			return Promise.reject(new Error("No OpenRouter API key is configured. Open Settings to add one."));
		}
		return fetch(OPENROUTER_URL, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": "Bearer " + this.apiKey,
				"HTTP-Referer": window.location.origin,
				"X-Title": "Fiori MCP OData Assistant"
			},
			body: JSON.stringify({
				model: this.model,
				messages: this.messages,
				tools: Tools.TOOL_DEFINITIONS,
				tool_choice: "auto"
			})
		}).then(function (res) {
			return res.text().then(function (sBody) {
				if (!res.ok) {
					throw new Error("OpenRouter HTTP " + res.status + ": " + sBody.slice(0, 500));
				}
				return JSON.parse(sBody);
			});
		});
	};

	ChatOrchestrator.prototype._runToolCalls = function (aToolCalls) {
		var that = this;
		return Promise.all(aToolCalls.map(function (oCall) {
			var oArgs = {};
			try {
				oArgs = JSON.parse(oCall.function.arguments || "{}");
			} catch (e) {
				// leave oArgs empty if the model produced malformed JSON
			}
			return Tools.executeTool(oCall.function.name, oArgs, that.odataClient)
				.then(function (oResult) {
					return { tool_call_id: oCall.id, name: oCall.function.name, content: JSON.stringify(oResult) };
				})
				.catch(function (oError) {
					return { tool_call_id: oCall.id, name: oCall.function.name, content: JSON.stringify({ error: oError.message || String(oError) }) };
				});
		})).then(function (aResults) {
			aResults.forEach(function (oResult) {
				that.messages.push({
					role: "tool",
					tool_call_id: oResult.tool_call_id,
					name: oResult.name,
					content: oResult.content
				});
			});
		});
	};

	/**
	 * Sends a user message through the tool-calling loop and resolves with the
	 * final assistant text.
	 */
	ChatOrchestrator.prototype.sendMessage = function (sUserText) {
		if (!this.messages.length) {
			this.resetContext();
		}
		// Rebuilt on every call (not just at resetContext) so "today" stays
		// correct across a conversation that runs past midnight, and so an
		// entitySet/customPrompt change is picked up without a full reset.
		this.messages[0] = this._buildSystemMessage();
		this.messages.push({ role: "user", content: sUserText });

		var that = this;
		var iRound = 0;

		function loop() {
			iRound++;
			return that._callOpenRouter().then(function (oResponse) {
				var oChoice = (oResponse.choices || [])[0];
				if (!oChoice) {
					throw new Error("OpenRouter returned no choices");
				}
				var oMessage = oChoice.message;
				that.messages.push(oMessage);

				if (oMessage.tool_calls && oMessage.tool_calls.length && iRound < MAX_TOOL_ROUNDS) {
					return that._runToolCalls(oMessage.tool_calls).then(loop);
				}
				return oMessage.content || "";
			});
		}

		return loop();
	};

	function escapeHtml(sValue) {
		return String(sValue).replace(/[&<>"']/g, function (sChar) {
			return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&apos;" }[sChar];
		});
	}

	/**
	 * Strips a trailing ```chart ... ``` JSON block from the assistant's
	 * reply (see the system prompt) and renders it via ChartRenderer into
	 * a <canvas> Chart.js instantiates once it's actually in the DOM (see
	 * InteractiveRenderer). Returns { text, chartHtml } - chartHtml is
	 * undefined when there is no chart block or it failed to parse/render.
	 */
	ChatOrchestrator.prototype._splitChartBlock = function (sReply) {
		var oMatch = CHART_BLOCK_RE.exec(sReply || "");
		if (!oMatch) {
			return { text: sReply || "" };
		}
		var sCleanText = (sReply.slice(0, oMatch.index) + sReply.slice(oMatch.index + oMatch[0].length)).trim();
		try {
			var oSpec = JSON.parse(oMatch[1]);
			var sChartMarkup = ChartRenderer.renderChart(oSpec);
			if (sChartMarkup) {
				return { text: sCleanText, chartHtml: "<div class='mcpChartWrap'>" + sChartMarkup + "</div>" };
			}
		} catch (e) {
			// malformed chart JSON from the model - fall through and show the raw reply
		}
		return { text: sReply || "" };
	};

	/**
	 * Renders the assistant's markdown reply (tables, lists, code, etc.) to
	 * sanitized HTML via marked + DOMPurify, and appends any chart SVG.
	 * Falls back to a plain escaped <pre> block if the markdown libraries
	 * can't be loaded (offline/CSP), so the reply still shows up.
	 */
	ChatOrchestrator.prototype._formatReply = function (sReply) {
		var oSplit = this._splitChartBlock(sReply);
		return MarkdownLoader.load().then(function (oLibs) {
			var sBodyHtml = oSplit.text ?
				oLibs.DOMPurify.sanitize(oLibs.marked.parse(oSplit.text, { gfm: true, breaks: true })) : "";
			if (sBodyHtml.indexOf("<table") !== -1) {
				var oContainer = document.createElement("div");
				oContainer.innerHTML = sBodyHtml;
				Array.prototype.slice.call(oContainer.querySelectorAll("table")).forEach(function (oTable) {
					var oWrap = document.createElement("div");
					oWrap.className = "mcpTableScroll";
					oTable.parentNode.insertBefore(oWrap, oTable);
					oWrap.appendChild(oTable);
				});
				sBodyHtml = oContainer.innerHTML;
			}
			return "<div class='mcpMarkdown'>" + sBodyHtml + "</div>" + (oSplit.chartHtml || "");
		}).catch(function () {
			var sBodyHtml = oSplit.text ? "<pre class='mcpPlainFallback'>" + escapeHtml(oSplit.text) + "</pre>" : "";
			return sBodyHtml + (oSplit.chartHtml || "");
		});
	};

	/**
	 * Returns a function compatible with deep-chat's `connect.handler(body, signals)`.
	 */
	ChatOrchestrator.prototype.createDeepChatHandler = function () {
		var that = this;
		return function (oBody, oSignals) {
			var aMessages = oBody.messages || [];
			var oLast = aMessages[aMessages.length - 1];
			var sText = oLast && oLast.text ? oLast.text : "";

			that.sendMessage(sText).then(function (sReply) {
				return that._formatReply(sReply);
			}).then(function (sHtml) {
				oSignals.onResponse({ html: sHtml || "(no response)" });
			}).catch(function (oError) {
				oSignals.onResponse({ error: oError.message || String(oError) });
			});
		};
	};

	return ChatOrchestrator;
});
