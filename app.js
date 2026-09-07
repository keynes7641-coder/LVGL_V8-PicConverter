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

// Web Serial State for ESP32 Direct Communication
const serialState = {
  port: null,
  reader: null,
  writer: null,
  connected: false,
  uploading: false,
  cancelRequested: false,
  baudRate: 115200
};

/* ==========================================================================
   Core LVGL V8 Image Converter Engine (Built-in Zero-Fail Transcoder)
   ========================================================================== */

function applyFloydSteinbergDither(imageData) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      const oldR = data[idx];
      const oldG = data[idx + 1];
      const oldB = data[idx + 2];

      const newR = Math.round(oldR / 255 * 31) * (255 / 31);
      const newG = Math.round(oldG / 255 * 63) * (255 / 63);
      const newB = Math.round(oldB / 255 * 31) * (255 / 31);

      data[idx] = Math.min(255, Math.max(0, newR));
      data[idx + 1] = Math.min(255, Math.max(0, newG));
      data[idx + 2] = Math.min(255, Math.max(0, newB));

      const errR = oldR - newR;
      const errG = oldG - newG;
      const errB = oldB - newB;

      const distribute = (nx, ny, weight) => {
        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
          const nIdx = (ny * width + nx) * 4;
          data[nIdx] = Math.min(255, Math.max(0, data[nIdx] + errR * weight));
          data[nIdx + 1] = Math.min(255, Math.max(0, data[nIdx + 1] + errG * weight));
          data[nIdx + 2] = Math.min(255, Math.max(0, data[nIdx + 2] + errB * weight));
        }
      };

      distribute(x + 1, y, 7 / 16);
      distribute(x - 1, y + 1, 3 / 16);
      distribute(x, y + 1, 5 / 16);
      distribute(x + 1, y + 1, 1 / 16);
    }
  }
  return imageData;
}

function convertToLVGLBuffer(canvas, options) {
  options = options || {};
  const dither = options.dither !== false;
  const includeHeader = options.includeHeader !== false;
  const swapBytes = options.swapBytes !== false;

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');
  let imageData = ctx.getImageData(0, 0, width, height);

  if (dither) {
    imageData = applyFloydSteinbergDither(imageData);
  }

  const pixelData = imageData.data;
  const headerSize = includeHeader ? 4 : 0;
  const payloadSize = width * height * 2;
  const totalSize = headerSize + payloadSize;

  const buffer = new Uint8Array(totalSize);

  if (includeHeader) {
    const LV_IMG_CF_TRUE_COLOR = 4;
    buffer[0] = (LV_IMG_CF_TRUE_COLOR & 0x1F) | ((width & 0x07) << 5);
    buffer[1] = (width >> 3) & 0xFF;
    buffer[2] = height & 0xFF;
    buffer[3] = (height >> 8) & 0x07;
  }

  let offset = headerSize;

  for (let i = 0; i < pixelData.length; i += 4) {
    const r = pixelData[i];
    const g = pixelData[i + 1];
    const b = pixelData[i + 2];

    const r5 = (r >> 3) & 0x1F;
    const g6 = (g >> 2) & 0x3F;
    const b5 = (b >> 3) & 0x1F;

    const rgb565 = (r5 << 11) | (g6 << 5) | b5;

    if (swapBytes) {
      buffer[offset++] = (rgb565 >> 8) & 0xFF;
      buffer[offset++] = rgb565 & 0xFF;
    } else {
      buffer[offset++] = rgb565 & 0xFF;
      buffer[offset++] = (rgb565 >> 8) & 0xFF;
    }
  }

  return {
    buffer: buffer,
    width: width,
    height: height,
    headerSize: headerSize,
    payloadSize: payloadSize,
    totalSize: totalSize
  };
}

