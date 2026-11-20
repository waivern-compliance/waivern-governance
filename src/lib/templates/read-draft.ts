import { templateDefinition, type TemplateDefinition } from './schema';

/**
 * A draft definition as typed into the editor, read before anything is saved.
 *
 * JSON that does not parse, or parses but is not a template, is refused and
 * nothing is written - not even a first save, so no draft comes into being.
 * A template that is merely incoherent is returned to be saved with its
 * problems, which the caller checks.
 */
export function readDraft(
  raw: string
):
  | { ok: true; definition: TemplateDefinition }
  | { ok: false; problems: string[] } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      ok: false,
      problems: [
        `That is not valid JSON - ${error instanceof Error ? error.message : 'unparseable'}`
      ]
    };
  }

  const shape = templateDefinition.safeParse(parsed);
  if (!shape.success) {
    return {
      ok: false,
      problems: shape.error.issues.map(
        (i) => `${i.path.join('.') || 'definition'}: ${i.message}`
      )
    };
  }
  return { ok: true, definition: shape.data };
}
