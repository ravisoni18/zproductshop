sap.ui.define([], function () {
	"use strict";

	/**
	 * Minimal OData V2/V4 client used directly from the browser (no middle
	 * layer). Provides schema discovery + CRUD used by the chat tool-calling
	 * loop. Version is auto-detected from the service URL (SAP Gateway's own
	 * convention: /sap/opu/odata4/... for V4 vs /sap/opu/odata/... for V2) -
	 * everywhere the two protocols differ on the wire (count query option,
	 * response envelope, update HTTP verb) branches on isV4. The two
	 * protocols share the same basic $metadata element structure
	 * (EntityType/Property/PropertyRef/EntitySet), so getMetadataSummary()
	 * needs no version branching.
	 */
	function ODataClient(sServiceUrl, sUser, sPassword) {
		this.serviceUrl = sServiceUrl.endsWith("/") ? sServiceUrl : sServiceUrl + "/";
		this.user = sUser || "";
		this.password = sPassword || "";
		this._csrfToken = null;
		this.isV4 = /\/odata4\//.test(this.serviceUrl) || /\/odata\/v4\//.test(this.serviceUrl);
	}

	ODataClient.prototype._authHeaders = function (oExtra) {
		var headers = Object.assign({
			"Accept": "application/json"
		}, oExtra || {});
		if (this.user) {
			headers["Authorization"] = "Basic " + btoa(this.user + ":" + this.password);
		}
		return headers;
	};

	ODataClient.prototype._fetchCsrfToken = function () {
		var that = this;
		return fetch(this.serviceUrl, {
			method: "GET",
			credentials: "include",
			headers: this._authHeaders({ "X-CSRFToken": "Fetch" })
		}).then(function (res) {
			var token = res.headers.get("x-csrftoken");
			if (token) {
				that._csrfToken = token;
			}
			return that._csrfToken;
		});
	};

	ODataClient.prototype.fetchMetadataXml = function () {
		return fetch(this.serviceUrl + "$metadata", {
			method: "GET",
			credentials: "include",
			headers: this._authHeaders({ "Accept": "application/xml" })
		}).then(function (res) {
			if (!res.ok) {
				throw new Error("HTTP " + res.status + " " + res.statusText);
			}
			return res.text();
		});
	};

	/**
	 * Fetches and parses $metadata into a compact summary:
	 * { entitySets: [ { name, entityType, keys: [...], properties: [{name, type}] } ] }
	 */
	ODataClient.prototype.getMetadataSummary = function () {
		return this.fetchMetadataXml().then(function (sXml) {
			var oDoc = new DOMParser().parseFromString(sXml, "application/xml");
			if (oDoc.getElementsByTagName("parsererror").length) {
				throw new Error("Could not parse $metadata XML");
			}

			var oEntityTypes = {};
			var aEntityTypeNodes = Array.prototype.slice.call(oDoc.getElementsByTagName("EntityType"));
			aEntityTypeNodes.forEach(function (oNode) {
				var sName = oNode.getAttribute("Name");
				var aKeys = Array.prototype.slice.call(oNode.getElementsByTagName("PropertyRef"))
					.map(function (k) { return k.getAttribute("Name"); });
				var aProps = Array.prototype.slice.call(oNode.getElementsByTagName("Property"))
					.map(function (p) {
						return { name: p.getAttribute("Name"), type: p.getAttribute("Type") };
					});
				oEntityTypes[sName] = { keys: aKeys, properties: aProps };
			});

			var aEntitySets = Array.prototype.slice.call(oDoc.getElementsByTagName("EntitySet"))
				.map(function (oNode) {
					var sName = oNode.getAttribute("Name");
					var sFullType = oNode.getAttribute("EntityType") || "";
					var sShortType = sFullType.split(".").pop();
					var oType = oEntityTypes[sShortType] || { keys: [], properties: [] };
					return {
						name: sName,
						entityType: sShortType,
						keys: oType.keys,
						properties: oType.properties
					};
				});

			var bTruncated = false;
			if (aEntitySets.length > 60) {
				aEntitySets = aEntitySets.slice(0, 60);
				bTruncated = true;
			}

			return { entitySets: aEntitySets, truncated: bTruncated };
		});
	};

	/**
	 * Strips wire boilerplate (V2 __metadata / un-expanded __deferred
	 * navigation-property stubs, V4 @odata.* annotations like @odata.count,
	 * @odata.context, @odata.etag or Property@odata.type) and, as a
	 * defense-in-depth measure, drops any top-level field not in
	 * aSelectFields - some SAP Gateway/CDS-based services silently ignore
	 * $select and return every field regardless (60+ fields per row instead
	 * of the 2-3 actually asked for), which is what blows up the token
	 * budget once results are handed to the LLM. Expanded navigation data
	 * (an object with __metadata, or a results array) is always kept and
	 * cleaned recursively, since an explicit $expand means the caller wants
	 * that data regardless of $select.
	 */
	function cleanRow(oRow, aSelectFields) {
		if (!oRow || typeof oRow !== "object") {
			return oRow;
		}
		var oClean = {};
		Object.keys(oRow).forEach(function (sKey) {
			if (sKey === "__metadata" || sKey.indexOf("@") !== -1) {
				return;
			}
			var vValue = oRow[sKey];
			var bIsObject = vValue && typeof vValue === "object";
			if (bIsObject && vValue.__deferred) {
				return;
			}
			var bIsExpanded = bIsObject && (vValue.__metadata || Array.isArray(vValue.results) || Array.isArray(vValue));
			if (!bIsExpanded && aSelectFields && aSelectFields.indexOf(sKey) === -1) {
				return;
			}
			if (bIsExpanded) {
				var aNavRows = Array.isArray(vValue.results) ? vValue.results : (Array.isArray(vValue) ? vValue : null);
				vValue = aNavRows ?
					aNavRows.map(function (o) { return cleanRow(o, null); }) :
					cleanRow(vValue, null);
			}
			oClean[sKey] = vValue;
		});
		return oClean;
	}

	/**
	 * Splits a comma-separated field list into trimmed, non-empty field
	 * names. The model occasionally emits a stray/leading/trailing comma
	 * (e.g. ",ActualCases") in the `select` tool argument, which would
	 * otherwise reach the wire as `$select=,ActualCases` - an empty
	 * selection item that SAP Gateway/CDS services reject outright.
	 */
	function normalizeFieldList(sList) {
		return sList ?
			sList.split(",").map(function (s) { return s.trim(); }).filter(Boolean) : [];
	}

	ODataClient.prototype._buildQuery = function (oParams) {
		var aParts = [];
		var aSelect = normalizeFieldList(oParams.select);
		if (aSelect.length) { aParts.push("$select=" + encodeURIComponent(aSelect.join(","))); }
		if (oParams.filter) { aParts.push("$filter=" + encodeURIComponent(oParams.filter)); }
		if (oParams.orderby) { aParts.push("$orderby=" + encodeURIComponent(oParams.orderby)); }
		if (oParams.expand) { aParts.push("$expand=" + encodeURIComponent(oParams.expand)); }
		aParts.push("$top=" + encodeURIComponent(String(Math.min(oParams.top || 20, 100))));
		if (oParams.skip) { aParts.push("$skip=" + encodeURIComponent(String(oParams.skip))); }
		if (this.isV4) {
			aParts.push("$count=true");
		} else {
			aParts.push("$format=json");
			aParts.push("$inlinecount=allpages");
		}
		return aParts.join("&");
	};

	ODataClient.prototype.queryEntities = function (oParams) {
		var that = this;
		var sUrl = this.serviceUrl + oParams.entitySet + "?" + this._buildQuery(oParams);
		var aSelectFields = oParams.select ? normalizeFieldList(oParams.select) : null;
		return fetch(sUrl, {
			method: "GET",
			credentials: "include",
			headers: this._authHeaders()
		}).then(function (res) {
			return res.text().then(function (sBody) {
				if (!res.ok) {
					throw new Error("HTTP " + res.status + ": " + sBody.slice(0, 500));
				}
				var oJson = JSON.parse(sBody);
				// V4: { value: [...], "@odata.count": N }. V2: { d: { results: [...], __count: "N" } }.
				var vResults = that.isV4 ? (oJson.value || []) : ((oJson.d || {}).results || oJson.d || {});
				var vCount = that.isV4 ? oJson["@odata.count"] : (oJson.d || {}).__count;
				var aResults = (Array.isArray(vResults) ? vResults : [vResults])
					.map(function (oRow) { return cleanRow(oRow, aSelectFields); });
				return {
					count: typeof vCount !== "undefined" ? vCount : aResults.length,
					results: aResults
				};
			});
		});
	};

	/**
	 * Pages through $skip/$top until either the result set is exhausted or
	 * iMaxRows is hit, for callers (aggregateEntities) that need to scan a
	 * whole filtered set rather than one page of it. The existing $top cap
	 * of 100 in _buildQuery sets the page size.
	 */
	ODataClient.prototype._fetchAllRows = function (oParams, iMaxRows) {
		var that = this;
		var iPageSize = 100;
		var aAll = [];
		var iTotalCount = null;

		function loop(iSkip) {
			return that.queryEntities(Object.assign({}, oParams, { top: iPageSize, skip: iSkip })).then(function (oPage) {
				if (iTotalCount === null && typeof oPage.count !== "undefined") {
					iTotalCount = Number(oPage.count);
				}
				aAll = aAll.concat(oPage.results);
				var bHasMore = oPage.results.length === iPageSize;
				var bHitCap = aAll.length >= iMaxRows;
				if (bHasMore && !bHitCap) {
					return loop(iSkip + iPageSize);
				}
				return {
					rows: aAll.slice(0, iMaxRows),
					totalCount: iTotalCount,
					truncated: bHitCap && bHasMore
				};
			});
		}

		return loop(0);
	};

	/**
	 * Computes a group-by summary (count/sum/avg/min/max) over ALL rows
	 * matching a filter, scanning them in the browser via _fetchAllRows,
	 * and returns only the small aggregated result - never the raw rows -
	 * so the model can answer "how many X by Y" / "top N" questions over
	 * large result sets without blowing the token budget on row data it
	 * doesn't actually need to see.
	 *
	 * groupBy accepts a comma-separated composite key (e.g. "Driver,
	 * DriverName", mirroring OData $apply's groupby((Driver,DriverName)))
	 * since callers are told to pair a code field with its text field. A
	 * single `oRow[sGroupBy]` lookup would look for one literal property
	 * named "Driver,DriverName", find nothing on every row, and silently
	 * collapse the whole result into one "(blank)" group - so each listed
	 * field is read separately and the values joined into the group label.
	 */
	ODataClient.prototype.aggregateEntities = function (oParams) {
		var sGroupBy = oParams.groupBy;
		var aGroupFields = normalizeFieldList(sGroupBy);
		var sMetric = oParams.metric || "count";
		var sValueField = oParams.valueField;
		var iMaxRows = Math.min(oParams.maxRows || 5000, 5000);
		var iTopGroups = Math.min(oParams.top || 20, 100);

		var aSelectFields = aGroupFields.slice();
		if (sValueField && aSelectFields.indexOf(sValueField) === -1) {
			aSelectFields.push(sValueField);
		}

		return this._fetchAllRows({
			entitySet: oParams.entitySet,
			filter: oParams.filter,
			select: aSelectFields.join(",")
		}, iMaxRows).then(function (oFetched) {
			var oGroups = {};
			oFetched.rows.forEach(function (oRow) {
				var aKeyParts = aGroupFields.map(function (sField) {
					var vValue = oRow[sField];
					return (vValue === null || typeof vValue === "undefined" || vValue === "") ? "" : String(vValue);
				});
				var sKey = aKeyParts.some(Boolean) ? aKeyParts.join(" / ") : "(blank)";
				var oGroup = oGroups[sKey] || (oGroups[sKey] = { key: sKey, count: 0, sum: 0, min: null, max: null });
				oGroup.count++;
				if (sValueField) {
					var fValue = Number(oRow[sValueField]);
					if (!isNaN(fValue)) {
						oGroup.sum += fValue;
						oGroup.min = oGroup.min === null ? fValue : Math.min(oGroup.min, fValue);
						oGroup.max = oGroup.max === null ? fValue : Math.max(oGroup.max, fValue);
					}
				}
			});

			var aGroups = Object.keys(oGroups).map(function (sKey) {
				var oGroup = oGroups[sKey];
				var fMetricValue;
				switch (sMetric) {
					case "sum": fMetricValue = oGroup.sum; break;
					case "avg": fMetricValue = oGroup.count ? oGroup.sum / oGroup.count : 0; break;
					case "min": fMetricValue = oGroup.min; break;
					case "max": fMetricValue = oGroup.max; break;
					default: fMetricValue = oGroup.count;
				}
				return { label: oGroup.key, count: oGroup.count, value: fMetricValue };
			});
			aGroups.sort(function (a, b) { return b.value - a.value; });

			return {
				entitySet: oParams.entitySet,
				groupBy: sGroupBy,
				metric: sMetric,
				valueField: sValueField || null,
				rowsScanned: oFetched.rows.length,
				totalMatchingRows: oFetched.totalCount,
				truncated: oFetched.truncated,
				groupCount: aGroups.length,
				groups: aGroups.slice(0, iTopGroups)
			};
		});
	};

	ODataClient.prototype.getEntity = function (oParams) {
		var that = this;
		var sUrl = this.serviceUrl + oParams.entitySet + "(" + oParams.key + ")" + (this.isV4 ? "" : "?$format=json");
		if (oParams.expand) { sUrl += (sUrl.indexOf("?") === -1 ? "?" : "&") + "$expand=" + encodeURIComponent(oParams.expand); }
		return fetch(sUrl, {
			method: "GET",
			credentials: "include",
			headers: this._authHeaders()
		}).then(function (res) {
			return res.text().then(function (sBody) {
				if (!res.ok) {
					throw new Error("HTTP " + res.status + ": " + sBody.slice(0, 500));
				}
				var oJson = JSON.parse(sBody);
				return that.isV4 ? oJson : oJson.d;
			});
		});
	};

	ODataClient.prototype._withCsrf = function (fnRequest) {
		var that = this;
		var pReady = this._csrfToken ? Promise.resolve(this._csrfToken) : this._fetchCsrfToken();
		return pReady.then(function () {
			return fnRequest();
		}).then(function (res) {
			if (res.status === 403 && !that._triedRefetch) {
				that._triedRefetch = true;
				return that._fetchCsrfToken().then(function () {
					that._triedRefetch = false;
					return fnRequest();
				});
			}
			return res;
		});
	};

	ODataClient.prototype.createEntity = function (oParams) {
		var that = this;
		return this._withCsrf(function () {
			return fetch(that.serviceUrl + oParams.entitySet, {
				method: "POST",
				credentials: "include",
				headers: that._authHeaders({
					"Content-Type": "application/json",
					"X-CSRFToken": that._csrfToken || ""
				}),
				body: JSON.stringify(oParams.data || {})
			});
		}).then(function (res) {
			return res.text().then(function (sBody) {
				if (!res.ok) {
					throw new Error("HTTP " + res.status + ": " + sBody.slice(0, 500));
				}
				if (!sBody) {
					return { success: true };
				}
				var oJson = JSON.parse(sBody);
				return that.isV4 ? oJson : oJson.d;
			});
		});
	};

	ODataClient.prototype.updateEntity = function (oParams) {
		var that = this;
		return this._withCsrf(function () {
			return fetch(that.serviceUrl + oParams.entitySet + "(" + oParams.key + ")", {
				method: that.isV4 ? "PATCH" : "MERGE",
				credentials: "include",
				headers: that._authHeaders({
					"Content-Type": "application/json",
					"X-CSRFToken": that._csrfToken || ""
				}),
				body: JSON.stringify(oParams.data || {})
			});
		}).then(function (res) {
			if (!res.ok) {
				return res.text().then(function (sBody) {
					throw new Error("HTTP " + res.status + ": " + sBody.slice(0, 500));
				});
			}
			return { success: true };
		});
	};

	ODataClient.prototype.deleteEntity = function (oParams) {
		var that = this;
		return this._withCsrf(function () {
			return fetch(that.serviceUrl + oParams.entitySet + "(" + oParams.key + ")", {
				method: "DELETE",
				credentials: "include",
				headers: that._authHeaders({
					"X-CSRFToken": that._csrfToken || ""
				})
			});
		}).then(function (res) {
			if (!res.ok) {
				return res.text().then(function (sBody) {
					throw new Error("HTTP " + res.status + ": " + sBody.slice(0, 500));
				});
			}
			return { success: true };
		});
	};

	return ODataClient;
});
