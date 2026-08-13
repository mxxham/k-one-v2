import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Warehouse, Lock, User, AlertCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) {
    navigate('/');
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login gagal');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#012d2c] via-brand-700 to-brand-500 p-4">
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 pt-8 pb-6 bg-gradient-to-br from-[#0d1f1f] to-brand-800 text-white text-center">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mb-3">
              <Warehouse className="w-7 h-7" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight">K-one</h1>
            <p className="text-white/60 text-xs mt-1 uppercase tracking-widest">Warehouse Management System</p>
          </div>

          <form onSubmit={handleSubmit} className="p-8">
            {error && (
              <div className="mb-4 flex items-center gap-2 px-3 py-2.5 rounded-lg bg-red-50 text-red-700 text-sm border border-red-200">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </div>
            )}

            <label className="block text-xs font-semibold text-gray-600 mb-1">Username</label>
            <div className="relative mb-4">
              <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border-[1.5px] border-gray-300 rounded-lg text-sm focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 outline-none"
                autoFocus
              />
            </div>

            <label className="block text-xs font-semibold text-gray-600 mb-1">Password</label>
            <div className="relative mb-6">
              <Lock className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full pl-9 pr-3 py-2.5 border-[1.5px] border-gray-300 rounded-lg text-sm focus:border-brand-500 focus:ring-[3px] focus:ring-brand-500/15 outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-brand-600 hover:bg-brand-700 text-white font-semibold text-sm transition disabled:opacity-60"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>

            <div className="mt-4 text-center text-[11px] text-gray-400">
              Default: <span className="font-semibold">admin / admin123</span>
            </div>
          </form>
        </div>
        <p className="text-center text-white/50 text-xs mt-4">K-one — Warehouse Management · v1.0.0</p>
      </div>
    </div>
  );
}
