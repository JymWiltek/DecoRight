import "server-only";
import ExcelJS from "exceljs";

/**
 * Excel bulk export/import schema + (de)serialization. Text-only — NO images
 * (Jym: embedding photos bloats the file and kills load/scan). The product_url
 * column lets Jym click through to the live page to eyeball the photo instead.
 *
 * ONE column list drives both directions so export headers and import parsing
 * can't drift.
 */

export type ExcelColumnKey =
  | "id"
  | "product_url"
  | "name"
  | "sku"
  | "brand"
  | "item_type"
  | "subtype"
  | "rooms"
  | "styles"
  | "materials"
  | "colors"
  | "length_mm"
  | "width_mm"
  | "height_mm"
  | "price"
  | "retailers"
  | "status";

type ColumnDef = {
  key: ExcelColumnKey;
  /** Human label + underlying meaning; read-only columns get a "(read-only)"
   *  suffix in the sheet header so Jym sees at a glance not to edit them. */
  header: string;
  readOnly: boolean;
  width: number;
  /** true = comma-separated multi-value (rooms/styles/materials/colors/
   *  retailers). */
  multi?: boolean;
};

// Order is the export column order (locked by the spec).
export const PRODUCT_EXCEL_COLUMNS: ColumnDef[] = [
  { key: "id", header: "id", readOnly: true, width: 38 },
  { key: "product_url", header: "product_url", readOnly: true, width: 46 },
  { key: "name", header: "name", readOnly: false, width: 34 },
  { key: "sku", header: "sku", readOnly: false, width: 16 },
  { key: "brand", header: "brand", readOnly: false, width: 16 },
  { key: "item_type", header: "item_type", readOnly: false, width: 18 },
  { key: "subtype", header: "subtype", readOnly: false, width: 18 },
  { key: "rooms", header: "rooms", readOnly: false, width: 22, multi: true },
  { key: "styles", header: "styles", readOnly: false, width: 22, multi: true },
  { key: "materials", header: "materials", readOnly: false, width: 22, multi: true },
  { key: "colors", header: "colors", readOnly: false, width: 22, multi: true },
  { key: "length_mm", header: "length_mm", readOnly: false, width: 12 },
  { key: "width_mm", header: "width_mm", readOnly: false, width: 12 },
  { key: "height_mm", header: "height_mm", readOnly: false, width: 12 },
  { key: "price", header: "price", readOnly: false, width: 12 },
  { key: "retailers", header: "retailers", readOnly: false, width: 26, multi: true },
  { key: "status", header: "status", readOnly: true, width: 12 },
];

export const EDITABLE_COLUMN_KEYS = PRODUCT_EXCEL_COLUMNS.filter(
  (c) => !c.readOnly,
).map((c) => c.key);

export const READONLY_COLUMN_KEYS = PRODUCT_EXCEL_COLUMNS.filter(
  (c) => c.readOnly,
).map((c) => c.key);

function headerLabel(c: ColumnDef): string {
  return c.readOnly ? `${c.header} (read-only)` : c.header;
}

/** Normalize a spreadsheet header cell back to a column key. Tolerant of the
 *  "(read-only)" suffix, surrounding whitespace, and case, so a round-trip
 *  through Excel / Google Sheets still maps. */
export function normalizeHeaderToKey(raw: string): ExcelColumnKey | null {
  const cleaned = raw
    .replace(/\(read-only\)/i, "")
    .trim()
    .toLowerCase();
  const hit = PRODUCT_EXCEL_COLUMNS.find((c) => c.header.toLowerCase() === cleaned);
  return hit ? hit.key : null;
}

// ── Export ──────────────────────────────────────────────────────────

export type ProductExportRow = {
  id: string;
  name: string | null;
  sku_id: string | null;
  brand: string | null;
  item_type: string | null;
  subtype_slug: string | null;
  room_slugs: string[] | null;
  styles: string[] | null;
  materials: string[] | null;
  colors: string[] | null;
  dimensions_mm: { length?: number; width?: number; height?: number } | null;
  price_myr: number | null;
  status: string;
  /** Retailer/supplier names linked to this product (resolved by the caller
   *  from product_suppliers). */
  retailerNames: string[];
};

function cellValue(
  col: ColumnDef,
  p: ProductExportRow,
  productUrl: string,
): string | number | null {
  switch (col.key) {
    case "id":
      return p.id;
    case "product_url":
      return productUrl;
    case "name":
      return p.name ?? "";
    case "sku":
      return p.sku_id ?? "";
    case "brand":
      return p.brand ?? "";
    case "item_type":
      return p.item_type ?? "";
    case "subtype":
      return p.subtype_slug ?? "";
    case "rooms":
      return (p.room_slugs ?? []).join(", ");
    case "styles":
      return (p.styles ?? []).join(", ");
    case "materials":
      return (p.materials ?? []).join(", ");
    case "colors":
      return (p.colors ?? []).join(", ");
    case "length_mm":
      return p.dimensions_mm?.length ?? "";
    case "width_mm":
      return p.dimensions_mm?.width ?? "";
    case "height_mm":
      return p.dimensions_mm?.height ?? "";
    case "price":
      return p.price_myr ?? "";
    case "retailers":
      return p.retailerNames.join(", ");
    case "status":
      return p.status;
  }
}