function generateLVGLCCode(convertedObj, variableName) {
  const varName = (variableName || 'image_map').replace(/[^a-zA-Z0-9_]/g, '_');
  const width = convertedObj.width;
  const height = convertedObj.height;
  const buffer = convertedObj.buffer;

  let code = `/* LVGL V8 Image Map C Source File */\n`;
  code += `#include "lvgl.h"\n\n`;
  code += `#ifndef LV_ATTRIBUTE_MEM_ALIGN\n`;
  code += `#define LV_ATTRIBUTE_MEM_ALIGN\n`;
  code += `#endif\n\n`;

  code += `#ifndef LV_ATTRIBUTE_IMG_${varName.toUpperCase()}\n`;
  code += `#define LV_ATTRIBUTE_IMG_${varName.toUpperCase()}\n`;
  code += `#endif\n\n`;

  code += `const LV_ATTRIBUTE_MEM_ALIGN LV_ATTRIBUTE_LARGE_CONST LV_ATTRIBUTE_IMG_${varName.toUpperCase()} uint8_t ${varName}_map[] = {\n`;

  let line = '  ';
  for (let i = 0; i < buffer.length; i++) {
    const hex = '0x' + buffer[i].toString(16).padStart(2, '0').toUpperCase();
    line += hex + ', ';

    if ((i + 1) % 12 === 0 || i === buffer.length - 1) {
      code += line.trimEnd() + '\n';
      line = '  ';
    }
  }

  code += `};\n\n`;

  code += `const lv_img_dsc_t ${varName} = {\n`;
  code += `  .header.always_zero = 0,\n`;
  code += `  .header.w = ${width},\n`;
  code += `  .header.h = ${height},\n`;
  code += `  .data_size = ${buffer.length},\n`;
  code += `  .header.cf = LV_IMG_CF_TRUE_COLOR,\n`;
  code += `  .data = ${varName}_map,\n`;
  code += `};\n`;

  return code;
}

// Initialize App Event Listeners & Canvas
function init() {
  try {
    bindEvents();
    initWebSerial();
    updateResolutionFromSelect();
    drawPlaceholderCanvas();
    updateInfoDisplay();
  } catch (err) {
    console.error('App init error:', err);
  }
}

