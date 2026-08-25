/** A `{{name}}` placeholder, the only syntax a template has. */
const PLACEHOLDER = /\{\{\s*([A-Za-z][A-Za-z0-9]*)\s*\}\}/g;

/**
 * Substitute `{{name}}` placeholders in a template.
 *
 * An unknown name is an error and is **left standing** in the output rather
 * than blanked: a typo should show up as a complaint and a visibly broken line,
 * not as `date: ""` and a column that silently collects nothing.
 *
 * Nothing else is touched, so a regex like `/^#w\d+_\d{4}$/` passes through
 * whole — `{4}` is not a placeholder, and a placeholder is never re-scanned
 * after substitution.
 */
export function renderTemplate(
  text: string,
  variables: Record<string, string>,
): { text: string; errors: string[] } {
  const unknown = new Set<string>();

  const rendered = text.replace(PLACEHOLDER, (match, name: string) => {
    const value = variables[name];
    if (value === undefined) {
      unknown.add(name);
      return match;
    }
    return value;
  });

  const known = Object.keys(variables).sort().join(", ");
  const errors = [...unknown].map(
    (name) => `Unknown template variable {{${name}}} (available: ${known})`,
  );

  return { text: rendered, errors };
}

/** Every placeholder a template names, in first-seen order. */
export function templateVariables(text: string): string[] {
  const names: string[] = [];
  for (const match of text.matchAll(PLACEHOLDER)) {
    if (!names.includes(match[1])) {
      names.push(match[1]);
    }
  }
  return names;
}
