import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { Printer } from 'lucide-react';
import { fmtNum } from '@/lib/format';

export interface LpnLabelData {
  lpn_code: string;
  product_code: string | null;
  product_name: string | null;
  batch_number: string | null;
  uom: string | null;
  quantity: number;
  pallet_seq: number;
  suggested_location: string | null;
  expiry_date: string | null;
  task_number: string | null;
  order_number: string | null;
}

/**
 * Printable LPN label (Step 1 / S46). The barcode (CODE128) is rendered
 * client-side with JsBarcode; window.print() prints ONLY the .lpn-print-area
 * via the @media print CSS in index.css. "Cetak Ulang" re-triggers the same
 * print without a refetch — the caller re-fetches fresh label data when it
 * reopens the modal.
 */
export default function LpnLabel({ label, onPrint }: { label: LpnLabelData; onPrint?: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !label.lpn_code) return;
    svgRef.current.innerHTML = '';
    try {
      JsBarcode(svgRef.current, label.lpn_code, {
        format: 'CODE128',
        width: 2,
        height: 56,
        displayValue: false,
        margin: 0,
      });
    } catch {
      // barcode render failure — the text-only label still prints
    }
  }, [label.lpn_code]);

  const doPrint = () => {
    onPrint?.();
    window.print();
  };

  return (
    <div>
      <div className="lpn-print-area bg-white text-black px-4 py-3 rounded-xl border-2 border-gray-800 w-[320px] mx-auto print:rounded-none">
        <div className="flex items-start justify-between border-b border-gray-400 pb-1.5 mb-2">
          <div className="text-sm font-black tracking-[0.08em] leading-tight">
            {label.lpn_code}
            <div className="text-[9px] font-bold text-gray-600 tracking-wide">LABEL PALLET / LPN</div>
          </div>
          <div className="text-[9px] font-bold text-gray-600 text-right leading-tight">
            <div>PT. K-ONE</div>
            <div>WAREHOUSE</div>
          </div>
        </div>
        <div className="text-[11px] leading-snug">
          <div className="font-bold">{label.product_name || label.product_code || '—'}</div>
          <div className="text-[10px] text-gray-600">{label.product_code || ''}</div>
          <div className="flex justify-between mt-1">
            <span>
              Batch: <span className="font-semibold">{label.batch_number || '—'}</span>
            </span>
            <span>
              Exp: <span className="font-semibold">{label.expiry_date || '—'}</span>
            </span>
          </div>
          <div className="flex justify-between">
            <span>
              Qty: <span className="font-semibold">
                {fmtNum(label.quantity)} {label.uom || ''}
              </span>
            </span>
            <span>
              Pallet: <span className="font-semibold">#{label.pallet_seq}</span>
            </span>
          </div>
          <div className="flex justify-between">
            <span>
              Lokasi: <span className="font-semibold">{label.suggested_location || '—'}</span>
            </span>
            <span>
              Task: <span className="font-semibold">{label.task_number || '—'}</span>
            </span>
          </div>
        </div>
        <svg ref={svgRef} className="w-full h-16 mt-1.5" />
        <div className="text-center text-[11px] font-bold tracking-[0.35em] mt-0.5">{label.lpn_code}</div>
      </div>

      <div className="flex justify-center gap-2 mt-4 no-print">
        <button
          onClick={doPrint}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700"
        >
          <Printer className="w-4 h-4" /> Cetak Label LPN
        </button>
        <button
          onClick={doPrint}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
        >
          <Printer className="w-4 h-4" /> Cetak Ulang
        </button>
      </div>
    </div>
  );
}