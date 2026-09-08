sap.ui.define([
    "sap/m/MessageToast",
    "sap/ui/core/mvc/XMLView",
    "sap/ui/core/StaticArea"
], function(MessageToast,XMLView, StaticArea) {
    'use strict';
    var MIN_WIDTH = 320;
    var MAX_WIDTH_RATIO = 0.9;

    var oSidePanelView;
    var oHandleDom;
    var bOpen = false;
    var iPanelWidth = Math.round(window.innerWidth * 0.4);

    function clampWidth(iWidth) {
        var iMax = Math.round(window.innerWidth * MAX_WIDTH_RATIO);
        return Math.min(Math.max(iWidth, MIN_WIDTH), iMax);
    }

    function applyBaseStyle(oDomRef) {
        oDomRef.style.position = "fixed";
        oDomRef.style.top = "0";
        oDomRef.style.width = iPanelWidth + "px";
        oDomRef.style.height = "100%";
        oDomRef.style.zIndex = "1100";
        oDomRef.style.boxShadow = "var(--sapContent_Shadow2)";
        oDomRef.style.backgroundColor = "var(--sapBaseColor)";
    }

    // Repositions both the panel and its resize handle together, since the
    // handle isn't a child of the panel's own (UI5-rendered, so periodically
    // rebuilt) DOM - it's an independent fixed element that has to be kept
    // in sync with the panel's width/open state manually.
    function applyPosition(oDomRef) {
        oDomRef.style.right = bOpen ? "0" : "-" + iPanelWidth + "px";
        if (oHandleDom) {
            oHandleDom.style.display = bOpen ? "block" : "none";
            oHandleDom.style.right = (iPanelWidth - 3) + "px";
        }
    }

    function setOpen(bValue) {
        bOpen = bValue;
        var oDomRef = oSidePanelView && oSidePanelView.getDomRef();
        if (oDomRef) {
            oDomRef.style.transition = "right 0.3s ease-in-out";
            applyPosition(oDomRef);
        }
    }

    function setWidth(iWidth, bWithTransition) {
        iPanelWidth = clampWidth(iWidth);
        var oDomRef = oSidePanelView && oSidePanelView.getDomRef();
        if (!oDomRef) {
            return;
        }
        oDomRef.style.transition = bWithTransition ? "right 0.3s ease-in-out, width 0.3s ease-in-out" : "none";
        oDomRef.style.width = iPanelWidth + "px";
        applyPosition(oDomRef);
    }

    function ensureHandle() {
        if (oHandleDom) {
            return;
        }

        var oHandle = document.createElement("div");
        oHandle.title = "Drag to resize";
        oHandle.style.position = "fixed";
        oHandle.style.top = "0";
        oHandle.style.width = "6px";
        oHandle.style.height = "100%";
        oHandle.style.cursor = "ew-resize";
        oHandle.style.zIndex = "1101";
        oHandle.style.background = "transparent";
        oHandle.style.touchAction = "none";

        var iStartX = 0;
        var iStartWidth = 0;
        var bDragging = false;

        function highlight(bOn) {
            oHandle.style.background = bOn ? "var(--sapContent_ForegroundBorderColor, rgba(0,0,0,0.2))" : "transparent";
        }

        function onPointerMove(oEvent) {
            setWidth(iStartWidth + (iStartX - oEvent.clientX), false);
        }

        function onPointerUp() {
            bDragging = false;
            highlight(false);
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", onPointerUp);
            document.body.style.userSelect = "";
        }

        oHandle.addEventListener("pointerdown", function (oEvent) {
            bDragging = true;
            iStartX = oEvent.clientX;
            iStartWidth = iPanelWidth;
            highlight(true);
            document.body.style.userSelect = "none";
            document.addEventListener("pointermove", onPointerMove);
            document.addEventListener("pointerup", onPointerUp);
            oEvent.preventDefault();
        });
        oHandle.addEventListener("mouseenter", function () {
            if (!bDragging) {
                highlight(true);
            }
        });
        oHandle.addEventListener("mouseleave", function () {
            if (!bDragging) {
                highlight(false);
            }
        });

        StaticArea.getDomRef().appendChild(oHandle);
        oHandleDom = oHandle;
    }
    return {
        OpenAI: function(oEvent) {
            MessageToast.show("Custom handler invoked.");
               if (oSidePanelView) {
                setOpen(!bOpen);
                return;
            }

            bOpen = true;

            XMLView.create({
                viewName: "customer.ravi.zproductshop.ext.view.SidePanel"
            }).then(function (oView) {
                oSidePanelView = oView;

                oView.addEventDelegate({
                    onAfterRendering: function () {
                        var oDomRef = oView.getDomRef();
                        if (oDomRef) {
                            applyBaseStyle(oDomRef);
                            oDomRef.style.transition = "right 0.3s ease-in-out";
                            applyPosition(oDomRef);
                        }
                    }
                });

                ensureHandle();
                oView.placeAt(StaticArea.getDomRef());
            });
        },

        onCloseSidePanel: function () {
            setOpen(false);
        }
    }
});
