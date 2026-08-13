import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  onChange: (page: number) => void;
}

export default function Pagination({ page, totalPages, total, onChange }: PaginationProps) {
  if (totalPages <= 1 && total === undefined) return null;
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const window = pages.filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1);

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <button
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="p-1.5 rounded border border-gray-300 bg-white text-gray-500 hover:border-brand-500 hover:text-brand-600 disabled:opacity-40 disabled:pointer-events-none"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>
      {window.map((p, i) => {
        const prev = window[i - 1];
        return (
          <span key={p} className="flex items-center gap-1.5">
            {prev && p - prev > 1 && <span className="text-gray-400 text-xs">…</span>}
            <button
              onClick={() => onChange(p)}
              className={`min-w-[30px] px-2 py-1 rounded text-xs font-semibold border ${
                p === page
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:border-brand-500 hover:text-brand-600'
              }`}
            >
              {p}
            </button>
          </span>
        );
      })}
      <button
        disabled={page >= totalPages}
        onClick={() => onChange(page + 1)}
        className="p-1.5 rounded border border-gray-300 bg-white text-gray-500 hover:border-brand-500 hover:text-brand-600 disabled:opacity-40 disabled:pointer-events-none"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
      {total !== undefined && <span className="text-xs text-gray-400 ml-2">{total.toLocaleString()} records</span>}
    </div>
  );
}
