sap.ui.define([], function () {
	"use strict";

	/**
	 * deep-chat renders the `html` string we hand it into its own shadow
	 * DOM asynchronously and outside our control, so a <canvas> or <table>
	 * we generate can't be wired up inline when we build the markup - it
	 * doesn't exist in the DOM yet. Instead a MutationObserver on the
	 * shadow root (set up once in View1.controller.js) calls wire() after
	 * every DOM change, and each half here is idempotent (marks what it
	 * already handled) so re-running it on unrelated mutations is cheap.
	 *
	 * The shadow root also means the app's own style.css never reaches this
	 * markup, so the CSS for tables/sorting/filtering below is injected
	 * directly into the shadow root instead of relying on a page stylesheet.
	 */

	var STYLE_ID = "mcpInteractiveStyles";
	var TABLE_STYLES = [
		".mcpTableScroll { overflow-x: auto; margin: 0.5rem 0; border: 1px solid #e2e5ea; border-radius: 0.5rem; }",
		".mcpMarkdown table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }",
		".mcpMarkdown thead th { position: sticky; top: 0; background: #f5f7fa; }",
		".mcpMarkdown th, .mcpMarkdown td { padding: 0.4rem 0.65rem; border-bottom: 1px solid #e9ecf1; text-align: left; white-space: nowrap; }",
		".mcpMarkdown tbody tr:hover { background: #f5f9ff; }",
		".mcpSortableTh { cursor: pointer; user-select: none; position: relative; padding-right: 1.3rem; }",
		".mcpSortableTh::after { content: \"\\2195\"; position: absolute; right: 0.4rem; opacity: 0.35; font-size: 0.75rem; }",
		".mcpSortableTh.mcpSortAsc::after { content: \"\\2191\"; opacity: 0.9; }",
		".mcpSortableTh.mcpSortDesc::after { content: \"\\2193\"; opacity: 0.9; }",
		".mcpTableFilter { display: block; width: 100%; box-sizing: border-box; margin: 0.5rem 0 0.25rem; padding: 0.35rem 0.6rem; font-size: 0.82rem; border: 1px solid #dde2e8; border-radius: 1rem; background: #f5f7fa; color: #1a2733; font-family: inherit; }",
		".mcpTableFilter:focus { outline: none; border-color: #0064d9; background: #ffffff; }",
		".mcpTableNoMatch td { text-align: center; color: #8a93a6; font-style: italic; padding: 0.6rem; white-space: normal; }"
	].join("\n");

	function decodeConfig(sBase64) {
		return JSON.parse(decodeURIComponent(escape(atob(sBase64))));
	}

	function injectStyles(oRoot) {
		if (oRoot.getElementById(STYLE_ID)) {
			return;
		}
		var oStyle = document.createElement("style");
		oStyle.id = STYLE_ID;
		oStyle.textContent = TABLE_STYLES;
		oRoot.appendChild(oStyle);
	}

	function wireCharts(oRoot, ChartLib) {
		if (!ChartLib) {
			return;
		}
		Array.prototype.slice.call(oRoot.querySelectorAll("canvas[data-chart-config]:not([data-chart-rendered])")).forEach(function (oCanvas) {
			oCanvas.setAttribute("data-chart-rendered", "1");
			try {
				new ChartLib(oCanvas, decodeConfig(oCanvas.getAttribute("data-chart-config")));
			} catch (e) {
				// leave the canvas blank rather than break the rest of the reply
			}
		});
	}

	function cellText(oRow, iIndex) {
		var oCell = oRow.children[iIndex];
		return oCell ? oCell.textContent.trim() : "";
	}

	function sortTableByColumn(oTable, iIndex, oTh, aHeaders) {
		var oTbody = oTable.querySelector("tbody");
		if (!oTbody) {
			return;
		}
		var aRows = Array.prototype.slice.call(oTbody.querySelectorAll("tr:not(.mcpTableNoMatch)"));
		var bAscending = oTh.getAttribute("data-sort-dir") !== "asc";

		aHeaders.forEach(function (oOtherTh) {
			oOtherTh.removeAttribute("data-sort-dir");
			oOtherTh.classList.remove("mcpSortAsc", "mcpSortDesc");
		});
		oTh.setAttribute("data-sort-dir", bAscending ? "asc" : "desc");
		oTh.classList.add(bAscending ? "mcpSortAsc" : "mcpSortDesc");

		var bAllNumeric = aRows.every(function (oRow) {
			var sText = cellText(oRow, iIndex).replace(/[,$%]/g, "");
			return sText === "" || !isNaN(Number(sText));
		});

		aRows.sort(function (oRowA, oRowB) {
			var sA = cellText(oRowA, iIndex), sB = cellText(oRowB, iIndex);
			var iCompare = bAllNumeric ?
				(Number(sA.replace(/[,$%]/g, "")) || 0) - (Number(sB.replace(/[,$%]/g, "")) || 0) :
				sA.localeCompare(sB);
			return bAscending ? iCompare : -iCompare;
		});
		aRows.forEach(function (oRow) { oTbody.appendChild(oRow); });
	}

	/**
	 * Live substring filter across every cell in the row (not per-column -
	 * the AI-generated tables in chat replies are usually small enough that
	 * a single search box is more useful than per-column inputs, and it's
	 * far simpler to keep in sync with sorting).
	 */
	function filterTable(oTable, sQuery) {
		var oTbody = oTable.querySelector("tbody");
		if (!oTbody) {
			return;
		}
		var sNeedle = sQuery.trim().toLowerCase();
		var aRows = Array.prototype.slice.call(oTbody.querySelectorAll("tr:not(.mcpTableNoMatch)"));
		var iVisible = 0;
		aRows.forEach(function (oRow) {
			var bMatch = !sNeedle || oRow.textContent.toLowerCase().indexOf(sNeedle) !== -1;
			oRow.style.display = bMatch ? "" : "none";
			if (bMatch) {
				iVisible++;
			}
		});

		var oNoMatch = oTbody.querySelector(".mcpTableNoMatch");
		if (!iVisible) {
			if (!oNoMatch) {
				var iCols = oTable.querySelectorAll("thead th").length || 1;
				oNoMatch = document.createElement("tr");
				oNoMatch.className = "mcpTableNoMatch";
				var oTd = document.createElement("td");
				oTd.colSpan = iCols;
				oTd.textContent = "No matching rows";
				oNoMatch.appendChild(oTd);
				oTbody.appendChild(oNoMatch);
			}
			oNoMatch.style.display = "";
		} else if (oNoMatch) {
			oNoMatch.style.display = "none";
		}
	}

	function wireTableFilter(oTable) {
		var oScrollWrap = oTable.closest(".mcpTableScroll") || oTable.parentNode;
		var oInput = document.createElement("input");
		oInput.type = "text";
		oInput.className = "mcpTableFilter";
		oInput.placeholder = "Filter rows...";
		oInput.addEventListener("input", function () {
			filterTable(oTable, oInput.value);
		});
		oScrollWrap.parentNode.insertBefore(oInput, oScrollWrap);
	}

	function wireInteractiveTables(oRoot) {
		Array.prototype.slice.call(oRoot.querySelectorAll(".mcpMarkdown table:not([data-sortable-wired])")).forEach(function (oTable) {
			oTable.setAttribute("data-sortable-wired", "1");
			var aHeaders = Array.prototype.slice.call(oTable.querySelectorAll("thead th"));
			if (aHeaders.length < 2) {
				return; // sorting a single-column table isn't worth the affordance
			}
			aHeaders.forEach(function (oTh, iIndex) {
				oTh.classList.add("mcpSortableTh");
				oTh.addEventListener("click", function () {
					sortTableByColumn(oTable, iIndex, oTh, aHeaders);
				});
			});

			if (oTable.querySelectorAll("tbody tr").length > 3) {
				wireTableFilter(oTable);
			}
		});
	}

	return {
		wire: function (oRoot, ChartLib) {
			if (!oRoot) {
				return;
			}
			injectStyles(oRoot);
			wireCharts(oRoot, ChartLib);
			wireInteractiveTables(oRoot);
		}
	};
});
