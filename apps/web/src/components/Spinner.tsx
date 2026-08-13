export default function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center py-16 text-brand-600 flex-col gap-3">
      <div className="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      {label && <span className="text-sm text-gray-500">{label}</span>}
    </div>
  );
}
