import type { ReactNode } from 'react';

/**
 * A contract document, rendered from the Markdown it is stored as.
 *
 * Deliberately small: headings, paragraphs, bulleted and numbered lists,
 * tables, bold, italic and links, which is everything the documents use. The text is
 * Waivern's own and fixed per version, never anybody's input, and it is turned
 * into React elements rather than HTML, so nothing in it can run.
 */

type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; start: number; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] };

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());
}

function parse(markdown: string): Block[] {
  return markdown
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk): Block => {
      const lines = chunk.split('\n').map((l) => l.trim());
      const heading = /^(#{2,3}) (.*)$/.exec(lines[0]);
      if (heading && lines.length === 1)
        return {
          kind: 'heading',
          level: heading[1].length as 2 | 3,
          text: heading[2]
        };
      if (lines.every((l) => l.startsWith('|'))) {
        const [head, ...rest] = lines;
        return {
          kind: 'table',
          head: cells(head),
          rows: rest.filter((l) => !/^\|[\s:|-]+\|$/.test(l)).map(cells)
        };
      }
      if (lines.every((l) => l.startsWith('- ')))
        return { kind: 'bullets', items: lines.map((l) => l.slice(2)) };
      if (lines.every((l) => /^\d+\. /.test(l)))
        return {
          kind: 'numbers',
          start: Number(/^(\d+)\./.exec(lines[0])?.[1] ?? 1),
          items: lines.map((l) => l.replace(/^\d+\. /, ''))
        };
      return { kind: 'paragraph', text: lines.join(' ') };
    });
}

const LINK = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/;

function inline(text: string): ReactNode[] {
  return text
    .split(/(\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*\*[^*]+\*\*|\*[^*]+\*)/g)
    .filter(Boolean)
    .map((part, i) => {
      const link = LINK.exec(part);
      if (link)
        return (
          <a
            key={i}
            href={link[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            {link[1]}
          </a>
        );
      if (part.startsWith('**') && part.endsWith('**'))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      if (part.startsWith('*') && part.endsWith('*') && part.length > 2)
        return <em key={i}>{part.slice(1, -1)}</em>;
      return part;
    });
}

export function anchorFor(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * `nested` is for a document shown inside a page with its own headings: its
 * sections become h4 and h5, so the page's outline stays the page's.
 */
export function LegalText({
  body,
  nested = false
}: {
  body: string;
  nested?: boolean;
}) {
  const Major = nested ? 'h4' : 'h2';
  const Minor = nested ? 'h5' : 'h3';
  return (
    <div className="space-y-3 text-sm leading-relaxed text-ink">
      {parse(body).map((block, i) => {
        switch (block.kind) {
          case 'heading':
            return block.level === 2 ? (
              <Major
                key={i}
                id={anchorFor(block.text)}
                className="scroll-mt-6 pt-3 text-base font-semibold tracking-tight"
              >
                {inline(block.text)}
              </Major>
            ) : (
              <Minor
                key={i}
                id={anchorFor(block.text)}
                className="scroll-mt-6 pt-2 text-sm font-semibold"
              >
                {inline(block.text)}
              </Minor>
            );
          case 'paragraph':
            return <p key={i}>{inline(block.text)}</p>;
          case 'bullets':
            return (
              <ul
                key={i}
                className="list-disc space-y-1 pl-5"
              >
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ul>
            );
          case 'numbers':
            return (
              <ol
                key={i}
                start={block.start}
                className="list-decimal space-y-1 pl-5"
              >
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </ol>
            );
          case 'table':
            return (
              <div
                key={i}
                className="overflow-x-auto"
              >
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      {block.head.map((h, j) => (
                        <th
                          key={j}
                          className="border border-line bg-ground px-2 py-1.5 align-top font-semibold"
                        >
                          {inline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, j) => (
                      <tr key={j}>
                        {row.map((c, k) => (
                          <td
                            key={k}
                            className="border border-line px-2 py-1.5 align-top"
                          >
                            {inline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
