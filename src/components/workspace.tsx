'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { z } from 'zod';
import { Landmark, Users, ShieldCheck, LogOut, Search, Plus, ArrowRight } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import FinancialWorkspace from '@/components/financial-workspace';
import ImportReview from '@/components/import-review';

type Client = { id: string; full_name: string; dni: string; phone: string; address: string; notes: string | null; created_at: string; stand_code: string | null; member_type: 'socio' | 'trabajador' | null };
const clientSchema = z.object({ stand_code: z.string().trim().min(1).max(40), member_type: z.enum(['socio', 'trabajador']), full_name: z.string().trim().min(3).max(150), dni: z.string().regex(/^\d{8}$/), phone: z.string().regex(/^9\d{8}$/), address: z.string().trim().min(3).max(300), notes: z.string().trim().max(2000) });
const supabase = getSupabase();
export default function Workspace() {
  const [userId, setUserId] = useState<string | null>(null);
  const sessionUserId = useRef<string | null>(null);
  const [role, setRole] = useState<'administrador' | 'jefe' | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState('');
  const [section, setSection] = useState<'inicio' | 'clientes' | 'finanzas' | 'importar'>('inicio');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      const nextUserId = session?.user.id ?? null;
      // SIGNED_IN can repeat when a tab regains focus; TOKEN_REFRESHED also keeps the same user.
      // Clear user data only when identity changes or the session actually ends.
      if (nextUserId !== sessionUserId.current) {
        sessionUserId.current = nextUserId;
        setUserId(nextUserId);
        setRole(null);
        setClients([]);
        setMessage('');
        setShowForm(false);
        setEditing(null);
        setSearch('');
        setSection('inicio');
      }
      setLoading(false);
    });
    return () => { active = false; data.subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!userId || !supabase) return;
    let active = true;
    async function load() {
      const profile = await supabase!.from('profiles').select('role').eq('id', userId).single();
      if (!active) return;
      if (profile.error || !['administrador', 'jefe'].includes(profile.data?.role)) {
        setMessage('Tu usuario no tiene un rol autorizado. Solicita al responsable que te asigne un perfil.'); return;
      }
      setRole(profile.data.role);
      const rows: Client[] = [];
      for (let offset = 0; ; offset += 1000) {
        const result = await supabase!.from('clients').select('*').order('created_at', { ascending: false }).order('id').range(offset, offset + 999);
        if (!active) return;
        if (result.error) { setMessage('No se pudieron cargar clientes. Verifica la migración y los permisos de Supabase.'); return; }
        rows.push(...result.data);
        if (result.data.length < 1000) break;
      }
      setClients(rows); setMessage('');
    }
    void load();
    return () => { active = false; };
  }, [userId]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const data = new FormData(event.currentTarget);
    try {
      const result = await supabase!.auth.signInWithPassword({ email: String(data.get('email')), password: String(data.get('password')) });
      if (result.error) setMessage('No fue posible ingresar. Verifica tus credenciales y la conexión.');
    } catch { setMessage('No se pudo conectar con Supabase.'); }
    finally { setBusy(false); }
  }
  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (role !== 'administrador') return;
    const form = event.currentTarget;
    const parsed = clientSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) { setMessage('Completa código de stand, condición, DNI de 8 dígitos y celular peruano de 9 dígitos.'); return; }
    if (!window.confirm(`¿${editing ? 'Actualizar' : 'Registrar'} a ${parsed.data.full_name} con DNI ${parsed.data.dni}?`)) return;
    setBusy(true); setMessage('');
    try {
      const query = editing ? supabase!.from('clients').update(parsed.data).eq('id', editing.id) : supabase!.from('clients').insert(parsed.data);
      const result = await query.select('*').single();
      if (result.error) setMessage(result.error.code === '23505' ? 'Ya existe un cliente con ese DNI.' : 'No se pudo registrar el cliente. Verifica tu conexión y permisos.');
      else { setClients(current => editing ? current.map(c => c.id === editing.id ? result.data : c) : [result.data, ...current]); setShowForm(false); setEditing(null); form.reset(); setMessage('Cliente guardado.'); }
    } catch { setMessage('No se pudo conectar con Supabase.'); }
    finally { setBusy(false); }
  }
  async function logout() {
    const result = await supabase!.auth.signOut();
    if (result.error) { setMessage('No se pudo cerrar sesión. Inténtalo nuevamente.'); return; }
    setUserId(null); setRole(null); setClients([]); setMessage(''); setShowForm(false);
  }
  const visible = clients.filter(client => `${client.full_name} ${client.dni} ${client.stand_code ?? ''}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="min-h-screen md:flex">
    <aside className="bg-slate-900 p-6 text-white md:fixed md:inset-y-0 md:w-64">
      <div className="flex items-center gap-3"><div className="rounded-xl bg-teal-600 p-2"><Landmark size={24} /></div><div><p className="text-xl font-bold">PM Créditos</p><p className="text-xs text-slate-400">Administración financiera</p></div></div>
      <nav aria-label="Menú principal" className="mt-9 flex flex-wrap gap-2 md:flex-col">
        <button onClick={() => setSection('inicio')} className={`flex items-center gap-3 rounded-lg p-3 text-left ${section === 'inicio' ? 'bg-slate-800' : ''}`}><Landmark size={18} /> Inicio</button>
        <button disabled={!role} onClick={() => setSection('clientes')} className={`flex items-center gap-3 rounded-lg p-3 text-left disabled:opacity-40 ${section === 'clientes' ? 'bg-slate-800' : ''}`}><Users size={18} /> Clientes</button>
        <button disabled={!role} onClick={() => setSection('finanzas')} className={`flex items-center gap-3 rounded-lg p-3 text-left disabled:opacity-40 ${section === 'finanzas' ? 'bg-slate-800' : ''}`}><Landmark size={18} /> Panel general</button>
        {role === 'administrador' && <button onClick={() => setSection('importar')} className={`rounded-lg p-3 text-left ${section === 'importar' ? 'bg-slate-800' : ''}`}>Revisar Excel</button>}
      </nav>
      <p className="mt-10 text-xs leading-6 text-slate-400">Soles peruanos · PEN<br />Zona horaria: Lima</p>
    </aside>
    <main className="min-w-0 w-full p-6 md:ml-64 md:p-10">
      <header className="mb-8 flex flex-wrap items-center justify-between gap-4"><div><p className="mb-1 text-sm text-slate-500">Gestión de préstamos personales</p><h1 className="text-3xl font-bold">{section === 'inicio' ? 'Bienvenido a PM Créditos' : section === 'clientes' ? 'Clientes' : section === 'importar' ? 'Revisar Excel' : 'Préstamos y cobranzas'}</h1></div>{userId && <Button variant="outline" onClick={logout}><LogOut size={16} /> Cerrar sesión</Button>}</header>
      {message && <p role="status" className="mb-5 rounded-lg border border-teal-200 bg-teal-50 p-4 text-sm">{message}</p>}
      {loading ? <p role="status">Verificando sesión…</p> : !supabase ? <section className="max-w-2xl rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><ShieldCheck className="mb-5 text-teal-700" size={36} /><h2 className="text-xl font-bold">Conecta tu proyecto Supabase</h2><p className="mt-3 leading-7 text-slate-600">La base de la aplicación está instalada. Para acceder, necesitas crear el proyecto, aplicar la migración y configurar la URL y la clave publicable.</p><p className="mt-4 text-sm text-slate-500">Todavía no se registran operaciones reales. Los cálculos y operaciones se han probado localmente. Falta validar el acceso y la persistencia con tu proyecto Supabase.</p></section>
      : !userId ? <form onSubmit={login} className="max-w-md space-y-5 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm"><h2 className="text-xl font-bold">Iniciar sesión</h2><p className="text-sm text-slate-500">Acceso exclusivo para usuarios autorizados.</p><label className="block">Correo electrónico<input name="email" type="email" autoComplete="username" required /></label><label className="block">Contraseña<input name="password" type="password" autoComplete="current-password" required /></label><Button className="w-full" disabled={busy}>{busy ? 'Ingresando…' : 'Ingresar'}<ArrowRight size={16} /></Button></form>
      : !role ? <p>Se requiere un perfil autorizado para acceder a los datos.</p>
      : section === 'importar' && role === 'administrador' ? <ImportReview />
      : section === 'finanzas' ? <FinancialWorkspace clients={clients} role={role} />
      : section === 'inicio' ? <section className="max-w-3xl space-y-6"><div className="rounded-2xl border border-slate-200 bg-white p-7"><p className="text-sm text-slate-500">Tu acceso</p><h2 className="mt-2 text-2xl font-semibold capitalize">{role}</h2><p className="mt-4 text-slate-600">{role === 'administrador' ? 'Puedes registrar y consultar clientes.' : 'Puedes consultar clientes.'}</p><Button className="mt-6" onClick={() => setSection('clientes')}><Users size={16} /> Ver clientes</Button></div><div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6">Abre Préstamos y cobranzas para consultar el panel financiero, registrar préstamos y pagos o exportar reportes. Los pagos son definitivos: no se anulan ni se eliminan.</div></section>
      : <section>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4"><div className="relative w-full max-w-md"><Search size={18} className="absolute left-3 top-4 text-slate-400" /><input aria-label="Buscar por nombre o DNI" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nombre o DNI" className="pl-10" /></div>{role === 'administrador' && <Button onClick={() => { setEditing(null); setShowForm(!showForm); }}><Plus size={16} /> Nuevo cliente</Button>}</div>
        {showForm && role === 'administrador' && <form key={editing?.id ?? 'nuevo'} onSubmit={createClient} className="mb-7 grid gap-5 rounded-xl border border-slate-200 bg-white p-6 md:grid-cols-2"><h2 className="text-lg font-bold md:col-span-2">{editing ? 'Editar cliente' : 'Registrar cliente'}</h2><label>Código de stand<input name="stand_code" defaultValue={editing?.stand_code ?? ''} required maxLength={40} /></label><label>Condición<select name="member_type" defaultValue={editing?.member_type ?? ''} required className="mt-1 block w-full rounded-lg border border-slate-300 bg-white p-3"><option value="">Selecciona socio o trabajador</option><option value="socio">Socio</option><option value="trabajador">Trabajador</option></select></label><label>Nombres y apellidos<input name="full_name" defaultValue={editing?.full_name ?? ''} required minLength={3} maxLength={150} /></label><label>DNI<input name="dni" defaultValue={editing?.dni ?? ''} required inputMode="numeric" pattern="[0-9]{8}" maxLength={8} /></label><label>Celular / WhatsApp<input name="phone" defaultValue={editing?.phone ?? ''} required inputMode="tel" pattern="9[0-9]{8}" maxLength={9} /></label><label>Dirección<input name="address" defaultValue={editing?.address ?? ''} required minLength={3} maxLength={300} /></label><label className="md:col-span-2">Observaciones<textarea name="notes" defaultValue={editing?.notes ?? ''} maxLength={2000} /></label><div className="flex gap-3 md:col-span-2"><Button disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar cliente'}</Button><Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button></div></form>}
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-slate-500"><tr>{['Cliente', 'Stand', 'Condición', 'DNI', 'Celular', 'Dirección', 'Registro', 'Acción'].map(title => <th key={title} className="p-4 font-medium">{title}</th>)}</tr></thead><tbody>{visible.map(client => <tr key={client.id} className="border-t border-slate-100"><td className="p-4 font-semibold">{client.full_name}</td><td className="p-4">{client.stand_code ?? 'Por registrar'}</td><td className="p-4 capitalize">{client.member_type ?? 'Por registrar'}</td><td className="p-4">{client.dni}</td><td className="p-4">{client.phone}</td><td className="p-4">{client.address}</td><td className="p-4">{new Intl.DateTimeFormat('es-PE', { timeZone: 'America/Lima' }).format(new Date(client.created_at))}</td><td className="p-4">{role === 'administrador' && <Button variant="outline" onClick={() => { setEditing(client); setShowForm(true); }}>Editar</Button>}</td></tr>)}</tbody></table>{visible.length === 0 && <p className="p-10 text-center text-slate-500">{search ? 'No se encontraron clientes.' : 'Todavía no hay clientes registrados.'}</p>}</div>
      </section>}
    </main>
  </div>;
}
