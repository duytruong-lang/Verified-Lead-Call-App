import { clients, json, requireIdentity } from '../_shared/http.ts';
import { decryptMemberToken, encryptMemberToken, inputFingerprint, isMemberRole, memberActionLink, normalizeTeamEmail } from '../_shared/team-links.ts';

type LinkKind = 'invite' | 'recovery';
type MemberRow = {
  id: string;
  auth_user_id: string | null;
  email: string;
  display_name: string | null;
  role: 'admin' | 'staff' | 'viewer';
  status: 'pending' | 'active' | 'disabled';
  version: number;
  created_at: string;
};
type SessionMember = {
  member_id: string;
  email: string;
  display_name: string | null;
  role: 'admin' | 'staff' | 'viewer';
  status: 'pending' | 'active' | 'disabled';
};

const errorStatus: Record<string, number> = {
  authentication_required: 401,
  admin_required: 403,
  active_member_required: 403,
  membership_pending: 403,
  member_disabled: 403,
  invitation_not_verified: 403,
  invitation_identity_mismatch: 403,
  member_not_pending: 409,
  member_link_not_allowed: 409,
  member_email_already_exists: 409,
  auth_user_already_member: 409,
  member_auth_identity_conflict: 409,
  member_version_conflict: 409,
  last_admin_required: 409,
  self_role_change_forbidden: 409,
  self_status_change_forbidden: 409,
  invitation_acceptance_required: 409,
  member_link_in_progress: 409,
  member_link_uncertain: 409,
  member_link_expired: 409,
  member_link_replaced: 409,
  idempotency_key_reused: 409,
};

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return json({}, 200);
  if (request.method !== 'POST') return json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'POST required.' } }, 405);

  try {
    const { user, service } = clients(request);
    const identity = await requireIdentity(user);
    const body = await request.json() as Record<string, unknown>;
    const operation = body.operation;
    let result: unknown;

    switch (operation) {
      case 'get-session': {
        const context = await sessionMember(service, identity.id);
        result = { actor: context ? {
          id: identity.id, memberId: context.member_id, role: context.role,
          status: context.status, email: context.email, displayName: context.display_name,
        } : null };
        break;
      }
      case 'list-members': {
        const members = await adminMembers(service, identity.id);
        result = { members: members.map(toMember) };
        break;
      }
      case 'invite-member': {
        const email = normalizeTeamEmail(body.email);
        if (!isMemberRole(body.role)) throw new Error('member_role_invalid');
        const key = requireIdempotencyKey(body.idempotencyKey);
        const inputHash = await inputFingerprint({ operation, email, role: body.role });
        const member = await rpc<MemberRow>(service, 'team_reserve_invitation', {
          p_actor_id: identity.id, p_email: email, p_role: body.role, p_key: key, p_input_hash: inputHash,
        });
        result = await issueLink({ service, actorId: identity.id, member, kind: 'invite', key, inputHash, createAuthUser: true });
        break;
      }
      case 'issue-member-link': {
        const memberId = requireId(body.memberId, 'member_id_invalid');
        const kind = body.kind;
        if (kind !== 'invite' && kind !== 'recovery') throw new Error('member_link_kind_invalid');
        const key = requireIdempotencyKey(body.idempotencyKey);
        const members = await adminMembers(service, identity.id);
        const member = members.find((row) => row.id === memberId);
        if (!member) throw new Error('member_not_found');
        const inputHash = await inputFingerprint({ operation, memberId, kind });
        result = await issueLink({ service, actorId: identity.id, member, kind, key, inputHash, createAuthUser: false });
        break;
      }
      case 'set-member-role': {
        const memberId = requireId(body.memberId, 'member_id_invalid');
        if (!isMemberRole(body.role)) throw new Error('member_role_invalid');
        const expectedVersion = requireVersion(body.expectedVersion);
        const key = requireIdempotencyKey(body.idempotencyKey);
        const inputHash = await inputFingerprint({ operation, memberId, role: body.role, expectedVersion });
        const member = await rpc<MemberRow>(service, 'team_set_member_role', {
          p_actor_id: identity.id, p_member_id: memberId, p_role: body.role,
          p_expected_version: expectedVersion, p_key: key, p_input_hash: inputHash,
        });
        result = toMember(member);
        break;
      }
      case 'set-member-status': {
        const memberId = requireId(body.memberId, 'member_id_invalid');
        if (body.status !== 'active' && body.status !== 'disabled') throw new Error('member_status_invalid');
        const expectedVersion = requireVersion(body.expectedVersion);
        const key = requireIdempotencyKey(body.idempotencyKey);
        const inputHash = await inputFingerprint({ operation, memberId, status: body.status, expectedVersion });
        const member = await rpc<MemberRow>(service, 'team_set_member_status', {
          p_actor_id: identity.id, p_member_id: memberId, p_status: body.status,
          p_expected_version: expectedVersion, p_key: key, p_input_hash: inputHash,
        });
        result = toMember(member);
        break;
      }
      case 'complete-onboarding': {
        const password = body.password;
        if (typeof password !== 'string' || password.length < 8 || password.length > 256) throw new Error('password_invalid');
        const context = await memberContext(service, identity.id);
        if (context.email.toLowerCase() !== identity.email.toLowerCase()) throw new Error('invitation_identity_mismatch');
        if (context.status === 'disabled') throw new Error('member_disabled');
        if (context.status !== 'pending' && context.status !== 'active') throw new Error('active_member_required');
        const { error: passwordError } = await service.auth.admin.updateUserById(identity.id, { password });
        if (passwordError) throw new Error(mapAuthError(passwordError.message));
        const member = await rpc<MemberRow>(service, 'team_activate_pending_member', { p_auth_user_id: identity.id });
        result = { member: toMember(member) };
        break;
      }
      default:
        throw new Error('unknown_operation');
    }

    return json({ data: result });
  } catch (error) {
    return safeError(error);
  }
});

