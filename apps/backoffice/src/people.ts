const AVATAR_COLORS = ['brand', 'indigo', 'grape', 'orange', 'cyan', 'pink', 'teal', 'violet'];

/** A stable colour per person, so staff learn to spot their own tile. */
export function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
