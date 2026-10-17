import type { QueryRecord } from '@/api/types';

import { Num } from './Num';
import './QueryList.css';

/** Parameterised query templates with rows and measured latency (the "graph proof"). */
export function QueryList({ queries, empty = 'No queries recorded.' }: { queries: QueryRecord[]; empty?: string }) {
  if (queries.length === 0) return <p className="query-list">{empty}</p>;
  return (
    <table className="query-list-2">
      <thead className="query-list__head">
        <tr>
          <th scope="col" className="query-list__heading-cell">
            Template
          </th>
          <th scope="col" className="query-list__heading-cell-2">
            Rows
          </th>
          <th scope="col" className="query-list__heading-cell-3">
            Latency
          </th>
        </tr>
      </thead>
      <tbody className="query-list__body">
        {queries.map((query, index) => (
          <tr key={`${query.id}-${query.template}-${index}`} className="query-list-3">
            <td className="query-list__cell">
              <span className="query-list__label">{query.id} </span>
              {query.template}
              {query.error ? <span className="query-list__label-2">error: {query.error}</span> : null}
            </td>
            <td className="query-list__cell-2">
              <Num metric="tierRows" value={query.rows} plain />
            </td>
            <td className="query-list__cell-3">
              <Num metric="queryLatency" value={query.latency_ms} format="ms" plain />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
