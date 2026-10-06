import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, RotateCcw } from 'lucide-react';
import { BrandLogo } from './brand-logo';

type CleanMinimalSignInProps = {
  demo?: boolean;
  busy?: boolean;
  error?: string;
  success?: string;
  onSignIn: (email: string, password: string) => Promise<void>;
};

export function CleanMinimalSignIn({ demo = false, busy = false, error, success, onSignIn }: CleanMinimalSignInProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitError('');
    setSubmitting(true);
    try {
      await onSignIn(email.trim(), password);
    } catch (cause) {
      setSubmitError(cause instanceof Error ? cause.message : 'Không thể đăng nhập. Vui lòng thử lại.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card auth-card-clean" aria-labelledby="sign-in-title">
        <div className="auth-brand-lockup"><BrandLogo className="brand-logo-auth" /></div>
        <p className="overline">VERIFIED CALL WORKSPACE</p>
        <h1 id="sign-in-title">Đăng nhập</h1>
        <p className="auth-intro">Dùng tài khoản công việc để mở hàng đợi xác minh lead.</p>
        {demo && <div className="local-banner" role="note">DEMO · Dữ liệu tổng hợp, chỉ lưu trên trình duyệt này</div>}
        {success && <p className="auth-success" role="status">{success}</p>}
        <form className="auth-form" onSubmit={(event) => void submit(event)}>
          <label htmlFor="auth-email">Email công việc</label>
          <div className="auth-input-wrap"><Mail aria-hidden="true" size={18} /><input autoComplete="username" id="auth-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="ten@congty.vn" required /></div>
          <label htmlFor="auth-password">Mật khẩu</label>
          <div className="auth-input-wrap"><LockKeyhole aria-hidden="true" size={18} /><input autoComplete="current-password" id="auth-password" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required /><button className="password-visibility" type="button" aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div>
          <button className="primary auth-submit" type="submit" disabled={busy || submitting}>
            {busy || submitting ? <><RotateCcw className="spin" size={17} aria-hidden="true" /> Đang đăng nhập</> : <>Đăng nhập <ArrowRight size={17} aria-hidden="true" /></>}
          </button>
        </form>
        {(submitError || error) && <p className="auth-error" role="alert">{submitError || error}</p>}
        <p className="auth-recovery">Không nhớ mật khẩu? Liên hệ quản trị viên để nhận liên kết khôi phục.</p>
      </section>
    </main>
  );
}
