import { ReactNode } from 'react';

export function Card({ title, children, actions, className = '' }: { title?: string; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden mb-5 ${className}`}>
      {title && (
        <div className="px-5 py-3.5 border-b border-gray-100 bg-brand-50/50 flex items-center justify-between">
          <h3 className="font-bold text-sm text-brand-700">{title}</h3>
          {actions}
        </div>
      )}
      <div className="p-5">{children}</div>
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-14 text-center text-gray-400">
      <div className="text-3xl mb-3 opacity-40">◇</div>
      <div className="text-sm">{message}</div>
    </div>
  );
}
