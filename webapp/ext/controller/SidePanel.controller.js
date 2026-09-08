sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/core/Fragment",
    "sap/ui/model/resource/ResourceModel",
    "customer/ravi/zproductshop/ext/controller/ListReportExt.controller",
    "sap/ui/model/json/JSONModel",
    "customer/ravi/zproductshop/ext/util/Storage",
    "customer/ravi/zproductshop/ext/util/ChatOrchestrator",
    "customer/ravi/zproductshop/ext/util/ODataClient",
    "customer/ravi/zproductshop/ext/util/DeepChatLoader",
    "customer/ravi/zproductshop/ext/util/ChartJsLoader",
    "customer/ravi/zproductshop/ext/util/InteractiveRenderer"
], function (
    Controller, Fragment, ResourceModel, ListReportExt, JSONModel, Storage, ChatOrchestrator, ODataClient,
    DeepChatLoader, ChartJsLoader, InteractiveRenderer
) {
    "use strict";

    return Controller.extend("customer.ravi.zproductshop.ext.controller.SidePanel", {

        onInit: function () {
            // This view is created standalone (via XMLView.create in
            // ListReportExt.js, not through the app Component's normal
            // view-creation flow), so it has no owner component and never
            // inherits the app's "i18n" model - it needs its own, and it
            // has to be set here (synchronously, before _initChatPanel runs)
            // rather than by the caller after creation: onInit already runs
            // as part of XMLView.create() itself, before that caller's
            // .then() callback gets a chance to run.
            this.getView().setModel(new ResourceModel({ bundleName: "customer.ravi.zproductshop.i18n.i18n" }), "i18n");
            this._initChatPanel();
        },

        onClose: function () {
            ListReportExt.onCloseSidePanel();
        },

        onCloseSplitView: function () {
            ListReportExt.onCloseSidePanel();
        },

        _getBundle: function () {
            return this.getView().getModel("i18n").getResourceBundle();
        },

        _connectODataClient: function (oSettings) {
            var oClient = new ODataClient(oSettings.odataUrl, oSettings.odataUser, oSettings.odataPassword);
            this._oChat.setODataClient(oClient, oSettings.odataUrl);
            this._oChat.resetContext();
            this._updateStatus();
        },

        _initChatPanel: function () {
            var oSettings = Storage.getSettings();
            this._oSettingsModel = new JSONModel(Object.assign({ testResult: "", entitySetOptions: [] }, oSettings));
            this.getView().setModel(this._oSettingsModel, "settings");

            var sLang = Storage.getLanguage() || sap.ui.getCore().getConfiguration().getLanguage().slice(0, 2);
            sLang = sLang === "es" ? "es" : "en";
            this._oMainModel = new JSONModel({
                statusText: "",
                languageLabel: sLang.toUpperCase()
            });
            this.getView().setModel(this._oMainModel);

            this._oChat = new ChatOrchestrator(oSettings);
            this._oChat.setLanguage(sLang);

            if (oSettings.odataUrl) {
                this._connectODataClient(oSettings);
            } else {
                this._oChat.resetContext();
                this._updateStatus();
            }
        },

        _updateStatus: function () {
            var oSettings = Storage.getSettings();
            var oI18n = this._getBundle();
            var sText;
            if (!oSettings.odataUrl) {
                sText = oI18n.getText("msgNoServiceConfigured");
            } else if (!oSettings.openrouterKey) {
                sText = oI18n.getText("msgNoApiKeyConfigured");
            } else {
                sText = oSettings.odataUrl;
            }
            this._oMainModel.setProperty("/statusText", sText);
        },

        // ---- deep-chat bootstrap ---------------------------------------------

        /**
         * deep-chat reads its config (connect, textInput, etc.) in
         * connectedCallback(), which fires the instant the element is
         * inserted into the DOM - so it has to be created and fully
         * configured BEFORE being attached, not after. The host div is
         * rendered empty (see the view) specifically so this method controls
         * that ordering, rather than relying on <deep-chat> already being in
         * the static view markup.
         */
        onChatHostRendered: function (oEvent) {
            if (this._chatStarted) {
                return;
            }
            this._chatStarted = true;

            var oHostDom = oEvent.getSource().getDomRef();

            Promise.all([DeepChatLoader.load(), ChartJsLoader.load()]).then(function (aResults) {
                var ChartLib = aResults[1];
                var oDeepChat = document.createElement("deep-chat");
                this._oDeepChat = oDeepChat;

                oDeepChat.connect = { handler: this._oChat.createDeepChatHandler() };
                oDeepChat.textInput = { placeholder: { text: "Ask about your data..." } };
                oDeepChat.style.width = "100%";
                oDeepChat.style.height = "100%";
                oDeepChat.style.border = "none";
                oDeepChat.style.display = "block";

                oHostDom.innerHTML = "";
                oHostDom.appendChild(oDeepChat);

                this._observeChatRoot(oDeepChat, ChartLib);
            }.bind(this)).catch(function (oError) {
                oHostDom.textContent = "Couldn't load the chat component: " + (oError.message || oError);
            });
        },

        /**
         * deep-chat renders replies into its own shadow DOM asynchronously,
         * so a <canvas>/<table> we hand it via html can't be wired up (charts
         * instantiated, tables made sortable/filterable) inline when the
         * markup is built - it doesn't exist in the DOM yet. A MutationObserver
         * on the shadow root re-runs InteractiveRenderer.wire() after every
         * change instead; wire() is idempotent (marks what it already
         * handled), so re-running it on unrelated mutations is cheap.
         */
        _observeChatRoot: function (oDeepChat, ChartLib) {
            var that = this;
            (function tryObserve() {
                if (!oDeepChat.shadowRoot) {
                    setTimeout(tryObserve, 50);
                    return;
                }
                var oObserver = new MutationObserver(function () {
                    InteractiveRenderer.wire(oDeepChat.shadowRoot, ChartLib);
                });
                oObserver.observe(oDeepChat.shadowRoot, { childList: true, subtree: true });
                that._oChatObserver = oObserver;
                InteractiveRenderer.wire(oDeepChat.shadowRoot, ChartLib);
            })();
        },

        onExit: function () {
            if (this._oChatObserver) {
                this._oChatObserver.disconnect();
            }
        },

        // ---- language toggle ---------------------------------------------

        onToggleLanguage: function () {
            var sNext = this._oChat.language === "es" ? "en" : "es";
            this._oChat.setLanguage(sNext);
            Storage.saveLanguage(sNext);
            this._oMainModel.setProperty("/languageLabel", sNext.toUpperCase());
        },

        // ---- settings dialog -----------------------------------------------

        onOpenSettings: function () {
            if (this._oSettingsDialog) {
                this._oSettingsDialog.open();
                return;
            }
            Fragment.load({
                id: this.getView().getId(),
                name: "customer.ravi.zproductshop.ext.fragment.Settings",
                controller: this
            }).then(function (oDialog) {
                this._oSettingsDialog = oDialog;
                this.getView().addDependent(oDialog);
                oDialog.open();
            }.bind(this));
        },

        onTestConnection: function () {
            var oData = this._oSettingsModel.getData();
            this._oSettingsModel.setProperty("/testResult", "Testing...");
            var oClient = new ODataClient(oData.odataUrl, oData.odataUser, oData.odataPassword);
            oClient.getMetadataSummary().then(function (oSummary) {
                this._oSettingsModel.setProperty("/testResult",
                    "Connected - " + oSummary.entitySets.length + " entity set(s) found.");
            }.bind(this)).catch(function (oError) {
                this._oSettingsModel.setProperty("/testResult", "Failed: " + (oError.message || oError));
            }.bind(this));
        },

        onSaveSettings: function () {
            var oData = this._oSettingsModel.getData();
            Storage.saveSettings(oData);

            this._oChat.apiKey = oData.openrouterKey;
            this._oChat.model = oData.openrouterModel;
            this._oChat.entitySet = oData.odataEntitySet;
            this._oChat.customPrompt = oData.systemPrompt;

            this._connectODataClient(oData);
            this._oSettingsDialog.close();
        },

        onCancelSettings: function () {
            Object.assign(this._oSettingsModel.getData(), Storage.getSettings());
            this._oSettingsModel.refresh();
            this._oSettingsDialog.close();
        }
    });
});
