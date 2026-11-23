// Nov 22 (per Mely): preview of the Online Service Fee on the map's checkouts — the same numbers
// api/_serviceFee.js charges (3.5%, minimum $2.25, times the part the park's customers pay).
import { useEffect, useState } from 'react';

export const ONLINE_SERVICE_FEE_LABEL = 'Online Service Fee';
export const ONLINE_SERVICE_FEE_DESCRIPTION = 'Covers secure online payment processing and the MelyOS online booking & account platform.';

export function previewServiceFee(amount, ratio = 1) {
  if (!(amount > 0)) return 0;
  const fullCents = Math.round(Math.max(amount * 0.035, 2.25) * 100);
  const r = Math.min(Math.max(Number(ratio) || 0, 0), 1);
  return Math.min(Math.round(fullCents * r), fullCents) / 100;
}

/** The part of the fee this park's customers pay (propane/storage: always all unless a split is set). */
export function useServiceFeeRatio(parkId, { always = false } = {}) {
  const [ratio, setRatio] = useState(1);
  useEffect(() => {
    fetch(`/api/service-fee?park_id=${encodeURIComponent(parkId || 'aloha')}`)
      .then((r) => r.json())
      .then((j) => {
        const v = always ? j.alwaysCustomerFeeRatio : j.customerFeeRatio;
        setRatio(typeof v === 'number' ? v : 1);
      })
      .catch(() => setRatio(1));
  }, [parkId, always]);
  return ratio;
}
