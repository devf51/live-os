export const toSatang = (baht: number): number => Math.round(baht * 100);

export const formatBaht = (satang: number): string =>
  `${(satang / 100).toLocaleString('en-US', satang % 100 === 0 ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`;
