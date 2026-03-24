-- ============================================================
-- DDE Spark Portal — Performance Rating System
-- Run this in your Supabase SQL Editor
-- ============================================================

-- ── Categories (safety, quality, etc.) ───────────────────────
CREATE TABLE IF NOT EXISTS perf_categories (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Questions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS perf_questions (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  category_id UUID REFERENCES perf_categories(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Evaluation Cycles (admin triggers one per employee) ───────
CREATE TABLE IF NOT EXISTS perf_cycles (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
  foreman_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  work_days_override INTEGER,   -- null = auto-calculated Mon-Fri
  triggered_by UUID REFERENCES employees(id) ON DELETE SET NULL,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending','in_progress','submitted')),
  submitted_at TIMESTAMPTZ,
  notes TEXT
);

-- ── Individual question answers ───────────────────────────────
CREATE TABLE IF NOT EXISTS perf_answers (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  cycle_id UUID REFERENCES perf_cycles(id) ON DELETE CASCADE,
  question_id UUID REFERENCES perf_questions(id) ON DELETE CASCADE,
  score INTEGER CHECK (score BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cycle_id, question_id)
);

-- ── Employee job grade profile (responsibilities upload) ──────
CREATE TABLE IF NOT EXISTS perf_employee_profiles (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  employee_id UUID REFERENCES employees(id) ON DELETE CASCADE UNIQUE,
  responsibilities TEXT,   -- free text / uploaded content
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by UUID REFERENCES employees(id) ON DELETE SET NULL
);

-- ── Default seed data ─────────────────────────────────────────
INSERT INTO perf_categories (name, description, sort_order) VALUES
  ('Safety Compliance', 'How well does the employee adhere to safety protocols and PPE requirements', 1),
  ('Quality of Work', 'Workmanship, accuracy, and attention to detail', 2),
  ('Attendance & Punctuality', 'Readiness and preparedness at clock-in, frequency of tardiness', 3),
  ('Productivity', 'Meeting project deadlines and adhering to the schedule', 4),
  ('Team Collaboration', 'How effectively the employee works with others on the crew', 5)
ON CONFLICT DO NOTHING;

-- Seed questions (referencing categories by name for portability)
DO $$
DECLARE
  safety_id UUID;
  quality_id UUID;
  attend_id UUID;
  prod_id UUID;
  collab_id UUID;
BEGIN
  SELECT id INTO safety_id FROM perf_categories WHERE name = 'Safety Compliance' LIMIT 1;
  SELECT id INTO quality_id FROM perf_categories WHERE name = 'Quality of Work' LIMIT 1;
  SELECT id INTO attend_id FROM perf_categories WHERE name = 'Attendance & Punctuality' LIMIT 1;
  SELECT id INTO prod_id FROM perf_categories WHERE name = 'Productivity' LIMIT 1;
  SELECT id INTO collab_id FROM perf_categories WHERE name = 'Team Collaboration' LIMIT 1;

  IF safety_id IS NOT NULL THEN
    INSERT INTO perf_questions (category_id, text, sort_order) VALUES
      (safety_id, 'Consistently adheres to all safety protocols and procedures on site', 1),
      (safety_id, 'Wears required PPE at all times without reminders', 2),
      (safety_id, 'Proactively identifies and reports hazards or unsafe conditions', 3)
    ON CONFLICT DO NOTHING;
  END IF;
  IF quality_id IS NOT NULL THEN
    INSERT INTO perf_questions (category_id, text, sort_order) VALUES
      (quality_id, 'Demonstrates high quality workmanship in completed tasks', 1),
      (quality_id, 'Accuracy in measurements and following specifications', 2),
      (quality_id, 'Attention to detail in finishing and tolerances', 3)
    ON CONFLICT DO NOTHING;
  END IF;
  IF attend_id IS NOT NULL THEN
    INSERT INTO perf_questions (category_id, text, sort_order) VALUES
      (attend_id, 'Arrives on time and is ready to work at clock-in', 1),
      (attend_id, 'Has all required tools and materials prepared at start of shift', 2)
    ON CONFLICT DO NOTHING;
  END IF;
  IF prod_id IS NOT NULL THEN
    INSERT INTO perf_questions (category_id, text, sort_order) VALUES
      (prod_id, 'Consistently meets project deadlines', 1),
      (prod_id, 'Adheres to the work schedule and task sequence', 2)
    ON CONFLICT DO NOTHING;
  END IF;
  IF collab_id IS NOT NULL THEN
    INSERT INTO perf_questions (category_id, text, sort_order) VALUES
      (collab_id, 'Works effectively with teammates and other crews', 1),
      (collab_id, 'Communicates clearly and professionally on site', 2)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

-- ── Helper: count work days (Mon–Fri) between two dates ───────
CREATE OR REPLACE FUNCTION count_work_days(p_start DATE, p_end DATE)
RETURNS INTEGER AS $$
DECLARE
  d DATE := p_start;
  cnt INTEGER := 0;
BEGIN
  WHILE d <= p_end LOOP
    IF EXTRACT(DOW FROM d) NOT IN (0, 6) THEN cnt := cnt + 1; END IF;
    d := d + 1;
  END LOOP;
  RETURN cnt;
END;
$$ LANGUAGE plpgsql;

-- ── Weighted average score for an employee across cycles ──────
-- Returns JSON: { overall_score, category_scores, cycle_detail }
CREATE OR REPLACE FUNCTION get_employee_perf_summary(p_employee_id UUID)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
BEGIN
  SELECT jsonb_build_object(
    'overall_score', ROUND(AVG(cycle_weighted_score)::NUMERIC, 2),
    'cycles', jsonb_agg(cycle_data ORDER BY start_date)
  ) INTO result
  FROM (
    SELECT
      pc.id,
      pc.start_date,
      pc.end_date,
      pc.foreman_id,
      COALESCE(pc.work_days_override, count_work_days(pc.start_date, pc.end_date)) AS work_days,
      ROUND(AVG(pa.score)::NUMERIC, 2) AS cycle_avg,
      ROUND(AVG(pa.score)::NUMERIC, 2) AS cycle_weighted_score,
      jsonb_build_object(
        'cycle_id', pc.id,
        'start_date', pc.start_date,
        'end_date', pc.end_date,
        'foreman_id', pc.foreman_id,
        'work_days', COALESCE(pc.work_days_override, count_work_days(pc.start_date, pc.end_date)),
        'avg_score', ROUND(AVG(pa.score)::NUMERIC, 2),
        'status', pc.status
      ) AS cycle_data
    FROM perf_cycles pc
    LEFT JOIN perf_answers pa ON pa.cycle_id = pc.id
    WHERE pc.employee_id = p_employee_id AND pc.status = 'submitted'
    GROUP BY pc.id, pc.start_date, pc.end_date, pc.foreman_id, pc.work_days_override, pc.status
  ) sub;

  RETURN COALESCE(result, '{}'::JSONB);
END;
$$ LANGUAGE plpgsql;

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_perf_cycles_employee ON perf_cycles(employee_id);
CREATE INDEX IF NOT EXISTS idx_perf_cycles_foreman ON perf_cycles(foreman_id);
CREATE INDEX IF NOT EXISTS idx_perf_cycles_status ON perf_cycles(status);
CREATE INDEX IF NOT EXISTS idx_perf_answers_cycle ON perf_answers(cycle_id);
CREATE INDEX IF NOT EXISTS idx_perf_questions_category ON perf_questions(category_id);

-- ── Permissions ───────────────────────────────────────────────
GRANT ALL ON perf_categories TO anon;
GRANT ALL ON perf_questions TO anon;
GRANT ALL ON perf_cycles TO anon;
GRANT ALL ON perf_answers TO anon;
GRANT ALL ON perf_employee_profiles TO anon;
GRANT EXECUTE ON FUNCTION count_work_days(DATE, DATE) TO anon;
GRANT EXECUTE ON FUNCTION get_employee_perf_summary(UUID) TO anon;
