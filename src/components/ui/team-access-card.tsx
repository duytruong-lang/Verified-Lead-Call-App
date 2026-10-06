import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Copy, KeyRound, Link2, LoaderCircle, MailPlus, Trash2 } from 'lucide-react';
import type { MemberLink, MemberRole, MemberStatus, TeamMember, UUID } from '@/shared/types';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Drawer, DrawerContent, DrawerFooter, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type TeamAccessCardProps = {
  members: TeamMember[];
  currentMemberId?: UUID;
  currentMemberEmail?: string;
  busy?: boolean;
  error?: string;
  onInvite: (email: string, role: MemberRole) => Promise<MemberLink>;
  onRoleChange: (memberId: UUID, role: MemberRole) => Promise<TeamMember>;
  onStatusChange: (memberId: UUID, status: Exclude<MemberStatus, 'pending'>) => Promise<TeamMember>;
  onIssueLink: (memberId: UUID, kind: MemberLink['kind']) => Promise<MemberLink>;
  onClose: () => void;
  className?: string;
};

const statusLabels: Record<MemberStatus, string> = { pending: 'Chờ tham gia', active: 'Đang hoạt động', disabled: 'Đã vô hiệu hóa' };
const nameOf = (member: TeamMember) => member.displayName?.trim() || member.email.split('@')[0];

