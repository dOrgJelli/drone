export function formatProfileDisplayName(nameRaw: string | null | undefined): string {
  const name = String(nameRaw ?? '').trim();
  if (!name) return 'New Profile';
  return name
    .split(/[-_.]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
