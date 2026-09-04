/**
 * Minimal template renderer for the prompt .md files in ./md/.
 *
 * Supported syntax:
 *   {{name}}              variable substitution (throws if the var is missing,
 *                         so a renamed placeholder fails loudly, not silently)
 *   {{#flag}}...{{/flag}} block kept when vars[flag] is truthy, dropped otherwise
 *   {{^flag}}...{{/flag}} inverse block: kept when vars[flag] is falsy
 *
 * Blocks are resolved before variables, so a variable referenced only inside a
 * dropped block does not need to be provided. Blocks must not nest under the
 * same key.
 */
export type PromptVars = Record<string, string | number | boolean | null | undefined>;

const BLOCK_RE = /\{\{([#^])(\w+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;
const VAR_RE = /\{\{(\w+)\}\}/g;

export function renderPrompt(template: string, vars: PromptVars = {}): string {
  let out = template;
  let prev: string;
  do {
    prev = out;
    out = out.replace(BLOCK_RE, (_match, kind: string, key: string, body: string) => {
      const truthy = Boolean(vars[key]);
      return (kind === "#") === truthy ? body : "";
    });
  } while (out !== prev);

  return out.replace(VAR_RE, (_match, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) {
      throw new Error(`Prompt template missing variable: ${key}`);
    }
    return String(value);
  });
}
