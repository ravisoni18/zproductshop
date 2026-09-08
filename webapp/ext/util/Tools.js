sap.ui.define([], function () {
	"use strict";

	/**
	 * OpenRouter/OpenAI-style function tool definitions exposed to the model,
	 * plus a dispatcher that executes them against the currently configured
	 * ODataClient. This is the "MCP-like" tool layer, run entirely client-side.
	 */

	var TOOL_DEFINITIONS = [
		{
			type: "function",
			function: {
				name: "get_metadata",
				description: "Get the schema of the connected SAP OData service: entity sets, their entity type, key properties and fields. Call this first if you don't already know the schema.",
				parameters: { type: "object", properties: {}, additionalProperties: false }
			}
		},
		{
			type: "function",
			function: {
				name: "query_entities",
				description: "Query a list of individual entities (rows) from an entity set, with optional OData V2 $filter/$select/$orderby/$expand/$top/$skip, to show or inspect actual records. Only the fields listed in $select are returned (unexpanded fields, __metadata etc. are stripped automatically). Do NOT use this to compute counts, totals, sums or 'top N by X' over a potentially large result set - use aggregate_entities for that instead, since pulling many rows just to summarize them yourself wastes context and can exceed the model's token limit.",
				parameters: {
					type: "object",
					properties: {
						entitySet: { type: "string", description: "Entity set name, e.g. 'Products'" },
						filter: { type: "string", description: "OData V2 $filter expression, e.g. \"Price gt 100 and Category eq 'Books'\". This is OData V2, NOT V4: for substring/text matching use substringof('text', Property), startswith(Property,'text') or endswith(Property,'text') - never contains(...), which is a V4-only function and will fail with a 'Property contains not found' backend error." },
						select: { type: "string", description: "Comma-separated list of fields to return" },
						orderby: { type: "string", description: "e.g. 'Price desc'" },
						expand: { type: "string", description: "Comma-separated navigation properties to expand" },
						top: { type: "number", description: "Max rows to return, default 20, max 100" },
						skip: { type: "number", description: "Rows to skip, for pagination" }
					},
					required: ["entitySet"],
					additionalProperties: false
				}
			}
		},
		{
			type: "function",
			function: {
				name: "aggregate_entities",
				description: "Computes a group-by summary (count, sum, avg, min or max) over ALL entities matching a filter, entirely in the browser - it pages through the OData service itself and returns only the small aggregated result, never raw rows. Use this for any 'how many/how much X by Y', 'top N', 'breakdown by', or totals question, especially when the matching set could be more than a couple dozen rows - it is far cheaper and more reliable than fetching rows with query_entities and counting/summing them yourself. The returned groups are already in {label, value} form, ready to drop straight into a ```chart block.",
				parameters: {
					type: "object",
					properties: {
						entitySet: { type: "string", description: "Entity set name, e.g. 'Orders'" },
						filter: { type: "string", description: "OData V2 $filter expression applied before aggregating, e.g. \"TranStatus ne 'complete'\"" },
						groupBy: { type: "string", description: "Field(s) to group rows by, e.g. 'BPPartnerName'. Pass a comma-separated pair like 'Driver,DriverName' to group by a code+name pair together - each group's label joins the values with ' / '." },
						metric: { type: "string", enum: ["count", "sum", "avg", "min", "max"], description: "Aggregation to compute per group. Default 'count'." },
						valueField: { type: "string", description: "Numeric field to sum/avg/min/max - required unless metric is 'count'" },
						top: { type: "number", description: "Return only the top N groups by metric value, descending. Default 20, max 100." },
						maxRows: { type: "number", description: "Safety cap on total rows scanned before stopping. Default and max 5000." }
					},
					required: ["entitySet", "groupBy"],
					additionalProperties: false
				}
			}
		},
		{
			type: "function",
			function: {
				name: "get_entity",
				description: "Get a single entity by its OData key predicate.",
				parameters: {
					type: "object",
					properties: {
						entitySet: { type: "string" },
						key: { type: "string", description: "Key predicate content, e.g. \"'123'\" or \"Id=1,CategoryId='A'\"" },
						expand: { type: "string" }
					},
					required: ["entitySet", "key"],
					additionalProperties: false
				}
			}
		},
		{
			type: "function",
			function: {
				name: "create_entity",
				description: "Create a new entity in the given entity set. Always confirm the data with the user before calling this.",
				parameters: {
					type: "object",
					properties: {
						entitySet: { type: "string" },
						data: { type: "object", description: "Key/value map of properties for the new entity" }
					},
					required: ["entitySet", "data"],
					additionalProperties: false
				}
			}
		},
		{
			type: "function",
			function: {
				name: "update_entity",
				description: "Update (merge/patch) an existing entity. Always confirm the change with the user before calling this.",
				parameters: {
					type: "object",
					properties: {
						entitySet: { type: "string" },
						key: { type: "string", description: "Key predicate content, e.g. \"'123'\"" },
						data: { type: "object", description: "Key/value map of properties to change" }
					},
					required: ["entitySet", "key", "data"],
					additionalProperties: false
				}
			}
		},
		{
			type: "function",
			function: {
				name: "delete_entity",
				description: "Delete an entity. Always confirm with the user before calling this - it is irreversible.",
				parameters: {
					type: "object",
					properties: {
						entitySet: { type: "string" },
						key: { type: "string", description: "Key predicate content, e.g. \"'123'\"" }
					},
					required: ["entitySet", "key"],
					additionalProperties: false
				}
			}
		}
	];

	function executeTool(sName, oArgs, oODataClient) {
		if (!oODataClient) {
			return Promise.reject(new Error("No OData service is configured yet. Ask the user to open Settings and connect one."));
		}
		switch (sName) {
			case "get_metadata":
				return oODataClient.getMetadataSummary();
			case "query_entities":
				return oODataClient.queryEntities(oArgs || {});
			case "aggregate_entities":
				return oODataClient.aggregateEntities(oArgs || {});
			case "get_entity":
				return oODataClient.getEntity(oArgs || {});
			case "create_entity":
				return oODataClient.createEntity(oArgs || {});
			case "update_entity":
				return oODataClient.updateEntity(oArgs || {});
			case "delete_entity":
				return oODataClient.deleteEntity(oArgs || {});
			default:
				return Promise.reject(new Error("Unknown tool: " + sName));
		}
	}

	return {
		TOOL_DEFINITIONS: TOOL_DEFINITIONS,
		executeTool: executeTool
	};
});