// Bind User Interactivity Events
function bindEvents() {
  // 1. Image File Input
  const fileInput = document.getElementById('fileInput');
  if (fileInput) {
    fileInput.addEventListener('change', handleFileSelect);
  }

  // 2. Resolution Setting Dropdown
  const resolutionSelect = document.getElementById('resolutionSelect');
  if (resolutionSelect) {
    resolutionSelect.addEventListener('change', () => {
      updateResolutionFromSelect();
      renderPreview();
    });
  }

  const customWidth = document.getElementById('customWidth');
  if (customWidth) {
    customWidth.addEventListener('input', () => {
      const resSel = document.getElementById('resolutionSelect');
      if (resSel && resSel.value === 'custom') {
        state.targetWidth = Math.max(1, parseInt(customWidth.value) || 240);
        renderPreview();
      }
    });
  }

  const customHeight = document.getElementById('customHeight');
  if (customHeight) {
    customHeight.addEventListener('input', () => {
      const resSel = document.getElementById('resolutionSelect');
      if (resSel && resSel.value === 'custom') {
        state.targetHeight = Math.max(1, parseInt(customHeight.value) || 240);
        renderPreview();
      }
    });
  }

  // 3. Aspect Ratio Dropdown
  const aspectModeSelect = document.getElementById('aspectModeSelect');
  if (aspectModeSelect) {
    aspectModeSelect.addEventListener('change', (e) => {
      state.aspectMode = e.target.value;
      renderPreview();
    });
  }

  // 4. LVGL Options
  const ditherCheckbox = document.getElementById('ditherCheckbox');
  if (ditherCheckbox) {
    ditherCheckbox.addEventListener('change', (e) => {
      state.dither = e.target.checked;
      renderPreview();
    });
  }

  const headerCheckbox = document.getElementById('headerCheckbox');
  if (headerCheckbox) {
    headerCheckbox.addEventListener('change', (e) => {
      state.includeHeader = e.target.checked;
      updateInfoDisplay();
    });
  }

  // 5 & 6. Rotate 90 Degrees Button
  const btnRotate = document.getElementById('btnRotate');
  if (btnRotate) {
    btnRotate.addEventListener('click', (e) => {
      e.preventDefault();
      state.rotation = (state.rotation + 90) % 360;
      const rotateDegreeDisplay = document.getElementById('rotateDegreeDisplay');
      if (rotateDegreeDisplay) {
        rotateDegreeDisplay.textContent = `${state.rotation}°`;
      }
      renderPreview();
    });
  }

  // 5 & 7. Center / Top Alignment Button
  const btnAlign = document.getElementById('btnAlign');
  if (btnAlign) {
    btnAlign.addEventListener('click', (e) => {
      e.preventDefault();
      state.alignMode = state.alignMode === 'center' ? 'top' : 'center';
      const alignModeDisplay = document.getElementById('alignModeDisplay');
      if (alignModeDisplay) {
        alignModeDisplay.textContent = state.alignMode === 'center' ? '置中' : '靠上';
      }

      if (state.aspectMode === 'fill') {
        state.aspectMode = 'keep';
        const aspectSel = document.getElementById('aspectModeSelect');
        if (aspectSel) aspectSel.value = 'keep';
      }

      renderPreview();
    });
  }

  // Local Export Buttons
  const btnExportBin = document.getElementById('btnExportBin');
  if (btnExportBin) btnExportBin.addEventListener('click', exportBinary);

  const btnExportC = document.getElementById('btnExportC');
  if (btnExportC) btnExportC.addEventListener('click', exportCCode);

  const btnExportPng = document.getElementById('btnExportPng');
  if (btnExportPng) btnExportPng.addEventListener('click', exportPNG);

  // ESP32 Web Serial Action Buttons
  const btnConnectSerial = document.getElementById('btnConnectSerial');
  if (btnConnectSerial) btnConnectSerial.addEventListener('click', requestSerialPortConnection);

  const btnDisconnectSerial = document.getElementById('btnDisconnectSerial');
  if (btnDisconnectSerial) btnDisconnectSerial.addEventListener('click', disconnectSerialPort);
  
  // 1-Click Convert & Upload Action Buttons
  const btnConvertAndUploadBin = document.getElementById('btnConvertAndUploadBin');
  if (btnConvertAndUploadBin) btnConvertAndUploadBin.addEventListener('click', convertAndUploadBin);

  const btnConvertAndUploadC = document.getElementById('btnConvertAndUploadC');
  if (btnConvertAndUploadC) btnConvertAndUploadC.addEventListener('click', convertAndUploadC);

  const btnUploadSelectedFile = document.getElementById('btnUploadSelectedFile');
  if (btnUploadSelectedFile) {
    btnUploadSelectedFile.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const serialFileInput = document.getElementById('serialFileInput');
      if (serialFileInput) {
        serialFileInput.click();
      }
    });
  }

  const serialFileInput = document.getElementById('serialFileInput');
  if (serialFileInput) {
    serialFileInput.addEventListener('change', handleSerialFileSelect);
  }

  const btnCancelUpload = document.getElementById('btnCancelUpload');
  if (btnCancelUpload) {
    btnCancelUpload.addEventListener('click', cancelUpload);
  }
}

/* ==========================================================================
   ESP32 Web Serial API Upload Controller (MicroPython Raw REPL 協議)
   ========================================================================== */

function initWebSerial() {
  try {
    if (!('serial' in navigator)) {
      const badge = document.getElementById('portStatusBadge');
      if (badge) {
        badge.textContent = '❌ 瀏覽器不支援 Web Serial';
        badge.className = 'port-status-badge status-disconnected';
      }
      return;
    }

    navigator.serial.getPorts().then((ports) => {
      updatePortDropdown(ports);
    }).catch((err) => {
      console.warn('Web Serial getPorts warning:', err);
    });
  } catch (err) {
    console.warn('Web Serial init error:', err);
  }
}

