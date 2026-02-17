const http = require('http');

// Test customer history endpoint
const testEmail = 'admin@gmail.com'; // Use the email from your test

const options = {
    hostname: 'localhost',
    port: 8001,
    path: `/api/customer/history/${testEmail}`,
    method: 'GET',
    headers: {
        'Content-Type': 'application/json'
    }
};

const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        console.log('--- Customer History Response ---');
        console.log('Status Code:', res.statusCode);
        console.log('Body:', JSON.parse(body));
    });
});

req.on('error', (error) => {
    console.error('Request Error:', error.message);
});

req.end();
