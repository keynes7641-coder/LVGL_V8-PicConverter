// Application State
const state = {
  image: null,           // HTMLImageElement
  originalWidth: 0,
  originalHeight: 0,
  targetWidth: 240,
  targetHeight: 240,
  aspectMode: 'keep',    // 'keep' (維持長寬比例) or 'fill' (填滿畫面)
  rotation: 0,           // 0, 90, 180, 270 degrees
  alignMode: 'center',   // 'center' (置中) or 'top' (靠上)
  dither: true,
  includeHeader: true,
  fileName: 'image_map'
};

// DOM Elements
let elements = {};

// Helper to reliably retrieve converter functions
function getConverter() {
  if (window.LVGLConverter && typeof window.LVGLConverter.convertToLVGLBuffer === 'function') {
    return window.LVGLConverter;
  }
  return {
    applyFloydSteinbergDither: window.applyFloydSteinbergDither,
    convertToLVGLBuffer: window.convertToLVGLBuffer,
    generateLVGLCCode: window.generateLVGLCCode
  };
}

// Initialize App Event Listeners & Canvas
function init() {
  elements = {
    btnSelectFile: document.getElementById('btnSelectFile'),
    fileInput: document.getElementById('fileInput'),
    
    resolutionSelect: document.getElementById('resolutionSelect'),
    currentResDisplay: document.getElementById('currentResDisplay'),
    customResBox: document.getElementById('customResBox'),
    customWidth: document.getElementById('customWidth'),
    customHeight: document.getElementById('customHeight'),
    
    aspectModeSelect: document.getElementById('aspectModeSelect'),
    ditherCheckbox: document.getElementById('ditherCheckbox'),
    headerCheckbox: document.getElementById('headerCheckbox'),
    
    previewCanvas: document.getElementById('previewCanvas'),
    screenFrame: document.getElementById('screenFrame'),
    
    btnRotate: document.getElementById('btnRotate'),
    rotateDegreeDisplay: document.getElementById('rotateDegreeDisplay'),
    btnAlign: document.getElementById('btnAlign'),
    alignModeDisplay: document.getElementById('alignModeDisplay'),
    
    btnExportBin: document.getElementById('btnExportBin'),
    btnExportC: document.getElementById('btnExportC'),
    btnExportPng: document.getElementById('btnExportPng'),
    
    infoOriginalRes: document.getElementById('infoOriginalRes'),
    infoTargetRes: document.getElementById('infoTargetRes'),
    infoOutputSize: document.getElementById('infoOutputSize'),
    infoTransform: document.getElementById('infoTransform')
  };

  bindEvents();
  updateResolutionFromSelect();
  drawPlaceholderCanvas();
  updateInfoDisplay();
}

