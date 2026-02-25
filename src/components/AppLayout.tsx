'use client';

import { useState } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from '@/components/Sidebar';

export default function AppLayout({
  children,
  locale
}: {
  children: React.ReactNode;
  locale: string;
}) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  return (
    <div className="layout-container" style={{ flexDirection: 'column', width: '100%', height: '100vh', overflow: 'hidden' }}>
      {/* Mobile Top Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '1rem',
          background: 'var(--bg-glass)',
          backdropFilter: 'blur(16px)',
          borderBottom: '1px solid var(--glass-border)',
          zIndex: 40,
        }}
        className="mobile-header"
      >
        <button
          onClick={() => setIsSidebarOpen(true)}
          style={{
            padding: '0.5rem',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
          aria-label="Open menu"
        >
          <Menu size={24} />
        </button>
        <h2 style={{ margin: '0 0 0 1rem', fontSize: '1.25rem', fontWeight: 600, color: 'var(--text-primary)' }}>
          Fusionista
        </h2>
      </div>



      <div className="layout-flex-row" style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <Sidebar
          locale={locale}
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
        />
        <main className="page-container" style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </main>
      </div>
    </div>
  );
}
