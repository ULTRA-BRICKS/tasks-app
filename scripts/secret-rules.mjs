// Configuration paths remain forbidden even after `git add --force`.
export function forbiddenTrackedPaths(paths) {
  return paths.filter((path) => {
    const parts = path.split('/'),
      name = parts.at(-1);
    return (
      (name.startsWith('.env') && name !== '.env.example') ||
      parts.some((p) => ['.vercel', '.data', '.config'].includes(p)) ||
      name === '.neon' ||
      /\.(?:db|sqlite|pem|key)$/.test(name)
    );
  });
}
