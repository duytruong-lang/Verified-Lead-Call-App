import { useEffect, useState } from 'react';
import { createRepository } from './adapters/createRepository';
import type { LeadSummary } from './shared/types';

export function App() {
  const [appState] = useState(() => {
    try { return { ...createRepository(), error: '' }; }
    catch (error) { return { mode: null, repository: null, error: error instanceof Error ? error.message : 'Không thể khởi tạo ứng dụng.' }; }
  });
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [selectedLead, setSelectedLead] = useState<LeadSummary | null>(null);
  const modeLabel = appState.mode === 'demo' ? 'Demo dữ liệu giả' : appState.mode === 'supabase' ? 'Supabase' : 'Chưa cấu hình';
  useEffect(() => { if (appState.repository) void appState.repository.listLeads('not_called').then(setLeads).catch(() => setLeads([])); }, [appState]);

  return (
    <main className="shell">
      <header className="topbar"><div className="brand-mark">V</div><div><p className="eyebrow">VERIFIED LEAD CALL</p><h1>Không gian xác minh lead</h1></div><span className="mode-pill">{modeLabel}</span></header>
      <section className="workspace">
        <aside className="queue-panel">
          <div className="queue-heading"><div><p className="eyebrow">HÀNG ĐỢI</p><h2>Lead cần gọi</h2></div><span className="count">{leads.length}</span></div>
          <div className="queue-tabs"><button className="active">Chưa gọi</button><button>Đang xử lý</button><button>Gọi lại</button><button>Đã kết thúc</button></div>
          {leads.length ? <div className="lead-list">{leads.map((lead) => <button className={`lead-card ${selectedLead?.id === lead.id ? 'selected' : ''}`} key={lead.id} onClick={() => setSelectedLead(lead)}><span className="lead-avatar">{lead.displayName?.slice(-2)}</span><span className="lead-meta"><b>{lead.displayName}</b><small>{lead.phone}</small></span><span className="lead-attempt">{lead.attemptCount}/5</span></button>)}</div> : <div className="empty-state"><div className="empty-icon">↗</div><strong>{modeLabel === 'Demo dữ liệu giả' ? 'Chưa có lead trong hàng đợi' : 'Hàng đợi sẵn sàng'}</strong><p>Dữ liệu lead sẽ xuất hiện ở đây khi kết nối nguồn được cấu hình.</p></div>}
        </aside>
        <section className="detail-panel">
          {appState.error ? <div className="config-error"><strong>Cần cấu hình adapter</strong><p>{appState.error}</p><code>Chạy npm run dev:demo hoặc cấu hình Supabase.</code></div> : selectedLead ? <div className="welcome-card"><div className="welcome-orbit">☎</div><p className="eyebrow">{selectedLead.source ?? 'LEAD'}</p><h2>{selectedLead.displayName}</h2><p>{selectedLead.phone}</p><div className="workflow"><span>Đã gọi <b>{selectedLead.attemptCount}/5 lượt</b></span></div></div> : <div className="welcome-card"><div className="welcome-orbit">☎</div><p className="eyebrow">MỘT MÀN HÌNH · MỘT QUY TRÌNH</p><h2>Chọn lead để bắt đầu</h2><p>Gọi bằng điện thoại của bạn, ghi âm bằng micro máy tính và lưu kết quả tại cùng một nơi.</p><div className="workflow"><span>01 <b>Chọn lead</b></span><i>→</i><span>02 <b>Ghi âm</b></span><i>→</i><span>03 <b>Lưu kết quả</b></span></div></div>}
          <footer className="footer-note"><span className="status-dot" /> App state là nguồn nghiệp vụ chính · Đồng bộ Sheet nền</footer>
        </section>
      </section>
    </main>
  );
}