async function issueLink(args: {
  service: ReturnType<typeof clients>['service'];
  actorId: string;
  member: MemberRow;
  kind: LinkKind;
  key: string;
  inputHash: string;
  createAuthUser: boolean;
}): Promise<{ member: ReturnType<typeof toMember>; kind: LinkKind; actionLink: string; expiresAt: string }> {
  const { service, actorId, member, kind, key, inputHash, createAuthUser } = args;
  if (kind === 'invite' && member.status !== 'pending') throw new Error('member_link_not_allowed');
  if (kind === 'recovery' && member.status !== 'active') throw new Error('member_link_not_allowed');

  const leaseToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + linkTtlSeconds() * 1000).toISOString();
  // Keep a member-wide quarantine past the link lifetime if generateLink's
  // response is lost after Auth accepts it; a second request could invalidate it.
  const uncertainUntil = new Date(Date.parse(expiresAt) + 60_000).toISOString();
  const reservation = await rpc<{ state: 'generate' | 'ready'; ciphertext?: string; expiresAt?: string }>(service, 'team_begin_member_link', {
    p_actor_id: actorId, p_member_id: member.id, p_kind: kind, p_key: key, p_input_hash: inputHash,
    p_lease_token: leaseToken, p_uncertain_until: uncertainUntil,
  });
  if (reservation.state === 'ready' && reservation.ciphertext && reservation.expiresAt) {
    const tokenHash = await decryptMemberToken(reservation.ciphertext, requiredSecret('TEAM_LINK_ENCRYPTION_KEY'));
    return { member: toMember(member), kind, actionLink: memberActionLink(appUrl(), tokenHash, kind), expiresAt: reservation.expiresAt };
  }

  let authUserId = member.auth_user_id;
  if (createAuthUser && !authUserId) {
    const existing = await findAuthUser(service, member.email);
    if (existing) {
      if (Date.parse(existing.created_at) < Date.parse(member.created_at)) throw new Error('auth_user_already_member');
      authUserId = existing.user_id;
    }
  }

  let tokenHash: string;
  if (authUserId) {
    const generated = await generateLink(service, kind, member.email);
    if (generated.userId && generated.userId !== authUserId) throw new Error('member_auth_identity_conflict');
    tokenHash = generated.tokenHash;
  } else {
    const generated = await generateLink(service, kind, member.email);
    if (kind === 'invite' && !generated.userId) throw new Error('auth_invitation_failed');
    authUserId = generated.userId;
    tokenHash = generated.tokenHash;
  }

  if (kind === 'invite' && authUserId) {
    await rpc<MemberRow>(service, 'team_bind_auth_user', {
      p_actor_id: actorId, p_member_id: member.id, p_auth_user_id: authUserId,
    });
  }

  const secret = requiredSecret('TEAM_LINK_ENCRYPTION_KEY');
  const ciphertext = await encryptMemberToken(tokenHash, secret);
  const savedMember = await rpc<MemberRow>(service, 'team_save_member_link', {
    p_actor_id: actorId, p_member_id: member.id, p_kind: kind, p_key: key,
    p_input_hash: inputHash, p_lease_token: leaseToken, p_ciphertext: ciphertext, p_expires_at: expiresAt,
  });
  return { member: toMember(savedMember), kind, actionLink: memberActionLink(appUrl(), tokenHash, kind), expiresAt };
}

