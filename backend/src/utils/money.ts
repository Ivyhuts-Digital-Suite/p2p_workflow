export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface PricedLine {
  quantity: number;
  unitPrice: number;
  taxRate: number;
}

/** Computes taxable value, tax and gross total for a set of priced lines. */
export function calcOrderTotals(lines: PricedLine[]) {
  let subtotal = 0;
  let taxTotal = 0;
  for (const line of lines) {
    const lineValue = line.quantity * line.unitPrice;
    subtotal += lineValue;
    taxTotal += (lineValue * line.taxRate) / 100;
  }
  return {
    subtotal: round2(subtotal),
    taxTotal: round2(taxTotal),
    grandTotal: round2(subtotal + taxTotal),
  };
}