// Update Serial Port Dropdown Menu
function updatePortDropdown(ports) {
  const select = document.getElementById('serialPortSelect');
  if (!select) return;

  select.innerHTML = '';
  
  if (!ports || ports.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- 請點擊右側按鈕搜尋 / 連接 Port --';
    select.appendChild(opt);
    return;
  }

  ports.forEach((port, index) => {
    const info = port.getInfo ? port.getInfo() : {};
    const vid = info.usbVendorId ? `VID:${info.usbVendorId.toString(16)}` : '';
    const pid = info.usbProductId ? `PID:${info.usbProductId.toString(16)}` : '';
    const name = `Port ${index + 1} (${vid} ${pid})`.trim();

    const opt = document.createElement('option');
    opt.value = index;
    opt.textContent = name;
    select.appendChild(opt);
  });
}

// Request Serial Port Connection via Browser Popup
async function requestSerialPortConnection() {
  if (!('serial' in navigator)) {
    alert('您的瀏覽器不支援 Web Serial API！請使用 Chrome、Edge 或 Opera 瀏覽器開啟本頁面。');
    return;
  }

  try {
    const port = await navigator.serial.requestPort();
    await connectToPort(port);
  } catch (err) {
    if (err.name !== 'NotFoundError') {
      console.error('Serial port error:', err);
      alert('連接 Serial Port 失敗：' + err.message);
    }
  }
}

// Connect & Open Selected Serial Port
async function connectToPort(port) {
  try {
    if (serialState.connected && serialState.port) {
      try {
        await serialState.port.close();
      } catch (e) {}
    }

    await port.open({ baudRate: serialState.baudRate });
    serialState.port = port;
    serialState.connected = true;

    const badge = document.getElementById('portStatusBadge');
    if (badge) {
      const info = port.getInfo ? port.getInfo() : {};
      const vid = info.usbVendorId ? `VID:${info.usbVendorId.toString(16).toUpperCase()}` : 'COM';
      badge.textContent = `✅ 已連接 ESP32 (${vid})`;
      badge.className = 'port-status-badge status-connected';
    }

    const ports = await navigator.serial.getPorts();
    updatePortDropdown(ports);

  } catch (err) {
    console.error('Port open error:', err);
    alert('無法開啟 Serial Port：' + err.message);
  }
}

// Disconnect Active Serial Port Connection
async function disconnectSerialPort() {
  if (serialState.uploading) {
    alert('檔案上傳中，請先點擊「🚫 取消上傳」或等待上傳完成後再中斷連線！');
    return;
  }

  if (!serialState.connected && !serialState.port) {
    alert('目前並未連接任何 ESP32 串口！');
    return;
  }

  try {
    if (serialState.writer) {
      try { await serialState.writer.close(); } catch (e) {}
      try { serialState.writer.releaseLock(); } catch (e) {}
      serialState.writer = null;
    }
    if (serialState.reader) {
      try { await serialState.reader.cancel(); } catch (e) {}
      try { serialState.reader.releaseLock(); } catch (e) {}
      serialState.reader = null;
    }

    if (serialState.port) {
      await serialState.port.close();
    }
  } catch (err) {
    console.warn('Port close warning:', err);
  } finally {
    serialState.port = null;
    serialState.connected = false;

    const badge = document.getElementById('portStatusBadge');
    if (badge) {
      badge.textContent = '🔌 未連接';
      badge.className = 'port-status-badge status-disconnected';
    }

    const select = document.getElementById('serialPortSelect');
    if (select && navigator.serial) {
      navigator.serial.getPorts().then((ports) => {
        updatePortDropdown(ports);
      }).catch(() => {});
    }

    alert('🔌 已中斷與 ESP32 開發板的連接！');
  }
}

