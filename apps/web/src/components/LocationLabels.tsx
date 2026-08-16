import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { Printer, X } from 'lucide-react';

export interface LocationLabelRow {
  location_code: string;
  aisle: string | null;
  rack: string | null;
  row_name: string | null;
  position: string | null;
  zone: string | null;
}

function BinLabel({ code }: { code: string }) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || !code) return;
    svgRef.current.innerHTML = '';
    try {
      JsBarcode(svgRef.current, code, {
        format: 'CODE128',
        width: 1.5,
        height: 34,
        displayValue: false,
        margin: 0,
      });
    } catch {
      // barcode render failure — the text-only label still prints
    }
  }, [code]);

  return (
    <div className="bin-label bg-white text-black border-2 border-gray-800 rounded-lg p-2 flex flex-col items-center justify-between">
      <div className="text-center leading-tight">
        <div className="text-[13px] font-black tracking-[0.1em]">{code}</div>
        <div className="text-[8px] font-bold text-gray-600 tracking-wide">LOKASI / BIN</div>
      </div>
      <svg ref={svgRef} className="w-full h-11 mt-1" />
      <div className="text-[11px] font-bold tracking-[0.2em] mt-0.5">{code}</div>
    </div>
  );
}

/**
 * Rack-walk bin labels (S44). Renders one barcode label per location inside a
 * print-only grid (.bin-print-area); window.print() prints only that grid via
 * the @media print CSS in index.css. Each label's barcode (CODE128) is drawn
 * client-side with JsBarcode — the same technique as LpnLabel.
 */
export default function LocationLabels({
  labels,
  onClose,
}: {
  labels: LocationLabelRow[];
  onClose?: () => void;
}) {
  return (
    <div>
      <div className="bin-print-area bg-white text-black rounded-xl">
        {labels.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">Tidak ada lokasi untuk dicetak.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {labels.map((l) => (
              <BinLabel key={l.location_code} code={l.location_code} />
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-center gap-2 mt-4 no-print">
        <button
          onClick={() => window.print()}
          disabled={labels.length === 0}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 disabled:opacity-50"
        >
          <Printer className="w-4 h-4" /> Cetak Label Lokasi ({labels.length})
        </button>
        <button
          onClick={onClose}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
        >
          <X className="w-4 h-4" /> Tutup
        </button>
      </div>
    </div>
  );
}