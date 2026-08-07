/**
 * LVGL V8 Image Converter Engine
 * Color Format: CF_TRUE_COLOR (RGB565)
 * Output Format: Binary RGB565 Byte Swap (Big-Endian for SPI displays)
 * Dithering: Floyd-Steinberg Error Diffusion
 */

const LV_IMG_CF_TRUE_COLOR = 4; 

/**
 * Apply Floyd-Steinberg Dithering on ImageData (24-bit to 16-bit color reduction)
 */
function applyFloydSteinbergDither(ctx, width, height) {
  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  
  const rBuf = new Float32Array(width * height);
  const gBuf = new Float32Array(width * height);
  const bBuf = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    rBuf[i] = data[i * 4];
    gBuf[i] = data[i * 4 + 1];
    bBuf[i] = data[i * 4 + 2];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;

      const oldR = rBuf[idx];
      const oldG = gBuf[idx];
      const oldB = bBuf[idx];

      // Quantize to RGB565 range (5 bits, 6 bits, 5 bits)
      const r5 = Math.min(31, Math.max(0, Math.round((oldR * 31) / 255)));
      const g6 = Math.min(63, Math.max(0, Math.round((oldG * 63) / 255)));
      const b5 = Math.min(31, Math.max(0, Math.round((oldB * 31) / 255)));

      // Reconstruct quantized 8-bit values
      const newR = (r5 * 255) / 31;
      const newG = (g6 * 255) / 63;
      const newB = (b5 * 255) / 31;

      // Update output pixels
      data[idx * 4]     = Math.min(255, Math.max(0, Math.round(newR)));
      data[idx * 4 + 1] = Math.min(255, Math.max(0, Math.round(newG)));
      data[idx * 4 + 2] = Math.min(255, Math.max(0, Math.round(newB)));

      // Calculate quantization error
      const errR = oldR - newR;
      const errG = oldG - newG;
      const errB = oldB - newB;

      // Inline error distribution
      if (x + 1 < width) {
        const nIdx = idx + 1;
        rBuf[nIdx] += errR * (7 / 16);
        gBuf[nIdx] += errG * (7 / 16);
        bBuf[nIdx] += errB * (7 / 16);
      }
      if (y + 1 < height) {
        if (x - 1 >= 0) {
          const nIdx = (y + 1) * width + (x - 1);
          rBuf[nIdx] += errR * (3 / 16);
          gBuf[nIdx] += errG * (3 / 16);
          bBuf[nIdx] += errB * (3 / 16);
        }
        {
          const nIdx = (y + 1) * width + x;
          rBuf[nIdx] += errR * (5 / 16);
          gBuf[nIdx] += errG * (5 / 16);
          bBuf[nIdx] += errB * (5 / 16);
        }
        if (x + 1 < width) {
          const nIdx = (y + 1) * width + (x + 1);
          rBuf[nIdx] += errR * (1 / 16);
          gBuf[nIdx] += errG * (1 / 16);
          bBuf[nIdx] += errB * (1 / 16);
        }
      }
    }
  }

  return imgData;
}

/**
 * Convert Canvas ImageData to LVGL V8 RGB565 Swapped Binary Buffer
 */
