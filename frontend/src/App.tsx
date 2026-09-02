import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Upscaler from './pages/Upscaler';
import Dashboard from './pages/Dashboard';
import AuthModal from './components/AuthModal';
import { getCurrentUser, User } from './services/authService';
import { checkAllServers } from './services/serverPool';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAuth, setShowAuth] = useState(false);

  // Check auth on mount
  useEffect(() => {
    checkAuth();
    checkAllServers(); // Initialize server health checks
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

  function handleAuth() {
    checkAuth();
    setShowAuth(false);
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950">
        <div className="text-center">
          <div className="mb-4 inline-block h-12 w-12 animate-spin rounded-full border-4 border-purple-500 border-t-transparent" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={<Landing onAuth={() => setShowAuth(true)} />}
        />
        <Route
          path="/upscale"
          element={
            <Upscaler
              user={user}
              onShowAuth={() => setShowAuth(true)}
            />
          }
        />
        <Route
          path="/dashboard"
          element={
            user ? (
              <Dashboard user={user} onRefresh={checkAuth} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <AuthModal
        isOpen={showAuth}
        onClose={() => setShowAuth(false)}
        onAuth={handleAuth}
      />
    </BrowserRouter>
  );
}
