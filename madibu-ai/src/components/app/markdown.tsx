/** Rendu Markdown minimal et sûr (aucun HTML brut injecté) pour les rapports générés. */
import { Fragment } from "react";

function inline(text: string, key: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|_[^_]+_)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("_") && p.endsWith("_") && p.length > 2) return <em key={`${key}-${i}`}>{p.slice(1, -1)}</em>;
    return <Fragment key={`${key}-${i}`}>{p}</Fragment>;
  });
}

export function Markdown({ source }: { source: string }) {
  const lines = source.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[-| ]+\|$/.test(lines[i])) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        <div key={`t${i}`} className="overflow-x-auto"><table>
          <thead><tr>{head.map((c, j) => <th key={j}>{inline(c, `h${i}${j}`)}</th>)}</tr></thead>
          <tbody>{body.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j}>{inline(c, `c${i}${k}${j}`)}</td>)}</tr>)}</tbody>
        </table></div>,
      );
      continue;
    }
    if (/^(- |\d+\. )/.test(l)) {
      const ordered = /^\d+\. /.test(l);
      const items: string[] = [];
      while (i < lines.length && /^(\s*- |\d+\. )/.test(lines[i])) { items.push(lines[i].replace(/^(\s*- |\d+\. )/, "")); i++; }
      const List = ordered ? "ol" : "ul";
      out.push(<List key={`l${i}`}>{items.map((it, k) => <li key={k}>{inline(it, `li${i}${k}`)}</li>)}</List>);
      continue;
    }
    if (l.startsWith("### ")) out.push(<h3 key={i}>{inline(l.slice(4), `h3${i}`)}</h3>);
    else if (l.startsWith("## ")) out.push(<h2 key={i}>{inline(l.slice(3), `h2${i}`)}</h2>);
    else if (l.startsWith("# ")) out.push(<h1 key={i}>{inline(l.slice(2), `h1${i}`)}</h1>);
    else if (l.trim()) out.push(<p key={i}>{inline(l, `p${i}`)}</p>);
    i++;
  }
  return <div className="prose-report">{out}</div>;
}