// 1-Click Convert & Direct Upload to ESP32 (.bin format)
async function convertAndUploadBin() {
  if (!state.image) {
    alert('請先點擊左側「📂 讀入檔案」選擇圖片檔案！');
    return;
  }

  const canvas = document.getElementById('previewCanvas');
  if (!canvas) return;

  const result = convertToLVGLBuffer(canvas, {
    dither: state.dither,
    includeHeader: state.includeHeader,
    swapBytes: true
  });

  const filename = `${state.fileName || 'lvgl_img'}_${state.targetWidth}x${state.targetHeight}.bin`;
  await streamFileToSerial(result.buffer, filename);
}

// 1-Click Convert & Direct Upload to ESP32 (.c format)
async function convertAndUploadC() {
  if (!state.image) {
    alert('請先點擊左側「📂 讀入檔案」選擇圖片檔案！');
    return;
  }

  const canvas = document.getElementById('previewCanvas');
  if (!canvas) return;

  const result = convertToLVGLBuffer(canvas, {
    dither: state.dither,
    includeHeader: state.includeHeader,
    swapBytes: true
  });

  const cCode = generateLVGLCCode(result, state.fileName || 'lvgl_img');
  const filename = `${state.fileName || 'lvgl_img'}.c`;
  const textEncoder = new TextEncoder();
  const uint8Array = textEncoder.encode(cCode);

  await streamFileToSerial(uint8Array, filename);
}

// Global Handle File Selection for Direct ESP32 Upload (.bin, .c, .png)
window.handleSerialFileSelect = async function(e) {
  const input = (e && e.target) || document.getElementById('serialFileInput');
  const file = input && input.files && input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (evt) => {
    const arrayBuffer = evt.target.result;
    if (!arrayBuffer) return;

    const uint8Array = new Uint8Array(arrayBuffer);

    if (!serialState.connected || !serialState.port) {
      alert('請在彈出視窗中選擇您的 ESP32 連接埠以進行檔案上傳！');
      await requestSerialPortConnection();
      if (!serialState.connected) {
        if (input) input.value = '';
        return;
      }
    }

    await streamFileToSerial(uint8Array, file.name);

    if (input) {
      input.value = '';
    }
  };

  reader.onerror = () => {
    alert('讀取選取的檔案失敗，請再試一次。');
  };

  reader.readAsArrayBuffer(file);
};

// Interruption / Abort Handler for Upload Action
function cancelUpload() {
  if (serialState.uploading) {
    serialState.cancelRequested = true;
    const progressText = document.getElementById('uploadProgressText');
    if (progressText) {
      progressText.textContent = '🛑 正在取消上傳...';
    }
    const btnCancel = document.getElementById('btnCancelUpload');
    if (btnCancel) {
      btnCancel.disabled = true;
    }
  }
}