// Bind User Interactivity Events
function bindEvents() {
  // 1. Direct click listener on "讀入檔案" button
  if (elements.btnSelectFile) {
    elements.btnSelectFile.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (elements.fileInput) {
        elements.fileInput.click();
      }
    });
  }

  // 1. Change listener on fileInput
  if (elements.fileInput) {
    elements.fileInput.addEventListener('change', handleFileSelect);
  }

  // 2. Resolution Setting Dropdown
  if (elements.resolutionSelect) {
    elements.resolutionSelect.addEventListener('change', () => {
      updateResolutionFromSelect();
      renderPreview();
    });
  }

  if (elements.customWidth) {
    elements.customWidth.addEventListener('input', () => {
      if (elements.resolutionSelect.value === 'custom') {
        state.targetWidth = Math.max(1, parseInt(elements.customWidth.value) || 240);
        renderPreview();
      }
    });
  }

  if (elements.customHeight) {
    elements.customHeight.addEventListener('input', () => {
      if (elements.resolutionSelect.value === 'custom') {
        state.targetHeight = Math.max(1, parseInt(elements.customHeight.value) || 240);
        renderPreview();
      }
    });
  }

  // 3. Aspect Ratio Dropdown
  if (elements.aspectModeSelect) {
    elements.aspectModeSelect.addEventListener('change', (e) => {
      state.aspectMode = e.target.value;
      renderPreview();
    });
  }

  // 4. LVGL Options
  if (elements.ditherCheckbox) {
    elements.ditherCheckbox.addEventListener('change', (e) => {
      state.dither = e.target.checked;
      renderPreview();
    });
  }

  if (elements.headerCheckbox) {
    elements.headerCheckbox.addEventListener('change', (e) => {
      state.includeHeader = e.target.checked;
      updateInfoDisplay();
    });
  }

  // 5 & 6. Rotate 90 Degrees Button
  if (elements.btnRotate) {
    elements.btnRotate.addEventListener('click', () => {
      state.rotation = (state.rotation + 90) % 360;
      elements.rotateDegreeDisplay.textContent = `${state.rotation}°`;
      renderPreview();
    });
  }

  // 5 & 7. Center / Top Alignment Button
  if (elements.btnAlign) {
    elements.btnAlign.addEventListener('click', () => {
      state.alignMode = state.alignMode === 'center' ? 'top' : 'center';
      elements.alignModeDisplay.textContent = state.alignMode === 'center' ? '置中' : '靠上';

      if (state.aspectMode === 'fill') {
        state.aspectMode = 'keep';
        elements.aspectModeSelect.value = 'keep';
      }

      renderPreview();
    });
  }

  // 9. Export Buttons
  if (elements.btnExportBin) elements.btnExportBin.addEventListener('click', exportBinary);
  if (elements.btnExportC) elements.btnExportC.addEventListener('click', exportCCode);
  if (elements.btnExportPng) elements.btnExportPng.addEventListener('click', exportPNG);
}

/**
 * Universal Binary Download Helper with Data URL Base64 Fallback
 */
function triggerBinaryDownload(uint8Array, filename) {
  try {
    const rawBuffer = uint8Array.buffer ? uint8Array.buffer.slice(uint8Array.byteOffset, uint8Array.byteOffset + uint8Array.byteLength) : uint8Array;
    const blob = new Blob([rawBuffer], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  } catch (err) {
    console.warn('Blob URL download failed, switching to Base64 Data URL fallback:', err);
    let binaryStr = '';
    const len = uint8Array.byteLength;
    for (let i = 0; i < len; i++) {
      binaryStr += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binaryStr);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = 'data:application/octet-stream;base64,' + base64;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 500);
  }
}

/**
 * Universal Text Download Helper with Data URL Fallback
 */
function triggerTextDownload(text, filename) {
  try {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  } catch (err) {
    console.warn('Text Blob URL download failed, switching to Data URL fallback:', err);
    const encoded = encodeURIComponent(text);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = 'data:text/plain;charset=utf-8,' + encoded;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 500);
  }
}

// Handle Image File Selection
function handleFileSelect(e) {
  const file = e.target.files && e.target.files[0];
  if (file) {
    loadImageFile(file);
  }
}

function loadImageFile(file) {
  if (!file) return;

  if (file.type && !file.type.startsWith('image/')) {
    alert('請選擇有效的圖片檔案 (PNG, JPG, WEBP, BMP, GIF等)');
    return;
  }

  const nameWithoutExt = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
  state.fileName = nameWithoutExt.replace(/[^a-zA-Z0-9_]/g, '_');

  const reader = new FileReader();

  reader.onload = (event) => {
    const dataUrl = event.target.result;
    if (!dataUrl) return;

    const img = new Image();

    img.onload = () => {
      state.image = img;
      state.originalWidth = img.naturalWidth || img.width;
      state.originalHeight = img.naturalHeight || img.height;

      // Update "原始解析度" info badge immediately
      if (elements.infoOriginalRes) {
        elements.infoOriginalRes.textContent = `${state.originalWidth} x ${state.originalHeight}`;
      }

      // Clear fileInput value after successful image load
      if (elements.fileInput) {
        elements.fileInput.value = '';
      }

      // Re-render preview canvas with loaded image
      renderPreview();
    };

    img.onerror = () => {
      alert('圖片解碼失敗，請確認檔案格式是否正確。');
    };

    img.src = dataUrl;
  };

  reader.onerror = () => {
    alert('讀取檔案失敗。');
  };

  reader.readAsDataURL(file);
}

