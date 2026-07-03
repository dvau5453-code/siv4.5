'use client';

import { useEffect, useState, Fragment } from 'react';
import { supabase } from '@/lib/supabase';
import { toast } from '@/hooks/use-toast';
import { ChevronLeft, ChevronRight, Search, CreditCard as Edit, CircleCheck as CheckCircle2, Circle as XCircle, Clock, Coffee, Umbrella, Users } from 'lucide-react';

interface Employee {
  id: string;
  employee_id: string;
  full_name: string;
  designation: string;
  department: string;
}

interface AttendanceRecord {
  id: string;
  employee_id: string;
  date: string;
  check_in: string | null;
  check_out: string | null;
  status: 'present' | 'absent' | 'late' | 'half_day' | 'leave';
  notes: string | null;
}

type AttendanceStatus = 'present' | 'absent' | 'late' | 'half_day' | 'leave';

const statusConfig: Record<AttendanceStatus, { label: string; color: string; activeColor: string }> = {
  present:  { label: 'Present',  color: 'border-border text-muted-foreground hover:border-green-300 hover:bg-green-50 hover:text-green-700',  activeColor: 'border-green-500 bg-green-100 text-green-700' },
  late:     { label: 'Late',     color: 'border-border text-muted-foreground hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700',   activeColor: 'border-amber-500 bg-amber-100 text-amber-700' },
  half_day: { label: 'Half Day', color: 'border-border text-muted-foreground hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700',     activeColor: 'border-blue-500 bg-blue-100 text-blue-700' },
  leave:    { label: 'Leave',    color: 'border-border text-muted-foreground hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700', activeColor: 'border-purple-500 bg-purple-100 text-purple-700' },
  absent:   { label: 'Absent',   color: 'border-border text-muted-foreground hover:border-red-300 hover:bg-red-50 hover:text-red-700',         activeColor: 'border-red-500 bg-red-100 text-red-700' },
};

const statusBadge: Record<AttendanceStatus, string> = {
  present:  'text-green-700 bg-green-100',
  absent:   'text-red-700 bg-red-100',
  late:     'text-amber-700 bg-amber-100',
  half_day: 'text-blue-700 bg-blue-100',
  leave:    'text-purple-700 bg-purple-100',
};

