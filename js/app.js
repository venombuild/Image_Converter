(function () {
  "use strict";

  const FORMAT_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };

  const LOSSY = new Set(["image/jpeg", "image/webp"]);

  /** @type {Map<string, FileEntry>} */
  const files = new Map();
  let fileIdCounter = 0;
  let selectedFormat = "image/jpeg";

  /** @typedef {{ id: string, file: File, previewUrl: string, status: string, resultUrl?: string, outputName?: string, error?: string }} FileEntry */

  const $ = (sel) => document.querySelector(sel);

  const dropzone = $("#dropzone");
  const dropzoneText = $("#dropzoneText");
  const fileInput = $("#fileInput");
  const gallery = $("#gallery");
  const galleryHeader = $("#galleryHeader");
  const imageCount = $("#imageCount");
  const qualityGroup = $("#qualityGroup");
  const qualityRange = $("#quality");
  const qualityValue = $("#qualityValue");
  const sizeMode = $("#sizeMode");
  const widthGroup = $("#widthGroup");
  const maxWidth = $("#maxWidth");
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
    const mode = sizeMode.value;
    let resizeMode = "none";
    let scalePercent = 100;
    let width = 0;

    if (mode === "half") {
      resizeMode = "percent";
      scalePercent = 50;
    } else if (mode === "small") {
      resizeMode = "percent";
      scalePercent = 75;
    } else if (mode === "width") {
      resizeMode = "width";
      width = Number(maxWidth.value) || 0;
    }

    return {
      format: selectedFormat,
      quality: Number(qualityRange.value) / 100,
      resizeMode,
      width,
      scalePercent,
    };
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

  function validateSettings() {
    const s = getSettings();
    if (s.resizeMode === "width" && s.width <= 0) {
      toast("Enter a max width in pixels", "error");
      return null;
    }
    return s;
  }

  async function saveOne(entry) {
    const settings = validateSettings();
    if (!settings) return false;

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
    if (entries.length === 0) return;

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
    const hasFiles = n > 0;

    galleryHeader.hidden = !hasFiles;
    imageCount.textContent = String(n);
    dropzone.classList.toggle("dropzone--compact", hasFiles);
    dropzoneText.textContent = hasFiles
      ? "Drop more images or click to add"
      : "Drop images here or click to browse";
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
      const status = document.createElement("button");
      status.type = "button";
      status.className = "btn btn--primary btn--full";
      status.disabled = true;
      status.innerHTML = '<span class="spinner"></span> Saving…';
      actions.appendChild(status);
    } else if (entry.status === "done") {
      const again = document.createElement("button");
      again.type = "button";
      again.className = "btn btn--primary btn--full";
      again.textContent = "Save again";
      again.addEventListener("click", () => saveOne(entry));
      actions.appendChild(again);
    } else if (entry.status === "error") {
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "btn btn--primary btn--full";
      retry.textContent = "Try again";
      retry.addEventListener("click", () => saveOne(entry));
      actions.appendChild(retry);
    } else {
      const save = document.createElement("button");
      save.type = "button";
      save.className = "btn btn--primary btn--full";
      save.textContent = "Save to device";
      save.addEventListener("click", () => saveOne(entry));
      actions.appendChild(save);
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
    for (const entry of files.values()) {
      gallery.appendChild(createCard(entry));
    }
    updateLayout();
  }

  function addFiles(list) {
    const incoming = [...list].filter((f) => f.type.startsWith("image/"));
    if (!incoming.length) {
      toast("Those don't look like images", "error");
      return;
    }

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

  function setActivePill(btn) {
    btn.parentElement.querySelectorAll(".pill").forEach((p) => p.classList.remove("pill--active"));
    btn.classList.add("pill--active");
  }

  function updateToolbar() {
    const lossy = LOSSY.has(selectedFormat);
    qualityGroup.hidden = !lossy;
    qualityValue.textContent = qualityRange.value + "%";
    widthGroup.hidden = sizeMode.value !== "width";
  }

  document.querySelectorAll("[data-format]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedFormat = btn.dataset.format;
      setActivePill(btn);
      updateToolbar();
    });
  });

  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });

  ["dragenter", "dragover"].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add("dropzone--over");
    });
  });

  ["dragleave", "drop"].forEach((ev) => {
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dropzone--over");
    });
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
  qualityRange.addEventListener("input", updateToolbar);
  sizeMode.addEventListener("change", updateToolbar);

  updateToolbar();
})();