export function TeamAccessCard({ members, currentMemberId, currentMemberEmail, busy = false, error, onInvite, onRoleChange, onStatusChange, onIssueLink, onClose, className }: TeamAccessCardProps) {
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(true);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('staff');
  const [localError, setLocalError] = useState('');
  const [working, setWorking] = useState<string | null>(null);
  const [link, setLink] = useState<MemberLink | null>(null);
  const [expiredLinkTarget, setExpiredLinkTarget] = useState<{ memberId: UUID; kind: MemberLink['kind'] } | null>(null);
  const [inviteNeedsResend, setInviteNeedsResend] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');
  const pending = busy || Boolean(working);
  const isSelf = (member: TeamMember) => currentMemberId ? member.id === currentMemberId : Boolean(currentMemberEmail && member.email.toLowerCase() === currentMemberEmail.toLowerCase());

  function close() { setOpen(false); onClose(); }
  async function invite() {
    setLocalError(''); setWorking('invite');
    try { setLink(await onInvite(email.trim(), role)); setStatus('Đã tạo liên kết mời. Hãy sao chép và gửi cho thành viên.'); setEmail(''); setInviteOpen(false); }
    catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Không thể tạo lời mời.');
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
      if (code === 'LINK_EXPIRED' || code === 'LINK_REPLACED') setInviteNeedsResend(true);
    }
    finally { setWorking(null); }
  }
  async function updateRole(member: TeamMember, nextRole: MemberRole) {
    if (nextRole === member.role) return;
    setLocalError(''); setWorking(`role:${member.id}`);
    try { await onRoleChange(member.id, nextRole); setStatus(`Đã cập nhật quyền của ${member.email}.`); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Không thể cập nhật quyền.'); }
    finally { setWorking(null); }
  }
  async function updateStatus(member: TeamMember, nextStatus: 'active' | 'disabled') {
    if (nextStatus === 'disabled' && !window.confirm(`Thu hồi quyền truy cập của ${member.email}? Họ sẽ mất quyền truy cập workspace.`)) return;
    setLocalError(''); setWorking(`status:${member.id}`);
    try { await onStatusChange(member.id, nextStatus); setStatus(nextStatus === 'disabled' ? `Đã vô hiệu hóa ${member.email}.` : `Đã kích hoạt ${member.email}.`); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Không thể đổi trạng thái thành viên.'); }
    finally { setWorking(null); }
  }
  async function issueLink(member: TeamMember, kind: MemberLink['kind']) {
    setLocalError(''); setExpiredLinkTarget(null); setWorking(`link:${member.id}`);
    try { setLink(await onIssueLink(member.id, kind)); setStatus(kind === 'invite' ? `Đã tạo lại liên kết mời cho ${member.email}.` : `Đã tạo liên kết khôi phục cho ${member.email}.`); }
    catch (cause) {
      const code = cause && typeof cause === 'object' && 'code' in cause ? String(cause.code) : '';
      setLocalError(cause instanceof Error ? cause.message : 'Không thể tạo liên kết.');
      if (code === 'LINK_EXPIRED' || code === 'LINK_REPLACED') {
        setLink(null);
        setExpiredLinkTarget({ memberId: member.id, kind });
      }
    }
    finally { setWorking(null); }
  }
  async function copyLink() {
    if (!link) return;
    try { await navigator.clipboard.writeText(link.actionLink); setCopied(true); window.setTimeout(() => setCopied(false), 1800); }
    catch { setLocalError('Không thể sao chép liên kết. Hãy kiểm tra quyền clipboard của trình duyệt.'); }
  }

  if (!open) return null;
  return <Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}><DialogContent className={cn('team-dialog-content', className)}>
    <DialogTitle className="sr-only">Thành viên workspace</DialogTitle><DialogDescription className="sr-only">Quản lý quyền và trạng thái tài khoản trong workspace này.</DialogDescription>
    <Card className="team-access-card">
      <CardHeader className="team-card-header"><div><p className="overline">QUẢN TRỊ QUYỀN TRUY CẬP</p><CardTitle id="team-access-title">Thành viên workspace</CardTitle><CardDescription>Quản lý quyền và trạng thái tài khoản trong workspace này.</CardDescription></div></CardHeader>
      {(error || localError) && <p className="admin-error" role="alert">{localError || error}</p>}
      {status && <p className="admin-status" role="status">{status}</p>}
      <CardContent className="team-member-list">
        {members.map((member) => <motion.article className="team-member" key={member.id} layout={!reduceMotion} initial={reduceMotion ? false : { opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} transition={reduceMotion ? { duration: 0 } : { duration: 0.16, ease: 'easeOut' }}>
          <Avatar className="team-avatar"><AvatarFallback>{nameOf(member).slice(0, 1).toUpperCase()}</AvatarFallback></Avatar>
          <div className="team-member-info"><strong>{nameOf(member)}{isSelf(member) && <span className="you-tag">Bạn</span>}</strong><span>{member.email}</span><small className={`member-status status-${member.status}`}><i />{statusLabels[member.status]}</small></div>
          <div className="team-member-actions">
            {member.status !== 'disabled' && <Select value={member.role} onValueChange={(value) => void updateRole(member, value as MemberRole)} disabled={pending || isSelf(member) || member.status === 'pending'}><SelectTrigger aria-label={`Quyền của ${member.email}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="admin">Quản trị viên</SelectItem><SelectItem value="staff">Nhân viên</SelectItem><SelectItem value="viewer">Chỉ xem</SelectItem></SelectContent></Select>}
            {member.status === 'pending' && <Button variant="outline" disabled={pending} onClick={() => void issueLink(member, 'invite')}><Link2 size={16} /> {expiredLinkTarget?.memberId === member.id && expiredLinkTarget.kind === 'invite' ? 'Tạo link mới' : 'Gửi lại link'}</Button>}
            {member.status === 'active' && member.id !== currentMemberId && <Button variant="outline" disabled={pending} onClick={() => void issueLink(member, 'recovery')} aria-label={expiredLinkTarget?.memberId === member.id && expiredLinkTarget.kind === 'recovery' ? `Tạo link mới cho ${member.email}` : `Tạo link khôi phục cho ${member.email}`}><KeyRound size={16} /><span>{expiredLinkTarget?.memberId === member.id && expiredLinkTarget.kind === 'recovery' ? 'Tạo link mới' : 'Khôi phục'}</span></Button>}
            {member.status === 'disabled' ? <Button variant="outline" disabled={pending || isSelf(member)} onClick={() => void updateStatus(member, 'active')}>Kích hoạt</Button> : !isSelf(member) && <Button variant="ghost" size="icon" disabled={pending} onClick={() => void updateStatus(member, 'disabled')} aria-label={`Thu hồi quyền truy cập của ${member.email}`}><Trash2 size={17} /></Button>}
            {working === `role:${member.id}` || working === `status:${member.id}` || working === `link:${member.id}` ? <LoaderCircle size={16} className="spin" aria-label="Đang cập nhật" /> : null}
          </div>
        </motion.article>)}
        {!members.length && <p className="team-empty">Chưa có thành viên.</p>}
      </CardContent>
      {link && <CardFooter className="member-link-card"><div className="member-link-heading"><Check size={17} /><div><strong>Liên kết {link.kind === 'invite' ? 'mời tham gia' : 'khôi phục mật khẩu'}</strong><span>Hết hạn {new Date(link.expiresAt).toLocaleString('vi-VN')}</span></div></div><div className="member-link-copy"><Input readOnly aria-label="Liên kết dùng một lần" value={link.actionLink} onFocus={(event) => event.currentTarget.select()} /><Button onClick={() => void copyLink()}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? 'Đã sao chép' : 'Sao chép'}</Button></div><small>Liên kết chỉ hiển thị tạm thời trong phiên này. Gửi qua kênh nội bộ phù hợp.</small></CardFooter>}
      <CardFooter className="team-card-footer"><Drawer open={inviteOpen} onOpenChange={(next) => { if (!pending) { setInviteOpen(next); if (!next && !link) setLocalError(''); } }}><DrawerTrigger asChild><Button disabled={pending}><MailPlus size={17} /> Mời thành viên</Button></DrawerTrigger><DrawerContent><DrawerHeader><DrawerTitle>Mời thành viên vào workspace</DrawerTitle><p>Quản trị viên tạo tài khoản thủ công. Liên kết mời dùng một lần.</p></DrawerHeader><div className="team-invite-fields"><label htmlFor="team-invite-email">Email công việc</label><Input autoComplete="email" id="team-invite-email" type="email" placeholder="ten@congty.vn" value={email} onChange={(event) => { setEmail(event.target.value); setInviteNeedsResend(false); }} /><label htmlFor="team-invite-role">Quyền truy cập</label><Select value={role} onValueChange={(value) => { setRole(value as MemberRole); setInviteNeedsResend(false); }}><SelectTrigger id="team-invite-role"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="staff">Nhân viên</SelectItem><SelectItem value="viewer">Chỉ xem</SelectItem><SelectItem value="admin">Quản trị viên</SelectItem></SelectContent></Select>{(localError || error) && <p className="admin-error" role="alert">{inviteNeedsResend ? 'Liên kết trước đã hết hạn hoặc được thay thế. Đóng biểu mẫu, tìm thành viên đang chờ và chọn “Gửi lại link”.' : localError || error}</p>}</div><DrawerFooter>{inviteNeedsResend ? <Button variant="outline" onClick={() => { setInviteNeedsResend(false); setInviteOpen(false); }}>Mở danh sách thành viên</Button> : <Button disabled={!email.includes('@') || pending} onClick={() => void invite()}>{working === 'invite' ? <><LoaderCircle size={16} className="spin" /> Đang tạo lời mời</> : 'Tạo liên kết mời'}</Button>}</DrawerFooter></DrawerContent></Drawer><Button variant="ghost" onClick={close}>Đóng</Button></CardFooter>
    </Card>
  </DialogContent></Dialog>;
}
