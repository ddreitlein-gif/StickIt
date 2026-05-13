## CSV / Excel exports

For spreadsheet workflows — feeding standings to a webmaster, manually computing FFSP for non-dual events, archiving — every event can be exported as CSV or Excel.

### Where to access

The **Reports** tab on the event detail page has CSV / XLSX / ZIP buttons. Each triggers a server-side export.

### CSV format

Tab-separated columns, with header row:

```
Place, Bib, Last, First, Club, Div, Birth Year, USSA#, Turns, Air, Time, Speed, Total
```

For multi-phase events, additional columns per phase:

```
..., Run 1 Turns, Run 1 Air, Run 1 Speed, Run 1 Total, Run 2 Turns, ...
```

For aerials v2 events:

```
..., Jump 1 Air, Jump 1 Form, Jump 1 Landing, Jump 1 Total,
     Jump 2 Air, Jump 2 Form, Jump 2 Landing, Jump 2 Total,
     Air no DD, Form Total, Landing Total, Event Total
```

Per-judge columns optionally included (per CLAUDE.md v1.7+):

```
..., TL1 Carving, TL1 Absorption, TL1 Upper, TL1 Deduction,
     TL2 ..., TL3 ..., A1 J1, A1 J2, A2 J1, A2 J2
```

### Excel (XLSX)

Same data as CSV, but formatted as a proper `.xlsx` workbook with column widths, header styling, and number formatting (2-decimal display).

The XLSX export uses `exceljs` server-side. Numeric values are stored as numbers (not strings), so spreadsheet formulas work directly.

### ZIP export

For multi-phase events, the ZIP export bundles:
- One CSV per phase
- One CSV with combined results
- A `README.txt` explaining each file

Useful when you need to deliver multiple views to a webmaster who'll merge them into a season aggregate.

### Nation column

As of v1.19.01, the **Nation column is removed** from CSV / Excel / HTML print exports. Earlier versions emitted an empty `Nation` column because the v1.16.12 Athletes UI removed Nation. The underlying `athletes.nation` DB column is preserved for USSS transmit XML and meet import/export round-trip — just no longer in exports.

### DNS / DNF / DSQ rows

Athletes with a status (DNS / DNF / DSQ) appear in the export with `DNS` / `DNF` / `DSQ` in the Total column and blanks in the component columns. NT runs show `NT` in the Time column.

### Truncation

All numeric values are floored to 2 decimals (FIS rule), matching the engine and the PDFs. DDs are preserved at full precision when included.

### When to use which

- **CSV** — quick view, importing into web tools, scripting.
- **XLSX** — handoff to non-technical stakeholders, formatted reading.
- **ZIP** — multi-phase events, full archive bundle.

### Direct API

```
GET /api/events/:eventId/export.csv
GET /api/events/:eventId/export.xlsx
GET /api/events/:eventId/export.zip
```

All return appropriate `Content-Type` headers and `Content-Disposition: attachment` with the right filename.