export default function AttendancePage() {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<Map<string, AttendanceRecord>>(new Map());
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterDept, setFilterDept] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCheckIn, setEditCheckIn] = useState('');
  const [editCheckOut, setEditCheckOut] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const today = new Date().toISOString().split('T')[0];
  const isToday = date === today;

  useEffect(() => { loadData(); }, [date]);

  async function loadData() {
    setLoading(true);
    const [empRes, attRes] = await Promise.all([
      supabase.from('employees').select('id, employee_id, full_name, designation, department').eq('status', 'active').order('full_name'),
      supabase.from('attendance').select('*').eq('date', date),
    ]);
    setEmployees(empRes.data || []);
    const map = new Map<string, AttendanceRecord>();
    (attRes.data || []).forEach((r: AttendanceRecord) => map.set(r.employee_id, r));
    setAttendance(map);
    setLoading(false);
  }

  async function markAttendance(employeeId: string, status: AttendanceStatus) {
    setSavingId(employeeId);
    const existing = attendance.get(employeeId);
    let updated: AttendanceRecord | null = null;

    if (existing) {
      const { data, error } = await supabase
        .from('attendance')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else updated = data;
    } else {
      const { data, error } = await supabase
        .from('attendance')
        .insert({ employee_id: employeeId, date, status })
        .select()
        .single();
      if (error) toast({ title: 'Error', description: error.message, variant: 'destructive' });
      else updated = data;
    }

    if (updated) {
      setAttendance(prev => new Map(prev).set(employeeId, updated!));
    }
    setSavingId(null);
  }

  async function saveDetails(employeeId: string) {
    const existing = attendance.get(employeeId);
    if (!existing) return;
    setSavingId(employeeId);

    const { data, error } = await supabase
      .from('attendance')
      .update({
        check_in: editCheckIn || null,
        check_out: editCheckOut || null,
        notes: editNotes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else if (data) {
      setAttendance(prev => new Map(prev).set(employeeId, data));
      setEditingId(null);
      toast({ title: 'Saved' });
    }
    setSavingId(null);
  }

  function openEdit(emp: Employee) {
    const rec = attendance.get(emp.id);
    if (!rec) return;
    setEditingId(emp.id);
    setEditCheckIn(rec.check_in?.slice(0, 5) || '');
    setEditCheckOut(rec.check_out?.slice(0, 5) || '');
    setEditNotes(rec.notes || '');
  }

  function navigateDate(delta: number) {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    setDate(d.toISOString().split('T')[0]);
  }

  const departments = [...new Set(employees.map(e => e.department).filter(Boolean))].sort();

  const filtered = employees.filter(e => {
    if (search && !e.full_name.toLowerCase().includes(search.toLowerCase()) && !e.employee_id.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterDept && e.department !== filterDept) return false;
    return true;
  });

  const counts = { present: 0, absent: 0, late: 0, half_day: 0, leave: 0, unmarked: 0 };
  employees.forEach(e => {
    const rec = attendance.get(e.id);
    if (!rec) counts.unmarked++;
    else counts[rec.status]++;
  });

  const displayDate = new Date(date + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Attendance</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{displayDate}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => navigateDate(-1)} className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <input
            type="date"
            value={date}
            max={today}
            onChange={e => { setDate(e.target.value); setEditingId(null); }}
            className="border border-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 bg-white"
          />
          <button
            onClick={() => navigateDate(1)}
            disabled={isToday}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-border hover:bg-muted transition disabled:opacity-40"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {!isToday && (
            <button onClick={() => { setDate(today); setEditingId(null); }} className="text-xs text-blue-600 hover:underline px-1 font-medium">
              Today
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5">
        {[
          { key: 'present',  label: 'Present',   cls: 'text-green-700 bg-green-50 border-green-200' },
          { key: 'absent',   label: 'Absent',    cls: 'text-red-700 bg-red-50 border-red-200' },
          { key: 'late',     label: 'Late',      cls: 'text-amber-700 bg-amber-50 border-amber-200' },
          { key: 'half_day', label: 'Half Day',  cls: 'text-blue-700 bg-blue-50 border-blue-200' },
          { key: 'leave',    label: 'Leave',     cls: 'text-purple-700 bg-purple-50 border-purple-200' },
          { key: 'unmarked', label: 'Unmarked',  cls: 'text-gray-500 bg-gray-50 border-gray-200' },
        ].map(s => (
          <div key={s.key} className={`rounded-xl border p-3 text-center ${s.cls}`}>
            <p className="text-xl font-bold">{counts[s.key as keyof typeof counts]}</p>
            <p className="text-xs font-medium mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-border p-3 shadow-sm flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search employees..."
            className="w-full pl-8 pr-4 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
        <select
          value={filterDept}
          onChange={e => setFilterDept(e.target.value)}
          className="border border-border rounded-lg px-3 py-2 text-sm focus:outline-none"
        >
          <option value="">All Departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Employee</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 hidden sm:table-cell">Dept</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">Status</th>
                <th className="text-left text-xs font-semibold text-muted-foreground px-4 py-3 hidden md:table-cell">Time</th>
                <th className="text-right text-xs font-semibold text-muted-foreground px-4 py-3">Mark Attendance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>
                    ))}
                  </tr>
                ))
              ) : employees.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center">
                    <Users className="w-10 h-10 text-muted-foreground/30 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground font-medium">No active employees</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Add employees in the Employees section first.</p>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">No employees match your search.</td></tr>
              ) : (
                filtered.map(emp => {
                  const rec = attendance.get(emp.id);
                  const isSaving = savingId === emp.id;
                  const isEditing = editingId === emp.id;

                  return (
                    <Fragment key={emp.id}>
                      <tr className="hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-700 font-bold text-xs shrink-0">
                              {emp.full_name.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground truncate">{emp.full_name}</p>
                              <p className="text-xs text-muted-foreground">{emp.employee_id}{emp.designation ? ` · ${emp.designation}` : ''}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          <span className="text-xs text-muted-foreground">{emp.department || '—'}</span>
                        </td>
                        <td className="px-4 py-3">
                          {rec ? (
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${statusBadge[rec.status]}`}>
                              {statusConfig[rec.status].label}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium text-gray-500 bg-gray-100">
                              Not Marked
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          {rec ? (
                            <span className="text-xs text-muted-foreground">
                              {rec.check_in ? rec.check_in.slice(0, 5) : '—'} / {rec.check_out ? rec.check_out.slice(0, 5) : '—'}
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            {(Object.keys(statusConfig) as AttendanceStatus[]).map(s => (
                              <button
                                key={s}
                                onClick={() => markAttendance(emp.id, s)}
                                disabled={isSaving}
                                title={statusConfig[s].label}
                                className={`px-2 py-1 rounded border text-[10px] font-semibold transition ${
                                  rec?.status === s ? statusConfig[s].activeColor : statusConfig[s].color
                                }`}
                              >
                                {statusConfig[s].label}
                              </button>
                            ))}
                            {rec && (
                              <button
                                onClick={() => isEditing ? setEditingId(null) : openEdit(emp)}
                                title="Edit times & notes"
                                className={`w-7 h-7 flex items-center justify-center rounded-lg border transition ${
                                  isEditing
                                    ? 'border-blue-500 bg-blue-100 text-blue-600'
                                    : 'border-border text-muted-foreground hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200'
                                }`}
                              >
                                <Edit className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {isEditing && (
                        <tr className="bg-blue-50/60">
                          <td colSpan={5} className="px-4 py-3 border-t border-blue-100">
                            <div className="flex flex-wrap items-end gap-3">
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Check In</label>
                                <input
                                  type="time"
                                  value={editCheckIn}
                                  onChange={e => setEditCheckIn(e.target.value)}
                                  className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                />
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1">Check Out</label>
                                <input
                                  type="time"
                                  value={editCheckOut}
                                  onChange={e => setEditCheckOut(e.target.value)}
                                  className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                />
                              </div>
                              <div className="flex-1 min-w-[180px]">
                                <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
                                <input
                                  type="text"
                                  value={editNotes}
                                  onChange={e => setEditNotes(e.target.value)}
                                  placeholder="Optional notes..."
                                  className="w-full border border-border rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                />
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => saveDetails(emp.id)}
                                  disabled={isSaving}
                                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition disabled:opacity-60"
                                >
                                  {isSaving ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="px-3 py-1.5 border border-border rounded-lg text-sm hover:bg-muted transition"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                            {attendance.get(emp.id)?.notes && (
                              <p className="mt-2 text-xs text-slate-500 italic">Current: {attendance.get(emp.id)?.notes}</p>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{filtered.length} of {employees.length} employees</p>
          <p className="text-xs text-muted-foreground">
            {counts.present + counts.late + counts.half_day} present · {counts.absent} absent · {counts.unmarked} unmarked
          </p>
        </div>
      </div>
    </div>
  );
}
