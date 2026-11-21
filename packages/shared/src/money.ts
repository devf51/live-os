export const toSatang = (baht: number): number => Math.round(baht * 100);

export const formatBaht = (satang: number): string =>
  `${satang % 100 === 0 ? satang / 100 : (satang / 100).toFixed(2)} บาท`;