// Update Target Resolution State
function updateResolutionFromSelect() {
  const val = elements.resolutionSelect.value;
  if (val === 'custom') {
    elements.customResBox.style.display = 'grid';
    state.targetWidth = Math.max(1, parseInt(elements.customWidth.value) || 240);
    state.targetHeight = Math.max(1, parseInt(elements.customHeight.value) || 240);
  } else {
    elements.customResBox.style.display = 'none';
    const [w, h] = val.split('x').map(Number);
    state.targetWidth = w;
    state.targetHeight = h;
  }

  elements.currentResDisplay.textContent = `${state.targetWidth} x ${state.targetHeight}`;
}

// Render Default Placeholder Graphics (Solid Black Background)
function drawPlaceholderCanvas() {
  const canvas = elements.previewCanvas;
  if (!canvas) return;

  const targetW = state.targetWidth;
  const targetH = state.targetHeight;
  const ctx = canvas.getContext('2d');

  // Solid Black Background #000000
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, targetW, targetH);

  // Subtle grid pattern
  ctx.strokeStyle = '#0d1d2d';
  ctx.lineWidth = 1;
  for (let x = 0; x < targetW; x += 20) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, targetH);
    ctx.stroke();
  }
  for (let y = 0; y < targetH; y += 20) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(targetW, y);
    ctx.stroke();
  }

  let centerY = targetH / 2;
  if (state.alignMode === 'top') {
    centerY = Math.max(35, targetH / 4);
  }

  // Placeholder Text & Emblem
  ctx.fillStyle = '#00f2fe';
  ctx.font = 'bold 15px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('LVGL V8 預覽畫面', targetW / 2, centerY - 12);

  ctx.fillStyle = '#8a99ad';
  ctx.font = '12px Inter, sans-serif';
  const posHint = state.alignMode === 'center' ? '(目前位置: 置中)' : '(目前位置: 靠上)';
  ctx.fillText(`點擊「讀入檔案」 ${posHint}`, targetW / 2, centerY + 12);
}

// Main Render Loop for Image Preview
function renderPreview() {
  const canvas = elements.previewCanvas;
  if (!canvas) return;

  const targetW = state.targetWidth;
  const targetH = state.targetHeight;

  canvas.width = targetW;
  canvas.height = targetH;
  
  // Adjust hardware screen frame preview aspect ratio
  const maxFrameDimension = 420;
  let frameW = targetW;
  let frameH = targetH;
  if (targetW > targetH) {
    frameW = maxFrameDimension;
    frameH = Math.round((targetH / targetW) * maxFrameDimension);
  } else {
    frameH = maxFrameDimension;
    frameW = Math.round((targetW / targetH) * maxFrameDimension);
  }
  elements.screenFrame.style.width = `${frameW}px`;
  elements.screenFrame.style.height = `${frameH}px`;

  const ctx = canvas.getContext('2d');

  // Fill entire canvas background with solid black #000000
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, targetW, targetH);

  if (!state.image || !state.originalWidth || !state.originalHeight) {
    drawPlaceholderCanvas();
    updateInfoDisplay();
    return;
  }

  const imgW = state.originalWidth;
  const imgH = state.originalHeight;

  const isRotated90or270 = state.rotation === 90 || state.rotation === 270;
  const rotatedW = isRotated90or270 ? imgH : imgW;
  const rotatedH = isRotated90or270 ? imgW : imgH;

  if (rotatedW <= 0 || rotatedH <= 0) {
    drawPlaceholderCanvas();
    updateInfoDisplay();
    return;
  }

  let drawW, drawH, drawX, drawY;

  if (state.aspectMode === 'fill') {
    drawW = targetW;
    drawH = targetH;
    drawX = 0;
    drawY = 0;
  } else {
    const scale = Math.min(targetW / rotatedW, targetH / rotatedH);
    drawW = Math.round(rotatedW * scale);
    drawH = Math.round(rotatedH * scale);
    
    drawX = Math.round((targetW - drawW) / 2);

    if (state.alignMode === 'center') {
      drawY = Math.round((targetH - drawH) / 2);
    } else {
      drawY = 0;
    }
  }

  ctx.save();

  const centerX = drawX + drawW / 2;
  const centerY = drawY + drawH / 2;

  ctx.translate(centerX, centerY);
  ctx.rotate((state.rotation * Math.PI) / 180);

  if (isRotated90or270) {
    ctx.drawImage(state.image, -drawH / 2, -drawW / 2, drawH, drawW);
  } else {
    ctx.drawImage(state.image, -drawW / 2, -drawH / 2, drawW, drawH);
  }

  ctx.restore();

  updateInfoDisplay();
}