/** Build the .xlsx workbook. `productUrlFor` supplies each product's absolute
 *  page URL (built from NEXT_PUBLIC_SITE_URL by the caller — never hardcoded
 *  here). */
export async function buildProductWorkbook(
  products: ProductExportRow[],
  productUrlFor: (id: string) => string,
): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Products");

  // Header row.
  ws.addRow(PRODUCT_EXCEL_COLUMNS.map((c) => headerLabel(c)));
  const header = ws.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle" };
  PRODUCT_EXCEL_COLUMNS.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width;
    if (c.readOnly) {
      // Grey fill on read-only header cells so they read as "don't touch".
      header.getCell(i + 1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFDDDDDD" },
      };
    }
  });

  for (const p of products) {
    ws.addRow(
      PRODUCT_EXCEL_COLUMNS.map((c) => cellValue(c, p, productUrlFor(p.id))),
    );
  }

  // Freeze the header row so it stays put while scrolling 200+ products.
  ws.views = [{ state: "frozen", ySplit: 1 }];

  const out = await wb.xlsx.writeBuffer();
  return new Uint8Array(out as ArrayBuffer);
}

// ── Import parse ────────────────────────────────────────────────────

/** One data row as raw trimmed strings keyed by column key. Only recognized
 *  columns are kept; unknown columns are dropped. Missing/blank cells become
 *  "" (the import layer treats "" as "don't touch this field"). */
export type RawImportRow = {
  /** 1-based row number in the sheet (row 1 = header), for error messages. */
  rowNumber: number;
  cells: Partial<Record<ExcelColumnKey, string>>;
};

export type ParsedSheet = {
  /** Column keys detected in the header, in sheet order. */
  columns: ExcelColumnKey[];
  rows: RawImportRow[];
};

/**
 * Parse an uploaded .xlsx or .csv into raw rows. `filename` picks the format
 * (Google Sheets exports both). Everything comes back as trimmed strings; the
 * import layer does matching / validation / diffing.
 */
export async function parseSpreadsheet(
  data: ArrayBuffer,
  filename: string,
): Promise<ParsedSheet> {
  const isCsv = /\.csv$/i.test(filename);
  const matrix = isCsv
    ? parseCsv(new TextDecoder("utf-8").decode(data))
    : await parseXlsx(data);
  if (matrix.length === 0) return { columns: [], rows: [] };

  const headerCells = matrix[0];
  const colKeyByIndex: (ExcelColumnKey | null)[] = headerCells.map((h) =>
    normalizeHeaderToKey(h),
  );
  const columns = colKeyByIndex.filter((k): k is ExcelColumnKey => k != null);

  const rows: RawImportRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const row = matrix[r];
    // Skip fully-empty rows (trailing blank lines from CSV, etc.).
    if (row.every((c) => c.trim() === "")) continue;
    const cells: Partial<Record<ExcelColumnKey, string>> = {};
    colKeyByIndex.forEach((key, i) => {
      if (!key) return;
      cells[key] = (row[i] ?? "").trim();
    });
    rows.push({ rowNumber: r + 1, cells });
  }
  return { columns, rows };
}

async function parseXlsx(data: ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  // exceljs accepts an ArrayBuffer (its browser path); cast to exceljs's own
  // expected param type, past the @types/node Buffer-generic mismatch.
  await wb.xlsx.load(data as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const matrix: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    // row.values is 1-indexed with a leading undefined; normalize to 0-based.
    const vals = row.values as unknown[];
    for (let i = 1; i < vals.length; i++) {
      cells[i - 1] = cellToString(vals[i]);
    }
    matrix.push(cells);
  });
  return matrix;
}

function cellToString(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") {
    // ExcelJS rich text / hyperlink / formula result objects.
    const o = v as Record<string, unknown>;
    if (typeof o.text === "string") return o.text;
    if (typeof o.result === "string" || typeof o.result === "number")
      return String(o.result);
    if (Array.isArray(o.richText))
      return (o.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
    if (typeof o.hyperlink === "string") return String(o.text ?? o.hyperlink);
    return "";
  }
  return String(v);
}

/**
 * Minimal RFC-4180 CSV parser — handles quoted fields, escaped double-quotes
 * (""), and commas / newlines inside quotes. Google Sheets' CSV export is
 * standard-conformant, so this covers it without an extra dependency.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  // Strip a UTF-8 BOM if present.
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      // Handle \r\n as a single break.
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  // Flush the last field/row if the file didn't end with a newline.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
