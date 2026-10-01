// Money / rate helpers for the drop (return) screen parts. The server sends
// Decimals as 2 dp strings — always Number(...) them.

export const num = (x: unknown) => Number(x ?? 0) || 0;

// Bill amounts always show paise: "₹1,416.00".
export const inr2 = (n: number) =>
  `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// "18%" / "9%" / "2.5%" — a GST rate as sent by the server (number or "18.00").
export const pct = (rate: unknown) => `${Number(num(rate).toFixed(2))}%`;