// Update Information Badges
function updateInfoDisplay() {
  const targetW = state.targetWidth;
  const targetH = state.targetHeight;
  
  if (elements.infoTargetRes) elements.infoTargetRes.textContent = `${targetW} x ${targetH}`;

  const headerSize = state.includeHeader ? 4 : 0;
  const totalBytes = headerSize + targetW * targetH * 2;
  const kbSize = (totalBytes / 1024).toFixed(1);
  if (elements.infoOutputSize) elements.infoOutputSize.textContent = `${kbSize} KB (${totalBytes.toLocaleString()} B)`;

  const alignText = state.alignMode === 'center' ? '置中' : '靠上';
  if (elements.infoTransform) elements.infoTransform.textContent = `${state.rotation}° / ${alignText}`;

  if (state.image && state.originalWidth && state.originalHeight) {
    if (elements.infoOriginalRes) elements.infoOriginalRes.textContent = `${state.originalWidth} x ${state.originalHeight}`;
  } else {
    if (elements.infoOriginalRes) elements.infoOriginalRes.textContent = '未讀入檔案';
  }
}

// 9. Export Binary (.bin)
function exportBinary() {
  try {
    const canvas = elements.previewCanvas;
    if (!canvas) return;

    const converter = getConverter();
    if (!converter || typeof converter.convertToLVGLBuffer !== 'function') {
      throw new Error('轉換引擎未在 window 全域變數中找到');
    }

    const result = converter.convertToLVGLBuffer(canvas, {
      dither: state.dither,
      includeHeader: state.includeHeader,
      swapBytes: true
    });

    const filename = `${state.fileName || 'lvgl_img'}_${state.targetWidth}x${state.targetHeight}.bin`;
    triggerBinaryDownload(result.buffer, filename);
  } catch (err) {
    console.error('Binary export error:', err);
    alert('輸出 Binary 檔案失敗：' + err.message);
  }
}

// 9. Export C Code (.c)
function exportCCode() {
  try {
    const canvas = elements.previewCanvas;
    if (!canvas) return;

    const converter = getConverter();
    if (!converter || typeof converter.convertToLVGLBuffer !== 'function') {
      throw new Error('轉換引擎未在 window 全域變數中找到');
    }

    const result = converter.convertToLVGLBuffer(canvas, {
      dither: state.dither,
      includeHeader: state.includeHeader,
      swapBytes: true
    });

    const cCode = converter.generateLVGLCCode(result, state.fileName || 'lvgl_img');
    const filename = `${state.fileName || 'lvgl_img'}.c`;
    triggerTextDownload(cCode, filename);
  } catch (err) {
    console.error('C Code export error:', err);
    alert('輸出 C 程式碼失敗：' + err.message);
  }
}

// 9. Export PNG Preview Image (.png)
function exportPNG() {
  try {
    const canvas = elements.previewCanvas;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `${state.fileName || 'lvgl_img'}_preview_${state.targetWidth}x${state.targetHeight}.png`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 500);
  } catch (err) {
    console.error('PNG export error:', err);
    alert('下載 PNG 預覽圖失敗：' + err.message);
  }
}

// Initialize on DOM load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
