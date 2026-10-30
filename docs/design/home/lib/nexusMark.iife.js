var NexusMark = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // ../mockups/mark-entry.ts
  var mark_entry_exports = {};
  __export(mark_entry_exports, {
    bootAnnouncement: () => bootAnnouncement,
    bootFraction: () => bootFraction,
    bootLabel: () => bootLabel,
    bootMarkStatus: () => bootMarkStatus,
    bootProgressFromLegacyText: () => bootProgressFromLegacyText,
    bootStepLabels: () => bootStepLabels,
    bootSteps: () => bootSteps,
    brandStatusGroups: () => brandStatusGroups,
    brandStatusLabels: () => brandStatusLabels,
    markSvg: () => markSvg
  });

  // ../brand/nexusMark.ts
  var MARK_VIEWBOX = "-73 -66 146 146";
  var TOP = "M-55.85-32.25H55.85L30.03-17.34H-30.03Z";
  var RIGHT = "M55.85-32.25L0 64.49V34.68L30.03-17.34Z";
  var LEFT = "M0 64.49L-55.85-32.25L-30.03-17.34L0 34.68Z";
  var FRAME = "M-55.85-32.25H55.85L0 64.49ZM-30.03-17.34H30.03L0 34.68Z";
  var HOLE = "M-30.03-17.34H30.03L0 34.68Z";
  var MID = "M-11.63-6.72H11.63L0 13.43Z";
  var CORE = "M-7.42-4.28H7.42L0 8.57Z";
  var GLOW = "M-20-11.55H20L0 23.09Z";
  var PROGRESS = "M0-38.7H67.02L0 77.39L-67.02-38.7Z";
  var PROGRESS_MIN_SIZE = 40;
  var PARTICLES = `<path fill="none" stroke="#7fe9ff" stroke-width="2.4" stroke-dasharray="4 4" d="M-27-15.6H27L0 31.2Z"/><circle fill="#7fe9ff" r="3" cx="0" cy="-31.2"/><circle fill="#7fe9ff" r="3" cx="-27" cy="15.6"/><circle fill="#7fe9ff" r="3" cx="27" cy="15.6"/>`;
  function safeId(uid) {
    return "nm-" + uid.replace(/[^A-Za-z0-9_-]/g, "_");
  }
  function markInner(uid) {
    const id = safeId(uid);
    return `<defs><linearGradient id="${id}-core"><stop offset="0" stop-color="#00a1ad"/><stop offset="1" stop-color="#587bff"/></linearGradient><linearGradient id="${id}-band" x2="0" y2="1"><stop offset="0" stop-color="#7fe9ff" stop-opacity="0"/><stop offset=".5" stop-color="#7fe9ff" stop-opacity=".95"/><stop offset="1" stop-color="#7fe9ff" stop-opacity="0"/></linearGradient><filter id="${id}-blur" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="6"/></filter><clipPath id="${id}-hole"><path d="${HOLE}"/></clipPath><clipPath id="${id}-mark"><path clip-rule="evenodd" d="${FRAME}"/><path d="${MID}"/></clipPath></defs><path class="nm-glow" fill="#38d9ff" filter="url(#${id}-blur)" d="${GLOW}"/><g class="nm-progress"><path class="nm-progress-track" pathLength="100" d="${PROGRESS}"/><path class="nm-progress-a" pathLength="100" d="${PROGRESS}"/></g><g class="nm-pose"><g class="nm-body"><g class="nm-fill" clip-path="url(#${id}-hole)"><rect class="nm-fill-a" x="-31" y="-18" width="62" height="54" fill="url(#${id}-core)"/></g><g class="nm-ring"><g class="nm-p nm-top"><path class="nm-a" d="${TOP}"/></g><g class="nm-p nm-right"><path class="nm-a" d="${RIGHT}"/></g><g class="nm-p nm-left"><path class="nm-a" d="${LEFT}"/></g></g><g class="nm-ghost"><g class="nm-ghost-a"><path class="nm-a" d="${RIGHT}"/><path class="nm-a" d="${LEFT}"/></g></g><g class="nm-echo"><path class="nm-echo-a" d="${MID}"/><path class="nm-echo-a nm-late" d="${MID}"/></g><g class="nm-particles"><g class="nm-particles-a">${PARTICLES}</g><g class="nm-particles-a nm-late">${PARTICLES}</g></g><g class="nm-scan" clip-path="url(#${id}-mark)"><rect class="nm-scan-a" x="-60" y="-40" width="120" height="28" fill="url(#${id}-band)"/></g><g class="nm-midg"><path class="nm-mid" fill="#fff" d="${MID}"/></g><g class="nm-coreg"><path class="nm-core" fill="url(#${id}-core)" d="${CORE}"/><path class="nm-warn" fill="#ff6b81" d="${MID}"/></g></g></g>`;
  }
  function progressPercent(progress) {
    return Number.isFinite(progress) ? Math.round(Math.min(1, Math.max(0, progress)) * 100) : 0;
  }
  function progressStyle(progress) {
    return `--nm-progress-offset: ${100 - progressPercent(progress)}`;
  }
  function markSvg(uid, status, options = {}) {
    const size = options.size ?? 128;
    const style = options.css === void 0 ? "" : `<style><![CDATA[${options.css}]]></style>`;
    const progress = options.progress === void 0 || size < PROGRESS_MIN_SIZE ? "" : ` data-progress="" style="${progressStyle(options.progress)}"`;
    const tone = options.tone === "light" ? ' data-tone="light"' : "";
    return `<svg xmlns="http://www.w3.org/2000/svg" class="nexus-mark" data-status="${status}" viewBox="${MARK_VIEWBOX}" width="${size}" height="${size}" aria-hidden="true" focusable="false"${progress}${tone}>${style}${markInner(uid)}</svg>`;
  }

  // ../brand/brandStatus.ts
  var brandStatusLabels = {
    idle: "Ready",
    waiting: "Waiting",
    preparing: "Preparing",
    memory: "Working with memory",
    thinking: "Thinking",
    generating: "Writing",
    tool_call: "Using a tool",
    translating: "Translating",
    imaging: "Creating an image",
    speaking: "Speaking",
    finishing: "Finishing up",
    done: "Done",
    stopped: "Stopped",
    error: "Failed",
    transfer_in: "Receiving data",
    transfer_out: "Sending data",
    scanning: "Checking data"
  };
  var brandStatusGroups = {
    run: ["waiting", "preparing", "memory", "thinking", "generating", "tool_call", "translating", "imaging", "speaking", "finishing"],
    outcome: ["done", "stopped", "error"],
    data: ["transfer_in", "transfer_out", "scanning"]
  };

  // ../boot/bootProgress.ts
  var bootSteps = ["storage", "save", "library", "app", "files", "plugins", "finish"];
  var bootStepLabels = {
    storage: "Opening storage",
    save: "Reading your save",
    library: "Preparing your library",
    app: "Checking the app",
    files: "Listing stored files",
    plugins: "Loading plugins",
    finish: "Applying settings"
  };
  var bootStateLabels = {
    waiting: "Waiting for you",
    failed: "Startup stopped",
    ready: "Ready"
  };
  var recoveringLabel = "Recovering from a backup";
  var stepStatus = {
    storage: "scanning",
    save: "transfer_in",
    library: "preparing",
    app: "scanning",
    files: "scanning",
    plugins: "tool_call",
    finish: "finishing"
  };
  function bootMarkStatus(progress) {
    if (progress.state === "failed") return "error";
    if (progress.state === "waiting") return "waiting";
    if (progress.state === "ready") return "done";
    if (progress.step === "library" && progress.recovering) return "transfer_in";
    return stepStatus[progress.step];
  }
  function bootAnnouncement(progress) {
    if (progress.state !== "running") return bootStateLabels[progress.state];
    if (progress.step === "library" && progress.recovering) return recoveringLabel;
    return bootStepLabels[progress.step];
  }
  function bootLabel(progress) {
    if (progress.state !== "running") return bootStateLabels[progress.state];
    return progress.detail ?? bootStepLabels[progress.step];
  }
  function bootFraction(progress) {
    if (progress.state === "ready") return 1;
    const index = bootSteps.indexOf(progress.step);
    const count = progress.count;
    const within = count && count.total > 0 ? Math.min(Math.max(count.done / count.total, 0), 1) : 0;
    return (index + within) / bootSteps.length;
  }
  var legacyText = [
    ["Checking Files...", "storage"],
    ["Reading Save File...", "save"],
    ["Loading Local Save File...", "save"],
    ["Decoding Save File...", "library"],
    ["Decoding Local Save File...", "library"],
    ["Reading Backup Files...", "library", { recovering: true, detail: recoveringLabel }],
    ["Checking Update...", "app"],
    ["Checking Service Worker...", "app"],
    ["Listing Stored Files...", "files"],
    ["Loading Plugins...", "plugins"],
    ["Checking For Format Update...", "finish"],
    ["Updating States...", "finish"]
  ];
  var countedText = /^(Updating archived characters|Archiving characters) (\d+)\/(\d+)$/;
  function bootProgressFromLegacyText(text, previous = "storage") {
    const exact = legacyText.find(([known]) => known === text);
    if (exact) return { step: exact[1], state: "running", ...exact[2] };
    if (text.startsWith("Reading Backup File ")) {
      return { step: "library", state: "running", recovering: true, detail: recoveringLabel };
    }
    const counted = countedText.exec(text);
    if (counted) {
      const done = Number(counted[2]);
      const total = Number(counted[3]);
      return { step: "library", state: "running", detail: text, count: { done: Math.max(done - 1, 0), total } };
    }
    return { step: previous, state: "running" };
  }
  return __toCommonJS(mark_entry_exports);
})();
