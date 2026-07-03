/*
# Add Attendance Table for HR Management

## Summary
Creates an attendance tracking table for the HR Management module.

## New Tables

### attendance
Tracks daily employee attendance records including check-in/check-out times and attendance status.

Columns:
- `id` (uuid, primary key) — unique identifier
- `employee_id` (uuid, foreign key → employees.id) — which employee
- `date` (date, not null) — the attendance date
- `check_in` (time) — clock-in time (nullable, may not have been logged)
- `check_out` (time) — clock-out time (nullable)
- `status` (text, default 'present') — one of: present, absent, late, half_day, leave
- `notes` (text) — optional manager notes
- `created_at` (timestamptz) — record creation timestamp
- `updated_at` (timestamptz) — last update timestamp

Constraints:
- UNIQUE(employee_id, date) — one record per employee per day
- status must be one of the valid enum values

## Security
- RLS enabled on attendance table
- Authenticated users can read, insert, update, and delete attendance records
- Anon users have no access (ERP requires sign-in)
*/

CREATE TABLE IF NOT EXISTS attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  check_in TIME,
  check_out TIME,
  status TEXT NOT NULL DEFAULT 'present' CHECK (status IN ('present', 'absent', 'late', 'half_day', 'leave')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, date)
);

ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_attendance" ON attendance;
CREATE POLICY "select_attendance" ON attendance FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_attendance" ON attendance;
CREATE POLICY "insert_attendance" ON attendance FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_attendance" ON attendance;
CREATE POLICY "update_attendance" ON attendance FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_attendance" ON attendance;
CREATE POLICY "delete_attendance" ON attendance FOR DELETE
  TO authenticated USING (true);
