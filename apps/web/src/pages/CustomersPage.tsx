import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Search, Plus, RefreshCw, Pencil, Users, Building2, MapPin, FileSpreadsheet } from 'lucide-react';
import { api, apiHref } from '@/lib/api';
import { WebBtn } from '@/components/WebBtn';
import { fmtNum } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import Spinner from '@/components/Spinner';
import Modal from '@/components/Modal';
import Pagination from '@/components/Pagination';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput, TextArea, Grid } from '@/components/Field';

interface Customer {
  id: number;
  customer_code: string;
  customer_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  is_active: number;
}

const PER_PAGE = 25;

const emptyForm = {
  customer_code: '',
  customer_name: '',
  contact_person: '',
  phone: '',
  email: '',
  address: '',
  city: '',
};

export default function CustomersPage() {
  const toast = useToast();
  const { canWrite } = useAuth();

  const [rows, setRows] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeStats, setTypeStats] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('customers', 'list', { params: { search, page, per_page: PER_PAGE } });
      setRows(res.rows || []);
      setTotal(Number(res.total) || 0);
      setTypeStats(res.type_stats || {});
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat data customer');
    } finally {
      setLoading(false);
    }
  }, [search, page, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditing(c);
    setForm({
      customer_code: c.customer_code || '',
      customer_name: c.customer_name || '',
      contact_person: c.contact_person || '',
      phone: c.phone || '',
      email: c.email || '',
      address: c.address || '',
      city: c.city || '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.customer_code.trim() || !form.customer_name.trim()) {
      toast('error', 'Kode dan nama customer wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        contact_person: form.contact_person || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        address: form.address || undefined,
        city: form.city || undefined,
      };
      if (editing) {
        await api('customers', 'update', { body: { id: editing.id, ...payload } });
        toast('success', 'Customer berhasil diperbarui');
      } else {
        await api('customers', 'create', { body: payload });
        toast('success', 'Customer berhasil ditambahkan');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan customer');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (c: Customer) => {
    try {
      await api('customers', 'delete', { body: { id: c.id } });
      toast('success', 'Customer dihapus');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus customer');
    }
  };

  const set = (k: keyof typeof emptyForm) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const statsCards = [
    { label: 'Total', value: total, icon: Users, grad: 'from-brand-600 to-brand-400' },
    { label: 'Active', value: typeStats['Active'] || 0, icon: Building2, grad: 'from-emerald-600 to-emerald-400' },
    { label: 'Inactive', value: typeStats['Inactive'] || 0, icon: MapPin, grad: 'from-gray-600 to-gray-400' },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Master data customer"
        actions={
          <>
            <WebBtn
              href={apiHref('export', 'customers')}
              label="Export Excel"
              tone="dark"
              icon={<FileSpreadsheet className="w-4 h-4" />}
            />
            {canWrite && (
              <button
                onClick={openCreate}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
              >
                <Plus className="w-4 h-4" /> New Customer
              </button>
            )}
            <button
              onClick={() => { setPage(1); load(); }}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {statsCards.map((k) => (
          <div key={k.label} className={`rounded-xl bg-gradient-to-br ${k.grad} p-4 text-white shadow-sm`}>
            <k.icon className="w-4 h-4 opacity-80" />
            <div className="text-2xl font-extrabold mt-2">{fmtNum(k.value, 0)}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      <Card>
        <div className="mb-4">
          <form onSubmit={handleSearch} className="flex items-end gap-3 flex-wrap">
            <div className="w-full md:w-80">
              <Field label="Cari Customer">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <TextInput
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Kode, nama, atau kota…"
                    className="pl-9"
                  />
                </div>
              </Field>
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-semibold hover:bg-brand-700 inline-flex items-center gap-2"
            >
              <Search className="w-4 h-4" /> Cari
            </button>
          </form>
        </div>

        {loading ? (
          <Spinner label="Memuat customer…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Tidak ada data customer" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                    <th className="px-3 py-2.5 text-left font-bold">Kode</th>
                    <th className="px-3 py-2.5 text-left font-bold">Nama Customer</th>
                    <th className="px-3 py-2.5 text-left font-bold">Kontak</th>
                    <th className="px-3 py-2.5 text-left font-bold">Telepon</th>
                    <th className="px-3 py-2.5 text-left font-bold">Email</th>
                    <th className="px-3 py-2.5 text-left font-bold">Kota</th>
                    <th className="px-3 py-2.5 text-center font-bold">Status</th>
                    <th className="px-3 py-2.5 text-center font-bold">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((c) => (
                    <tr key={c.id} className="hover:bg-brand-50/50">
                      <td className="px-3 py-2.5 font-semibold text-brand-700">{c.customer_code}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-gray-800">{c.customer_name}</div>
                        {c.address && <div className="text-xs text-gray-400 max-w-[240px] truncate">{c.address}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600">{c.contact_person || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{c.phone || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{c.email || '—'}</td>
                      <td className="px-3 py-2.5 text-gray-600">{c.city || '—'}</td>
                      <td className="px-3 py-2.5 text-center">
                        {Number(c.is_active) === 1 ? (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-emerald-50 text-emerald-700 border-emerald-300">
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-gray-100 text-gray-600 border-gray-300">
                            Inactive
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-center gap-1.5">
                          {canWrite && (
                            <button
                              onClick={() => openEdit(c)}
                              title="Edit"
                              className="p-1.5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 border border-brand-100"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {canWrite && (
                            <ConfirmButton label="Hapus" onConfirm={() => handleDelete(c)} />
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 mt-4 border-t border-gray-100 pt-4 flex-wrap">
              <Pagination page={page} totalPages={totalPages} total={total} onChange={setPage} />
            </div>
          </>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Customer' : 'New Customer'} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <Grid cols={2}>
            <Field label="Kode Customer" required>
              <TextInput value={form.customer_code} onChange={set('customer_code')} placeholder="Contoh: CUST-001" />
            </Field>
            <Field label="Nama Customer" required>
              <TextInput value={form.customer_name} onChange={set('customer_name')} placeholder="Nama customer" />
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Contact Person">
              <TextInput value={form.contact_person} onChange={set('contact_person')} placeholder="Nama kontak" />
            </Field>
            <Field label="Telepon">
              <TextInput value={form.phone} onChange={set('phone')} placeholder="No. telepon" />
            </Field>
          </Grid>
          <Grid cols={2}>
            <Field label="Email">
              <TextInput type="email" value={form.email} onChange={set('email')} placeholder="email@contoh.com" />
            </Field>
            <Field label="Kota">
              <TextInput value={form.city} onChange={set('city')} placeholder="Kota" />
            </Field>
          </Grid>
          <Field label="Alamat">
            <TextArea rows={2} value={form.address} onChange={set('address')} placeholder="Alamat lengkap (opsional)" />
          </Field>
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 rounded-lg bg-gray-100 text-gray-600 text-sm font-semibold hover:bg-gray-200"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold disabled:opacity-60"
            >
              <Users className="w-4 h-4" /> {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Tambah Customer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
