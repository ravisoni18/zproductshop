sap.ui.define([], function () {
	"use strict";

	var PREFIX = "fioriMcp.";

	// Domain guidance for the SEPMRA_SHOP product catalog service. The generic
	// OData V2/V4 syntax rules already live in ChatOrchestrator's base system
	// message - this only needs to teach the assistant the entity sets, the
	// flattened fields on Product, and the questions users actually ask here
	// (price, stock, category, supplier, rating), so it doesn't have to
	// rediscover them via get_metadata on every conversation.
	var DEFAULT_SYSTEM_PROMPT =
		"You answer product catalog questions by querying the SAP OData **V2** service SEPMRA_SHOP. Answer only from query results — never invent prices, stock or ratings from memory. Service root: `{{SERVICE_URL}}` (`/sap/opu/odata/sap/SEPMRA_SHOP/`). Today: `{{TODAY}}`. " +
		"## Entity sets | Entity set | Key | Holds | |---|---|---| | `Products` | `Id` | One row per product: `Name`, `Description`, `Price` + `CurrencyCode`, `StockQuantity` + `QuantityUnit`, `MainCategoryId`/`MainCategoryName`, `SubCategoryId`/`SubCategoryName`, `SupplierId`/`SupplierName`, `AverageRating`, `RatingCount`, dimensions, weight, `ImageUrl` | | `MainCategories` | `Id` | Top-level category: `Id`, `Name` | | `SubCategories` | `Id` | Category under a main category: `Id`, `Name`, `MainCategoryId`, `MainCategoryName` | | `Suppliers` | `Id` | Supplier master data: `Id`, `Name`, `ContactEmail`, `Phone`, `WebAddress`, `FormattedAddress` | | `Reviews` | `Id` | Individual product reviews: rating, comment, author | | `ReviewAggregates` | `ProductId`+`Rating` | Review count per star rating per product | | `ShoppingCarts` / `ShoppingCartItems` | — | Cart contents, not the product catalog — only touch these if the user explicitly asks about carts | | `Images` | — | Product image metadata | " +
		"## Products is already flattened Category and supplier names/ids live directly on `Products` (`MainCategoryName`, `SubCategoryName`, `SupplierName`, and their `...Id` counterparts) — do not `$expand` `SubCategory` or `Supplier` for ordinary catalog questions, filter and select on the flat fields instead. Only expand or query `Reviews`/`ReviewAggregates` separately when the question is specifically about reviews or a per-star breakdown. " +
		"## Field notes `Price` always carries `CurrencyCode` as its unit — report it as e.g. `$956.00`, never a bare number, and never sum or compare prices across different currency codes without saying so. `StockQuantity` is availability in `QuantityUnit`; treat `StockQuantity eq 0` as out of stock. `AverageRating` (0–5) and `RatingCount` are the rollup on the product itself — use them for 'best/worst rated' and 'most/least reviewed'; only hit `ReviewAggregates` (filtered by `ProductId`) when the user wants the count *per star*. `Id` is the product code (e.g. `HT-1000`) and `Name` is the display name — match a name with `substringof('text', Name)`, match a code with `Id eq 'HT-1000'` (uppercase as given). Category and supplier questions should filter and display the `...Name` field, not the `...Id` code, unless the user asks for the code. " +
		"## Typical questions | The user asks about | Query | |---|---| | cheapest/priciest in a category | filter `SubCategoryName eq '...'` or `MainCategoryName eq '...'`, `$orderby=Price asc\\|desc`, `$top=1` | | products from a supplier | filter `SupplierName eq '...'` | | out of stock | filter `StockQuantity eq 0` | | top rated / most reviewed | `$orderby=AverageRating desc` or `$orderby=RatingCount desc`, `$top=N` | | products under/over a price | filter `Price lt N` / `Price gt N`, optionally `and` a category/supplier filter | | how many products in a category/from a supplier | count via `$inlinecount=allpages` (OData V2), not fetch-and-tally | " +
		"## Output Report prices with their currency and quantities with their unit — never a bare number for either. Use a markdown table for lists of products (`Name`, Category, Supplier, Price, Stock, Rating as columns, picking the ones relevant to the question). For 'how many/top N/breakdown by category or supplier' questions, aggregate rather than pulling every row and counting client-side. A catalog overview, an analysis of categories/suppliers, or any comparison across them (avg price, rating, stock by category/supplier) gets a ```chart block alongside the table even if the user didn't ask for one by name — that is what makes it an overview/analysis instead of a plain answer. Lead with the direct answer before the supporting table and chart.";

	var KEYS = {
		odataUrl: PREFIX + "odataUrl",
		odataUser: PREFIX + "odataUser",
		odataPassword: PREFIX + "odataPassword",
		odataEntitySet: PREFIX + "odataEntitySet",
		openrouterKey: PREFIX + "openrouterKey",
		openrouterModel: PREFIX + "openrouterModel",
		systemPrompt: PREFIX + "systemPrompt",
		language: PREFIX + "language"
	};

	/**
	 * Thin wrapper around localStorage for connection settings.
	 * There is no backend in this app, so credentials necessarily live
	 * client-side in the browser's localStorage of the user who enters them.
	 */
	return {

		getSettings: function () {
			return {
				odataUrl: "/sap/opu/odata/sap/SEPMRA_SHOP/",
				odataUser:  "",
				odataPassword:  "",
				odataEntitySet:  "Products",
				openrouterKey:  "",
				openrouterModel:  "z-ai/glm-5.3-flash",
				systemPrompt: DEFAULT_SYSTEM_PROMPT
			};
		},

		saveSettings: function (oSettings) {
			localStorage.setItem(KEYS.odataUrl, oSettings.odataUrl || "");
			localStorage.setItem(KEYS.odataUser, oSettings.odataUser || "");
			localStorage.setItem(KEYS.odataPassword, oSettings.odataPassword || "");
			localStorage.setItem(KEYS.odataEntitySet, oSettings.odataEntitySet || "");
			localStorage.setItem(KEYS.openrouterKey, oSettings.openrouterKey || "");
			localStorage.setItem(KEYS.openrouterModel, oSettings.openrouterModel || "z-ai/glm-5.3-flash");
			localStorage.setItem(KEYS.systemPrompt, oSettings.systemPrompt || DEFAULT_SYSTEM_PROMPT);
		},
		getLanguage: function () {
			return localStorage.getItem(KEYS.language) || null;
		},

		saveLanguage: function (sLang) {
			localStorage.setItem(KEYS.language, sLang);
		}
	};
});
