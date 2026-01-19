require('dotenv').config();

console.log('='.repeat(80));
console.log('DATABASE_URL CHECK');
console.log('='.repeat(80));
console.log('Full URL:', process.env.DATABASE_URL);
console.log('='.repeat(80));

// Extract parts
if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    const match = url.match(/postgresql:\/\/([^:]+):([^@]+)@([^\/]+)\/(.+)/);
    if (match) {
        console.log('User:', match[1]);
        console.log('Password:', match[2]);
        console.log('Host:', match[3]);
        console.log('Database:', match[4]);
    }
}
console.log('='.repeat(80));
