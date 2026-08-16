import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Plus, RefreshCw, Pencil, UserPlus, Shield, Eye, Lock } from 'lucide-react';
import { api, DEPARTMENTS, Department } from '@/lib/api';
import { fmtDate } from '@/lib/format';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
import { PageHeader } from '@/components/PageHeader';
import { Card, EmptyState } from '@/components/Card';
import Spinner from '@/components/Spinner';
import Modal from '@/components/Modal';
import ConfirmButton from '@/components/ConfirmButton';
import { Field, TextInput, Select, Grid } from '@/components/Field';

interface User {
  id: number;
  username: string;
  full_name: string;
  email: string;
  role: string;
  department?: string;
  is_active: number;
  created_at: string;
}

interface Role {
  key: string;
  label: string;
}

const ROLE_STYLES: Record<string, string> = {
  admin: 'bg-brand-800 text-white border-brand-800',
  operator: 'bg-brand-50 text-brand-700 border-brand-200',
  viewer: 'bg-gray-100 text-gray-600 border-gray-300',
};

const emptyForm = {
  username: '',
  password: '',
  full_name: '',
  email: '',
  role: 'viewer',
  department: 'all',
};

export default function UsersPage() {
  const toast = useToast();
  const { user: me } = useAuth();

  const [rows, setRows] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api('users', 'list');
      setRows(res.rows || []);
      setRoles(res.roles || []);
      setDepartments(res.departments || []);
    } catch (err: any) {
      toast('error', err.message || 'Gagal memuat data user');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm({ ...emptyForm, role: 'viewer', department: 'all' });
    setModalOpen(true);
  };

  const openEdit = (u: User) => {
    setEditing(u);
    setForm({
      username: u.username || '',
      password: '',
      full_name: u.full_name || '',
      email: u.email || '',
      role: u.role || 'viewer',
      department: u.department || 'all',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.username.trim() || !form.full_name.trim()) {
      toast('error', 'Username dan full name wajib diisi');
      return;
    }
    if (!editing && !form.password.trim()) {
      toast('error', 'Password wajib diisi');
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        username: form.username.trim(),
        full_name: form.full_name.trim(),
        email: form.email.trim() || undefined,
        role: form.role,
        department: form.department,
      };
      if (form.password.trim()) payload.password = form.password;
      if (editing) {
        await api('users', 'update', { body: { id: editing.id, ...payload } });
        toast('success', 'User berhasil diperbarui');
      } else {
        await api('users', 'create', { body: payload });
        toast('success', 'User berhasil ditambahkan');
      }
      setModalOpen(false);
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menyimpan user');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: User) => {
    try {
      await api('users', 'update', {
        body: {
          id: u.id,
          username: u.username,
          full_name: u.full_name,
          email: u.email || undefined,
          role: u.role,
          department: u.department || 'all',
          is_active: Number(u.is_active) === 1 ? 0 : 1,
        },
      });
      toast('success', Number(u.is_active) === 1 ? 'User dinonaktifkan' : 'User diaktifkan');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal mengubah status user');
    }
  };

  const handleDelete = async (u: User) => {
    try {
      await api('users', 'delete', { body: { id: u.id } });
      toast('success', 'User dihapus');
      load();
    } catch (err: any) {
      toast('error', err.message || 'Gagal menghapus user');
    }
  };

  const set = (k: keyof typeof emptyForm) => (e: any) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const deptOptions = (departments && departments.length ? departments : DEPARTMENTS) as Array<{ key: string; label: string }>;

  const stats = [
    { label: 'Total User', value: rows.length, icon: UserPlus, grad: 'from-brand-600 to-brand-400' },
    {
      label: 'Admin',
      value: rows.filter((r) => r.role === 'admin').length,
      icon: Shield,
      grad: 'from-emerald-600 to-emerald-400',
    },
    {
      label: 'Viewer',
      value: rows.filter((r) => r.role === 'viewer').length,
      icon: Eye,
      grad: 'from-gray-600 to-gray-400',
    },
  ];

  return (
    <div>
      <PageHeader
        title="User Management"
        subtitle="Kelola akun pengguna sistem"
        actions={
          <>
            <button
              onClick={openCreate}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/15 hover:bg-white/25 text-white text-sm font-semibold border border-white/20"
            >
              <Plus className="w-4 h-4" /> New User
            </button>
            <button
              onClick={() => load()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-white text-sm font-semibold border border-white/20"
            >
              <RefreshCw className="w-4 h-4" /> Refresh
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        {stats.map((k) => (
          <div key={k.label} className={`rounded-xl bg-gradient-to-br ${k.grad} p-4 text-white shadow-sm`}>
            <k.icon className="w-4 h-4 opacity-80" />
            <div className="text-2xl font-extrabold mt-2">{k.value}</div>
            <div className="text-[11px] font-semibold uppercase tracking-wide opacity-85 mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      <Card>
        {loading ? (
          <Spinner label="Memuat user…" />
        ) : rows.length === 0 ? (
          <EmptyState message="Tidak ada data user" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[820px]">
              <thead>
                <tr className="bg-brand-50 text-[11px] uppercase tracking-wider text-brand-700">
                  <th className="px-3 py-2.5 text-left font-bold">Username</th>
                  <th className="px-3 py-2.5 text-left font-bold">Nama Lengkap</th>
                  <th className="px-3 py-2.5 text-left font-bold">Email</th>
                  <th className="px-3 py-2.5 text-left font-bold">Role</th>
                  <th className="px-3 py-2.5 text-left font-bold">Departemen</th>
                  <th className="px-3 py-2.5 text-left font-bold">Dibuat</th>
                  <th className="px-3 py-2.5 text-center font-bold">Status</th>
                  <th className="px-3 py-2.5 text-center font-bold">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map((u) => (
                  <tr key={u.id} className="hover:bg-brand-50/50">
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-brand-700">{u.username}</div>
                      {me?.id === u.id && <span className="text-[10px] text-brand-500 font-bold">(Anda)</span>}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-gray-800">{u.full_name}</td>
                    <td className="px-3 py-2.5 text-gray-600">{u.email || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${ROLE_STYLES[u.role] || ROLE_STYLES.viewer}`}>
                        <Shield className="w-3 h-3" />
                        {u.role}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold border bg-teal-50 text-teal-700 border-teal-200">
                        {(u.department || 'all').toUpperCase()}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-gray-600">{fmtDate(u.created_at)}</td>
                    <td className="px-3 py-2.5 text-center">
                      {Number(u.is_active) === 1 ? (
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
                        <button
                          onClick={() => openEdit(u)}
                          title="Edit"
                          className="p-1.5 rounded-lg bg-brand-50 text-brand-600 hover:bg-brand-100 border border-brand-100"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => toggleActive(u)}
                          title={Number(u.is_active) === 1 ? 'Nonaktifkan' : 'Aktifkan'}
                          className={`p-1.5 rounded-lg border ${
                            Number(u.is_active) === 1
                              ? 'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100'
                              : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {me?.id !== u.id && (
                          <ConfirmButton label="Hapus" onConfirm={() => handleDelete(u)} />
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit User' : 'New User'} size="md">
        <form onSubmit={handleSave} className="space-y-4">
          <Grid cols={2}>
            <Field label="Username" required>
              <TextInput value={form.username} onChange={set('username')} placeholder="Username login" />
            </Field>
            <Field label="Nama Lengkap" required>
              <TextInput value={form.full_name} onChange={set('full_name')} placeholder="Nama lengkap" />
            </Field>
          </Grid>
          <Grid cols={3}>
            <Field label="Email">
              <TextInput type="email" value={form.email} onChange={set('email')} placeholder="email@contoh.com" />
            </Field>
            <Field label="Role">
              <Select value={form.role} onChange={set('role')}>
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Departemen">
              <Select value={form.department} onChange={set('department')}>
                {deptOptions.map((d) => (
                  <option key={d.key} value={d.key}>{d.label}</option>
                ))}
              </Select>
            </Field>
          </Grid>
          <Field label={editing ? 'Password (kosongkan jika tidak diubah)' : 'Password'} required={!editing}>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <TextInput
                type="password"
                value={form.password}
                onChange={set('password')}
                placeholder="Password"
                className="pl-9"
              />
            </div>
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
              <UserPlus className="w-4 h-4" /> {saving ? 'Menyimpan…' : editing ? 'Simpan Perubahan' : 'Tambah User'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
