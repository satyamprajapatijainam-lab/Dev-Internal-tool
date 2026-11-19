# Dev Toolkit

Client-side utilities, no build step: open `index.html` (crypto-js and fonts load from CDN).

Tabs: Encrypt, Decrypt, JSON Viewer, Transform TechExcel Data, Base64 to PDF / Excel

```
dev-toolkit/
  index.html        layout, sidebar settings, tabs
  css/styles.css    theme (light + dark)
  js/aes.js         Encrypt / Decrypt (CBC/ECB, 128/192/256, Base64/Hex)
  js/json-tools.js  Format / Minify / Validate
  js/table.js       TechExcelToTable
  js/base64-file.js Base64 -> PDF / Excel (detect, convert, preview, download)
  js/utils.js       shared helpers (copy, JSON error locator)
  js/app.js         tab switching
```
Add a tab: `.tab` button with `data-tab="x"`, a `.view` with `data-view="x"`, and add "x" to `names` in `js/app.js`.

## Base64 to PDF / Excel
Signature-based: the file type is detected from the decoded bytes, never from the chosen format or extension.
- PDF / `.xlsx` / `.xls` input is previewed and downloaded byte-for-byte (no re-encoding).
- Text, CSV/TSV, JSON -> Excel; text, PNG, JPEG -> PDF. Mismatches (e.g. a PDF with "Excel" selected) are reported, not renamed.
- SheetJS and jsPDF are lazy-loaded from cdnjs on first conversion; everything else is local. Nothing is uploaded.
"# Dev-Internal-tool" 
