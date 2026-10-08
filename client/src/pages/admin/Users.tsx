import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Field, Input, LoadingBlock, Modal, PageHeader, Select } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { api, errorMessage } from '../../lib/api';
import { ago } from '../../lib/format';
import type { Role, User } from '../../lib/types';

export default function UsersAdmin() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'agent' as Role, title: '' });

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['users', q, role],
    queryFn: () => api<{ items: User[]; total: number }>('/api/users', { query: { q, role, limit: 100 } }),
    placeholderData: keepPreviousData,
  });
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<User> }) => api(`/api/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => {
      toast.success('User updated');
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const create = useMutation({
    mutationFn: () => api('/api/users', { method: 'POST', body: { ...form, title: form.title || undefined } }),
    onSuccess: () => {
      toast.success('User created');
      setOpen(false);
      setForm({ name: '', email: '', password: '', role: 'agent', title: '' });
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="fade-in">
      <PageHeader
        title="Users"
        description="Manage roles and access. Role changes and deactivation revoke active sessions."
        actions={
          <Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setOpen(true)}>
            Add user
          </Button>
        }
      />
      <Card padded={false}>
        <div className="flex flex-wrap gap-2 border-b border-line p-3">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="pl-9" aria-label="Search users" />
          </div>
          <Select value={role} onChange={(e) => setRole(e.target.value)} className="w-auto" aria-label="Role filter">
            <option value="">All roles</option>
            <option value="admin">Admins</option>
            <option value="agent">Agents</option>
            <option value="reporter">Reporters</option>
          </Select>
        </div>
        {error ? (
          <ErrorState error={error} retry={refetch} />
        ) : isLoading ? (
          <div className="p-4">
            <LoadingBlock rows={6} />
          </div>
        ) : !data?.items.length ? (
          <EmptyState title="No users found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs tracking-wide text-faint uppercase">
                  <th className="px-4 py-2.5 font-medium">User</th>
                  <th className="px-3 py-2.5 font-medium">Role</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Last sign-in</th>
                  <th className="px-4 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((u) => {
                  const self = u.id === me?.id;
                  return (
                    <tr key={u.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name} />
                          <div className="min-w-0">
                            <p className="font-medium">
                              {u.name} {self && <span className="text-xs text-faint">(you)</span>}
                            </p>
                            <p className="text-xs text-muted">
                              {u.email}
                              {u.title ? ` - ${u.title}` : ''}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <Select value={u.role} disabled={self || patch.isPending} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value as Role } })} className="h-8 w-32 py-1 text-xs" aria-label={`Role for ${u.name}`}>
                          <option value="reporter">Reporter</option>
                          <option value="agent">Agent</option>
                          <option value="admin">Admin</option>
                        </Select>
                      </td>
                      <td className="px-3 py-3">{u.active ? <Badge tone="green" dot>Active</Badge> : <Badge tone="slate" dot>Disabled</Badge>}</td>
                      <td className="px-3 py-3 text-xs text-muted">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant={u.active ? 'outline' : 'secondary'} disabled={self} onClick={() => patch.mutate({ id: u.id, body: { active: !u.active } })}>
                          {u.active ? 'Disable' : 'Enable'}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Add user"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={create.isPending} onClick={() => create.mutate()} disabled={!form.name || !form.email || form.password.length < 8}>
              Create user
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Temporary password" hint="8+ characters, letter and digit">
            <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              <option value="reporter">Reporter</option>
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Job title (optional)">
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
          </div>
        </div>
      </Modal>
    </div>
  );
}