// Stream File Payload to ESP32 Device using MicroPython Raw REPL Protocol
async function streamFileToSerial(uint8Array, filename) {
  if (!serialState.connected || !serialState.port) {
    alert('請先點擊「🔌 搜尋 / 連接 Port」連接您的 ESP32 開發板！');
    await requestSerialPortConnection();
    if (!serialState.connected) return false;
  }

  if (serialState.uploading) {
    alert('檔案正在上傳中，請稍候...');
    return false;
  }

  const pathInput = document.getElementById('uploadPathInput');
  let destInput = (pathInput ? pathInput.value.trim() : '/') || '/';
  if (!destInput.startsWith('/')) {
    destInput = '/' + destInput;
  }

  let targetDir = '/';
  let finalPath = '';

  if (destInput.endsWith('/')) {
    targetDir = destInput;
    finalPath = destInput + filename;
  } else if (destInput.endsWith('.' + filename.split('.').pop())) {
    targetDir = destInput.substring(0, destInput.lastIndexOf('/') + 1) || '/';
    finalPath = destInput;
  } else {
    targetDir = destInput + '/';
    finalPath = destInput + '/' + filename;
  }

  serialState.uploading = true;
  serialState.cancelRequested = false;

  const btnCancel = document.getElementById('btnCancelUpload');
  if (btnCancel) btnCancel.disabled = false;

  const progressBox = document.getElementById('uploadProgressBox');
  if (progressBox) progressBox.style.display = 'flex';

  const progressBar = document.getElementById('uploadProgressBar');
  if (progressBar) {
    progressBar.style.width = '0%';
    progressBar.style.backgroundColor = '';
  }

  const progressText = document.getElementById('uploadProgressText');
  if (progressText) progressText.textContent = `進入 MicroPython Raw REPL 模式...`;

  let writer = null;
  let reader = null;

  try {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    writer = serialState.port.writable.getWriter();
    reader = serialState.port.readable.getReader();

    // Helper to safely write string over serial line with buffer drain check
    const writeString = async (str) => {
      if (writer.ready) await writer.ready;
      await writer.write(encoder.encode(str));
    };

    // Helper to read incoming serial stream until matching prompt or timeout
    const readUntil = async (prompts, timeoutMs = 2500) => {
      let buf = '';
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const readPromise = reader.read();
        const timeoutPromise = new Promise((r) => setTimeout(() => r({ timeout: true }), 80));
        const res = await Promise.race([readPromise, timeoutPromise]);

        if (res.timeout) continue;
        if (res.done) break;
        if (res.value) {
          buf += decoder.decode(res.value, { stream: true });
          for (const p of prompts) {
            if (buf.includes(p)) return true;
          }
        }
      }
      return false;
    };

    // 1. Enter MicroPython Raw REPL Mode (\x03\x03 Ctrl+C, \x01 Ctrl+A)
    await writeString('\x03\x03');
    await new Promise((r) => setTimeout(r, 100));
    await writeString('\x01'); // Ctrl+A
    const enterOk = await readUntil(['raw REPL; CTRL-B to exit', '>'], 2000);
    if (!enterOk) {
      await writeString('\x01');
      await readUntil(['raw REPL; CTRL-B to exit', '>'], 2000);
    }

    // 2. Import ubinascii and os modules
    await writeString('import os, ubinascii\n\x04');
    await readUntil(['>', 'OK'], 2000);

    // 3. Create target directory if non-root
    if (targetDir !== '/' && targetDir !== '') {
      let cleanDir = targetDir;
      if (cleanDir.endsWith('/') && cleanDir.length > 1) {
        cleanDir = cleanDir.slice(0, -1);
      }
      const mkdirCode = `try:\n os.mkdir('${cleanDir}')\nexcept:\n pass\n\x04`;
      await writeString(mkdirCode);
      await readUntil(['>', 'OK'], 2000);
    }

    // 4. Open File for Binary Writing in MicroPython
    const openCode = `f = open('${finalPath}', 'wb')\n\x04`;
    await writeString(openCode);
    await readUntil(['>', 'OK'], 2000);

    // 5. Stream Binary Chunks in Base64 (256 Bytes per chunk, 15ms delay, ACK Handshake)
    const chunkSize = 256;
    const totalBytes = uint8Array.byteLength;
    let offset = 0;

    while (offset < totalBytes) {
      if (serialState.cancelRequested) {
        console.warn('Upload cancelled by user request');
        // Abort: close file and exit Raw REPL
        await writeString('f.close()\n\x04');
        await readUntil(['>', 'OK'], 1000);
        await writeString('\x02'); // Ctrl+B exit Raw REPL
        
        if (progressText) progressText.textContent = `❌ 上傳已取消！`;
        if (progressBar) progressBar.style.backgroundColor = '#ff5252';
        alert(`🚫 已成功中斷並取消上傳「${filename}」！`);
        return false;
      }

      const chunk = uint8Array.subarray(offset, Math.min(offset + chunkSize, totalBytes));
      
      // Convert binary chunk bytes to Base64 string
      let binaryStr = '';
      for (let i = 0; i < chunk.byteLength; i++) {
        binaryStr += String.fromCharCode(chunk[i]);
      }
      const b64Str = btoa(binaryStr);

      // MicroPython write chunk code using ubinascii.a2b_base64
      const writeChunkCode = `f.write(ubinascii.a2b_base64('${b64Str}'))\n\x04`;
      
      // Wait for writer.ready buffer drain before sending chunk
      if (writer.ready) await writer.ready;
      await writer.write(encoder.encode(writeChunkCode));

      // Real Handshake ACK: wait for MicroPython to return 'OK' or '>' prompt
      await readUntil(['>', 'OK'], 2000);

      offset += chunk.byteLength;

      const percent = Math.min(100, Math.round((offset / totalBytes) * 100));
      if (progressBar) progressBar.style.width = `${percent}%`;
      if (progressText) progressText.textContent = `MicroPython Raw REPL 傳送中... ${percent}% (${offset}/${totalBytes} B)`;

      // 15ms yield delay
      await new Promise((r) => setTimeout(r, 15));
    }

    // 6. Close File Handle & Exit Raw REPL Mode
    await writeString('f.close()\n\x04');
    await readUntil(['>', 'OK'], 2000);

    // Send Ctrl+B (\x02) to exit Raw REPL back to normal state
    await writeString('\x02');
    await new Promise((r) => setTimeout(r, 100));

    if (progressText) progressText.textContent = `✅ Raw REPL 上傳成功 100%！`;
    alert(`🎉 成功透過 MicroPython Raw REPL 將「${filename}」傳送至 ESP32！\n儲存目錄: ${targetDir}\n檔案完整路徑: ${finalPath}`);
    return true;

  } catch (err) {
    console.error('MicroPython Raw REPL upload error:', err);
    alert('上傳失敗：' + err.message);
    return false;

  } finally {
    if (writer) {
      try {
        writer.releaseLock();
      } catch (e) {}
    }
    if (reader) {
      try {
        reader.releaseLock();
      } catch (e) {}
    }
    serialState.uploading = false;
    serialState.cancelRequested = false;
    if (btnCancel) btnCancel.disabled = true;

    setTimeout(() => {
      if (progressBox) progressBox.style.display = 'none';
      if (progressBar) progressBar.style.backgroundColor = '';
    }, 2500);
  }
}

