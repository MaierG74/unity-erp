# Staff Time Analysis Module - Product Documentation

**Module Price:** R3,000 (Previously sold at R1,750)

---

## Overview

The Staff Time Analysis Module is a comprehensive workforce management solution that handles time tracking, attendance monitoring, and automated payroll calculations. It integrates seamlessly with facial recognition systems for biometric time capture and provides detailed reporting for labor cost analysis.

---

## Core Features

### 1. Time Clock Management
- **Clock In/Out Events** - Record employee start and end times
- **Break Tracking** - Lunch, tea, coffee, and other break types
- **Multiple Verification Methods**:
  - Facial recognition integration (via external app)
  - Manual entry by supervisors
  - System-generated events
- **Mass Clock Actions** - Clock in/out multiple staff members simultaneously

### 2. Attendance Tracking
- **Daily Attendance Dashboard** - Real-time view of who's working
- **Timeline View** - Visual representation of each employee's day
- **Missing Clock-Out Alerts** - Automatic detection of incomplete shifts
- **Overnight Shift Handling** - Proper split of hours across midnight

### 3. Automated Payroll Calculations

The system automatically applies South African labor rules:

| Day | Tea Break Deduction | Regular Time | Overtime | Double Time |
|-----|---------------------|--------------|----------|-------------|
| Mon-Thu | 30 minutes auto-deducted | First 9 hours | After 9 hours (1.5×) | — |
| Friday | No deduction | First 9 hours | After 9 hours (1.5×) | — |
| Sunday | No deduction | — | — | All hours (2×) |

### 4. Reports & Analytics

- **Daily Summaries** - Hours worked, breaks taken, regular/OT/DT breakdown
- **Weekly Summaries** - Aggregated hours by staff with totals
- **Payroll Reports** - PDF-exportable payroll per employee
- **Attendance Reports** - Days present/absent, attendance rate
- **CSV Export** - Data export for external systems

### 5. Payroll Workflow

- Calculate weekly hours and earnings
- Approval workflow (Pending → Approved → Paid)
- Payment date tracking
- Support for both hourly wage and piece work calculations

---

## Facial Recognition Integration

The module is designed to receive data from a standalone facial recognition application:

### Current Integration Points
- Clock events record verification method (`facial`, `manual`, `system`)
- Confidence score storage (0-100) for recognition quality
- Staff facial profile linking via `get_facial_profiles_for_active_staff()` function
- Events from facial recognition system integrate seamlessly with the time tracking pipeline

### Future Enhancement (Planned)
The facial recognition app can be merged directly into Unity, eliminating the need for separate application management.

---

## Technical Architecture

### Data Flow
```
Facial Recognition / Manual Entry
        ↓
time_clock_events (raw events)
        ↓
Segment Processing
        ↓
time_segments (paired work/break periods)
        ↓
Daily Summary Generation
        ↓
time_daily_summary (daily totals with payroll calculations)
```

### Database Tables
- `staff` - Employee master data with hourly rates
- `time_clock_events` - Single source of truth for all clock events
- `time_segments` - Processed work/break periods
- `time_daily_summary` - Daily aggregates with payroll calculations

### Timezone Handling
- All times handled in SAST (South African Standard Time, UTC+2)
- Proper midnight boundary handling for overnight shifts

---

## User Interface

### Pages
1. **Staff Hub** (`/staff`) - Central staff management
2. **Hours Tracking** (`/staff/hours`) - Four tabs:
   - Daily Attendance - Grid view of all staff
   - Quick Entry - Bulk time entry interface
   - Weekly Summary - Aggregated weekly view
   - Reports - Payroll and attendance reports
3. **Payroll** (`/staff/payroll`) - Calculation and management

### Key Workflows

**Recording Attendance:**
1. Select date using date picker
2. View all staff with their current clock status
3. Add clock events (manual) or receive from facial recognition
4. System automatically calculates hours and pay

**Generating Payroll:**
1. Navigate to Weekly Summary
2. Select week and staff
3. Review hours breakdown (Regular/OT/DT)
4. Export to PDF for payroll processing
5. Mark as approved/paid

---

## Business Value

### For Management
- Real-time visibility into workforce presence
- Automated compliance with labor regulations
- Accurate cost tracking per employee
- Reduced payroll processing time

### For HR/Payroll
- Elimination of manual calculations
- Audit trail for all time entries
- Easy handling of overtime and Sunday work
- PDF reports for record keeping

### For Supervisors
- Quick daily attendance overview
- Mass clock actions for team management
- Missing clock-out detection
- Break tracking and management

---

## Integration Points

- **Facial Recognition App** - Receives biometric clock events
- **Labor Planning Module** - Staff scheduling integration (optional add-on)
- **Reports Module** - Exports to external systems

---

## What's Included

✅ Staff master data management
✅ Time clock event recording
✅ Automatic segment processing
✅ Payroll calculations (Regular/OT/DT)
✅ Tea break auto-deduction rules
✅ Daily attendance dashboard
✅ Weekly summary reports
✅ PDF export for payroll
✅ CSV data export
✅ Facial recognition integration points
✅ Mass clock actions
✅ Approval workflow

---

## Requirements

- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection
- Supabase database access
- Optional: Facial recognition hardware + app

---

*Document Version: 1.0*
*Last Updated: January 2025*
