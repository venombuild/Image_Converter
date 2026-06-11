(function () {
  "use strict";

  const FORMAT_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
  };

  const LOSSY_FORMATS = new Set(["image/jpeg", "image/webp"]);

  /** @type {Map<string, FileEntry>} */
  const files = new Map();
  let fileIdCounter = 0;

  /** @typedef {{ id: string, file: File, previewUrl: string, status: string, result?: Blob, resultUrl?: string, outputName?: string, error?: string }} FileEntry */

  const $ = (sel) => document.querySelector(sel);

  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  const workspace = $("#workspace");
  const fileList = $("#fileList");
  const fileCount = $("#fileCount");
  const downloadBar = $("#downloadBar");
  const convertedCount = $("#convertedCount");
  const toastContainer = $("#toastContainer");

  const formatSelect = $("#format");
  const qualityGroup = $("#qualityGroup");
  const qualityRange = $("#quality");
  const qualityValue = $("#qualityValue");
  const resizeMode = $("#resizeMode");
  const resizeFields = $("#resizeFields");
  const resizeWidth = $("#resizeWidth");
  const resizeHeight = $("#resizeHeight");
  const percentGroup = $("#percentGroup");
  const scalePercent = $("#scalePercent");
  const scaleValue = $("#scaleValue");
  const maintainAspect = $("#maintainAspect");
  const rotateSelect = $("#rotate");
  const flipH = $("#flipH");
  const flipV = $("#flipV");
  const bgColor = $("#bgColor");
  const filenamePattern = $("#filenamePattern");

  function toast(message, type = "info") {
    const el = document.createElement("div");
    el.className = "toast" + (type === "error" ? " toast--error" : "");
    el.textContent = message;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = "0";
      el.style.transition = "opacity 0.3s";
      setTimeout(() => el.remove(), 300);
    }, 3500);
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
  }

  function stripExtension(name) {
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(0, dot) : name;
  }

  function getSettings() {
    return {
      format: formatSelect.value,
      quality: Number(qualityRange.value) / 100,
      resizeMode: resizeMode.value,
      width: Number(resizeWidth.value) || 0,
      height: Number(resizeHeight.value) || 0,
      scalePercent: Number(scalePercent.value),
      maintainAspect: maintainAspect.checked,
      rotate: Number(rotateSelect.value),
      flipH: flipH.checked,
      flipV: flipV.checked,
      bgColor: bgColor.value,
      filenamePattern: filenamePattern.value || "{name}_converted",
    };
  }

  function computeDimensions(srcW, srcH, settings) {
    let w = srcW;
    let h = srcH;

    switch (settings.resizeMode) {
      case "width":
        if (settings.width > 0) {
          w = settings.width;
          if (settings.maintainAspect) h = Math.round((srcH / srcW) * w);
        }
        break;
      case "height":
        if (settings.height > 0) {
          h = settings.height;
          if (settings.maintainAspect) w = Math.round((srcW / srcH) * h);
        }
        break;
      case "both":
        if (settings.width > 0) w = settings.width;
        if (settings.height > 0) h = settings.height;
        break;
      case "percent":
        w = Math.round(srcW * (settings.scalePercent / 100));
        h = Math.round(srcH * (settings.scalePercent / 100));
        break;
      case "max": {
        const maxW = settings.width || srcW;
        const maxH = settings.height || srcH;
        const ratio = Math.min(maxW / srcW, maxH / srcH, 1);
        w = Math.round(srcW * ratio);
        h = Math.round(srcH * ratio);
        break;
      }
    }

    return { width: Math.max(1, w), height: Math.max(1, h) };
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not load image"));
      };
      img.src = url;
    });
  }

  async function convertImage(file, settings) {
    const img = await loadImage(file);
    const { width, height } = computeDimensions(img.naturalWidth, img.naturalHeight, settings);

    const rotation = settings.rotate;
    const swap = rotation === 90 || rotation === 270;
    const canvasW = swap ? height : width;
    const canvasH = swap ? width : height;

    const canvas = document.createElement("canvas");
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext("2d");

    if (!ctx) throw new Error("Canvas not supported");

    const needsBg = LOSSY_FORMATS.has(settings.format);
    if (needsBg) {
      ctx.fillStyle = settings.bgColor;
      ctx.fillRect(0, 0, canvasW, canvasH);
    }

    ctx.save();
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(settings.flipH ? -1 : 1, settings.flipV ? -1 : 1);
    ctx.drawImage(img, -width / 2, -height / 2, width, height);
    ctx.restore();

    const mime = settings.format;
    const qualityArg = LOSSY_FORMATS.has(mime) ? settings.quality : undefined;

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Conversion failed"))),
        mime,
        qualityArg
      );
    });

    return blob;
  }

  function buildOutputName(originalName, settings) {
    const base = stripExtension(originalName);
    const pattern = settings.filenamePattern.replace(/\{name\}/g, base);
    const ext = FORMAT_EXT[settings.format] || "png";
    return pattern + "." + ext;
  }

  function updateUI() {
    const count = files.size;
    fileCount.textContent = String(count);
    workspace.hidden = count === 0;
    dropzone.hidden = count > 0;

    const done = [...files.values()].filter((f) => f.status === "done").length;
    downloadBar.hidden = done === 0;
    convertedCount.textContent = String(done);
  }

  function renderFileList() {
    fileList.innerHTML = "";
    for (const entry of files.values()) {
      fileList.appendChild(createFileItem(entry));
    }
    updateUI();
  }

  function createFileItem(entry) {
    const li = document.createElement("li");
    li.className = "file-item";
    li.dataset.id = entry.id;
    if (entry.status === "done") li.classList.add("file-item--done");
    if (entry.status === "error") li.classList.add("file-item--error");

    const thumb = document.createElement("img");
    thumb.className = "file-item__thumb";
    thumb.src = entry.resultUrl || entry.previewUrl;
    thumb.alt = "";

    const info = document.createElement("div");
    info.className = "file-item__info";

    const name = document.createElement("div");
    name.className = "file-item__name";
    name.textContent = entry.outputName || entry.file.name;
    name.title = name.textContent;

    const meta = document.createElement("div");
    meta.className = "file-item__meta";
    const sizeText = entry.result
      ? formatBytes(entry.file.size) + " → " + formatBytes(entry.result.size)
      : formatBytes(entry.file.size);
    meta.textContent = sizeText;

    const status = document.createElement("div");
    status.className = "file-item__status file-item__status--" + entry.status;
    if (entry.status === "pending") status.textContent = "Ready to convert";
    else if (entry.status === "processing") status.innerHTML = '<span class="spinner"></span>Converting…';
    else if (entry.status === "done") status.textContent = "Converted";
    else if (entry.status === "error") status.textContent = entry.error || "Failed";

    info.append(name, meta, status);

    const actions = document.createElement("div");
    actions.className = "file-item__actions";

    if (entry.status === "done" && entry.resultUrl) {
      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "btn btn--ghost btn--sm";
      dl.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2"/></svg> Download';
      dl.addEventListener("click", () => downloadBlob(entry.resultUrl, entry.outputName));
      actions.appendChild(dl);
    }

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn--ghost btn--sm";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => removeFile(entry.id));
    actions.appendChild(remove);

    li.append(thumb, info, actions);
    return li;
  }

  function refreshFileItem(entry) {
    const existing = fileList.querySelector('[data-id="' + entry.id + '"]');
    const newItem = createFileItem(entry);
    if (existing) existing.replaceWith(newItem);
    else fileList.appendChild(newItem);
    updateUI();
  }

  function downloadBlob(url, filename) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  }

  function addFiles(fileListInput) {
    const incoming = [...fileListInput].filter((f) => f.type.startsWith("image/"));
    if (incoming.length === 0) {
      toast("Please select image files only", "error");
      return;
    }

    for (const file of incoming) {
      const id = "f-" + ++fileIdCounter;
      files.set(id, {
        id,
        file,
        previewUrl: URL.createObjectURL(file),
        status: "pending",
      });
    }

    renderFileList();
    toast(incoming.length + " image" + (incoming.length > 1 ? "s" : "") + " added");
  }

  function removeFile(id) {
    const entry = files.get(id);
    if (!entry) return;
    URL.revokeObjectURL(entry.previewUrl);
    if (entry.resultUrl) URL.revokeObjectURL(entry.resultUrl);
    files.delete(id);
    renderFileList();
  }

  function clearAll() {
    for (const entry of files.values()) {
      URL.revokeObjectURL(entry.previewUrl);
      if (entry.resultUrl) URL.revokeObjectURL(entry.resultUrl);
    }
    files.clear();
    renderFileList();
  }

  async function convertAll() {
    const settings = getSettings();
    const entries = [...files.values()];
    let success = 0;

    $("#convertBtn").disabled = true;

    for (const entry of entries) {
      if (entry.resultUrl) URL.revokeObjectURL(entry.resultUrl);
      entry.result = undefined;
      entry.resultUrl = undefined;
      entry.status = "processing";
      refreshFileItem(entry);

      try {
        const blob = await convertImage(entry.file, settings);
        entry.result = blob;
        entry.resultUrl = URL.createObjectURL(blob);
        entry.outputName = buildOutputName(entry.file.name, settings);
        entry.status = "done";
        success++;
      } catch (err) {
        entry.status = "error";
        entry.error = err instanceof Error ? err.message : "Conversion failed";
      }

      refreshFileItem(entry);
    }

    $("#convertBtn").disabled = false;

    if (success === entries.length) {
      toast("All " + success + " images converted");
    } else if (success > 0) {
      toast(success + " of " + entries.length + " converted");
    } else {
      toast("Conversion failed", "error");
    }
  }

  async function downloadAllZip() {
    const done = [...files.values()].filter((f) => f.status === "done" && f.result);
    if (done.length === 0) return;

    if (typeof JSZip === "undefined") {
      toast("Zip library failed to load", "error");
      return;
    }

    const zip = new JSZip();
    for (const entry of done) {
      zip.file(entry.outputName, entry.result);
    }

    $("#downloadAllBtn").disabled = true;
    try {
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(URL.createObjectURL(blob), "converted_images.zip");
      toast("Zip downloaded");
    } catch {
      toast("Could not create zip file", "error");
    }
    $("#downloadAllBtn").disabled = false;
  }

  function updateResizeUI() {
    const mode = resizeMode.value;
    resizeFields.hidden = mode === "none" || mode === "percent";
    percentGroup.hidden = mode !== "percent";

    if (mode === "percent") {
      scaleValue.textContent = scalePercent.value + "%";
    }
  }

  function updateQualityUI() {
    const isLossy = LOSSY_FORMATS.has(formatSelect.value);
    qualityGroup.hidden = !isLossy;
    qualityValue.textContent = qualityRange.value + "%";
  }

  // Dropzone events
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });

  ["dragenter", "dragover"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dropzone--active");
    });
  });

  ["dragleave", "drop"].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dropzone--active");
    });
  });

  dropzone.addEventListener("drop", (e) => {
    if (e.dataTransfer?.files) addFiles(e.dataTransfer.files);
  });

  fileInput.addEventListener("change", () => {
    if (fileInput.files?.length) addFiles(fileInput.files);
    fileInput.value = "";
  });

  $("#addMoreBtn").addEventListener("click", () => fileInput.click());
  $("#clearBtn").addEventListener("click", clearAll);
  $("#convertBtn").addEventListener("click", convertAll);
  $("#downloadAllBtn").addEventListener("click", downloadAllZip);

  qualityRange.addEventListener("input", updateQualityUI);
  scalePercent.addEventListener("input", updateResizeUI);
  resizeMode.addEventListener("change", updateResizeUI);
  formatSelect.addEventListener("change", updateQualityUI);

  updateQualityUI();
  updateResizeUI();
})();
