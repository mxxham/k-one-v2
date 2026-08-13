import { createContext, useContext, useCallback, useState, ReactNode } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (kind: ToastKind, message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const toast = useCallback((kind: ToastKind, message: string) => {
    const id = Date.now() + Math.random();
    setItems((prev) => [...prev, { id, kind, message }]);
    setTimeout(() => {
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-sm font-medium min-w-[260px] max-w-md border ${
              t.kind === 'success'
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                : t.kind === 'error'
                  ? 'bg-red-50 text-red-800 border-red-200'
                  : 'bg-sky-50 text-sky-800 border-sky-200'
            }`}
          >
            {t.kind === 'success' && <CheckCircle2 className="w-4 h-4 flex-shrink-0" />}
            {t.kind === 'error' && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            {t.kind === 'info' && <Info className="w-4 h-4 flex-shrink-0" />}
            <span className="flex-1">{t.message}</span>
            <button
              onClick={() => setItems((prev) => prev.filter((x) => x.id !== t.id))}
              className="opacity-50 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx.toast;
}
