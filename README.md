# FidelityMD

FidelityMD is a privacy-first, browser-only document-to-Markdown converter. It reads files locally and creates a Markdown file plus linked assets without sending document bytes to a server or requiring an API key.

Live site: **https://santanusoe.github.io/document-to-markdown/**

## Why this converter is deliberately honest

No converter can guarantee 99% accuracy for every arbitrary PDF, scan, table, graph, and equation. Those objects do not share one recoverable semantic representation. FidelityMD therefore reports how each part was recovered:

- **Native/high** — read from source structure such as DOCX Office Math, workbook cells, or EPUB XHTML.
- **Inferred** — reconstructed from PDF coordinates or local OCR and should be checked.
- **Review** — cannot be represented losslessly in Markdown; the authoritative visual is retained.

This is stricter—and more useful—than displaying a fabricated global accuracy percentage.

## Supported formats

| Family | Formats | Method |
| --- | --- | --- |
| Documents | PDF, DOCX, ODT, RTF, EPUB, HTML, TXT, Markdown | PDF geometry/OCR or semantic source markup |
| Spreadsheets | XLSX, XLS, XLSB, ODS, CSV, TSV | Native cells, formats, formulas, merges, and cached chart data |
| Slides | PPTX | PresentationML shapes, tables, media, notes, and Office Math |
| Mathematics/technical | LaTeX, XML, JSON, Jupyter notebooks, source files | Deterministic source conversion |
| Images | PNG, JPEG, GIF, WebP, BMP, TIFF | Original asset plus optional local OCR |
| Apple documents | Pages, Keynote, Numbers | Embedded Quick Look PDF when the package provides one |

Legacy `.doc` and `.ppt` binaries are rejected rather than guessed. Save them as DOCX or PPTX first.

## Fidelity architecture

- DOCX equations are parsed from OMML and converted structurally to LaTeX.
- Complex merged tables remain semantic HTML inside Markdown when GFM pipe tables would lose spans.
- PDF text is reconstructed from glyph coordinates, repeated headers/footers are removed, and two-column layouts are detected geometrically.
- Graph- or diagram-heavy PDF pages are retained as linked PNG visual layers.
- Spreadsheet formulas remain in HTML comments beside their displayed values.
- Cached Office chart series are exported as Markdown tables.
- OCR uses Tesseract.js inside the browser. The recognition model may be downloaded, but the document itself is not uploaded.
- Markdown previews are sanitised before rendering.

## Local development

Requires Node.js 22 or newer.

```bash
npm ci
npm test
npm run dev
```

Create a production build with:

```bash
npm run build
```

GitHub Actions tests every push to `main`, creates the Vite production build, and deploys `dist/` to GitHub Pages.

## Security and privacy

Conversion happens in the current browser tab. The app has no backend, database, analytics, cookies, API credentials, or upload endpoint. Generated object URLs are revoked when previews change.

Large or untrusted compressed Office files can still consume significant browser memory. Use the current browser version, and inspect critical output before publication.

## Licence

MIT © 2026 Santanu Soe
