import { useRef, useState, KeyboardEvent } from 'react';
import { ScanLine } from 'lucide-react';

interface ScanInputProps {
  onScan: (code: string) => void | Promise<void>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * Scanner-first input (Phase 2). A single autofocused text input that submits
 * on Enter — USB/Bluetooth scanners act as a keyboard. NOT a modal or page.
 * After a scan the field clears and refocuses for the next read.
 */
export default function ScanInput({ onScan, placeholder = 'Scan kode…', disabled, className = '' }: ScanInputProps) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    const code = value.trim();
    if (!code || busy || disabled) return;
    setBusy(true);
    try {
      await onScan(code);
    } finally {
      setBusy(false);
      setValue('');
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className={`relative ${className}`}>
      <ScanLine className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-brand-500" />
      <input
        ref={inputRef}
        autoFocus
        value={value}
        disabled={disabled || busy}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full pl-9 pr-3 py-2 border-[1.5px] border-gray-300 rounded-lg text-sm text-brand-900 bg-white focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 outline-none transition disabled:opacity-60"
      />
    </div>
  );
}
