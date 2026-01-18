# User Control & Access Management Module - Project Specification

**Module Price:** R3,000

---

## Executive Summary

The User Control & Access Management Module provides enterprise-grade security, granular permissions, and comprehensive audit logging across all Unity ERP modules. It enables organizations to control who can access what, track all user activity, and maintain compliance with security requirements.

This module is **foundational** - its features enhance every other module in the system by adding access control and audit capabilities.

---

## Current State (Included in Base Platform)

The base platform includes basic authentication:

| Feature | Status | Description |
|---------|--------|-------------|
| User Login | ✅ Basic | Supabase Auth with password |
| 4 Role Tiers | ✅ Basic | Owner, Admin, Manager, Staff |
| Admin User Management | ✅ Basic | Create users, reset passwords |
| Organization Structure | ✅ Basic | Multi-org support (tables exist) |
| Admin Audit Log | ✅ Basic | Logs user creation/role changes only |

---

## Module Features (What You're Paying For)

### 1. Granular Module-Level Permissions

Control access to each module independently:

| Module | View | Create | Edit | Delete | Approve |
|--------|------|--------|------|--------|---------|
| Quotes | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ |
| Orders | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ |
| Purchasing | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ |
| Inventory | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ |
| Staff/Payroll | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ |
| Suppliers | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ |
| Products | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ |
| Customers | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ |
| Reports | ✅/❌ | — | — | — | — |
| Admin/Users | ✅/❌ | ✅/❌ | ✅/❌ | ✅/❌ | — |

**Permission Types:**
- **View** - Can see data but not modify
- **Create** - Can create new records
- **Edit** - Can modify existing records
- **Delete** - Can remove records
- **Approve** - Can approve workflows (POs, payroll, quotes)

### 2. Access Control Groups (Roles)

Create custom roles with specific permission sets:

**Pre-configured Roles:**
- **Owner** - Full access to everything
- **Admin** - User management + all operations
- **Manager** - Operations access, no admin
- **Staff** - Limited operational access

**Custom Roles:**
- Create roles like "Purchasing Manager" or "Inventory Clerk"
- Assign specific permissions per module
- Clone existing roles as starting point
- Name and describe roles for clarity

**Role Assignment:**
- Assign users to one or more roles
- Roles stack (user gets union of all permissions)
- Override specific permissions per user if needed

### 3. Comprehensive Activity Logging

Track ALL user actions across the system:

#### Activity Types Logged
- **Data Changes** - Every create, update, delete
- **View Events** - Optional: track who viewed sensitive data
- **Login/Logout** - Authentication events
- **Failed Attempts** - Security monitoring
- **Approvals** - Workflow state changes
- **Exports** - PDF generation, CSV downloads
- **Email Sends** - Quote/PO emails sent

#### Log Entry Structure
```
{
  timestamp: "2025-01-18T10:30:00+02:00",
  user_id: "abc-123",
  user_name: "John Smith",
  action: "update",
  module: "inventory",
  entity_type: "component",
  entity_id: "comp-456",
  entity_name: "Steel Bracket 50mm",
  changes: {
    quantity_on_hand: { from: 100, to: 85 },
    location: { from: "Warehouse A", to: "Warehouse B" }
  },
  ip_address: "192.168.1.100",
  user_agent: "Chrome 120..."
}
```

### 4. Audit Trail Interface

**Activity Log Viewer:**
- Filter by date range
- Filter by user
- Filter by module
- Filter by action type (create/update/delete)
- Search by entity name or ID
- Export to CSV

**Per-Record History:**
- View full change history on any record
- See who changed what and when
- Compare versions side-by-side
- Restore previous values (with permission)

### 5. User Management Enhancements

**User Profiles:**
- Profile photo/avatar
- Contact details
- Department/team assignment
- Direct manager assignment
- Employment details (for staff module integration)

**User Status Management:**
- Active/Inactive toggle
- Temporary suspension with date range
- Account lockout after failed attempts
- Password expiry policies (optional)

**Bulk Operations:**
- Bulk role assignment
- Bulk activation/deactivation
- Import users from CSV

### 6. Organization & Multi-Tenant Support

**Organization Isolation:**
- Each organization sees only their data
- Row-level security enforced at database level
- Cross-org data completely invisible

**Multi-Organization Users:**
- Single user can belong to multiple orgs
- Different roles per organization
- Switch between orgs in UI

