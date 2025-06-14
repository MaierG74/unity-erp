import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Get environment info
    const envInfo = {
      NODE_ENV: process.env.NODE_ENV,
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'Set' : 'Not set',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'Set' : 'Not set'
    };

    // Test Supabase connection
    let dbStatus = 'Unknown';
    let error = null;
    
    try {
      const { data, error: dbError } = await supabase.from('components').select('count').single();
      if (dbError) {
        dbStatus = 'Error';
        error = dbError.message;
      } else {
        dbStatus = 'Connected';
      }
    } catch (e) {
      dbStatus = 'Exception';
      error = e instanceof Error ? e.message : String(e);
    }

    // Return the HTML page with debug info and clear button
    return new NextResponse(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Unity ERP - Debug</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          h1 { color: #333; }
          .card { border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 20px; background: #f9f9f9; }
          button { background: #F26B3A; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; }
          pre { background: #eee; padding: 10px; border-radius: 4px; overflow-x: auto; }
          .error { color: #e74c3c; }
          .success { color: #2ecc71; }
        </style>
      </head>
      <body>
        <h1>Unity ERP - Debug Page</h1>
        
        <div class="card">
          <h2>Environment</h2>
          <pre>${JSON.stringify(envInfo, null, 2)}</pre>
        </div>
        
        <div class="card">
          <h2>Database Status</h2>
          <p>Status: <span class="${dbStatus === 'Connected' ? 'success' : 'error'}">${dbStatus}</span></p>
          ${error ? `<p class="error">Error: ${error}</p>` : ''}
        </div>
        
        <div class="card">
          <h2>Clear Local Storage</h2>
          <p>Click the button below to clear your local storage and redirect to the home page.</p>
          <button onclick="clearLocalStorageAndRedirect()">Clear and Redirect</button>
        </div>
        
        <script>
          function clearLocalStorageAndRedirect() {
            // Clear all local storage 
            localStorage.clear();
            
            // Clear all cookies for this domain
            document.cookie.split(';').forEach(function(c) {
              document.cookie = c.trim().split('=')[0] + '=;expires=Thu, 01 Jan 1970 00:00:00 UTC;path=/';
            });
            
            // Redirect to home
            window.location.href = '/';
          }
        </script>
      </body>
      </html>
    `, {
      headers: {
        'Content-Type': 'text/html',
      },
    });
  } catch (error) {
    console.error('Debug page error:', error);
    return NextResponse.json(
      { 
        status: 'error', 
        message: 'Server error', 
        error: error instanceof Error ? error.message : String(error) 
      }, 
      { status: 500 }
    );
  }
} 