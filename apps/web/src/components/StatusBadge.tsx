const STATUS_STYLES: Record<string, string> = {
  // Inbound
  Draft: 'bg-gray-100 text-gray-700 border-gray-300',
  'Dues In': 'bg-blue-50 text-blue-700 border-blue-300',
  Receiving: 'bg-orange-50 text-orange-700 border-orange-300',
  'Good Received': 'bg-green-50 text-green-700 border-green-300',
  'Goods Received': 'bg-green-50 text-green-700 border-green-300',
  Unserviceable: 'bg-red-50 text-red-700 border-red-300',
  Picked: 'bg-indigo-50 text-indigo-700 border-indigo-300',
  ATP: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  Completed: 'bg-emerald-50 text-emerald-800 border-emerald-300',
  Cancelled: 'bg-red-50 text-red-700 border-red-300',
  // Outbound
  Open: 'bg-sky-50 text-sky-700 border-sky-300',
  Picking: 'bg-amber-50 text-amber-700 border-amber-300',
  Shipped: 'bg-violet-50 text-violet-700 border-violet-300',
  Delivered: 'bg-teal-50 text-teal-700 border-teal-300',
  // Picklist
  Confirmed: 'bg-cyan-50 text-cyan-700 border-cyan-300',
  // Stock take
  'In Progress': 'bg-amber-50 text-amber-700 border-amber-300',
  Counting: 'bg-amber-50 text-amber-700 border-amber-300',
  Review: 'bg-purple-50 text-purple-700 border-purple-300',
  Adjusted: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  // Bin transfer / misc
  Pending: 'bg-yellow-50 text-yellow-700 border-yellow-300',
  Available: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  Reserved: 'bg-indigo-50 text-indigo-700 border-indigo-300',
  Expired: 'bg-red-50 text-red-700 border-red-300',
  Rejected: 'bg-red-50 text-red-700 border-red-300',
  Accepted: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  Plus: 'bg-emerald-50 text-emerald-700 border-emerald-300',
  Minus: 'bg-red-50 text-red-700 border-red-300',
  Clear: 'bg-gray-100 text-gray-700 border-gray-300',
};

export default function StatusBadge({ status }: { status?: string | null }) {
  const key = status || '—';
  const cls = STATUS_STYLES[key] || 'bg-gray-100 text-gray-600 border-gray-300';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${cls}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {key}
    </span>
  );
}
