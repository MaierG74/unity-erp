'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, DollarSign, Calculator, FileText } from 'lucide-react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { format, startOfWeek, endOfWeek, addDays, addWeeks, subWeeks, parseISO, isSunday } from 'date-fns';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle, 
  DialogTrigger 
} from '@/components/ui/dialog';

export default function PayrollPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<any[]>([]);
  const [payrollData, setPayrollData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedStaff, setSelectedStaff] = useState<string | null>(null);
  const [selectedWeekStart, setSelectedWeekStart] = useState<Date>(
    startOfWeek(new Date(), { weekStartsOn: 1 })
  );
  const [calculatingPayroll, setCalculatingPayroll] = useState(false);
  const [payrollDetails, setPayrollDetails] = useState<any | null>(null);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);

  const fetchStaff = async () => {
    try {
      const { data, error: staffError } = await supabase
        .from('staff')
        .select('staff_id, first_name, last_name')
        .eq('is_active', true);
      
      if (staffError) throw staffError;
      setStaff(data || []);
      
      if (data && data.length > 0 && !selectedStaff) {
        setSelectedStaff(data[0].staff_id.toString());
      }
    } catch (err: any) {
      console.error('Error fetching staff:', err);
      setError(err.message || 'Failed to load staff data');
    }
  };

  const fetchPayrollData = async () => {
    if (!selectedStaff) return;
    
    setLoading(true);
    try {
      // Fetch payroll summaries for the staff member
      const { data, error: payrollError } = await supabase
        .from('staff_weekly_payroll')
        .select('*')
        .eq('staff_id', selectedStaff)
        .order('week_start_date', { ascending: false })
        .limit(10);
      
      if (payrollError) throw payrollError;
      setPayrollData(data || []);
    } catch (err: any) {
      console.error('Error fetching payroll data:', err);
      setError(err.message || 'Failed to load payroll data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStaff();
  }, []);

  useEffect(() => {
    if (selectedStaff) {
      fetchPayrollData();
    }
  }, [selectedStaff]);

  const handleStaffChange = (value: string) => {
    setSelectedStaff(value);
  };

  const navigateWeek = (direction: 'prev' | 'next') => {
    const newDate = direction === 'prev' 
      ? subWeeks(selectedWeekStart, 1) 
      : addWeeks(selectedWeekStart, 1);
    setSelectedWeekStart(newDate);
  };

  const calculatePayroll = async () => {
    if (!selectedStaff) return;
    
    setCalculatingPayroll(true);
    setError(null);
    
    try {
      const weekEnd = endOfWeek(selectedWeekStart, { weekStartsOn: 1 });
      const staffMember = staff.find(s => s.staff_id.toString() === selectedStaff);
      
      // Fetch staff details
      const { data: staffData, error: staffError } = await supabase
        .from('staff')
        .select('*')
        .eq('staff_id', selectedStaff)
        .single();
      
      if (staffError) throw staffError;
      
      // Fetch hours for the week
      const { data: hoursData, error: hoursError } = await supabase
        .from('staff_hours')
        .select('*')
        .eq('staff_id', selectedStaff)
        .gte('date_worked', selectedWeekStart.toISOString().split('T')[0])
        .lte('date_worked', weekEnd.toISOString().split('T')[0]);
      
      if (hoursError) throw hoursError;
      
      // Fetch completed job card items for the week
      const { data: jobCardItems, error: jobCardError } = await supabase
        .from('job_card_items')
        .select(`
          *,
          job_cards!inner(staff_id, completion_date)
        `)
        .gte('job_cards.completion_date', selectedWeekStart.toISOString().split('T')[0])
        .lte('job_cards.completion_date', weekEnd.toISOString().split('T')[0])
        .eq('job_cards.staff_id', selectedStaff)
        .eq('status', 'completed');
      
      if (jobCardError) throw jobCardError;
      
      // Calculate total hours worked
      const totalHours = hoursData?.reduce((sum, hour) => sum + parseFloat(hour.hours_worked), 0) || 0;
      
      // Separate regular, overtime, and doubletime hours
      const weeklyHours = staffData.weekly_hours || 40;
      
      // Extract regular, overtime, and doubletime hours from the data
      let regularHours = 0;
      let overtimeHours = 0;
      let doubletimeHours = 0;
      
      // Process each day's hours
      hoursData?.forEach(day => {
        if (day.is_holiday || isSunday(new Date(day.date_worked))) {
          // Sunday or holiday hours are doubletime
          doubletimeHours += day.hours_worked;
        } else {
          // Regular day hours
          regularHours += day.hours_worked;
          
          // Add any explicitly marked overtime
          if (day.overtime_hours) {
            if (day.overtime_rate === 2.0) {
              doubletimeHours += day.overtime_hours;
            } else {
              overtimeHours += day.overtime_hours;
            }
          }
        }
      });
      
      // Check if regular hours exceed weekly limit and convert excess to overtime
      if (regularHours > weeklyHours) {
        const excessHours = regularHours - weeklyHours;
        overtimeHours += excessHours;
        regularHours = weeklyHours;
      }
      
      // Calculate hourly wage
      const hourlyRate = staffData.hourly_rate;
      const overtimeRate = hourlyRate * 1.5; // Overtime at 1.5x
      const doubletimeRate = hourlyRate * 2.0; // Doubletime at 2.0x
      const hourlyWageTotal = 
        (regularHours * hourlyRate) + 
        (overtimeHours * overtimeRate) + 
        (doubletimeHours * doubletimeRate);
      
      // Calculate piece work total
      const pieceWorkTotal = jobCardItems?.reduce((sum, item) => {
        return sum + (item.completed_quantity * item.piece_rate);
      }, 0) || 0;
      
      // Determine final payment (higher of hourly or piece work)
      const finalPayment = Math.max(hourlyWageTotal, pieceWorkTotal);
      
      // Check if payroll record already exists
      const { data: existingPayroll, error: existingError } = await supabase
        .from('staff_weekly_payroll')
        .select('payroll_id')
        .eq('staff_id', selectedStaff)
        .eq('week_start_date', selectedWeekStart.toISOString().split('T')[0])
        .maybeSingle();
      
      if (existingError) throw existingError;
      
      // Insert or update payroll record
      let payrollRecord;
      
      if (existingPayroll) {
        // Update existing record
        const { data: updatedRecord, error: updateError } = await supabase
          .from('staff_weekly_payroll')
          .update({
            regular_hours: regularHours,
            overtime_hours: overtimeHours,
            doubletime_hours: doubletimeHours,
            hourly_wage_total: hourlyWageTotal,
            piece_work_total: pieceWorkTotal,
            final_payment: finalPayment,
            updated_at: new Date().toISOString(),
          })
          .eq('payroll_id', existingPayroll.payroll_id)
          .select()
          .single();
        
        if (updateError) throw updateError;
        payrollRecord = updatedRecord;
      } else {
        // Insert new record
        const { data: newRecord, error: insertError } = await supabase
          .from('staff_weekly_payroll')
          .insert([
            {
              staff_id: parseInt(selectedStaff),
              week_start_date: selectedWeekStart.toISOString().split('T')[0],
              week_end_date: weekEnd.toISOString().split('T')[0],
              regular_hours: regularHours,
              overtime_hours: overtimeHours,
              doubletime_hours: doubletimeHours,
              hourly_wage_total: hourlyWageTotal,
              piece_work_total: pieceWorkTotal,
              final_payment: finalPayment,
              status: 'pending',
            },
          ])
          .select()
          .single();
        
        if (insertError) throw insertError;
        payrollRecord = newRecord;
      }
      
      // Set payroll details for display
      setPayrollDetails({
        ...payrollRecord,
        staff_name: `${staffMember.first_name} ${staffMember.last_name}`,
        hourly_rate: hourlyRate,
        weekly_hours: weeklyHours,
        hours_data: hoursData,
        job_card_items: jobCardItems,
      });
      
      setShowDetailsDialog(true);
      fetchPayrollData(); // Refresh the payroll list
    } catch (err: any) {
      console.error('Error calculating payroll:', err);
      setError(err.message || 'Failed to calculate payroll');
    } finally {
      setCalculatingPayroll(false);
    }
  };

  const approvePayroll = async (payrollId: number) => {
    try {
      const { error } = await supabase
        .from('staff_weekly_payroll')
        .update({
          status: 'approved',
          updated_at: new Date().toISOString(),
        })
        .eq('payroll_id', payrollId);
      
      if (error) throw error;
      
      fetchPayrollData(); // Refresh the data
    } catch (err: any) {
      console.error('Error approving payroll:', err);
      setError(err.message || 'Failed to approve payroll');
    }
  };

  const markAsPaid = async (payrollId: number) => {
    try {
      const { error } = await supabase
        .from('staff_weekly_payroll')
        .update({
          status: 'paid',
          payment_date: new Date().toISOString().split('T')[0],
          updated_at: new Date().toISOString(),
        })
        .eq('payroll_id', payrollId);
      
      if (error) throw error;
      
      fetchPayrollData(); // Refresh the data
    } catch (err: any) {
      console.error('Error marking payroll as paid:', err);
      setError(err.message || 'Failed to mark payroll as paid');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline">Pending</Badge>;
      case 'approved':
        return <Badge variant="secondary">Approved</Badge>;
      case 'paid':
        return <Badge variant="success">Paid</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center">
        <Button variant="ghost" size="sm" asChild className="mr-2">
          <Link href="/staff">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Staff
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Staff Payroll</h1>
      </div>

      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <Select value={selectedStaff || ''} onValueChange={handleStaffChange}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select staff member" />
            </SelectTrigger>
            <SelectContent>
              {staff.map((s) => (
                <SelectItem key={s.staff_id} value={s.staff_id.toString()}>
                  {s.first_name} {s.last_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          <div className="flex items-center space-x-2">
            <Button variant="outline" size="sm" onClick={() => navigateWeek('prev')}>
              Previous Week
            </Button>
            <span className="font-medium">
              {format(selectedWeekStart, 'MMM d')} - {format(addDays(selectedWeekStart, 6), 'MMM d, yyyy')}
            </span>
            <Button variant="outline" size="sm" onClick={() => navigateWeek('next')}>
              Next Week
            </Button>
          </div>
        </div>
        
        <Button onClick={calculatePayroll} disabled={calculatingPayroll || !selectedStaff}>
          <Calculator className="mr-2 h-4 w-4" />
          {calculatingPayroll ? 'Calculating...' : 'Calculate Payroll'}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Payroll History</CardTitle>
          <CardDescription>
            {selectedStaff && staff.length > 0 
              ? `Payroll history for ${staff.find(s => s.staff_id.toString() === selectedStaff)?.first_name} ${staff.find(s => s.staff_id.toString() === selectedStaff)?.last_name}`
              : 'Select a staff member to view payroll history'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <p>Loading payroll data...</p>
            </div>
          ) : payrollData.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No payroll records found for this staff member.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Week</TableHead>
                  <TableHead>Regular Hours</TableHead>
                  <TableHead>Overtime (1.5x)</TableHead>
                  <TableHead>Doubletime (2x)</TableHead>
                  <TableHead>Hourly Total</TableHead>
                  <TableHead>Piece Work Total</TableHead>
                  <TableHead>Final Payment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payrollData.map((payroll) => (
                  <TableRow key={payroll.payroll_id}>
                    <TableCell className="font-medium">
                      {format(new Date(payroll.week_start_date), 'MMM d')} - {format(new Date(payroll.week_end_date), 'MMM d, yyyy')}
                    </TableCell>
                    <TableCell>{payroll.regular_hours}</TableCell>
                    <TableCell>{payroll.overtime_hours}</TableCell>
                    <TableCell>{payroll.doubletime_hours || 0}</TableCell>
                    <TableCell>${payroll.hourly_wage_total.toFixed(2)}</TableCell>
                    <TableCell>${payroll.piece_work_total.toFixed(2)}</TableCell>
                    <TableCell className="font-bold">${payroll.final_payment.toFixed(2)}</TableCell>
                    <TableCell>{getStatusBadge(payroll.status)}</TableCell>
                    <TableCell>
                      <div className="flex space-x-2">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => {
                            setPayrollDetails({
                              ...payroll,
                              staff_name: staff.find(s => s.staff_id.toString() === selectedStaff)
                                ? `${staff.find(s => s.staff_id.toString() === selectedStaff)?.first_name} ${staff.find(s => s.staff_id.toString() === selectedStaff)?.last_name}`
                                : 'Staff Member'
                            });
                            setShowDetailsDialog(true);
                          }}
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                        {payroll.status === 'pending' && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => approvePayroll(payroll.payroll_id)}
                          >
                            Approve
                          </Button>
                        )}
                        {payroll.status === 'approved' && (
                          <Button 
                            variant="outline" 
                            size="sm"
                            onClick={() => markAsPaid(payroll.payroll_id)}
                          >
                            Mark Paid
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Payroll Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Payroll Details</DialogTitle>
            <DialogDescription>
              {payrollDetails && (
                <span>
                  Week of {format(new Date(payrollDetails.week_start_date), 'MMM d')} - {format(new Date(payrollDetails.week_end_date), 'MMM d, yyyy')} for {payrollDetails.staff_name}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          
          {payrollDetails && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <h3 className="font-medium">Hours Summary</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>Regular Hours:</div>
                    <div className="font-medium">{payrollDetails.regular_hours}</div>
                    <div>Overtime Hours (1.5x):</div>
                    <div className="font-medium">{payrollDetails.overtime_hours}</div>
                    <div>Doubletime Hours (2x):</div>
                    <div className="font-medium">{payrollDetails.doubletime_hours || 0}</div>
                    <div>Total Hours:</div>
                    <div className="font-medium">
                      {(payrollDetails.regular_hours + payrollDetails.overtime_hours + (payrollDetails.doubletime_hours || 0)).toFixed(2)}
                    </div>
                    <div>Hourly Rate:</div>
                    <div className="font-medium">${payrollDetails.hourly_rate?.toFixed(2) || 'N/A'}</div>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <h3 className="font-medium">Payment Summary</h3>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div>Hourly Wage Total:</div>
                    <div className="font-medium">${payrollDetails.hourly_wage_total.toFixed(2)}</div>
                    <div>Piece Work Total:</div>
                    <div className="font-medium">${payrollDetails.piece_work_total.toFixed(2)}</div>
                    <div>Final Payment:</div>
                    <div className="font-bold">${payrollDetails.final_payment.toFixed(2)}</div>
                    <div>Payment Method:</div>
                    <div className="font-medium">
                      {payrollDetails.hourly_wage_total >= payrollDetails.piece_work_total ? 'Hourly Wage' : 'Piece Work'}
                    </div>
                  </div>
                </div>
              </div>
              
              <div className="space-y-2">
                <h3 className="font-medium">Status</h3>
                <div className="flex items-center space-x-2">
                  {getStatusBadge(payrollDetails.status)}
                  {payrollDetails.payment_date && (
                    <span className="text-sm text-muted-foreground">
                      Paid on {format(new Date(payrollDetails.payment_date), 'MMM d, yyyy')}
                    </span>
                  )}
                </div>
              </div>
              
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowDetailsDialog(false)}>
                  Close
                </Button>
                {payrollDetails.status === 'pending' && (
                  <Button onClick={() => {
                    approvePayroll(payrollDetails.payroll_id);
                    setShowDetailsDialog(false);
                  }}>
                    Approve Payroll
                  </Button>
                )}
                {payrollDetails.status === 'approved' && (
                  <Button onClick={() => {
                    markAsPaid(payrollDetails.payroll_id);
                    setShowDetailsDialog(false);
                  }}>
                    Mark as Paid
                  </Button>
                )}
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
} 