async function generateLink(service: ReturnType<typeof clients>['service'], kind: LinkKind, email: string): Promise<{ userId: string | null; tokenHash: string }> {
  const { data, error } = await service.auth.admin.generateLink({
    type: kind,
    email,
    options: { redirectTo: `${appUrl()}/auth/confirm` },
  });
  if (error || !data?.properties?.hashed_token) throw new Error(mapAuthError(error?.message ?? 'auth_link_generation_failed'));
  return { userId: data.user?.id ?? null, tokenHash: data.properties.hashed_token };
}

async function findAuthUser(service: ReturnType<typeof clients>['service'], email: string): Promise<{ user_id: string; created_at: string } | null> {
  const rows = await rpc<Array<{ user_id: string; created_at: string }>>(service, 'team_find_auth_user', { p_email: email });
  return rows[0] ?? null;
}

async function adminMembers(service: ReturnType<typeof clients>['service'], actorId: string): Promise<MemberRow[]> {
  return await rpc<MemberRow[]>(service, 'team_list_members', { p_actor_id: actorId });
}

async function memberContext(service: ReturnType<typeof clients>['service'], authUserId: string): Promise<MemberRow> {
  const rows = await rpc<MemberRow[]>(service, 'team_auth_context', { p_auth_user_id: authUserId });
  const member = rows[0];
  if (!member) throw new Error('active_member_required');
  return member;
}

async function sessionMember(service: ReturnType<typeof clients>['service'], authUserId: string): Promise<SessionMember | null> {
  const rows = await rpc<SessionMember[]>(service, 'team_auth_context', { p_auth_user_id: authUserId });
  return rows[0] ?? null;
}

async function rpc<T>(service: ReturnType<typeof clients>['service'], functionName: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await service.rpc(functionName, args);
  if (error) throw new Error(mapDatabaseError(error.message));
  if (data === null) throw new Error('team_operation_failed');
  return data as T;
}

function toMember(row: MemberRow) {
  return { id: row.id, email: row.email, displayName: row.display_name, role: row.role, status: row.status, version: Number(row.version), createdAt: row.created_at };
}

