import { useMemo } from 'react';

import { useCertificate } from '@/api/queries';
import type { CertificateView, HuntReportView } from '@/api/types';
import { clusterAnalysis, type ClusterAnalysis } from '@/lib/analysis';

import { useRun, useSandboxState, useWorkbenchState } from './services';

export function useClusterAnalysis(clusterId: string): ClusterAnalysis {
  const run = useRun(clusterId);
  const direct = useWorkbenchState((state) => state.direct[clusterId]);
  return useMemo(() => clusterAnalysis(run, direct), [run, direct]);
}

export interface HuntOutcome {
  certificate: CertificateView | null;
  /** VALID / SUPERSEDED / EXPIRED, as the API last recomputed it. */
  certificateStatus: string | null;
  /**
   * The containment claim may be shown only while this is true: the API says VALID and the
   * sandbox is still at the certificate's revision (the API's own rule, applied so a stale
   * cached "VALID" is never shown after a sandbox change).
   */
  certificateCurrent: boolean;
}

export function useHuntOutcome(hunt: HuntReportView | undefined): HuntOutcome {
  const embedded = hunt?.certificate ?? null;
  const query = useCertificate(embedded?.certificate_id ?? null);
  const revision = useSandboxState((s) => s.revision);
  const certificate = query.data ?? embedded;
  const status = certificate?.status ?? null;
  const sameRevision = revision === null || certificate?.snapshot.sandbox_revision === revision;
  return {
    certificate,
    certificateStatus: status === 'VALID' && !sameRevision ? 'SUPERSEDED' : status,
    certificateCurrent: status === 'VALID' && sameRevision,
  };
}