/* ==========================================================================
   Universal File Download Helper (Local Storage Download)
   ========================================================================== */

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

// Global Handle File Selection for Left Panel
window.handleFileSelect = function(e) {
  const input = (e && e.target) || document.getElementById('fileInput');
  const file = input && input.files && input.files[0];
  if (file) {
    loadImageFile(file);
  }
};

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
      state.originalWidth = img.naturalWidth || img.width || 240;
      state.originalHeight = img.naturalHeight || img.height || 240;

      const infoOriginalRes = document.getElementById('infoOriginalRes');
      if (infoOriginalRes) {
        infoOriginalRes.textContent = `${state.originalWidth} x ${state.originalHeight}`;
      }

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
  const resolutionSelect = document.getElementById('resolutionSelect');
  if (!resolutionSelect) return;

  const val = resolutionSelect.value;
  const customResBox = document.getElementById('customResBox');
  const customWidth = document.getElementById('customWidth');
  const customHeight = document.getElementById('customHeight');

  if (val === 'custom') {
    if (customResBox) customResBox.style.display = 'grid';
    state.targetWidth = Math.max(1, parseInt(customWidth ? customWidth.value : 240) || 240);
    state.targetHeight = Math.max(1, parseInt(customHeight ? customHeight.value : 240) || 240);
  } else {
    if (customResBox) customResBox.style.display = 'none';
    const [w, h] = val.split('x').map(Number);
    state.targetWidth = w;
    state.targetHeight = h;
  }

  const currentResDisplay = document.getElementById('currentResDisplay');
  if (currentResDisplay) {
    currentResDisplay.textContent = `${state.targetWidth} x ${state.targetHeight}`;
  }
}

