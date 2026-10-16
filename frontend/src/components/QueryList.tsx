import type { QueryRecord } from '@/api/types';

import { Num } from './Num';

/** Parameterised query templates with rows and measured latency (the "graph proof"). */
export function QueryList({ queries, empty = 'No queries recorded.' }: { queries: QueryRecord[]; empty?: string }) {
  if (queries.length === 0) return <p className="text-2xs text-fg-subtle">{empty}</p>;
  return (
    <table className="w-full text-left text-2xs">
      <thead className="text-fg-subtle">
        <tr>
          <th scope="col" className="pb-1 pr-2 font-medium">
            Template
          </th>
          <th scope="col" className="pb-1 pr-2 text-right font-medium">
            Rows
          </th>
          <th scope="col" className="pb-1 text-right font-medium">
            Latency
          </th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {queries.map((query, index) => (
          <tr key={`${query.id}-${query.template}-${index}`} className="border-t border-line/70">
            <td className="py-1 pr-2 text-fg">
              <span className="text-fg-subtle">{query.id} </span>
              {query.template}
              {query.error ? <span className="ml-1 text-red-400">error: {query.error}</span> : null}
            </td>
            <td className="py-1 pr-2 text-right text-fg-muted">
              <Num metric="tierRows" value={query.rows} plain />
            </td>
            <td className="py-1 text-right text-fg-muted">
              <Num metric="queryLatency" value={query.latency_ms} format="ms" plain />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