### 7. Security Features

**Session Management:**
- View active sessions
- Force logout from all devices
- Session timeout configuration

**Password Policies:**
- Minimum length requirements
- Complexity rules (optional)
- Password history (prevent reuse)
- Expiry reminders

**Two-Factor Authentication (2FA):**
- Optional 2FA via authenticator app
- Backup codes for recovery
- Admin can require 2FA for specific roles

### 8. Permission Inheritance

**Hierarchical Permissions:**
- Department-level defaults
- Team-level overrides
- User-level exceptions

**Effective Permissions View:**
- See calculated permissions for any user
- Understand where each permission comes from
- Debug access issues quickly

---

## User Interface

### Admin → Users Page (Enhanced)
- User list with role badges
- Status indicators (active, suspended, locked)
- Last login timestamp
- Quick actions (edit, roles, reset password, deactivate)
- Bulk selection and actions

### Admin → Roles Page (New)
- List of all roles (built-in and custom)
- Permission matrix view
- Create/edit role dialogs
- User count per role
- Clone role functionality

### Admin → Activity Log Page (New)
- Timeline view of all activity
- Advanced filters panel
- Detail drawer for each event
- Export functionality
- Real-time updates (optional)

### Admin → Security Page (New)
- Active sessions list
- Login history
- Failed attempt alerts
- Security settings configuration

### Per-Record History Tab
- Added to all major entities (orders, quotes, components, etc.)
- Shows change timeline
- Expandable change details
- User attribution

---

## Database Schema

### New Tables

**roles**
```sql
- role_id (PK)
- role_name (unique)
- description
- is_system (boolean) -- built-in vs custom
- created_at
- created_by
```

**role_permissions**
```sql
- role_id (FK)
- module (text) -- quotes, orders, inventory, etc.
- permission (text) -- view, create, edit, delete, approve
- granted (boolean)
- PRIMARY KEY (role_id, module, permission)
```

**user_roles**
```sql
- user_id (FK)
- role_id (FK)
- org_id (FK)
- assigned_at
- assigned_by
- PRIMARY KEY (user_id, role_id, org_id)
```

**user_permission_overrides**
```sql
- user_id (FK)
- org_id (FK)
- module (text)
- permission (text)
- granted (boolean) -- override role setting
- PRIMARY KEY (user_id, org_id, module, permission)
```

**activity_log**
```sql
- log_id (PK, bigint)
- timestamp (timestamptz)
- user_id (FK)
- org_id (FK)
- action (text) -- create, update, delete, view, export, email
- module (text)
- entity_type (text)
- entity_id (text)
- entity_name (text)
- changes (jsonb) -- {field: {from, to}}
- metadata (jsonb) -- ip, user_agent, etc.
```

**login_history**
```sql
- id (PK)
- user_id (FK)
- timestamp (timestamptz)
- success (boolean)
- ip_address (text)
- user_agent (text)
- failure_reason (text, nullable)
```

**active_sessions**
```sql
- session_id (PK)
- user_id (FK)
- created_at (timestamptz)
- last_activity (timestamptz)
- ip_address (text)
- user_agent (text)
- is_current (boolean)
```

### Enhanced RLS Policies

All domain tables will receive org-scoped RLS:

```sql
-- Example for components table
CREATE POLICY "org_isolation" ON components
  FOR ALL
  TO authenticated
  USING (public.is_org_member(org_id))
  WITH CHECK (public.is_org_member(org_id));
```

Permission checking function:

```sql
CREATE FUNCTION has_permission(p_module text, p_permission text)
RETURNS boolean AS $$
  -- Check user_permission_overrides first
  -- Then check role_permissions via user_roles
  -- Return true if any grant found
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## API Endpoints

### Role Management
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/roles` | GET | List all roles |
| `/api/admin/roles` | POST | Create custom role |
| `/api/admin/roles/[id]` | GET | Get role details with permissions |
| `/api/admin/roles/[id]` | PUT | Update role |
| `/api/admin/roles/[id]` | DELETE | Delete custom role |
| `/api/admin/roles/[id]/clone` | POST | Clone role |
| `/api/admin/roles/[id]/permissions` | PUT | Update role permissions |

