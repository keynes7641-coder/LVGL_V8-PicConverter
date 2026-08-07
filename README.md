# LVGL V8 圖片轉換程式 (LVGL V8 PicConverter)

🚀 一款專為 **LVGL V8** 嵌入式顯示介面設計的高效能純前端圖片轉換工具。能在瀏覽器中 100% 本地執行，無須安裝 Node.js 或架設伺服器。

![LVGL V8 PicConverter Banner](https://img.shields.io/badge/LVGL-v8.x_Compatible-00f2fe?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-purple?style=for-the-badge)

---

## 🌟 核心功能特色

1. **多解析度預設與自訂支援**：
   - 下拉選單支援 `240x240`、`240x320`、`320x240`、`320x480`、`128x128` 及 **自訂解析度 (Custom Resolution)** 輸入。
   - 預覽畫面邊框隨目標解析度與螢幕比例動態同步調整。

2. **圖片比例與對齊控制**：
   - **維持長寬比例 (Fit Ratio)**：自動計算縮放比率，將圖片等比例縮放完整呈現在預覽畫面中。
   - **填滿畫面 (Fill / Stretch)**：忽略原圖比例，強制拉伸至指定解析度。
   - **對齊模式**：支援「畫面置中 (Center)」與「畫面上方 (Top)」切換。

3. **純黑底色與留白填充 (`#000000`)**：
   - 預覽畫布與背景採用純黑底色 `#000000`，圖片未填滿的留白與黑邊區域 100% 填入純黑色，確保液晶螢幕無雜訊顯示。

4. **旋轉 90 度矩陣變形**：
   - 一鍵順時針旋轉 90 度 (0° → 90° → 180° → 270°)。

5. **LVGL V8 專業格式轉換**：
   - **Color Format**: `CF_TRUE_COLOR` (RGB565 16-bit 顏色)。
   - **Output Format**: **Binary RGB565 Swap** (適合嵌入式 SPI 螢幕，如 ST7789 / ILI9341 Big-Endian 傳輸)。
   - **Floyd-Steinberg 顏色抖動演算法 (Dither Images)**：開關可選，顯著優化 16-bit 色彩漸層。
   - **LVGL V8 4-Byte Header**：包含標準 32-bit uint packed header。

6. **三種一鍵輸出與下載**：
   - 🚀 **輸出 Binary 檔案 (.bin)**：可以直接下載至 SD 卡或寫入 Flash 快閃記憶體。
   - 📜 **輸出 C 程式碼 (.c)**：生成標準 `const lv_img_dsc_t` 結構體與 C 語言陣列。
   - 🖼️ **下載 PNG 預覽圖 (.png)**。

---

## 📁 專案檔案結構

```
v:/antigravity/LVGL_V8 PicConverter/
├── index.html        # 網頁 UI 佈局與結構
├── styles.css        # 暗黑玻璃擬態 (Dark Mode Glassmorphism) 樣式表
├── app.js            # 介面互動控制、對齊/旋轉邏輯、圖檔 Base64 Data URL 解碼與畫布直繪引擎
├── converter.js      # LVGL V8 RGB565 Swap 轉碼器、Floyd-Steinberg 抖動演算法與 C Code 生成器
└── README.md         # 專案說明文件
```

---

## 🚀 如何執行

本專案完全零依賴，無需安裝 Node.js、npm 或伺服器：

1. 下載或複製本專案至您的電腦。
2. 在檔案總管中 **直接雙擊 `index.html`**。
3. 在瀏覽器中點擊「**📂 讀入檔案**」即可開始圖片轉換！

---

## 📜 授權條款 (License)

本專案採用 [MIT License](LICENSE) 授權條款。
