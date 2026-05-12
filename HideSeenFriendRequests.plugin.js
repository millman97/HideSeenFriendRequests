/**
 * @name HideSeenFriendRequests
 * @author millman97
 * @version 0.2.0
 * @description Hide seen pending friend request notifications.
 */

module.exports = class HideSeenFriendRequests {
  // Initializes plugin state and runtime handles.
  constructor() {
    this.name = "HideSeenFriendRequests";
    this.seen = new Set();
    this.observer = null;
    this.injectTimer = null;
    this.injectResetTimer = null;
    this.isInjecting = false;
    this.isStarted = false;
    this.tooltip = null;
  }

  // Starts the plugin and wires up patches, observers, and buttons.
  start() {
    if (this.isStarted) return;

    this.isStarted = true;
    this.RelationshipStore = BdApi.Webpack.getStore("RelationshipStore");

    if (!this.isValidRelationshipStore(this.RelationshipStore)) {
      console.error("[HideSeenFriendRequests] RelationshipStore missing or unsupported");
      BdApi.UI.showToast("HideSeenFriendRequests: unsupported Discord build", {
        type: "error"
      });
      this.isStarted = false;
      return;
    }

    const saved = BdApi.Data.load(this.name, "seenRequests");
    this.seen = new Set(Array.isArray(saved) ? saved : []);

    this.patchPendingCount();
    this.startObserver();
    this.injectButtons();
    this.forceRelationshipUpdate();

    console.log("[HideSeenFriendRequests] started");
  }

  // Stops the plugin and removes patches, observers, buttons, and tooltips.
  stop() {
    this.isStarted = false;

    BdApi.Patcher.unpatchAll(this.name);
    this.observer?.disconnect();

    clearTimeout(this.injectTimer);
    clearTimeout(this.injectResetTimer);

    this.isInjecting = false;

    document
      .querySelectorAll(`.hsfr-seen-button[data-hsfr-owner="${this.name}"]`)
      .forEach(el => el.remove());

    this.hideTooltip();
    this.forceRelationshipUpdate();

    console.log("[HideSeenFriendRequests] stopped");
  }

  // Checks that Discord's relationship store exposes the required APIs.
  isValidRelationshipStore(store) {
    return Boolean(
      store &&
        typeof store.getPendingCount === "function" &&
        typeof store.getMutableRelationships === "function" &&
        typeof store.isUnfilteredPendingIncoming === "function"
    );
  }

  // Reads relationship entries from Discord's relationship store.
  getRelationshipEntries() {
    try {
      const relationships = this.RelationshipStore.getMutableRelationships();

      if (relationships instanceof Map) return [...relationships.entries()];
      if (relationships && typeof relationships === "object") {
        return Object.entries(relationships);
      }
    } catch (error) {
      console.error("[HideSeenFriendRequests] failed to get relationships", error);
    }

    return [];
  }

  // Finds user IDs for incoming pending friend requests.
  getPendingRequestIds() {
    const pending = [];

    for (const [userId, type] of this.getRelationshipEntries()) {
      const isPending =
        this.RelationshipStore.isUnfilteredPendingIncoming(userId) ||
        this.RelationshipStore.isUnfilteredPendingIncoming(userId, type);

      if (isPending) pending.push(userId);
    }

    return pending;
  }

  // Filters saved seen IDs down to requests that are still pending.
  getSeenPendingRequestIds() {
    const pending = new Set(this.getPendingRequestIds());
    return [...this.seen].filter(userId => pending.has(userId));
  }

  // Patches the pending request count to exclude seen requests.
  patchPendingCount() {
    const original = this.RelationshipStore.getPendingCount;

    BdApi.Patcher.instead(
      this.name,
      this.RelationshipStore,
      "getPendingCount",
      (_, args) => {
        const realCount = original.apply(this.RelationshipStore, args);

        if (typeof realCount !== "number") return realCount;
        if (args.length > 0) return realCount;

        try {
          const seenCount = this.getSeenPendingRequestIds().length;
          return Math.max(0, realCount - seenCount);
        } catch (error) {
          console.error("[HideSeenFriendRequests] failed to adjust pending count", error);
          return realCount;
        }
      }
    );
  }

  // Toggles whether a pending request is marked as seen.
  toggleSeen(userId) {
    if (!userId) return;

    if (this.seen.has(userId)) {
      this.seen.delete(userId);
    } else {
      this.seen.add(userId);
    }

    this.save();
    this.updateButtons();
    this.cleanupStaleButtons();
    this.forceRelationshipUpdate();
  }

  // Persists the current seen request IDs.
  save() {
    BdApi.Data.save(this.name, "seenRequests", [...this.seen]);
  }

  // Emits relationship store updates so Discord refreshes the UI.
  forceRelationshipUpdate() {
    try {
      this.RelationshipStore?.emitChange?.();
      this.RelationshipStore?.doEmitChanges?.();
    } catch (error) {
      console.error("[HideSeenFriendRequests] failed to emit store change", error);
    }
  }

  // Watches Discord's DOM for friend request list changes.
  startObserver() {
    this.observer = new MutationObserver(() => {
      if (!this.isStarted || this.isInjecting) return;

      clearTimeout(this.injectTimer);
      this.injectTimer = setTimeout(() => {
        if (this.isStarted) this.injectButtons();
      }, 150);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  // Adds seen toggle buttons to visible pending request rows.
  injectButtons() {
    if (!this.isStarted || this.isInjecting) return;

    this.isInjecting = true;

    try {
      const pendingIds = this.getPendingRequestIds();
      const pendingSet = new Set(pendingIds);

      this.cleanupStaleButtons(pendingSet);

      for (const userId of pendingIds) {
        const row = document.querySelector(`[data-list-item-id="people___${userId}"]`);
        if (!row) continue;

        const actions = row.querySelector('[class*="actions"]');
        const firstAction = actions?.querySelector('[role="button"], button');

        if (!actions || !firstAction) continue;

        let button = row.querySelector(
          `.hsfr-seen-button[data-hsfr-owner="${this.name}"]`
        );

        if (!button) {
          button = document.createElement(firstAction.tagName.toLowerCase());
          button.className = `${firstAction.className || ""} hsfr-seen-button`;
          button.setAttribute("role", "button");
          button.setAttribute("tabindex", "0");
          button.dataset.hsfrOwner = this.name;

          button.addEventListener("click", event => {
            event.preventDefault();
            event.stopPropagation();
            this.toggleSeen(button.dataset.userId);
          });

          button.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              event.stopPropagation();
              this.toggleSeen(button.dataset.userId);
            }
          });

          button.addEventListener("mouseenter", () => this.showTooltip(button));
          button.addEventListener("mouseleave", () => this.hideTooltip());
          button.addEventListener("focus", () => this.showTooltip(button));
          button.addEventListener("blur", () => this.hideTooltip());

          actions.insertBefore(button, firstAction);
        }

        button.dataset.userId = userId;
        this.updateButton(button, userId);
      }
    } finally {
      clearTimeout(this.injectResetTimer);
      this.injectResetTimer = setTimeout(() => {
        if (this.isStarted) this.isInjecting = false;
      }, 0);
    }
  }

  // Removes injected buttons that no longer match pending request rows.
  cleanupStaleButtons(pendingSet = new Set(this.getPendingRequestIds())) {
    for (const button of document.querySelectorAll(
      `.hsfr-seen-button[data-hsfr-owner="${this.name}"]`
    )) {
      const row = button.closest('[data-list-item-id^="people___"]');
      const rowId = row?.getAttribute("data-list-item-id")?.replace("people___", "");
      const buttonId = button.dataset.userId;

      if (!row || !rowId || !pendingSet.has(rowId) || (buttonId && buttonId !== rowId)) {
        button.remove();
      }
    }
  }

  // Refreshes all injected seen toggle buttons.
  updateButtons() {
    for (const button of document.querySelectorAll(
      `.hsfr-seen-button[data-hsfr-owner="${this.name}"]`
    )) {
      const userId = button.dataset.userId;
      if (userId) this.updateButton(button, userId);
    }
  }

  // Updates one seen toggle button's label, icon, and tooltip.
  updateButton(button, userId) {
    const isSeen = this.seen.has(userId);
    const label = isSeen ? "Mark as unseen" : "Mark as seen";

    button.setAttribute("aria-label", label);
    button.removeAttribute("title");
    button.innerHTML = isSeen ? this.getEyeOffIcon() : this.getEyeIcon();

    if (this.tooltip?.dataset?.sourceUserId === userId) {
      this.showTooltip(button);
    }
  }

  // Shows a custom tooltip for a seen toggle button.
  showTooltip(button) {
    this.hideTooltip();

    const label = button.getAttribute("aria-label");
    if (!label) return;

    const tooltip = document.createElement("div");
    tooltip.className = "hsfr-tooltip";
    tooltip.dataset.sourceUserId = button.dataset.userId;
    tooltip.dataset.hsfrOwner = this.name;
    tooltip.textContent = label;

    Object.assign(tooltip.style, {
      position: "fixed",
      zIndex: "10000",
      padding: "8px 10px",
      borderRadius: "5px",
      background: "var(--background-floating, #111214)",
      color: "var(--text-normal, #dbdee1)",
      fontSize: "14px",
      fontWeight: "500",
      lineHeight: "16px",
      whiteSpace: "nowrap",
      pointerEvents: "none",
      boxShadow: "var(--elevation-high)"
    });

    const arrow = document.createElement("div");

    Object.assign(arrow.style, {
      position: "absolute",
      left: "50%",
      width: "8px",
      height: "8px",
      background: "var(--background-floating, #111214)",
      transform: "translateX(-50%) rotate(45deg)"
    });

    tooltip.appendChild(arrow);
    document.body.appendChild(tooltip);

    const rect = button.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();

    let left = Math.round(rect.left + rect.width / 2 - tipRect.width / 2);
    left = Math.max(8, Math.min(left, window.innerWidth - tipRect.width - 8));

    let top = Math.round(rect.top - tipRect.height - 8);
    let placeBelow = false;

    if (top < 8) {
      top = Math.round(rect.bottom + 8);
      placeBelow = true;
    }

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;

    Object.assign(
      arrow.style,
      placeBelow
        ? { top: "-4px", bottom: "auto" }
        : { bottom: "-4px", top: "auto" }
    );

    this.tooltip = tooltip;
  }

  // Removes any visible custom tooltip.
  hideTooltip() {
    document
      .querySelectorAll(`.hsfr-tooltip[data-hsfr-owner="${this.name}"]`)
      .forEach(el => el.remove());

    this.tooltip = null;
  }

  // Returns the SVG icon for marking a request as seen.
  getEyeIcon() {
    return `
      <svg class="icon_f8fa06" aria-hidden="true" role="img" width="24" height="24" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 4c5.5 0 9.2 4.1 10.7 6.2a3 3 0 0 1 0 3.6C21.2 15.9 17.5 20 12 20s-9.2-4.1-10.7-6.2a3 3 0 0 1 0-3.6C2.8 8.1 6.5 4 12 4Zm0 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 2.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z"/>
      </svg>
    `;
  }

  // Returns the SVG icon for marking a request as unseen.
  getEyeOffIcon() {
    return `
      <svg class="icon_f8fa06" aria-hidden="true" role="img" width="24" height="24" viewBox="0 0 24 24">
        <path fill="currentColor" d="M2.3 2.3a1 1 0 0 1 1.4 0l18 18a1 1 0 0 1-1.4 1.4l-3.1-3.1A11.2 11.2 0 0 1 12 20c-5.5 0-9.2-4.1-10.7-6.2a3 3 0 0 1 0-3.6A18.4 18.4 0 0 1 5.1 6L2.3 3.7a1 1 0 0 1 0-1.4ZM7.3 8.2A4.9 4.9 0 0 0 7 10a5 5 0 0 0 6.8 4.6l-2-2A2.5 2.5 0 0 1 9.4 10.2l-2-2ZM12 4c5.5 0 9.2 4.1 10.7 6.2a3 3 0 0 1 0 3.6 17.5 17.5 0 0 1-2.2 2.6l-3.2-3.2A5 5 0 0 0 10.8 6.7L8.4 4.3A11.4 11.4 0 0 1 12 4Z"/>
      </svg>
    `;
  }
};