function safeError(error: unknown): Response {
  const raw = error instanceof Error ? error.message : 'team_operation_failed';
  const message = mapDatabaseError(raw);
  const status = errorStatus[message] ?? 400;
  const code = message === 'authentication_required' ? 'UNAUTHENTICATED' : status === 403 ? 'FORBIDDEN' : status === 409 ? 'CONFLICT' : 'TEAM_OPERATION_FAILED';
  const publicMessage: Record<string, string> = {
    authentication_required: 'Vui lòng đăng nhập.',
    admin_required: 'Chỉ quản trị viên đang hoạt động mới được thực hiện thao tác này.',
    active_member_required: 'Tài khoản cần có tư cách thành viên đang hoạt động.',
    membership_pending: 'Hãy mở lời mời và đặt mật khẩu trước khi tiếp tục.',
    member_disabled: 'Tư cách thành viên này đã bị vô hiệu hóa.',
    member_version_conflict: 'Thông tin thành viên vừa thay đổi. Hãy tải lại danh sách rồi thử lại.',
    last_admin_required: 'Nhóm cần giữ lại ít nhất một quản trị viên đang hoạt động.',
    self_role_change_forbidden: 'Quản trị viên không thể tự đổi vai trò của mình.',
    self_status_change_forbidden: 'Quản trị viên không thể tự vô hiệu hóa hoặc kích hoạt lại mình.',
    invitation_acceptance_required: 'Thành viên đang chờ phải chấp nhận lời mời trước khi kích hoạt.',
    member_email_already_exists: 'Email này đã có trong danh sách thành viên.',
    auth_user_already_member: 'Email này đã có tài khoản Auth ngoài luồng mời của nhóm.',
    member_link_in_progress: 'Đường dẫn đang được tạo. Hãy thử lại bằng cùng mã yêu cầu sau ít phút.',
    member_link_uncertain: 'Auth có thể vẫn đang xử lý đường dẫn trước đó. Hãy thử lại sau khi đường dẫn hết hạn với mã yêu cầu mới.',
    member_link_expired: 'Đường dẫn đã hết hạn. Hãy tạo đường dẫn mới bằng mã yêu cầu mới.',
    member_link_replaced: 'Một đường dẫn mới hơn đã thay thế yêu cầu này. Hãy tải lại thành viên và dùng đường dẫn mới nhất.',
    idempotency_key_reused: 'Mã yêu cầu này đã được dùng với dữ liệu khác.',
    email_invalid: 'Email không hợp lệ.',
    member_role_invalid: 'Vai trò không hợp lệ.',
    member_status_invalid: 'Trạng thái không hợp lệ.',
    password_invalid: 'Mật khẩu phải có từ 8 đến 256 ký tự.',
    unknown_operation: 'Thao tác không được hỗ trợ.',
  };
  return json({ error: { code, message: publicMessage[message] ?? 'Không thể hoàn thành thao tác quản lý thành viên.' } }, status);
}

function mapDatabaseError(message: string): string {
  const known = [
    'authentication_required','admin_required','active_member_required','membership_pending','member_disabled',
    'invitation_not_verified','invitation_identity_mismatch','member_not_pending','member_link_not_allowed',
    'member_email_already_exists','auth_user_already_member','member_auth_identity_conflict','member_version_conflict',
    'last_admin_required','self_role_change_forbidden','self_status_change_forbidden','invitation_acceptance_required',
    'member_link_in_progress','member_link_uncertain','member_link_expired','member_link_replaced','idempotency_key_reused','email_invalid','member_role_invalid','member_status_invalid',
    'member_link_kind_invalid','member_not_found','unknown_operation','member_link_encryption_key_missing','password_invalid',
  ];
  return known.find((candidate) => message.includes(candidate)) ?? 'team_operation_failed';
}

function mapAuthError(message: string): string {
  if (/already registered|already exists|user exists/i.test(message)) return 'auth_user_already_member';
  return 'auth_link_generation_failed';
}

function requireId(value: unknown, errorCode: string): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) throw new Error(errorCode);
  return value;
}

function requireIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 200) throw new Error('idempotency_key_required');
  return value;
}

function requireVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error('member_version_invalid');
  return Number(value);
}

function requiredSecret(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error('team_link_encryption_key_missing');
  return value;
}

function linkTtlSeconds(): number {
  const value = Number(Deno.env.get('TEAM_LINK_TTL_SECONDS') ?? 3600);
  return Number.isFinite(value) && value >= 60 && value <= 86_400 ? Math.floor(value) : 3600;
}

function appUrl(): string {
  const base = Deno.env.get('PUBLIC_APP_URL');
  if (!base) throw new Error('team_operation_failed');
  return base.replace(/\/$/, '');
}