function convertToLVGLBuffer(canvas, options = {}) {
  const {
    dither = true,
    includeHeader = true,
    swapBytes = true
  } = options;

  const width = canvas.width;
  const height = canvas.height;
  const ctx = canvas.getContext('2d');

  let imgData;
  if (dither) {
    imgData = applyFloydSteinbergDither(ctx, width, height);
  } else {
    imgData = ctx.getImageData(0, 0, width, height);
  }

  const pixels = imgData.data;
  const totalPixels = width * height;
  
  // Header size: 4 bytes for LVGL v8 header
  const headerSize = includeHeader ? 4 : 0;
  const bufferSize = headerSize + totalPixels * 2;
  const buffer = new Uint8Array(bufferSize);

  // Write LVGL v8 image header if enabled
  if (includeHeader) {
    const headerVal = 
      (LV_IMG_CF_TRUE_COLOR & 0x1F) |
      ((width & 0x7FF) << 10) |
      ((height & 0x7FF) << 21);

    buffer[0] = headerVal & 0xFF;
    buffer[1] = (headerVal >>> 8) & 0xFF;
    buffer[2] = (headerVal >>> 16) & 0xFF;
    buffer[3] = (headerVal >>> 24) & 0xFF;
  }

  // Convert RGB888 to RGB565 with Byte Swap option
  let byteOffset = headerSize;
  for (let i = 0; i < totalPixels; i++) {
    const r = pixels[i * 4];
    const g = pixels[i * 4 + 1];
    const b = pixels[i * 4 + 2];

    const r5 = (r >> 3) & 0x1F;
    const g6 = (g >> 2) & 0x3F;
    const b5 = (b >> 3) & 0x1F;

    // RGB565 16-bit word: RRRRRGGG GGGBBBBB
    const rgb565 = (r5 << 11) | (g6 << 5) | b5;

    const msb = (rgb565 >> 8) & 0xFF;
    const lsb = rgb565 & 0xFF;

    if (swapBytes) {
      // Big Endian / SPI swapped format
      buffer[byteOffset++] = msb;
      buffer[byteOffset++] = lsb;
    } else {
      // Standard Little Endian format
      buffer[byteOffset++] = lsb;
      buffer[byteOffset++] = msb;
    }
  }

  return {
    buffer,
    width,
    height,
    dither,
    includeHeader,
    swapBytes,
    pixelDataLength: totalPixels * 2
  };
}

/**
 * Generate LVGL V8 C Source Code String
 */
function generateLVGLCCode(conversionResult, imageName = 'image_map') {
  const { buffer, width, height, includeHeader, swapBytes, dither } = conversionResult;
  const cleanName = (imageName || 'image_map').replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase();

  let cCode = `/* LVGL v8 Image Source Code
 * Generated by LVGL V8 PicConverter
 * Resolution: ${width}x${height}
 * Color Format: CF_TRUE_COLOR (RGB565)
 * Byte Swap: ${swapBytes ? 'YES (Big-Endian)' : 'NO (Little-Endian)'}
 * Dithering: ${dither ? 'Enabled (Floyd-Steinberg)' : 'Disabled'}
 */

#include "lvgl/lvgl.h"

#ifndef LV_ATTRIBUTE_MEM_ALIGN
#define LV_ATTRIBUTE_MEM_ALIGN
#endif

#ifndef LV_ATTRIBUTE_IMG_${cleanName.toUpperCase()}
#define LV_ATTRIBUTE_IMG_${cleanName.toUpperCase()}
#endif

const LV_ATTRIBUTE_MEM_ALIGN LV_ATTRIBUTE_LARGE_CONST LV_ATTRIBUTE_IMG_${cleanName.toUpperCase()} uint8_t ${cleanName}_map[] = {\n  `;

  const bytes = includeHeader ? buffer.subarray(4) : buffer;
  const totalBytes = bytes.length;
  
  for (let i = 0; i < totalBytes; i++) {
    const hex = '0x' + bytes[i].toString(16).padStart(2, '0');
    cCode += hex + ', ';
    
    if ((i + 1) % 16 === 0) {
      cCode += '\n  ';
    }
  }

  cCode += `\n};\n\n`;

  cCode += `const lv_img_dsc_t ${cleanName} = {
  .header.always_zero = 0,
  .header.w = ${width},
  .header.h = ${height},
  .data_size = ${totalBytes},
  .header.cf = LV_IMG_CF_TRUE_COLOR,
  .data = ${cleanName}_map,
};\n`;

  return cCode;
}

// Attach directly to window object for global availability
window.applyFloydSteinbergDither = applyFloydSteinbergDither;
window.convertToLVGLBuffer = convertToLVGLBuffer;
window.generateLVGLCCode = generateLVGLCCode;

window.LVGLConverter = {
  applyFloydSteinbergDither: applyFloydSteinbergDither,
  convertToLVGLBuffer: convertToLVGLBuffer,
  generateLVGLCCode: generateLVGLCCode
};
