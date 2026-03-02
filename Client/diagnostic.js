// Diagnostic script to check localStorage token
console.log('=== DIAGNOSTIC ===');
console.log('Token in localStorage:', localStorage.getItem('token') ? 'EXISTS' : 'MISSING');
console.log('Token value:', localStorage.getItem('token')?.substring(0, 50) + '...');
console.log('==================');
