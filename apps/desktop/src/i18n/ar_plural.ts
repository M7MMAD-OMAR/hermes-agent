/** Arabic counted noun: one, two, 3 to 10 (plural), 11 and up (singular). */
export const arPlural = (n: number, one: string, two: string, few: string, many: string): string =>
  n === 1 ? one : n === 2 ? two : n % 100 >= 3 && n % 100 <= 10 ? `${n} ${few}` : `${n} ${many}`
