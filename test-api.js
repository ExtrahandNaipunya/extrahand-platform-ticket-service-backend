const http = require('http');

const data = JSON.stringify({
    customer_name: 'Debug User',
    customer_email: 'debug@gmail.com'
});

const options = {
    hostname: 'localhost',
    port: 8001,
    path: '/api/sessions',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => body += chunk);
    res.on('end', () => {
        console.log('--- API Response ---');
        console.log('Status Code:', res.statusCode);
        console.log('Body:', body);
    });
});

req.on('error', (error) => {
    console.error('Request Error:', error.message);
});

req.write(data);
req.end();
