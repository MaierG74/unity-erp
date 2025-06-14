// Add console message to indicate this script should be run in browser console
console.log('--- COPY PASTE THIS SCRIPT INTO YOUR BROWSER CONSOLE ON THE ORDER PAGE ---');

// Function to fix order #2 status
async function fixOrderStatus() {
  try {
    // Fetch the Completed status ID
    const { data: statusData, error: statusError } = await supabase
      .from('supplier_order_statuses')
      .select('status_id')
      .eq('status_name', 'Completed')
      .single();
      
    if (statusError) {
      console.error('Error fetching status:', statusError);
      return;
    }
    
    console.log('Found Completed status ID:', statusData.status_id);
    
    // Update order #2 status to Completed
    const { error: updateError } = await supabase
      .from('supplier_orders')
      .update({ status_id: statusData.status_id })
      .eq('order_id', 2);
      
    if (updateError) {
      console.error('Error updating order status:', updateError);
      return;
    }
    
    console.log('Successfully updated order #2 status to Completed');
    console.log('Please refresh the page to see the updated status');
  } catch (error) {
    console.error('Unexpected error:', error);
  }
}

// Execute the function
fixOrderStatus(); 