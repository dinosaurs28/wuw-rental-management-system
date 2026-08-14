const CATEGORY_DISPLAY: Record<string, string> = {
  'Two Wheeler': 'Bikes',
  'Four Wheeler': 'Cars',
};

export const displayCategory = (name?: string | null): string => {
  if (!name) return '';
  return CATEGORY_DISPLAY[name] ?? name;
};
