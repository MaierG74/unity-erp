-- Staff table to store staff member information
CREATE TABLE public.staff (
  staff_id SERIAL PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id), -- Link to auth system if staff member has login
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  address TEXT,
  date_of_birth DATE,
  hire_date DATE NOT NULL,
  hourly_rate NUMERIC(10,2) NOT NULL,
  weekly_hours NUMERIC(5,2) DEFAULT 40.00, -- Default weekly hours
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Staff hours table to track working hours
CREATE TABLE public.staff_hours (
  hours_id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES public.staff(staff_id) ON DELETE CASCADE,
  date_worked DATE NOT NULL,
  hours_worked NUMERIC(5,2) NOT NULL,
  start_time TIME,
  end_time TIME,
  break_duration NUMERIC(5,2) DEFAULT 0.00,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Job cards table for assigning work to staff
CREATE TABLE public.job_cards (
  job_card_id SERIAL PRIMARY KEY,
  order_id INTEGER REFERENCES public.orders(order_id),
  staff_id INTEGER REFERENCES public.staff(staff_id),
  issue_date DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date DATE,
  completion_date DATE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, completed, cancelled
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Job card items - individual items within a job card
CREATE TABLE public.job_card_items (
  item_id SERIAL PRIMARY KEY,
  job_card_id INTEGER REFERENCES public.job_cards(job_card_id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES public.products(product_id),
  job_id INTEGER REFERENCES public.jobs(job_id),
  quantity INTEGER NOT NULL DEFAULT 1,
  completed_quantity INTEGER NOT NULL DEFAULT 0,
  piece_rate NUMERIC(10,2), -- Rate per piece for this specific job
  status TEXT NOT NULL DEFAULT 'pending', -- pending, in_progress, completed
  start_time TIMESTAMP WITH TIME ZONE,
  completion_time TIMESTAMP WITH TIME ZONE,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Piece work rates table - standard rates for different jobs
CREATE TABLE public.piece_work_rates (
  rate_id SERIAL PRIMARY KEY,
  job_id INTEGER REFERENCES public.jobs(job_id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES public.products(product_id),
  rate NUMERIC(10,2) NOT NULL, -- Rate per piece
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date DATE, -- NULL means currently active
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_job_product_date UNIQUE (job_id, product_id, effective_date)
);

-- Weekly payroll summary table
CREATE TABLE public.staff_weekly_payroll (
  payroll_id SERIAL PRIMARY KEY,
  staff_id INTEGER REFERENCES public.staff(staff_id) ON DELETE CASCADE,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  regular_hours NUMERIC(5,2) DEFAULT 0.00,
  overtime_hours NUMERIC(5,2) DEFAULT 0.00,
  hourly_wage_total NUMERIC(10,2) DEFAULT 0.00,
  piece_work_total NUMERIC(10,2) DEFAULT 0.00,
  final_payment NUMERIC(10,2) DEFAULT 0.00, -- The higher of hourly or piece work
  payment_date DATE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, paid
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_staff_week UNIQUE (staff_id, week_start_date)
); 