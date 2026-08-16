import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Package, CheckCircle2, AlertCircle, MapPin, Box } from 'lucide-react';
import { api } from '@/lib/api';
import Spinner from '@/components/Spinner';
import { fmtNum } from '@/lib/format';

interface PicklistItem {
  id: number;
  product_id: number;
  product_code: string;
  product_name: string;
  batch_number: string;
  location: string;
  quantity: number;
  picked_quantity: number | null;
  uom: string;
  pallet: number;
  status: 'Pending' | 'Picked' | 'Verified';
  pallet_seq?: number;
}

interface Picklist {
  id: number;
  picklist_number: string;
  status: string;
  outbound_order?: {
    order_number: string;
    customer_name?: string;
  };
  items: PicklistItem[];
}

export default function MobilePickerUI() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [picklist, setPicklist] = useState<Picklist | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeItem, setActiveItem] = useState<number | null>(null);

  useEffect(() => {
    loadPicklist();
  }, [id]);

  const loadPicklist = async () => {
    try {
      setLoading(true);
      const res = await api('picklist', 'detail', { params: { id } });
      setPicklist(res.picklist);
      // Auto-select first pending item
      const firstPending = res.picklist.items.find((i: PicklistItem) => i.status === 'Pending');
      if (firstPending) setActiveItem(firstPending.id);
    } catch (e: any) {
      setError(e.message || 'Failed to load picklist');
    } finally {
      setLoading(false);
    }
  };

  const markPicked = async (itemId: number, quantity: number) => {
    try {
      await api('picklist', 'update_item', {
        body: {
          id: itemId,
          picked_quantity: quantity,
          status: 'Picked',
        },
      });
      await loadPicklist();
      // Move to next pending
      const nextPending = picklist?.items.find(
        (i) => i.id !== itemId && i.status === 'Pending'
      );
      if (nextPending) {
        setActiveItem(nextPending.id);
      }
    } catch (e: any) {
      alert(e.message || 'Failed to update item');
    }
  };

  const completePicking = async () => {
    if (!picklist) return;
    const pending = picklist.items.filter((i) => i.status === 'Pending');
    if (pending.length > 0) {
      alert(`${pending.length} items still pending. Complete all items first.`);
      return;
    }
    
    if (confirm('Complete picking? This will finalize the picklist.')) {
      try {
        await api('picklist', 'complete', { body: { id: picklist.id } });
        navigate('/picklist');
      } catch (e: any) {
        alert(e.message || 'Failed to complete');
      }
    }
  };

  if (loading) return <Spinner label="Loading picklist..." />;
  if (error) return <div className="p-4 text-red-600">{error}</div>;
  if (!picklist) return <div className="p-4">Picklist not found</div>;

  const activeItemData = activeItem
    ? picklist.items.find((i) => i.id === activeItem)
    : null;

  const stats = {
    total: picklist.items.length,
    picked: picklist.items.filter((i) => i.status === 'Picked').length,
    pending: picklist.items.filter((i) => i.status === 'Pending').length,
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-br from-brand-600 to-brand-500 text-white p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs opacity-75 uppercase tracking-wide">Picklist</div>
            <div className="text-xl font-bold">{picklist.picklist_number}</div>
            {picklist.outbound_order && (
              <div className="text-sm opacity-90 mt-0.5">
                {picklist.outbound_order.order_number}
                {picklist.outbound_order.customer_name && ` • ${picklist.outbound_order.customer_name}`}
              </div>
            )}
          </div>
          <Package className="w-10 h-10 opacity-80" />
        </div>

        {/* Progress bar */}
        <div className="mt-4">
          <div className="flex justify-between text-xs mb-1">
            <span>{stats.picked} / {stats.total} picked</span>
            <span>{Math.round((stats.picked / stats.total) * 100)}%</span>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white transition-all duration-300"
              style={{ width: `${(stats.picked / stats.total) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Main content - split view on larger screens, stacked on mobile */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Item list - scrollable */}
        <div className="lg:w-1/3 bg-white border-b lg:border-r border-gray-200 overflow-y-auto">
          <div className="p-3 bg-gray-50 border-b border-gray-200 font-bold text-sm text-gray-700 sticky top-0">
            Pick Items ({stats.pending} pending)
          </div>
          <div className="divide-y divide-gray-100">
            {picklist.items.map((item) => (
              <button
                key={item.id}
                onClick={() => setActiveItem(item.id)}
                className={`w-full text-left p-4 transition-colors ${
                  activeItem === item.id
                    ? 'bg-brand-50 border-l-4 border-brand-500'
                    : item.status === 'Picked'
                    ? 'bg-emerald-50'
                    : 'hover:bg-gray-50'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{item.product_code}</div>
                    <div className="text-sm text-gray-600 truncate">{item.product_name}</div>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {item.location}
                      </span>
                      <span className="flex items-center gap-1">
                        <Box className="w-3 h-3" />
                        {fmtNum(item.quantity, 0)} {item.uom}
                      </span>
                    </div>
                  </div>
                  <div>
                    {item.status === 'Picked' ? (
                      <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                    ) : (
                      <div className="w-6 h-6 rounded-full border-2 border-gray-300" />
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Active item detail - large touch-friendly UI */}
        <div className="flex-1 flex flex-col bg-white overflow-y-auto">
          {activeItemData ? (
            <div className="p-6 space-y-6">
              {/* Product info */}
              <div className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-2xl p-6 border border-gray-200">
                <div className="text-sm text-gray-500 mb-1">Product</div>
                <div className="text-2xl font-bold text-gray-900 mb-2">{activeItemData.product_code}</div>
                <div className="text-gray-700">{activeItemData.product_name}</div>
                {activeItemData.batch_number && (
                  <div className="mt-3 inline-block px-3 py-1 bg-white rounded-full text-xs font-medium text-gray-600 border border-gray-200">
                    Batch: {activeItemData.batch_number}
                  </div>
                )}
              </div>

              {/* Location - large and prominent */}
              <div className="bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl p-8 text-white shadow-lg">
                <div className="flex items-center gap-2 text-brand-100 text-sm mb-2">
                  <MapPin className="w-5 h-5" />
                  <span className="font-semibold uppercase tracking-wide">Pick Location</span>
                </div>
                <div className="text-5xl font-black tracking-tight">{activeItemData.location}</div>
                {activeItemData.pallet_seq && (
                  <div className="mt-3 text-brand-100 text-lg">Pallet #{activeItemData.pallet_seq}</div>
                )}
              </div>

              {/* Quantity - large */}
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-xl p-5 border border-purple-200">
                  <div className="text-xs text-purple-600 font-semibold uppercase mb-1">Required</div>
                  <div className="text-4xl font-black text-purple-900">{fmtNum(activeItemData.quantity, 0)}</div>
                  <div className="text-sm text-purple-700 mt-1">{activeItemData.uom}</div>
                </div>
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-5 border border-blue-200">
                  <div className="text-xs text-blue-600 font-semibold uppercase mb-1">Pallets</div>
                  <div className="text-4xl font-black text-blue-900">{Math.ceil(activeItemData.pallet)}</div>
                  <div className="text-sm text-blue-700 mt-1">Total</div>
                </div>
              </div>

              {/* Action buttons - large touch targets */}
              {activeItemData.status === 'Pending' ? (
                <div className="space-y-3 pt-4">
                  <button
                    onClick={() => markPicked(activeItemData.id, activeItemData.quantity)}
                    className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-700 hover:to-emerald-600 text-white font-bold text-lg py-6 px-6 rounded-2xl shadow-lg active:scale-95 transition-all flex items-center justify-center gap-3"
                  >
                    <CheckCircle2 className="w-7 h-7" />
                    Confirm Pick - {fmtNum(activeItemData.quantity, 0)} {activeItemData.uom}
                  </button>
                  <button
                    onClick={() => {
                      const qty = prompt(`Enter picked quantity (default: ${activeItemData.quantity}):`, String(activeItemData.quantity));
                      if (qty !== null) markPicked(activeItemData.id, parseFloat(qty) || activeItemData.quantity);
                    }}
                    className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold py-4 px-6 rounded-xl border-2 border-gray-300 active:scale-95 transition-all"
                  >
                    Adjust Quantity
                  </button>
                </div>
              ) : (
                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-6 flex items-center gap-4">
                  <CheckCircle2 className="w-10 h-10 text-emerald-600 flex-shrink-0" />
                  <div>
                    <div className="font-bold text-emerald-900">Item Picked</div>
                    <div className="text-sm text-emerald-700">
                      {fmtNum(activeItemData.picked_quantity || activeItemData.quantity, 0)} {activeItemData.uom}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-gray-400">
              <div className="text-center">
                <Package className="w-16 h-16 mx-auto mb-3 opacity-50" />
                <div>Select an item to start picking</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer - complete button */}
      {stats.pending === 0 && (
        <div className="bg-white border-t border-gray-200 p-4 shadow-lg">
          <button
            onClick={completePicking}
            className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-bold text-lg py-5 px-6 rounded-2xl shadow-md active:scale-95 transition-all flex items-center justify-center gap-3"
          >
            <CheckCircle2 className="w-6 h-6" />
            Complete Picklist
          </button>
        </div>
      )}
    </div>
  );
}
