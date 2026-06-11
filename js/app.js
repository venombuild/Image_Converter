(function () {
  "use strict";

  const FORMAT_EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  const FORMAT_LABEL = { "image/jpeg": "JPG", "image/png": "PNG", "image/webp": "WebP" };
  const LOSSY = new Set(["image/jpeg", "image/webp"]);

  const SIZE_LABEL = {
    none: "Original size",
    small: "75% smaller",
    half: "Half size",
    width: "Max width",
  };

  const QUALITY_LABEL = { 92: "Best quality", 85: "Balanced", 70: "Smallest file" };

  /** @type {Map<string, FileEntry>} */
  const files = new Map();
  let fileIdCounter = 0;

  const prefs = {
    format: "image/jpeg",
    sizeMode: "none",
    maxWidth: 1920,
    quality: 85,
  };

  let wizardStep = 0;
  const TOTAL_STEPS = 4;

  /** @typedef {{ id: string, file: File, previewUrl: string, status: string, resultUrl?: string, outputName?: string, error?: string }} FileEntry */

  const $ = (sel) => document.querySelector(sel);

  const landing = $("#landing");
  const converter = $("#converter");
  const wizardBackdrop = $("#wizardBackdrop");
  const wizardBar = $("#wizardBar");
  const wizardBack = $("#wizardBack");
  const wizardSteps = $("#wizardSteps");
  const qualityStep = $("#qualityStep");
  const widthExtra = $("#widthExtra");
  const wizardWidth = $("#wizardWidth");
  const wizardSummary = $("#wizardSummary");
  const settingsSummary = $("#settingsSummary");
  const dropzone = $("#dropzone");
  const dropzoneText = $("#dropzoneText");
  const fileInput = $("#fileInput");
  const gallery = $("#gallery");
  const galleryHeader = $("#galleryHeader");
  const imageCount = $("#imageCount");
  const toastContainer = $("#toastContainer");

  function toast(msg, type) {
    const el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " toast--error" : "");
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.3s";
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  function formatBytes(b) {
    if (b < 1024) return b + " B";
    if (b < 1048576) return (b / 1024).toFixed(1) + " KB";
    return (b / 1048576).toFixed(1) + " MB";
  }

  function stripExt(name) {
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(0, i) : name;
  }

  function getSettings() {
    let resizeMode = "none";
    let scalePercent = 100;
    let width = 0;

    if (prefs.sizeMode === "half") {
      resizeMode = "percent";
      scalePercent = 50;
    } else if (prefs.sizeMode === "small") {
      resizeMode = "percent";
      scalePercent = 75;
    } else if (prefs.sizeMode === "width") {
      resizeMode = "width";
      width = prefs.maxWidth;
    }

    return {
      format: prefs.format,
      quality: prefs.quality / 100,
      resizeMode,
      width,
      scalePercent,
    };
  }

  function settingsDescription() {
    const parts = [FORMAT_LABEL[prefs.format]];
    parts.push(SIZE_LABEL[prefs.sizeMode] || "Original size");
    if (prefs.sizeMode === "width") parts[parts.length - 1] += " " + prefs.maxWidth + "px";
    if (LOSSY.has(prefs.format)) parts.push(QUALITY_LABEL[prefs.quality] || prefs.quality + "%");
    return parts.join(" · ");
  }

  function updateSettingsDisplay() {
    settingsSummary.textContent = settingsDescription();
  }

  function computeSize(w, h, s) {
    if (s.resizeMode === "width" && s.width > 0) {
      return { width: s.width, height: Math.max(1, Math.round((h / w) * s.width)) };
    }
    if (s.resizeMode === "percent") {
      return {
        width: Math.max(1, Math.round(w * s.scalePercent / 100)),
        height: Math.max(1, Math.round(h * s.scalePercent / 100)),
      };
    }
    return { width: w, height: h };
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't open image")); };
      img.src = url;
    });
  }

  async function convert(file, settings) {
    const img = await loadImage(file);
    const { width, height } = computeSize(img.naturalWidth, img.naturalHeight, settings);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Not supported");

    if (LOSSY.has(settings.format)) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }

    ctx.drawImage(img, 0, 0, width, height);

    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Conversion failed"))),
        settings.format,
        LOSSY.has(settings.format) ? settings.quality : undefined
      );
    });
  }

  function outputName(original, settings) {
    return stripExt(original) + "." + (FORMAT_EXT[settings.format] || "jpg");
  }

  function download(url, name) {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }

  async function saveOne(entry) {
    const settings = getSettings();
    if (settings.resizeMode === "width" && settings.width <= 0) {
      toast("Invalid max width in settings", "error");
      return false;
    }

    entry.status = "saving";
    refreshCard(entry);

    try {
      const blob = await convert(entry.file, settings);
      if (entry.resultUrl) URL.revokeObjectURL(entry.resultUrl);
      entry.resultUrl = URL.createObjectURL(blob);
      entry.outputName = outputName(entry.file.name, settings);
      entry.status = "done";
      refreshCard(entry);
      download(entry.resultUrl, entry.outputName);
      return true;
    } catch (err) {
      entry.status = "error";
      entry.error = err instanceof Error ? err.message : "Failed";
      refreshCard(entry);
      return false;
    }
  }

  async function saveAll() {
    const entries = [...files.values()].filter((e) => e.status !== "saving");
    if (!entries.length) return;

    $("#saveAllBtn").disabled = true;
    let ok = 0;

    for (const entry of entries) {
      if (await saveOne(entry)) {
        ok++;
        if (entries.length > 1) await new Promise((r) => setTimeout(r, 400));
      }
    }

    $("#saveAllBtn").disabled = false;
    if (ok === entries.length) toast("All saved!");
    else if (ok > 0) toast(ok + " of " + entries.length + " saved");
  }

  function updateLayout() {
    const n = files.size;
    galleryHeader.hidden = n === 0;
    imageCount.textContent = String(n);
    dropzone.classList.toggle("dropzone--compact", n > 0);
    dropzoneText.textContent = n > 0 ? "Drop more images or click to add" : "Drop your images here or click to browse";
  }

  function createCard(entry) {
    const card = document.createElement("article");
    card.className = "card";
    card.dataset.id = entry.id;
    if (entry.status === "done") card.classList.add("card--done");
    if (entry.status === "error") card.classList.add("card--error");
    if (entry.status === "saving") card.classList.add("card--saving");

    const preview = document.createElement("div");
    preview.className = "card__preview";
    const img = document.createElement("img");
    img.src = entry.previewUrl;
    img.alt = entry.file.name;
    preview.appendChild(img);

    const body = document.createElement("div");
    body.className = "card__body";
    const name = document.createElement("p");
    name.className = "card__name";
    name.textContent = entry.file.name;
    name.title = entry.file.name;
    const meta = document.createElement("p");
    meta.className = "card__meta";
    meta.textContent = formatBytes(entry.file.size);
    body.append(name, meta);

    const actions = document.createElement("div");
    actions.className = "card__actions";

    if (entry.status === "saving") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--primary btn--full";
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Saving…';
      actions.appendChild(btn);
    } else if (entry.status === "done") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--primary btn--full";
      btn.textContent = "Save again";
      btn.addEventListener("click", () => saveOne(entry));
      actions.appendChild(btn);
    } else if (entry.status === "error") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--primary btn--full";
      btn.textContent = "Try again";
      btn.addEventListener("click", () => saveOne(entry));
      actions.appendChild(btn);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn--primary btn--full";
      btn.textContent = "Save to device";
      btn.addEventListener("click", () => saveOne(entry));
      actions.appendChild(btn);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "card__remove";
    remove.setAttribute("aria-label", "Remove");
    remove.textContent = "×";
    remove.addEventListener("click", () => removeFile(entry.id));

    card.append(preview, body, actions, remove);
    return card;
  }

  function refreshCard(entry) {
    const old = gallery.querySelector('[data-id="' + entry.id + '"]');
    const card = createCard(entry);
    if (old) old.replaceWith(card);
    else gallery.appendChild(card);
    updateLayout();
  }

  function renderAll() {
    gallery.innerHTML = "";
    for (const entry of files.values()) gallery.appendChild(createCard(entry));
    updateLayout();
  }

  function addFiles(list) {
    const incoming = [...list].filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) { toast("Those don't look like images", "error"); return; }
    for (const file of incoming) {
      const id = "f-" + ++fileIdCounter;
      files.set(id, {
        id,
        file,
        previewUrl: URL.createObjectURL(file),
        status: "ready",
      });
    }
    renderAll();
  }

  function removeFile(id) {
    const entry = files.get(id);
    if (!entry) return;
    URL.revokeObjectURL(entry.previewUrl);
    if (entry.resultUrl) URL.revokeObjectURL(entry.resultUrl);
    files.delete(id);
    renderAll();
  }

  function clearAll() {
    for (const e of files.values()) {
      URL.revokeObjectURL(e.previewUrl);
      if (e.resultUrl) URL.revokeObjectURL(e.resultUrl);
    }
    files.clear();
    renderAll();
  }

  /* ── Wizard ── */

  function getStepElements() {
    return [...wizardSteps.querySelectorAll(".wizard__step")];
  }

  function logicalStepCount() {
    return LOSSY.has(prefs.format) ? 4 : 3;
  }

  function showWizardStep(index) {
    const steps = getStepElements();
    steps.forEach((el, i) => {
      el.classList.remove("wizard__step--active", "wizard__step--exit");
      if (i === index) el.classList.add("wizard__step--active");
      else if (i < index) el.classList.add("wizard__step--exit");
    });

    wizardBack.hidden = index === 0;

    const progress = ((index + 1) / logicalStepCount()) * 100;
    wizardBar.style.width = progress + "%";

    if (index === 3) buildSummary();
  }

  function nextStep() {
    if (wizardStep === 1 && prefs.sizeMode === "width") {
      prefs.maxWidth = Number(wizardWidth.value) || 1920;
    }

    if (wizardStep === 1 && !LOSSY.has(prefs.format)) {
      wizardStep = 3;
    } else {
      wizardStep++;
    }

    showWizardStep(wizardStep);
  }

  function prevStep() {
    if (wizardStep === 3 && !LOSSY.has(prefs.format)) {
      wizardStep = 1;
    } else {
      wizardStep--;
    }
    showWizardStep(wizardStep);
  }

  function openWizard(fromConverter) {
    wizardStep = fromConverter ? 0 : 0;
    widthExtra.hidden = prefs.sizeMode !== "width";
    wizardWidth.value = String(prefs.maxWidth);
    showWizardStep(wizardStep);
    wizardBackdrop.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function closeWizard() {
    wizardBackdrop.hidden = true;
    document.body.style.overflow = "";
  }

  function finishWizard() {
    if (prefs.sizeMode === "width") {
      prefs.maxWidth = Number(wizardWidth.value) || 1920;
    }
    updateSettingsDisplay();
    closeWizard();

    landing.classList.add("landing--exit");
    setTimeout(() => { landing.hidden = true; }, 500);

    converter.hidden = false;
    updateSettingsDisplay();
  }

  function buildSummary() {
    const items = [
      ["Format", FORMAT_LABEL[prefs.format]],
      ["Size", prefs.sizeMode === "width"
        ? "Max width " + prefs.maxWidth + "px"
        : SIZE_LABEL[prefs.sizeMode]],
    ];
    if (LOSSY.has(prefs.format)) {
      items.push(["Quality", QUALITY_LABEL[prefs.quality]]);
    }

    wizardSummary.innerHTML = items
      .map(([label, val]) => "<li>" + label + ": <strong>" + val + "</strong></li>")
      .join("");
  }

  function selectChoice(btn) {
    btn.closest(".wizard__choices").querySelectorAll(".choice").forEach((c) => {
      c.classList.remove("choice--selected");
    });
    btn.classList.add("choice--selected");
  }

  $("#startBtn").addEventListener("click", () => openWizard(false));
  $("#changeSettingsBtn").addEventListener("click", () => openWizard(true));
  wizardBack.addEventListener("click", prevStep);
  $("#wizardFinish").addEventListener("click", finishWizard);

  wizardSteps.querySelectorAll("[data-format]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectChoice(btn);
      prefs.format = btn.dataset.format;
      setTimeout(nextStep, 280);
    });
  });

  wizardSteps.querySelectorAll("[data-size]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectChoice(btn);
      prefs.sizeMode = btn.dataset.size;
      widthExtra.hidden = prefs.sizeMode !== "width";
      if (prefs.sizeMode === "width") return;
      setTimeout(nextStep, 280);
    });
  });

  wizardWidth.addEventListener("keydown", (e) => {
    if (e.key === "Enter") nextStep();
  });

  $("#widthContinue").addEventListener("click", nextStep);

  wizardSteps.querySelectorAll("[data-quality]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectChoice(btn);
      prefs.quality = Number(btn.dataset.quality);
      setTimeout(nextStep, 280);
    });
  });

  /* ── Dropzone ── */

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });

  ["dragenter", "dragover"].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dropzone--over"); });
  });

  ["dragleave", "drop"].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dropzone--over"); });
  });

  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.length) addFiles(fileInput.files);
    fileInput.value = "";
  });

  $("#saveAllBtn").addEventListener("click", saveAll);
  $("#clearBtn").addEventListener("click", clearAll);
})();
