const SALES_PATH = "/erp/vendas";

export function readSalesRoute(pathname: string) {
  if (pathname === SALES_PATH || pathname === `${SALES_PATH}/`) {
    return { matches: true, salePublicId: null } as const;
  }
  if (!pathname.startsWith(`${SALES_PATH}/`)) {
    return { matches: false, salePublicId: null } as const;
  }
  const raw = pathname.slice(SALES_PATH.length + 1);
  if (!raw || raw.includes("/"))
    return { matches: false, salePublicId: null } as const;
  try {
    return { matches: true, salePublicId: decodeURIComponent(raw) } as const;
  } catch {
    return { matches: false, salePublicId: null } as const;
  }
}

export function buildSalesPath(salePublicId?: string | null, search = "") {
  const parameters = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  parameters.delete("salePublicId");
  const serialized = parameters.toString();
  const normalizedSearch = serialized ? `?${serialized}` : "";
  return salePublicId
    ? `${SALES_PATH}/${encodeURIComponent(salePublicId)}${normalizedSearch}`
    : `${SALES_PATH}${normalizedSearch}`;
}
