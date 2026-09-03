import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Upscaler from './pages/Upscaler';
import Dashboard from './pages/Dashboard';
import Pricing from './pages/Pricing';
import Admin from './pages/Admin';
import Checkout from './pages/Checkout';
import Login from './pages/Login';
import Signup from './pages/Signup';
import { ToastProvider } from './contexts/ToastContext';
import { getCurrentUser } from './services/authService';
import { loadTierConfigs } from './services/creditService';
import type { User } from './lib/supabase';
import { checkAllServers } from './services/serverPool';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
    checkAllServers();
    loadTierConfigs();
  }, []);

  async function checkAuth() {
    try {
      const currentUser = await getCurrentUser();
      setUser(currentUser);
    } catch (err) {
      console.error('Auth check failed:', err);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="text-center">
          <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-4 border-green-500 border-t-transparent" />
          <p className="text-gray-400">Loading PixelBoost...</p>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Landing user={user} />} />
          <Route path="/upscale" element={<Upscaler user={user} />} />
          <Route path="/pricing" element={<Pricing user={user} />} />
          <Route path="/checkout" element={<Checkout user={user} />} />
          <Route path="/login" element={<Login user={user} />} />
          <Route path="/signup" element={<Signup user={user} />} />
          <Route path="/dashboard" element={user ? <Dashboard user={user} onRefresh={checkAuth} /> : <Navigate to="/login" replace />} />
          <Route path="/admin" element={<Admin user={user} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}