### User Role Assignment
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/users/[id]/roles` | GET | Get user's roles |
| `/api/admin/users/[id]/roles` | PUT | Update user's roles |
| `/api/admin/users/[id]/permissions` | GET | Get effective permissions |
| `/api/admin/users/[id]/overrides` | PUT | Set permission overrides |

### Activity Log
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/activity` | GET | Query activity log |
| `/api/admin/activity/export` | GET | Export to CSV |
| `/api/admin/activity/[entity]/[id]` | GET | Get entity history |

### Security
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/sessions` | GET | List active sessions |
| `/api/admin/sessions/[id]` | DELETE | Force logout session |
| `/api/admin/users/[id]/sessions` | DELETE | Logout user everywhere |
| `/api/admin/login-history` | GET | Query login history |

---

## Integration with Other Modules

This module integrates with ALL other modules:

### Quotes Module
- Permission check before create/edit/delete/send
- Activity log on all quote actions
- History tab showing quote changes

### Orders Module
- Permission check on order operations
- Approval permission for order confirmation
- Full order change history

### Inventory Module
- Permission check on stock adjustments
- Log all stock movements with user attribution
- Audit trail for inventory transactions

### Purchasing Module
- PO approval permission
- Receiving permission separate from creation
- Email send logging

### Staff/Payroll Module
- Sensitive data access controls
- Payroll approval permission
- Clock event audit trail

### All Modules
- Sidebar shows only accessible modules
- Buttons hidden for unpermitted actions
- API returns 403 for unauthorized requests

---

## Deliverables

1. ✅ Role management system (CRUD)
2. ✅ Permission matrix per role
3. ✅ User role assignment
4. ✅ Permission override capability
5. ✅ Activity logging infrastructure
6. ✅ Activity log viewer with filters
7. ✅ Per-entity history tabs
8. ✅ Organization isolation (RLS)
9. ✅ Login history tracking
10. ✅ Session management
11. ✅ Enhanced user management UI
12. ✅ Permission checking middleware
13. ✅ Sidebar permission filtering
14. ✅ Database migrations
15. ✅ API endpoints

---

## What's Included

✅ Custom role creation and management
✅ Granular module-level permissions (view/create/edit/delete/approve)
✅ User role assignment with multi-role support
✅ Permission override capability per user
✅ Comprehensive activity logging across all modules
✅ Activity log viewer with advanced filtering
✅ Per-record change history tabs
✅ Organization data isolation (RLS)
✅ Login history and failed attempt tracking
✅ Active session management
✅ Force logout capability
✅ Enhanced user profile management
✅ Bulk user operations
✅ Sidebar filtering based on permissions
✅ API permission enforcement

---

## What's NOT Included (Future Enhancements)

❌ Two-Factor Authentication (2FA) - can be added
❌ Single Sign-On (SSO) integration
❌ LDAP/Active Directory sync
❌ IP whitelisting
❌ Advanced password policies
❌ Scheduled access (time-based permissions)
❌ Data masking for sensitive fields
❌ Approval workflows (separate module)

---

## Business Value

### For Management
- Know exactly who can access what
- Audit trail for compliance
- Reduce risk of unauthorized changes
- Track user productivity

### For IT/Security
- Granular access control
- Security monitoring
- Incident investigation capability
- Compliance reporting

### For Operations
- Role-based workflows
- Clear permission boundaries
- Approval chains
- Accountability

### For Compliance
- Complete audit trail
- User activity records
- Access control documentation
- Data isolation proof

---

## Timeline

| Phase | Duration | Activities |
|-------|----------|------------|
| Foundation | 2-3 days | Database schema, RLS policies |
| Roles | 3-4 days | Role CRUD, permission matrix |
| Logging | 3-4 days | Activity log infrastructure, triggers |
| UI | 4-5 days | Admin pages, history tabs |
| Integration | 3-4 days | Permission checks across all modules |
| Testing | 2-3 days | Security testing, edge cases |

**Estimated Total:** 3-4 weeks

---

## Acceptance Criteria

1. Admin can create custom roles with specific permissions
2. Users assigned to roles see only permitted modules
3. Unpermitted actions are blocked (UI hidden, API returns 403)
4. All data changes logged with user attribution
5. Activity log viewer shows complete history
6. Per-record history shows change timeline
7. Organizations see only their own data
8. Login history tracked with IP/device info
9. Admin can force logout users
10. Permission checks enforced across all modules

---

*Document Version: 1.0*
*Last Updated: January 2025*
