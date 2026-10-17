import { describe, expect, it } from "vitest";
import { salesListOrderBy } from "./repository";

describe("sales list server-side ordering", () => {
  it("orders identifiers by prefix and numeric suffix instead of naïve lexical text", () => {
    const sql = salesListOrderBy("orderNumber", "asc");
    expect(sql).toContain("LOWER(SUBSTRING_INDEX(o.order_number,'-',1)) ASC");
    expect(sql).toContain("CAST(SUBSTRING_INDEX(o.order_number,'-',-1) AS UNSIGNED) ASC");
    expect(sql).toMatch(/o\.id ASC$/);
  });

  it("uses the commercial date and sends missing normalized names to the end", () => {
    expect(salesListOrderBy("commercialDate", "desc")).toContain("COALESCE(o.commercial_date,DATE(o.created_at)) DESC");
    expect(salesListOrderBy("customer", "desc")).toContain("IS NULL) ASC");
    expect(salesListOrderBy("seller", "asc")).toContain("NULLIF(LOWER(TRIM(o.seller_name_snapshot)),'') ASC");
  });

  it("maps sale and quote workflow statuses to a stable business order", () => {
    const sql = salesListOrderBy("status", "asc");
    expect(sql).toContain("o.document_type='quote'");
    expect(sql).toContain("WHEN 'negotiation' THEN 20");
    expect(sql).toContain("WHEN 'separation' THEN 30");
    expect(sql).toContain("o.status='cancelled'");
  });
});
