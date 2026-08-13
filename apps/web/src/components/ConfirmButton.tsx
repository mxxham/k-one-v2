import { useState, ReactNode, ButtonHTMLAttributes } from 'react';
import { Trash2 } from 'lucide-react';

interface ConfirmButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  confirmText?: string;
  onConfirm: () => void;
  variant?: 'danger' | 'ghost';
  children?: ReactNode;
}

export default function ConfirmButton({
  label,
  confirmText = 'Yakin? Tindakan ini tidak bisa dibatalkan.',
  onConfirm,
  variant = 'danger',
  children,
  ...rest
}: ConfirmButtonProps) {
  const [confirming, setConfirming] = useState(false);

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <button
          onClick={() => {
            setConfirming(false);
            onConfirm();
          }}
          className="px-2 py-1 text-[11px] font-bold rounded bg-red-600 text-white hover:bg-red-700"
        >
          Konfirmasi
        </button>
        <button onClick={() => setConfirming(false)} className="px-2 py-1 text-[11px] rounded bg-gray-200 text-gray-700 hover:bg-gray-300">
          Batal
        </button>
      </span>
    );
  }

  return (
    <button
      {...rest}
      onClick={(e) => {
        e.stopPropagation();
        setConfirming(true);
      }}
      title={confirmText}
      className={
        variant === 'danger'
          ? 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100'
          : 'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200'
      }
    >
      <Trash2 className="w-3.5 h-3.5" />
      {children || label}
    </button>
  );
}
