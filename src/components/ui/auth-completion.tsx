import { useState } from 'react';
import { ArrowRight, KeyRound, LockKeyhole, RotateCcw } from 'lucide-react';
import { BrandLogo } from './brand-logo';

export function AuthCompletion({ busy = false, error, onComplete }: { busy?: boolean; error?: string; onComplete: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLocalError('');
    if (password.length < 12) { setLocalError('Mật khẩu cần có ít nhất 12 ký tự.'); return; }
    if (password !== confirmPassword) { setLocalError('Hai mật khẩu chưa khớp.'); return; }
    setSaving(true);
    try { await onComplete(password); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Không thể cập nhật mật khẩu. Vui lòng thử lại.'); }
    finally { setSaving(false); }
  }

  return <main className="auth-screen"><section className="auth-card auth-card-clean" aria-labelledby="auth-completion-title">
    <div className="auth-brand-lockup"><BrandLogo className="brand-logo-auth" /></div>
    <p className="overline">HOÀN TẤT TÀI KHOẢN</p><h1 id="auth-completion-title">Tạo mật khẩu</h1><p className="auth-intro">Chọn mật khẩu mới để mở workspace.</p>
    <form className="auth-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="new-password">Mật khẩu mới</label><div className="auth-input-wrap"><KeyRound size={18} aria-hidden="true" /><input autoComplete="new-password" id="new-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /></div>
      <label htmlFor="confirm-password">Nhập lại mật khẩu</label><div className="auth-input-wrap"><LockKeyhole size={18} aria-hidden="true" /><input autoComplete="new-password" id="confirm-password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} minLength={12} required /></div>
      {(localError || error) && <p className="auth-error" role="alert">{localError || error}</p>}
      <button className="primary auth-submit" type="submit" disabled={busy || saving}>{busy || saving ? <><RotateCcw className="spin" size={17} /> Đang cập nhật</> : <>Lưu mật khẩu <ArrowRight size={17} /></>}</button>
    </form>
  </section></main>;
}
