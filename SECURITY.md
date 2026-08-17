# Security policy

## Privacy model

FidelityMD is a static web application. Document contents are processed in browser memory and are not transmitted to a project-owned server. OCR language data may be downloaded by Tesseract.js when OCR is enabled; files and extracted text are not sent with that request.

## Reporting a vulnerability

Please open a GitHub issue with reproduction steps that do not include confidential documents. For a report that would expose user data or a live exploit, contact the repository owner privately through the contact information on their GitHub profile.

## Scope

Relevant reports include cross-site scripting in rendered Markdown, unsafe archive expansion, dependency vulnerabilities with a practical browser exploit, and unexpected file or text transmission.