// Render Default Placeholder Graphics (Solid Black Background)
function drawPlaceholderCanvas() {
  const canvas = document.getElementById('previewCanvas');
  if (!canvas) return;

  const targetW = state.targetWidth || 240;
  const targetH = state.targetHeight || 240;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, targetW, targetH);

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
  const canvas = document.getElementById('previewCanvas');
  if (!canvas) return;

  const targetW = state.targetWidth || 240;
  const targetH = state.targetHeight || 240;

  canvas.width = targetW;
  canvas.height = targetH;
  
  const screenFrame = document.getElementById('screenFrame');
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
  if (screenFrame) {
    screenFrame.style.width = `${frameW}px`;
    screenFrame.style.height = `${frameH}px`;
  }

  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, targetW, targetH);

  if (!state.image) {
    drawPlaceholderCanvas();
    updateInfoDisplay();
    return;
  }

  const imgW = state.originalWidth || state.image.naturalWidth || state.image.width || targetW;
  const imgH = state.originalHeight || state.image.naturalHeight || state.image.height || targetH;

  const isRotated90or270 = state.rotation === 90 || state.rotation === 270;
  const rotatedW = isRotated90or270 ? imgH : imgW;
  const rotatedH = isRotated90or270 ? imgW : imgH;

  let drawW, drawH, drawX, drawY;

  if (state.aspectMode === 'fill') {
    drawW = targetW;
    drawH = targetH;
    drawX = 0;
    drawY = 0;
  } else {
    const scale = Math.min(targetW / rotatedW, targetH / rotatedH) || 1;
    drawW = Math.round(rotatedW * scale) || targetW;
    drawH = Math.round(rotatedH * scale) || targetH;
    
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
  const targetW = state.targetWidth || 240;
  const targetH = state.targetHeight || 240;
  
  const infoTargetRes = document.getElementById('infoTargetRes');
  if (infoTargetRes) infoTargetRes.textContent = `${targetW} x ${targetH}`;

  const headerSize = state.includeHeader ? 4 : 0;
  const totalBytes = headerSize + targetW * targetH * 2;
  const kbSize = (totalBytes / 1024).toFixed(1);

  const infoOutputSize = document.getElementById('infoOutputSize');
  if (infoOutputSize) infoOutputSize.textContent = `${kbSize} KB (${totalBytes.toLocaleString()} B)`;

  const alignText = state.alignMode === 'center' ? '置中' : '靠上';
  const infoTransform = document.getElementById('infoTransform');
  if (infoTransform) infoTransform.textContent = `${state.rotation}° / ${alignText}`;

  const infoOriginalRes = document.getElementById('infoOriginalRes');
  if (state.image) {
    const w = state.originalWidth || state.image.naturalWidth || state.image.width || 0;
    const h = state.originalHeight || state.image.naturalHeight || state.image.height || 0;
    if (infoOriginalRes) infoOriginalRes.textContent = `${w} x ${h}`;
  } else {
    if (infoOriginalRes) infoOriginalRes.textContent = '未讀入檔案';
  }
}

// Local Export Buttons
function exportBinary() {
  try {
    const canvas = document.getElementById('previewCanvas');
    if (!canvas) return;

    const result = convertToLVGLBuffer(canvas, {
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

function exportCCode() {
  try {
    const canvas = document.getElementById('previewCanvas');
    if (!canvas) return;

    const result = convertToLVGLBuffer(canvas, {
      dither: state.dither,
      includeHeader: state.includeHeader,
      swapBytes: true
    });

    const cCode = generateLVGLCCode(result, state.fileName || 'lvgl_img');
    const filename = `${state.fileName || 'lvgl_img'}.c`;
    triggerTextDownload(cCode, filename);
  } catch (err) {
    console.error('C Code export error:', err);
    alert('輸出 C 程式碼失敗：' + err.message);
  }
}

function exportPNG() {
  try {
    const canvas = document.getElementById('previewCanvas');
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
