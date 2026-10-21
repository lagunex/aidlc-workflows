# Requirements Analysis — Clarifying Questions

These questions refine the requirements for the CSV export PoC. Answer in whichever mode you prefer; all answers are written back here before I generate `requirements.md`.

### Q1. Which reports must the PoC export?
The intent names saved reports. Which of them are in scope?

- A. One saved report only (the weekly summary)
- B. Every saved report, with the columns each one shows on screen (as stated in the intent)
- C. Saved reports plus one-off queries
- D. Whatever the reporting tool minimally requires to be useful
- E. Not yet defined
- X. Other (please specify)

[Answer]: B. Every saved report, with the columns each one shows on screen (as stated in the intent).

### Q2. How should the export read the report's rows?
How should rows be collected from the reporting tool?

- A. Stream rows from the query layer page by page (low memory, consistent with the new query layer)
- B. Load the whole result into memory, then write it (simpler, higher memory)
- C. Reuse an existing CSV library rather than writing the quoting by hand
- D. No preference — pick the approach that best fits flat memory use
- E. Not yet defined
- X. Other (please specify)

[Answer]: X. Support BOTH a streaming writer (page by page, low memory) and an in-memory writer (simpler, one pass), offered as a selectable option. Measure memory for both so the PoC can compare them.

### Q3. How should the file reach the person?
The target is a CSV file a spreadsheet opens. What delivery path should the PoC use?

- A. A download link on the report page that streams the file to the browser
- B. A command that writes the file to disk, which the report page then offers for download
- C. Either is acceptable; choose whichever is simplest to demonstrate the end-to-end path
- D. Not yet defined
- X. Other (please specify)

[Answer]: B. A command that writes the file to disk, which the report page then offers for download. The file is named after the report and the date (for example `weekly-summary-2026-10-16.csv`) and is written as UTF-8.

### Q4. How does a person start an export?
How should someone ask for a CSV file?

- A. A button on the report page (no setup)
- B. A command the maintainers run for a report
- C. Both the button and the command
- D. No preference for the PoC — the simplest start that demonstrates the export
- E. Not yet defined
- X. Other (please specify)

[Answer]: C. Both a button on the report page and a command the maintainers can run for any saved report (including choosing the writer mode).

### Q5. What is the sample report for the demonstration?
The intent flags this as an open assumption. What should the PoC export?

- A. A small purpose-built sample report with tricky fields (commas, quotes, line breaks) and a million rows
- B. A representative real report (for example the weekly summary)
- C. A standard benchmark dataset
- D. Not yet chosen — leave it to the design/build stage to pick a minimal sample
- X. Other (please specify)

[Answer]: A. A small purpose-built sample report with tricky fields (commas, quotes, line breaks) and a million rows, so the quoting and the memory use are both visible.

### Q6. What should the memory measurement capture (since there is no fixed threshold)?
R-01 confirmed memory use is measure-and-report. What should be measured and reported?

- A. Peak memory and export time
- B. Peak memory, export time, and file size
- C. A simple before/after comparison on the sample report, reported qualitatively
- D. Not yet defined
- X. Other (please specify)

[Answer]: B. Peak memory, export time, and file size, measured on the sample report — reported for each writer mode (streaming and in-memory) so the two can be compared.

### Q7. What are the explicit non-goals / out-of-scope items for this PoC?
Confirm what the PoC should NOT attempt (select all that apply, or use X).

- A. Production hardening (retries, a permissions review, very large files over a slow connection)
- B. Other export formats (spreadsheet files, JSON) — that is the next iteration
- C. Scheduled or mailed-out exports
- D. Importing CSV files back into the reporting tool
- E. All of the above are out of scope
- X. Other (please specify)

[Answer]: E. All of the above are out of scope: production hardening; other export formats (next iteration); scheduled or mailed-out exports; and importing CSV files back into the reporting tool.

### Q8. Are there platform/runtime constraints for the PoC?
Any constraints on where the export runs or which spreadsheet programs must open the file?

- A. A single recent Python version, running locally or on a single host, is sufficient
- B. Must demonstrate on a specific runtime (for example a container) — please specify
- C. No specific constraint — simplest environment that proves the path
- D. Not yet defined
- X. Other (please specify)

[Answer]: A. A single recent Python version running locally or on a single host is sufficient for the PoC. Constraint: the export must not need any Python version or library that conflicts with what the reporting tool already supports, and the files must open in the common spreadsheet programs without an import wizard.

## Consolidated Summary Confirmation

Summary of answers:

- Reports: every saved report, with the columns it shows on screen.
- Reading rows: BOTH a streaming writer and an in-memory writer, selectable, both measured for comparison.
- Delivery: a command writes the file to disk and the report page offers it for download; UTF-8, named after the report and the date.
- Starting an export: both a button on the report page and a command (including writer-mode selection).
- Sample report: a small purpose-built report with tricky fields and a million rows.
- Memory measurement: peak memory, export time, and file size, per writer mode.
- Out of scope: production hardening; other export formats (next iteration); scheduled or mailed-out exports; importing CSV files back.
- Platform/runtime: a recent Python on a single host; the export must stay within the reporting tool's supported versions.

Does this all look correct before I generate the requirements artifact?

- Looks correct
- Request changes

[Answer]: Looks correct
