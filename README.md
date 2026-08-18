# FidelityMD

FidelityMD is a privacy-first, browser-only document-to-Markdown converter. It reads files locally and creates a Markdown file plus linked assets without sending document bytes to a server or requiring an API key. A private conversion history is stored only in the visitor's browser profile.

Production URL: https://santanusoe.github.io/document-to-markdown/

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
- PDF text is reconstructed from font signals and glyph coordinates, with duplicate-layer removal, corrected line-wrap repair, repeated-margin removal, semantic heading/caption recovery, and multi-column reading-order analysis.
- PDF tables use aligned column anchors rather than cell-count guesses, while equation candidates are mapped to LaTeX and explicitly flagged for verification.
- PDF superscripts/subscripts, drawn fraction rules, and large-operator limits are recovered from two-dimensional geometry before Unicode mathematics is normalised into GitHub/KaTeX-compatible LaTeX.
- Every detected PDF equation receives an exact high-resolution source crop beside its reconstructed LaTeX, so semantic code and authoritative pixels can be compared directly.
- OCR retains word bounding boxes and confidence instead of flattening a scanned page into an unstructured text block.
- Meaningful embedded PDF images are cropped into individual figure assets. Caption-led vector graphs receive a conservative region crop, and the complete page remains a high-resolution evidence layer so plotted content is not silently clipped.
- Spreadsheet formulas remain in HTML comments beside their displayed values.
- Cached Office chart series are exported as Markdown tables.
- OCR uses Tesseract.js inside the browser. The recognition model may be downloaded, but the document itself is not uploaded.
- Markdown previews are sanitised before rendering.
- TeX regions are protected before the Markdown parser runs, preventing backslashes, underscores, and alignment markers from being rewritten before KaTeX rendering.

The primary download is a ZIP whenever a conversion has visual assets. Keep the generated Markdown file beside its `assets/` directory; otherwise relative image links cannot render. A `README.txt` inside each package repeats this rule.

## Regression benchmark

The automated rendering benchmark currently covers 47 representative Unicode/LaTeX expressions, eight GFM table shapes, and four PDF image-coordinate records, plus geometry-based PDF fraction, script, label, theme-isolation, end-to-end DOCX, PPTX, spreadsheet, preview, and packaging tests. These defined cases must all pass. This is a reproducible regression target, not a fabricated universal percentage for arbitrary documents.

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

For a custom domain or static host that serves the app from `/`, build with:

```bash
VITE_BASE_PATH=/ npm run build
```

GitHub Actions tests every push to `main`, creates the Vite production build, and deploys `dist/` to GitHub Pages.

## Security and privacy

Conversion happens in the current browser tab. The app has no backend, remote database, analytics, cookies, API credentials, or upload endpoint. Completed conversions may be stored in IndexedDB on the same browser profile so the visitor can reopen or download their own history; large visual assets are omitted when they would exceed the local storage safety limit. Generated object URLs are revoked when previews change.

Large or untrusted compressed Office files can still consume significant browser memory. Use the current browser version, and inspect critical output before publication.

## Licence

MIT © 2026 Santanu Soe
